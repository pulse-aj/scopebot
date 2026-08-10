import { eq, and, isNull, isNotNull, notInArray, ne, or } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  paperclipAgentsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { requestUrl } from "./email";
import { buildFeatureRequestMarkdown } from "./feature-request-markdown";
import {
  createIssue,
  isPaperclipConfigured,
  listAgents,
  listIssues,
  type PaperclipAgent,
  type PaperclipIssue,
} from "./paperclip";

const PUSH_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const PUSH_STARTUP_DELAY_MS = 45_000;
const POLL_STARTUP_DELAY_MS = 20_000;

let pushRunning = false;
let pollRunning = false;
let pushTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastPushAt: Date | null = null;
let lastPollAt: Date | null = null;
let lastPushError: string | null = null;
let lastPollError: string | null = null;

export function getPaperclipSchedulerStatus() {
  return {
    configured: isPaperclipConfigured(),
    pushRunning,
    pollRunning,
    lastPushAt: lastPushAt?.toISOString() ?? null,
    lastPollAt: lastPollAt?.toISOString() ?? null,
    lastPushError,
    lastPollError,
  };
}

/**
 * Find planned feature requests that have never been attempted and push
 * them. Semantics are **fire-and-forget**: every planned row is pushed at
 * most once by the scheduler, regardless of outcome.
 *   - Eligible: status='planned' AND paperclipIssueId IS NULL
 *     AND paperclipPushedAt IS NULL AND paperclipPushError IS NULL.
 *   - On success: record issue id + snapshot. paperclipPushedAt is set, so
 *     it won't be picked up again.
 *   - On failure (HTTP error, timeout, malformed body): record the error
 *     AND set paperclipPushedAt, so we do NOT auto-retry. This is the key
 *     anti-duplicate behavior — a 5xx where Paperclip actually created the
 *     issue used to cause one duplicate per tick.
 * Admins re-attempt explicitly via the per-request "Retry push" button,
 * which clears both fields before re-running this loop.
 */
