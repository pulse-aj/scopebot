import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  usersTable,
  type FeatureRequest,
  type User,
} from "@workspace/db";
import {
  anthropic,
  MODEL,
  PRIORITIZE_BACKLOG_SYSTEM_PROMPT,
  PRIORITIZE_BACKLOG_TOOL,
} from "./anthropic";
import { logger } from "./logger";

export type AiPriorityItem = {
  featureRequestId: number;
  rank: number;
  rationale: string;
  title: string;
  summary: string;
  status: FeatureRequest["status"];
  priority: FeatureRequest["priority"];
  userEmail: string;
  userName: string | null;
  createdAt: string;
};

export type AiPrioritizationSnapshot = {
  generatedAt: string | null;
  nextRunAt: string | null;
  isRunning: boolean;
  items: AiPriorityItem[];
};

type Ranking = { featureRequestId: number; rank: number; rationale: string };

function truncate(s: string, max: number): string {
  if (!s) return "";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + "…";
}

function compactRequest(fr: FeatureRequest): Record<string, unknown> {
  return {
    id: fr.id,
    title: fr.title,
    statedPriority: fr.priority,
    summary: truncate(fr.summary, 400),
    problem: truncate(fr.problem, 700),
    benefits: truncate(fr.benefits, 500),
    currentSpend: truncate(fr.currentSpend, 500),
    requestedAt: fr.createdAt.toISOString(),
  };
}

/**
 * Run the AI prioritizer over every "requested" feature request and persist
 * the rank + rationale onto each row. Returns the resulting snapshot.
 *
 * Safe to call concurrently — the DB update is the source of truth, last write
 * wins. We do guard against overlapping invocations at the caller (scheduler).
 */
export async function runPrioritization(): Promise<AiPrioritizationSnapshot> {
  const requested = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.status, "requested"));

  if (requested.length === 0) {
    // Nothing to rank, but still stamp generatedAt on the empty result by
    // clearing any stale ranks left over from previous runs on items that
    // have since been moved out of "requested".
    await clearStaleRanks();
    return buildSnapshot([]);
  }

  const inDev = await db
    .select()
    .from(featureRequestsTable)
    .where(
      inArray(featureRequestsTable.status, ["planned", "in_progress"]),
    );

  const userMap = await loadUsers([...requested, ...inDev]);

  const promptPayload = {
    requested: requested.map(compactRequest),
    inDevelopment: inDev.map((fr) => ({
      id: fr.id,
      status: fr.status,
      title: fr.title,
      summary: truncate(fr.summary, 240),
    })),
  };

  let rankings: Ranking[];
  try {
    rankings = await callPrioritizer(
      promptPayload,
      requested.map((r) => r.id),
    );
  } catch (err) {
    logger.error({ err }, "AI prioritization model call failed");
    throw err;
  }

  const validRankings = sanitizeRankings(
    rankings,
    requested.map((r) => r.id),
  );

  const generatedAt = new Date();
  await persistRankings(validRankings, generatedAt);
  await clearStaleRanks();

  const byId = new Map(requested.map((r) => [r.id, r]));
  const items: AiPriorityItem[] = validRankings
    .sort((a, b) => a.rank - b.rank)
    .map((r) => {
      const fr = byId.get(r.featureRequestId)!;
      const u = userMap.get(fr.userId);
      return {
        featureRequestId: fr.id,
        rank: r.rank,
        rationale: r.rationale,
        title: fr.title,
        summary: fr.summary,
        status: fr.status,
        priority: fr.priority,
        userEmail: u?.email ?? "",
        userName: u?.name ?? null,
        createdAt: fr.createdAt.toISOString(),
      };
    });

  logger.info(
    { generatedAt: generatedAt.toISOString(), ranked: items.length },
    "AI prioritization run complete",
  );
  return buildSnapshot(items, generatedAt);
}

async function callPrioritizer(
  payload: Record<string, unknown>,
  validIds: number[],
): Promise<Ranking[]> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: PRIORITIZE_BACKLOG_SYSTEM_PROMPT,
    tools: [PRIORITIZE_BACKLOG_TOOL],
    tool_choice: { type: "tool", name: PRIORITIZE_BACKLOG_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Here is the current backlog. Rank every item in "requested" (there are ${validIds.length}).\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
          },
        ],
      },
    ],
  });

  const tu = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!tu) throw new Error("Prioritizer did not call the tool");
  const input = tu.input as { rankings?: unknown };
  if (!Array.isArray(input.rankings)) {
    throw new Error("Prioritizer returned no rankings array");
  }
  const out: Ranking[] = [];
  for (const r of input.rankings) {
    if (
      r &&
      typeof r === "object" &&
      typeof (r as Ranking).featureRequestId === "number" &&
      typeof (r as Ranking).rank === "number" &&
      typeof (r as Ranking).rationale === "string"
    ) {
      out.push({
        featureRequestId: (r as Ranking).featureRequestId,
        rank: (r as Ranking).rank,
        rationale: (r as Ranking).rationale,
      });
    }
  }
  return out;
}

