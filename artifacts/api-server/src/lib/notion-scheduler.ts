import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db, featureRequestsTable } from "@workspace/db";
import { logger } from "./logger";
import { requestUrl } from "./email";
import {
  createNotionPage,
  getNotionPage,
  isNotionConfigured,
} from "./notion";

const PUSH_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const PUSH_STARTUP_DELAY_MS = 50_000;
const POLL_STARTUP_DELAY_MS = 25_000;

let pushRunning = false;
let pollRunning = false;
let pushTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastPushAt: Date | null = null;
let lastPollAt: Date | null = null;
let lastPushError: string | null = null;
let lastPollError: string | null = null;

export function getNotionSchedulerStatus() {
  return {
    configured: isNotionConfigured(),
    pushRunning,
    pollRunning,
    lastPushAt: lastPushAt?.toISOString() ?? null,
    lastPollAt: lastPollAt?.toISOString() ?? null,
    lastPushError,
    lastPollError,
  };
}

/**
 * Find planned, human-routed feature requests that have never been attempted
 * and create a Notion page for each. Same fire-and-forget semantics as the
 * Paperclip push: every eligible row is attempted at most once by the
 * scheduler.
 *   - Eligible: status='planned' AND engineeringOwner='human'
 *     AND notionPageId IS NULL AND notionPushedAt IS NULL
 *     AND notionPushError IS NULL.
 *   - On success: store pageId/url + initial status. notionPushedAt is set.
 *   - On failure: record the error AND set notionPushedAt so we do NOT
 *     auto-retry. Admins re-attempt via the per-request "Retry push" button.
 *
 * Unlike Paperclip we skip post-failure marker reconciliation: the Notion API
 * returns the created page id transactionally, so a duplicate-on-5xx is not a
 * realistic failure mode here.
 */