export async function runPaperclipPushOnce(): Promise<{
  attempted: number;
  pushed: number;
  failed: number;
}> {
  if (!isPaperclipConfigured()) return { attempted: 0, pushed: 0, failed: 0 };
  const rows = await db
    .select()
    .from(featureRequestsTable)
    .where(
      and(
        eq(featureRequestsTable.status, "planned"),
        // Human-routed requests go to Notion only — never push them to
        // Paperclip. null (legacy, pre-routing) is treated as agent-eligible.
        or(
          isNull(featureRequestsTable.engineeringOwner),
          ne(featureRequestsTable.engineeringOwner, "human"),
        ),
        isNull(featureRequestsTable.paperclipIssueId),
        isNull(featureRequestsTable.paperclipPushedAt),
        isNull(featureRequestsTable.paperclipPushError),
      ),
    );
  if (rows.length === 0) return { attempted: 0, pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;
  for (const fr of rows) {
    const result = await pushSingleFeatureRequest(fr.id);
    if (result.ok) pushed++;
    else failed++;
  }
  return { attempted: rows.length, pushed, failed };
}

/**
 * Push exactly one feature request to Paperclip. Used by both the
 * scheduler and the manual "Retry push" endpoint. Records pushedAt on
 * both success and failure so the scheduler treats this row as "attempted"
 * — fire and forget, no automatic retries.
 *
 * Caller is responsible for clearing paperclipPushedAt + paperclipPushError
 * first when they want to force a retry. The compare-and-set on the success
 * UPDATE still guards against a concurrent push (e.g. retry button clicked
 * while a scheduled tick is in flight).
 */
export async function pushSingleFeatureRequest(
  featureRequestId: number,
  // When true (manual retry), check Paperclip for an already-created issue
  // before POSTing a new one. This prevents duplicates when re-pushing a row
  // that was orphaned by an earlier 500-after-commit. The batch loop leaves
  // this off because it only ever processes never-attempted rows.
  reconcileFirst = false,
): Promise<{ ok: true; paperclipIssueId: string } | { ok: false; error: string }> {
  if (!isPaperclipConfigured()) {
    return { ok: false, error: "Paperclip not configured" };
  }
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, featureRequestId))
    .limit(1);
  if (!fr) return { ok: false, error: `Feature request ${featureRequestId} not found` };
  if (fr.paperclipIssueId) {
    return { ok: true, paperclipIssueId: fr.paperclipIssueId };
  }
  if (reconcileFirst) {
    try {
      const existing = await findCreatedIssueForFeatureRequest(fr.id);
      if (existing) {
        const linkedId = await linkRecoveredIssue(fr.id, existing);
        logger.info(
          { featureRequestId: fr.id, paperclipIssueId: linkedId },
          "Paperclip retry found an existing issue for this request — linked it instead of creating a duplicate.",
        );
        return { ok: true, paperclipIssueId: linkedId };
      }
    } catch (lookupErr) {
      logger.warn(
        {
          featureRequestId: fr.id,
          err:
            lookupErr instanceof Error
              ? lookupErr.message
              : String(lookupErr),
        },
        "Paperclip pre-push reconciliation lookup failed; proceeding with create.",
      );
    }
  }
  try {
    const issue = await createIssue({
      title: fr.title,
      description: await buildFeatureRequestMarkdown(fr, { includeMarker: true }),
      priority: fr.priority,
    });
    const updated = await db
      .update(featureRequestsTable)
      .set({
        paperclipIssueId: issue.id,
        paperclipIdentifier: issue.identifier,
        paperclipPushedAt: new Date(),
        paperclipPushError: null,
        paperclipStatus: issue.status,
        paperclipPriority: issue.priority,
        paperclipAssigneeAgentId: issue.assigneeAgentId,
        paperclipLastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(featureRequestsTable.id, fr.id),
          isNull(featureRequestsTable.paperclipIssueId),
        ),
      )
      .returning({ id: featureRequestsTable.id });
    if (updated.length === 0) {
      logger.warn(
        { featureRequestId: fr.id, paperclipIssueId: issue.id },
        "Paperclip push raced — issue created but row already had paperclipIssueId. The new issue is orphaned in Paperclip; an admin should cancel it manually.",
      );
    }
    logger.info(
      {
        featureRequestId: fr.id,
        paperclipIssueId: issue.id,
        identifier: issue.identifier,
      },
      "Pushed feature request to Paperclip",
    );
    return { ok: true, paperclipIssueId: issue.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Paperclip's self-hosted instance sometimes returns a 5xx AFTER it has
    // already persisted the issue. Before recording a hard failure — which
    // would orphan that issue and risk a duplicate on the next push/retry —
    // re-list issues and look for the one we just created, matched by the
    // marker embedded in its description.
    try {
      const recovered = await findCreatedIssueForFeatureRequest(fr.id);
      if (recovered) {
        const linkedId = await linkRecoveredIssue(fr.id, recovered);
        logger.warn(
          {
            featureRequestId: fr.id,
            paperclipIssueId: linkedId,
            err: message,
          },
          "Paperclip returned an error but the issue was created — recovered and linked it (no duplicate).",
        );
        return { ok: true, paperclipIssueId: linkedId };
      }
    } catch (reconcileErr) {
      logger.warn(
        {
          featureRequestId: fr.id,
          err:
            reconcileErr instanceof Error
              ? reconcileErr.message
              : String(reconcileErr),
        },
        "Paperclip post-failure reconciliation lookup failed; recording original error.",
      );
    }
    // Stamp pushedAt on failure too — this is what keeps the scheduler
    // from creating duplicates if Paperclip 500s but actually persisted
    // the issue. Manual retry clears both fields.
    await db
      .update(featureRequestsTable)
      .set({
        paperclipPushedAt: new Date(),
        paperclipPushError: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(featureRequestsTable.id, fr.id));
    logger.error(
      { featureRequestId: fr.id, err: message },
      "Paperclip push failed (will NOT auto-retry; admin must re-trigger)",
    );
    return { ok: false, error: message };
  }
}

/**
 * After a createIssue error, check whether Paperclip actually persisted the
 * issue (it sometimes 500s post-commit). Matches primarily on the immutable
 * "<!-- scopebot-fr-id: N -->" marker that scopeWithSourceHeader embeds in
 * every pushed description (host-independent, survives a PUBLIC_APP_URL change),
 * falling back to the visible Source-PRD URL for issues created before that
 * marker existed. The trailing " -->" / ")" make both matches collision-safe
 * across ids (id 19 won't match id 199). When more than one issue matches we
 * link the OLDEST (canonical first-created) and warn so the duplicate can be
 * cleaned up manually. Returns the chosen issue, or null if none matched.
 */
async function findCreatedIssueForFeatureRequest(
  featureRequestId: number,
): Promise<PaperclipIssue | null> {
  const idMarker = `scopebot-fr-id: ${featureRequestId} -->`;
  const urlMarker = `(${requestUrl(featureRequestId)})`;
  const issues = await listIssues();
  const matches = issues.filter(
    (i) =>
      i.description?.includes(idMarker) || i.description?.includes(urlMarker),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt;
  });
  if (matches.length > 1) {
    logger.warn(
      {
        featureRequestId,
        matchCount: matches.length,
        paperclipIssueIds: matches.map((m) => m.id),
      },
      "Multiple Paperclip issues match this feature request — linking the oldest; the others are duplicates needing manual cleanup.",
    );
  }
  return matches[0];
}