// Discard rankings for ids the model invented, dedupe to one ranking per id
// (lowest rank wins), and renumber 1..N so we always produce a contiguous
// sequence even if the model skipped numbers.
function sanitizeRankings(raw: Ranking[], validIds: number[]): Ranking[] {
  const validSet = new Set(validIds);
  const seen = new Map<number, Ranking>();
  for (const r of raw) {
    if (!validSet.has(r.featureRequestId)) continue;
    const prev = seen.get(r.featureRequestId);
    if (!prev || r.rank < prev.rank) seen.set(r.featureRequestId, r);
  }
  // Items the model omitted entirely — drop them to the bottom in id order
  // with a placeholder rationale, since admins need a complete picture.
  for (const id of validIds) {
    if (!seen.has(id)) {
      seen.set(id, {
        featureRequestId: id,
        rank: Number.MAX_SAFE_INTEGER,
        rationale: "(no rationale returned — placed at the bottom)",
      });
    }
  }
  const ordered = Array.from(seen.values()).sort((a, b) => a.rank - b.rank);
  return ordered.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function persistRankings(rankings: Ranking[], generatedAt: Date) {
  // Drizzle doesn't expose a clean bulk UPDATE … FROM VALUES, but we only run
  // every 2 hours and N is small (dozens), so a single round-trip with
  // CASE/WHEN keeps it tidy without an N+1.
  if (rankings.length === 0) return;
  const ids = rankings.map((r) => r.featureRequestId);
  const rankCase = sql.join(
    [
      sql`CASE id`,
      ...rankings.map(
        (r) => sql`WHEN ${r.featureRequestId} THEN ${r.rank}::integer`,
      ),
      sql`END`,
    ],
    sql` `,
  );
  const rationaleCase = sql.join(
    [
      sql`CASE id`,
      ...rankings.map(
        (r) => sql`WHEN ${r.featureRequestId} THEN ${r.rationale}::text`,
      ),
      sql`END`,
    ],
    sql` `,
  );
  await db
    .update(featureRequestsTable)
    .set({
      aiPriorityRank: rankCase,
      aiPriorityRationale: rationaleCase,
      aiPriorityGeneratedAt: generatedAt,
    })
    .where(inArray(featureRequestsTable.id, ids));
}

// Wipe ranks from rows that have left "requested" status since the last run,
// so the admin view never shows a stale ranking next to a planned/in-progress
// item.
async function clearStaleRanks() {
  await db
    .update(featureRequestsTable)
    .set({
      aiPriorityRank: null,
      aiPriorityRationale: null,
      aiPriorityGeneratedAt: null,
    })
    .where(
      and(
        ne(featureRequestsTable.status, "requested"),
        isNotNull(featureRequestsTable.aiPriorityRank),
      ),
    );
}

async function loadUsers(rows: FeatureRequest[]): Promise<Map<string, User>> {
  const ids = Array.from(new Set(rows.map((r) => r.userId)));
  if (ids.length === 0) return new Map();
  const users = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  return new Map(users.map((u) => [u.id, u]));
}

/**
 * Load the most recent persisted prioritization without re-running the model.
 * Used by the GET endpoint and the scheduler's "next run" calculation.
 */
export async function loadCurrentPrioritization(
  nextRunAt: Date | null,
  isRunning: boolean,
): Promise<AiPrioritizationSnapshot> {
  const rows = await db
    .select()
    .from(featureRequestsTable)
    .where(
      and(
        eq(featureRequestsTable.status, "requested"),
        isNotNull(featureRequestsTable.aiPriorityRank),
      ),
    );
  const userMap = await loadUsers(rows);
  const items: AiPriorityItem[] = rows
    .map((fr) => ({
      featureRequestId: fr.id,
      rank: fr.aiPriorityRank ?? Number.MAX_SAFE_INTEGER,
      rationale: fr.aiPriorityRationale ?? "",
      title: fr.title,
      summary: fr.summary,
      status: fr.status,
      priority: fr.priority,
      userEmail: userMap.get(fr.userId)?.email ?? "",
      userName: userMap.get(fr.userId)?.name ?? null,
      createdAt: fr.createdAt.toISOString(),
    }))
    .sort((a, b) => a.rank - b.rank);
  const latestGen = rows.reduce<Date | null>((acc, r) => {
    if (!r.aiPriorityGeneratedAt) return acc;
    if (!acc || r.aiPriorityGeneratedAt > acc) return r.aiPriorityGeneratedAt;
    return acc;
  }, null);
  return {
    generatedAt: latestGen ? latestGen.toISOString() : null,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    isRunning,
    items,
  };
}

function buildSnapshot(
  items: AiPriorityItem[],
  generatedAt?: Date,
): AiPrioritizationSnapshot {
  return {
    generatedAt: generatedAt ? generatedAt.toISOString() : null,
    nextRunAt: null,
    isRunning: false,
    items,
  };
}