export async function runNotionPushOnce(): Promise<{
  attempted: number;
  pushed: number;
  failed: number;
}> {
  if (!isNotionConfigured()) return { attempted: 0, pushed: 0, failed: 0 };
  const rows = await db
    .select()
    .from(featureRequestsTable)
    .where(
      and(
        eq(featureRequestsTable.status, "planned"),
        eq(featureRequestsTable.engineeringOwner, "human"),
        isNull(featureRequestsTable.notionPageId),
        isNull(featureRequestsTable.notionPushedAt),
        isNull(featureRequestsTable.notionPushError),
      ),
    );
  if (rows.length === 0) return { attempted: 0, pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;
  for (const fr of rows) {
    const result = await pushSingleToNotion(fr.id);
    if (result.ok) pushed++;
    else failed++;
  }
  return { attempted: rows.length, pushed, failed };
}

/**
 * Create a Notion page for exactly one feature request. Used by both the
 * scheduler and the manual "Retry push" endpoint. Records notionPushedAt on
 * both success and failure (fire-and-forget). The compare-and-set on the
 * success UPDATE guards against a concurrent push double-creating. Callers
 * that want to force a retry must clear notionPushedAt + notionPushError first
 * (see clearNotionPushAttempt).
 */
export async function pushSingleToNotion(
  featureRequestId: number,
): Promise<{ ok: true; notionPageId: string } | { ok: false; error: string }> {
  if (!isNotionConfigured()) {
    return { ok: false, error: "Notion not configured" };
  }
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, featureRequestId))
    .limit(1);
  if (!fr) return { ok: false, error: `Feature request ${featureRequestId} not found` };
  if (fr.notionPageId) {
    return { ok: true, notionPageId: fr.notionPageId };
  }
  // Notion is the destination for human-routed, planned tickets only. Guard the
  // manual retry path too (the scheduler push loop already filters on these) so
  // an admin can't accidentally create a Notion page for an agent-routed or
  // non-planned row by hitting the retry endpoint.
  if (fr.engineeringOwner !== "human") {
    return { ok: false, error: "Not a human-routed request" };
  }
  if (fr.status !== "planned") {
    return { ok: false, error: `Request is '${fr.status}', not 'planned'` };
  }
  try {
    const page = await createNotionPage({
      title: fr.title,
      summary: fr.summary,
      scope: fr.scope,
      priority: fr.priority,
      prdUrl: requestUrl(fr.id),
    });
    const updated = await db
      .update(featureRequestsTable)
      .set({
        notionPageId: page.pageId,
        notionUrl: page.url,
        notionStatus: page.status,
        notionPushedAt: new Date(),
        notionPushError: null,
        notionLastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(featureRequestsTable.id, fr.id),
          isNull(featureRequestsTable.notionPageId),
        ),
      )
      .returning({ id: featureRequestsTable.id });
    if (updated.length === 0) {
      logger.warn(
        { featureRequestId: fr.id, notionPageId: page.pageId },
        "Notion push raced — page created but row already had notionPageId. The new page is orphaned in Notion; an admin should archive it manually.",
      );
    }
    logger.info(
      { featureRequestId: fr.id, notionPageId: page.pageId },
      "Created Notion page for feature request",
    );
    return { ok: true, notionPageId: page.pageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(featureRequestsTable)
      .set({
        notionPushedAt: new Date(),
        notionPushError: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(featureRequestsTable.id, fr.id));
    logger.error(
      { featureRequestId: fr.id, err: message },
      "Notion push failed (will NOT auto-retry; admin must re-trigger)",
    );
    return { ok: false, error: message };
  }
}

/**
 * Clear the push attempt markers for a single row so the scheduler (or an
 * immediate manual push) will treat it as fresh. Does NOT clear notionPageId
 * — once a page exists we never create another.
 */
export async function clearNotionPushAttempt(
  featureRequestId: number,
): Promise<boolean> {
  const updated = await db
    .update(featureRequestsTable)
    .set({
      notionPushedAt: null,
      notionPushError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(featureRequestsTable.id, featureRequestId),
        isNull(featureRequestsTable.notionPageId),
      ),
    )
    .returning({ id: featureRequestsTable.id });
  return updated.length > 0;
}

/**
 * Refresh status + assignee for every feature_request that has a notionPageId
 * by fetching each page individually (human-routed rows are few, so per-page
 * GET is cheaper than paginating the whole database). Notion status does NOT
 * auto-flip the ScopeBot card — admins still drive the ScopeBot kanban.
 */
export async function runNotionPollOnce(): Promise<{ refreshed: number }> {
  if (!isNotionConfigured()) return { refreshed: 0 };
  const tracked = await db
    .select()
    .from(featureRequestsTable)
    .where(isNotNull(featureRequestsTable.notionPageId));
  if (tracked.length === 0) return { refreshed: 0 };

  let refreshed = 0;
  for (const fr of tracked) {
    const pageId = fr.notionPageId;
    if (!pageId) continue;
    try {
      const snap = await getNotionPage(pageId);
      await db
        .update(featureRequestsTable)
        .set({
          notionStatus: snap.status,
          notionAssignee: snap.assignee,
          notionUrl: snap.url,
          notionLastSyncedAt: new Date(),
        })
        .where(eq(featureRequestsTable.id, fr.id));
      refreshed++;
    } catch (err) {
      logger.warn(
        {
          featureRequestId: fr.id,
          notionPageId: pageId,
          err: err instanceof Error ? err.message : String(err),
        },
        "Notion page poll failed; leaving cached snapshot in place.",
      );
    }
  }
  return { refreshed };
}

function startPushLoop() {
  const tick = async () => {
    if (pushRunning) {
      pushTimer = setTimeout(tick, PUSH_INTERVAL_MS);
      return;
    }
    pushRunning = true;
    try {
      const r = await runNotionPushOnce();
      lastPushAt = new Date();
      lastPushError = null;
      if (r.attempted > 0) logger.info(r, "Notion push tick complete");
    } catch (err) {
      lastPushError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Notion push tick failed");
    } finally {
      pushRunning = false;
      pushTimer = setTimeout(tick, PUSH_INTERVAL_MS);
    }
  };
  pushTimer = setTimeout(tick, PUSH_STARTUP_DELAY_MS);
}

function startPollLoop() {
  const tick = async () => {
    if (pollRunning) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }
    pollRunning = true;
    try {
      const r = await runNotionPollOnce();
      lastPollAt = new Date();
      lastPollError = null;
      if (r.refreshed > 0) logger.debug(r, "Notion poll tick complete");
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Notion poll tick failed");
    } finally {
      pollRunning = false;
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  pollTimer = setTimeout(tick, POLL_STARTUP_DELAY_MS);
}

/**
 * Start the two Notion schedulers. Safe to call multiple times — only arms
 * once per loop. Relies on a single long-lived process (Reserved VM).
 */
export function startNotionSchedulers(): void {
  if (!isNotionConfigured()) {
    logger.warn(
      "Notion schedulers NOT started — set NOTION_DATABASE_ID (and connect the Notion integration) to enable.",
    );
    return;
  }
  if (!pushTimer) startPushLoop();
  if (!pollTimer) startPollLoop();
  logger.info(
    { pushIntervalMs: PUSH_INTERVAL_MS, pollIntervalMs: POLL_INTERVAL_MS },
    "Notion schedulers started",
  );
}

/**
 * Run both loops immediately in the background. Used by the admin
 * "Refresh now" button. Returns whether each was already busy.
 */
export function triggerNotionRefreshInBackground(): {
  push: "started" | "busy";
  poll: "started" | "busy";
} {
  const result = {
    push: pushRunning ? ("busy" as const) : ("started" as const),
    poll: pollRunning ? ("busy" as const) : ("started" as const),
  };
  if (!pushRunning) {
    pushRunning = true;
    setImmediate(async () => {
      try {
        await runNotionPushOnce();
        lastPushAt = new Date();
        lastPushError = null;
      } catch (err) {
        lastPushError = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "Notion manual push failed");
      } finally {
        pushRunning = false;
      }
    });
  }
  if (!pollRunning) {
    pollRunning = true;
    setImmediate(async () => {
      try {
        await runNotionPollOnce();
        lastPollAt = new Date();
        lastPollError = null;
      } catch (err) {
        lastPollError = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "Notion manual poll failed");
      } finally {
        pollRunning = false;
      }
    });
  }
  return result;
}