/**
 * Link a recovered/existing Paperclip issue onto a feature request row, using
 * the same isNull compare-and-set as the success path so a concurrent push
 * can't double-link. Returns the issue id that is actually stored on the row:
 * the recovered one if we won the race, or whatever a concurrent actor linked
 * if we lost it (so callers never report an id that disagrees with the DB).
 */
async function linkRecoveredIssue(
  featureRequestId: number,
  issue: PaperclipIssue,
): Promise<string> {
  const updated = await db
    .update(featureRequestsTable)
    .set({
      paperclipIssueId: issue.id,
      paperclipIdentifier: issue.identifier,
      paperclipPushedAt: new Date(),
      paperclipPushError: null,
      paperclipStatus: issue.status,
      paperclipPriority: issue.priority,
      paperclipAssigneeAgentId: issue.assigneeAgentId,
      paperclipLastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(featureRequestsTable.id, featureRequestId),
        isNull(featureRequestsTable.paperclipIssueId),
      ),
    )
    .returning({ id: featureRequestsTable.id });
  if (updated.length > 0) return issue.id;
  const [row] = await db
    .select({ paperclipIssueId: featureRequestsTable.paperclipIssueId })
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, featureRequestId))
    .limit(1);
  return row?.paperclipIssueId ?? issue.id;
}

/**
 * Clear the push attempt markers for a single row so the scheduler (or an
 * immediate manual push) will treat it as fresh. Returns whether anything
 * was cleared. Does NOT clear paperclipIssueId — once a row has been
 * successfully pushed, we never re-push it.
 */
export async function clearPaperclipPushAttempt(
  featureRequestId: number,
): Promise<boolean> {
  const updated = await db
    .update(featureRequestsTable)
    .set({
      paperclipPushedAt: null,
      paperclipPushError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(featureRequestsTable.id, featureRequestId),
        isNull(featureRequestsTable.paperclipIssueId),
      ),
    )
    .returning({ id: featureRequestsTable.id });
  return updated.length > 0;
}

/**
 * Fetch the full issue + agent list from Paperclip and refresh every
 * feature_request that has a paperclipIssueId. Children of our issues
 * (Paperclip's "tasks") are inlined as a JSON snapshot.
 */
export async function runPaperclipPollOnce(): Promise<{
  refreshed: number;
  agents: number;
}> {
  if (!isPaperclipConfigured()) return { refreshed: 0, agents: 0 };

  const tracked = await db
    .select()
    .from(featureRequestsTable)
    .where(isNotNull(featureRequestsTable.paperclipIssueId));

  // Always refresh agents so the UI has names available even before the
  // first push has happened.
  const agents = await listAgents();
  await upsertAgents(agents);

  if (tracked.length === 0) {
    return { refreshed: 0, agents: agents.length };
  }

  const issues = await listIssues();
  const byId = new Map<string, PaperclipIssue>();
  const childrenByParent = new Map<string, PaperclipIssue[]>();
  for (const i of issues) {
    byId.set(i.id, i);
    if (i.parentId) {
      const arr = childrenByParent.get(i.parentId) ?? [];
      arr.push(i);
      childrenByParent.set(i.parentId, arr);
    }
  }

  let refreshed = 0;
  for (const fr of tracked) {
    const pid = fr.paperclipIssueId;
    if (!pid) continue;
    const issue = byId.get(pid);
    if (!issue) {
      logger.warn(
        { featureRequestId: fr.id, paperclipIssueId: pid },
        "Paperclip issue not present in listing; leaving cached snapshot in place.",
      );
      continue;
    }
    const children = (childrenByParent.get(pid) ?? []).map((c) => ({
      id: c.id,
      identifier: c.identifier,
      title: c.title,
      status: c.status,
      assigneeAgentId: c.assigneeAgentId,
    }));
    await db
      .update(featureRequestsTable)
      .set({
        paperclipStatus: issue.status,
        paperclipPriority: issue.priority,
        paperclipAssigneeAgentId: issue.assigneeAgentId,
        paperclipIdentifier: issue.identifier ?? fr.paperclipIdentifier,
        paperclipChildrenSnapshot: children,
        paperclipLastSyncedAt: new Date(),
      })
      .where(eq(featureRequestsTable.id, fr.id));
    refreshed++;
  }
  return { refreshed, agents: agents.length };
}

