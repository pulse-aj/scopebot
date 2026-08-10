import type { Request } from "express";
import { inArray } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  featureRequestMergeProposalsTable,
  type FeatureRequest,
} from "@workspace/db";
import { logger } from "./logger";
import {
  anthropic,
  MODEL,
  PROPOSE_MERGE_SYSTEM_PROMPT,
  PROPOSE_MERGE_TOOL,
} from "./anthropic";

type Log = Request["log"] | typeof logger;

// Customer-facing scope text must never reveal that a second requester exists.
// This is a defense-in-depth gate on top of the prompt: any drafted scope that
// references "another customer/request", a request id, or "duplicate" language
// is rejected so it can never reach a customer-visible field.
const CONFIDENTIAL_LEAK_PATTERNS: RegExp[] = [
  /\b(another|other|second|additional|different)\s+(customer|client|user|requester|request|team|account|company|org)\b/i,
  /\bduplicate\s+(request|requester|customer|submission|ticket)\b/i,
  /\b(also|similarly|separately)\s+requested\b/i,
  /\bas\s+(also\s+)?requested\s+by\b/i,
  /\brequest\s+#?\d+\b/i,
];

export function containsConfidentialLeak(text: string): boolean {
  return CONFIDENTIAL_LEAK_PATTERNS.some((re) => re.test(text));
}

// Compact, full-text view of a request the model needs to judge duplication and
// to merge scopes. Kept admin-internal — never sent to a customer.
function renderRequest(fr: FeatureRequest): string {
  return [
    `id: ${fr.id}`,
    `title: ${fr.title}`,
    `status: ${fr.status}`,
    `priority: ${fr.priority}`,
    `summary: ${fr.summary}`,
    `problem:\n${fr.problem}`,
    `benefits:\n${fr.benefits}`,
    `current spend / pain:\n${fr.currentSpend}`,
    `scope:\n${fr.scope}`,
  ].join("\n\n");
}

/**
 * Fire-and-forget duplicate-PRD detection for a freshly created feature request.
 *
 * The intake PM model already flags likely-related ids in `relatedRequestIds`.
 * Here we ask the model to confirm whether the new request is genuinely a
 * near-duplicate of one of those candidates and, if so, draft a merged scope
 * for the chosen PRIMARY (existing) request. The draft is stored as a PENDING
 * merge proposal for an admin to approve/reject — nothing is applied
 * automatically, and the duplicate request itself is never modified.
 *
 * Never throws: detection is best-effort and must not affect finalization.
 */
export async function proposeMergeForNewRequest(args: {
  newFr: FeatureRequest;
  log?: Log;
}): Promise<void> {
  const { newFr } = args;
  const log = args.log ?? logger;

  const candidateIds = Array.from(
    new Set((newFr.relatedRequestIds ?? []).filter((n) => n !== newFr.id)),
  );
  if (candidateIds.length === 0) return;

  const candidates = (
    await db
      .select()
      .from(featureRequestsTable)
      .where(inArray(featureRequestsTable.id, candidateIds))
  ).filter((c) => c.id !== newFr.id);
  if (candidates.length === 0) return;

  const userContent = `NEW REQUEST (the possible duplicate):\n\n${renderRequest(
    newFr,
  )}\n\n---\n\nCANDIDATE EXISTING REQUESTS (pick at most one as the primary):\n\n${candidates
    .map(renderRequest)
    .join("\n\n========\n\n")}`;

  let input: Record<string, unknown> | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16384,
      system: PROPOSE_MERGE_SYSTEM_PROMPT,
      tools: [PROPOSE_MERGE_TOOL],
      tool_choice: { type: "tool", name: PROPOSE_MERGE_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });
    const tu = resp.content.find((b) => b.type === "tool_use");
    if (tu && tu.type === "tool_use") {
      input = tu.input as Record<string, unknown>;
    }
  } catch (err) {
    log?.warn({ err, featureRequestId: newFr.id }, "merge detection LLM failed");
    return;
  }
  if (!input) return;

  const isDuplicate = input.isDuplicate === true;
  const confidence = String(input.confidence ?? "low");
  const primaryRequestId = Number(input.primaryRequestId);
  const proposedScope = String(input.proposedScope ?? "").trim();
  const relationRationale = String(input.relationRationale ?? "").trim();

  if (!isDuplicate || confidence === "low") return;
  if (confidence !== "medium" && confidence !== "high") return;
  if (!Number.isInteger(primaryRequestId) || primaryRequestId <= 0) return;
  if (primaryRequestId === newFr.id) return;
  if (!candidates.some((c) => c.id === primaryRequestId)) return;
  if (!proposedScope) return;

  // Hard confidentiality gate: drop any draft that could expose a second
  // requester to a customer once approved onto the primary's scope.
  if (containsConfidentialLeak(proposedScope)) {
    log?.warn(
      { duplicateRequestId: newFr.id, primaryRequestId },
      "merge proposal dropped: drafted scope failed confidentiality check",
    );
    return;
  }

  try {
    await db
      .insert(featureRequestMergeProposalsTable)
      .values({
        duplicateRequestId: newFr.id,
        primaryRequestId,
        confidence,
        relationRationale:
          relationRationale || "Flagged as a likely duplicate.",
        proposedScope,
      });
    log?.info(
      { duplicateRequestId: newFr.id, primaryRequestId, confidence },
      "merge proposal created",
    );
  } catch (err) {
    // Unique partial index → a pending proposal already exists for this dup.
    log?.warn(
      { err, featureRequestId: newFr.id },
      "merge proposal insert skipped",
    );
  }
}