async function upsertAgents(agents: PaperclipAgent[]) {
  if (agents.length === 0) return;
  const now = new Date();
  for (const a of agents) {
    await db
      .insert(paperclipAgentsTable)
      .values({
        id: a.id,
        name: a.name,
        role: a.role,
        title: a.title,
        icon: a.icon,
        status: a.status,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: paperclipAgentsTable.id,
        set: {
          name: a.name,
          role: a.role,
          title: a.title,
          icon: a.icon,
          status: a.status,
          updatedAt: now,
        },
      });
  }
  // GC agents that disappeared from Paperclip so we don't show stale
  // names. Non-fatal — log and continue if it fails.
  try {
    const liveIds = agents.map((a) => a.id);
    await db
      .delete(paperclipAgentsTable)
      .where(notInArray(paperclipAgentsTable.id, liveIds));
  } catch (err) {
    logger.warn({ err }, "Paperclip agent GC failed");
  }
}

function startPushLoop() {
  const tick = async () => {
    if (pushRunning) {
      pushTimer = setTimeout(tick, PUSH_INTERVAL_MS);
      return;
    }
    pushRunning = true;
    try {
      const r = await runPaperclipPushOnce();
      lastPushAt = new Date();
      lastPushError = null;
      if (r.attempted > 0) logger.info(r, "Paperclip push tick complete");
    } catch (err) {
      lastPushError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Paperclip push tick failed");
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
      const r = await runPaperclipPollOnce();
      lastPollAt = new Date();
      lastPollError = null;
      if (r.refreshed > 0) logger.debug(r, "Paperclip poll tick complete");
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Paperclip poll tick failed");
    } finally {
      pollRunning = false;
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  pollTimer = setTimeout(tick, POLL_STARTUP_DELAY_MS);
}

/**
 * Start the two Paperclip schedulers. Safe to call multiple times — only
 * arms once per loop. Relies on a single long-lived process (Reserved VM).
 */
export function startPaperclipSchedulers(): void {
  if (!isPaperclipConfigured()) {
    logger.warn(
      "Paperclip schedulers NOT started — set PAPERCLIP_URL, COMPANY_ID, PAPERCLIP_API_KEY to enable.",
    );
    return;
  }
  if (!pushTimer) startPushLoop();
  if (!pollTimer) startPollLoop();
  logger.info(
    {
      pushIntervalMs: PUSH_INTERVAL_MS,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    "Paperclip schedulers started",
  );
}

/**
 * Run both loops immediately in the background. Used by the admin
 * "Refresh now" button. Returns whether each was already busy.
 */
export function triggerPaperclipRefreshInBackground(): {
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
        await runPaperclipPushOnce();
        lastPushAt = new Date();
        lastPushError = null;
      } catch (err) {
        lastPushError = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "Paperclip manual push failed");
      } finally {
        pushRunning = false;
      }
    });
  }
  if (!pollRunning) {
    pollRunning = true;
    setImmediate(async () => {
      try {
        await runPaperclipPollOnce();
        lastPollAt = new Date();
        lastPollError = null;
      } catch (err) {
        lastPollError = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "Paperclip manual poll failed");
      } finally {
        pollRunning = false;
      }
    });
  }
  return result;
}
