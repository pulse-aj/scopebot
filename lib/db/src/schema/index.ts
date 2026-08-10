import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  index,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "finalized",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "admin",
]);

export const featureRequestStatusEnum = pgEnum("feature_request_status", [
  "requested",
  "ready_for_execution",
  "planned",
  "in_progress",
  "deployed",
]);

export const featureRequestPriorityEnum = pgEnum("feature_request_priority", [
  "low",
  "medium",
  "high",
]);

// Where a planned request is routed for execution. Set by the admin in the
// "Move to Planned" modal. "agent" → pushed to the Paperclip orchestrator and
// exposed to the external dev-agent pull queue. "human" → created as a page in
// the Notion project tracker for a human engineer and excluded from both
// Paperclip and the dev-agent queue. Nullable so non-planned items can leave it
// unset (treated as "agent" for backward compatibility in queries).
export const engineeringOwnerEnum = pgEnum("engineering_owner", [
  "agent",
  "human",
]);

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isEngineer: boolean("is_engineer").notNull().default(false),
    // bcrypt hash. NULL means the user existed under the legacy Clerk auth
    // and hasn't set a self-hosted password yet — they must complete the
    // "set your password" email flow before sign-in works.
    passwordHash: text("password_hash"),
    // NULL until the user clicks their verification link. Sign-in is
    // blocked while this is NULL.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export type User = typeof usersTable.$inferSelect;

// Cookie-based session store. The cookie carries an opaque random token;
// only the sha256 of that token is stored here so a DB leak can't be
// replayed as login. Sessions slide-refresh on use up to 30 days.
export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_idx").on(t.tokenHash),
    index("auth_sessions_user_idx").on(t.userId),
    index("auth_sessions_expires_idx").on(t.expiresAt),
  ],
);

export type AuthSession = typeof authSessionsTable.$inferSelect;

export const authTokenKindEnum = pgEnum("auth_token_kind", [
  "verify_email",
  "password_reset",
  "initial_set",
]);

// Single-use tokens for email verification, password reset, and the
// one-shot "set your password" flow used during the Clerk migration.
// Only the sha256 of the raw token is stored; the raw token only ever
// appears in the email link.
export const authEmailTokensTable = pgTable(
  "auth_email_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: authTokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_email_tokens_token_hash_idx").on(t.tokenHash),
    index("auth_email_tokens_user_kind_idx").on(t.userId, t.kind),
  ],
);

export type AuthEmailToken = typeof authEmailTokensTable.$inferSelect;

export const teamRoleEnum = pgEnum("team_role", ["admin", "engineer"]);

export const teamMembersTable = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    role: teamRoleEnum("role").notNull(),
    note: text("note"),
    addedByUserId: text("added_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailRoleUnique: uniqueIndex("team_members_email_role_idx").on(
      table.email,
      table.role,
    ),
  }),
);

export type TeamMember = typeof teamMembersTable.$inferSelect;

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    status: conversationStatusEnum("status").notNull().default("active"),
    featureRequestId: integer("feature_request_id"),
    // "Minor" quick-report mode: small bug/feature. The intake bot asks at most
    // one clarifying question then finalizes, instead of a full interview.
    minor: boolean("minor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId)],
);

export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    authorUserId: text("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export type Message = typeof messagesTable.$inferSelect;

export const attachmentsTable = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => messagesTable.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("attachments_conversation_idx").on(t.conversationId),
    index("attachments_message_idx").on(t.messageId),
  ],
);

export type Attachment = typeof attachmentsTable.$inferSelect;

export const featureRequestsTable = pgTable(
  "feature_requests",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    problem: text("problem").notNull(),
    benefits: text("benefits").notNull(),
    currentSpend: text("current_spend").notNull(),
    scope: text("scope").notNull(),
    status: featureRequestStatusEnum("status").notNull().default("requested"),
    priority: featureRequestPriorityEnum("priority").notNull().default("medium"),
    // Carried over from the conversation: this request was filed via the
    // "Minor" quick-report path (small bug/feature, light scoping).
    minor: boolean("minor").notNull().default(false),
    // AI prioritization (admin-facing). Filled by a periodic background job
    // that ranks every "requested" feature request from 1..N and explains why.
    aiPriorityRank: integer("ai_priority_rank"),
    aiPriorityRationale: text("ai_priority_rationale"),
    aiPriorityGeneratedAt: timestamp("ai_priority_generated_at", {
      withTimezone: true,
    }),
    // Admin-only clustering signal. When the PM model finalizes a request it
    // can flag other feature_requests ids it looks like a near-duplicate of,
    // plus a short rationale. NEVER surfaced to the requesting customer —
    // only shown in admin views so the team can merge / co-prioritize.
    relatedRequestIds: integer("related_request_ids").array(),
    clusterRationale: text("cluster_rationale"),
    // Admin-set priority rank used to order the "Planned" backlog for the
    // external dev agent (Claude Code / Cursor) integration. Lower number =
    // higher priority. Admins set this in the "Move to Planned" modal,
    // defaulting to the AI rank. Nullable so non-planned items can leave it
    // unset.
    adminPriorityRank: integer("admin_priority_rank"),
    // Destination chosen by the admin when a request is moved to "Planned":
    // "agent" → Paperclip + dev-agent queue; "human" → Notion page only.
    // Nullable until planned; null is treated as "agent" in eligibility queries
    // for backward compatibility with rows planned before this column existed.
    engineeringOwner: engineeringOwnerEnum("engineering_owner"),
    // Notion integration (human-routed requests): mirror columns parallel to
    // the Paperclip ones. notionPageId is the idempotency key — once set we
    // never re-push. notionPushedAt is stamped on both success and failure so
    // the scheduler never auto-retries (admins re-attempt via the Retry push
    // button). status/assignee + lastSyncedAt are refreshed by the 1-minute
    // poll. notionUrl deep-links to the created page.
    notionPageId: text("notion_page_id"),
    notionUrl: text("notion_url"),
    notionPushedAt: timestamp("notion_pushed_at", { withTimezone: true }),
    notionPushError: text("notion_push_error"),
    notionLastSyncedAt: timestamp("notion_last_synced_at", {
      withTimezone: true,
    }),
    notionStatus: text("notion_status"),
    notionAssignee: text("notion_assignee"),
    // Paperclip integration: when a planned request is pushed to the
    // external Paperclip orchestrator, we record the issue id + identifier
    // (e.g. "PUL-23"), a snapshot of the most recent poll, and any push
    // error. paperclipIssueId is the idempotency key — once set we never
    // re-push. lastSyncedAt + status/priority/assigneeAgentId/children
    // snapshot are refreshed by the 1-minute poll. childrenSnapshot is an
    // array of {id, identifier, title, status, assigneeAgentId} for issues
    // whose parentId === our issue id (Paperclip's "tasks" model).
    paperclipIssueId: text("paperclip_issue_id"),
    paperclipIdentifier: text("paperclip_identifier"),
    paperclipPushedAt: timestamp("paperclip_pushed_at", { withTimezone: true }),
    paperclipPushError: text("paperclip_push_error"),
    paperclipLastSyncedAt: timestamp("paperclip_last_synced_at", {
      withTimezone: true,
    }),
    paperclipStatus: text("paperclip_status"),
    paperclipPriority: text("paperclip_priority"),
    paperclipAssigneeAgentId: text("paperclip_assignee_agent_id"),
    paperclipChildrenSnapshot: jsonb("paperclip_children_snapshot").$type<
      Array<{
        id: string;
        identifier: string | null;
        title: string;
        status: string;
        assigneeAgentId: string | null;
      }>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feature_requests_user_idx").on(t.userId),
    uniqueIndex("feature_requests_conversation_unique").on(t.conversationId),
    // Backs the integration's planned-backlog query
    // (`status='planned' ORDER BY admin_priority_rank NULLS LAST, created_at`).
    // Partial index keeps it tiny — most rows aren't "planned".
    index("feature_requests_planned_queue_idx")
      .on(t.adminPriorityRank, t.createdAt)
      .where(sql`status = 'planned'`),
    // Idempotency / lookup index for Paperclip integration. Partial — only
    // pushed rows have a value, so it stays small.
    uniqueIndex("feature_requests_paperclip_issue_unique")
      .on(t.paperclipIssueId)
      .where(sql`paperclip_issue_id is not null`),
    // Idempotency / lookup index for the Notion integration. Partial — only
    // human-routed rows that have been pushed have a value, so it stays small.
    uniqueIndex("feature_requests_notion_page_unique")
      .on(t.notionPageId)
      .where(sql`notion_page_id is not null`),
  ],
);

// Cached snapshot of Paperclip agents (id → name/role) so the Engineering
// Space UI can resolve assigneeAgentId without round-tripping to Paperclip
// on every page render. Refreshed by the 1-minute poll.
export const paperclipAgentsTable = pgTable("paperclip_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role"),
  title: text("title"),
  icon: text("icon"),
  status: text("status"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PaperclipAgent = typeof paperclipAgentsTable.$inferSelect;

export type FeatureRequest = typeof featureRequestsTable.$inferSelect;

// Timeline of events posted by the external dev agent integration (Claude
// Code / Cursor) and, eventually, the GitHub webhook. Used to show progress
// on each planned/in-progress request without trusting the agent's
// self-reports alone — webhook events are the source of truth.
export const featureRequestEventsTable = pgTable(
  "feature_request_events",
  {
    id: serial("id").primaryKey(),
    featureRequestId: integer("feature_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    // Event kind, e.g. "branch_created", "commit", "pr_opened", "pr_merged",
    // "note", "status_changed". Validated at the route layer.
    kind: text("kind").notNull(),
    // Where the event originated. "integration" = bearer-token agent;
    // "github_webhook" = GitHub HMAC-verified webhook (Wave 2); "system" =
    // server-internal; "admin" = a human admin in the UI.
    source: text("source").notNull(),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite covers both "all events for a request, newest first" and
    // single-column lookups by featureRequestId. We don't query by
    // createdAt alone, so no global created_at index.
    index("feature_request_events_fr_created_idx").on(
      t.featureRequestId,
      t.createdAt,
    ),
  ],
);

export type FeatureRequestEvent = typeof featureRequestEventsTable.$inferSelect;

export const featureRequestVersionsTable = pgTable(
  "feature_request_versions",
  {
    id: serial("id").primaryKey(),
    featureRequestId: integer("feature_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    problem: text("problem").notNull(),
    benefits: text("benefits").notNull(),
    currentSpend: text("current_spend").notNull(),
    scope: text("scope").notNull(),
    priority: featureRequestPriorityEnum("priority").notNull().default("medium"),
    changeReason: text("change_reason").notNull(),
    createdByUserId: text("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feature_request_versions_fr_idx").on(t.featureRequestId),
    uniqueIndex("feature_request_versions_unique").on(
      t.featureRequestId,
      t.versionNumber,
    ),
  ],
);

export type FeatureRequestVersion =
  typeof featureRequestVersionsTable.$inferSelect;

// Admin-only duplicate-PRD detection. When a newly finalized feature request
// looks like a near-duplicate of an existing one, the model drafts a proposed
// rewrite of the EXISTING ("primary") request's scope that covers both needs.
// Nothing is applied automatically — an admin approves/rejects from the
// "Duplicates" review queue. On approval the proposedScope replaces the
// primary's scope (a new feature_request_versions snapshot is recorded). The
// duplicate request itself is never modified; the link is informational only.
// Customers never see any of this — proposedScope is written generically.
export const mergeProposalStatusEnum = pgEnum("merge_proposal_status", [
  "pending",
  "approved",
  "rejected",
]);

export const featureRequestMergeProposalsTable = pgTable(
  "feature_request_merge_proposals",
  {
    id: serial("id").primaryKey(),
    // The newer request that looks like a duplicate.
    duplicateRequestId: integer("duplicate_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    // The pre-existing request whose scope we propose to enrich.
    primaryRequestId: integer("primary_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    // "medium" | "high" — we never persist "low"-confidence matches.
    confidence: text("confidence").notNull(),
    // Admin-only note explaining the relationship. May reference request ids.
    relationRationale: text("relation_rationale").notNull(),
    // Drafted rewrite of the primary's scope, covering both requests. Becomes
    // customer-visible on the primary once approved, so it is written generically.
    proposedScope: text("proposed_scope").notNull(),
    status: mergeProposalStatusEnum("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // The feature_request_versions.version_number created on the primary when
    // this proposal was approved (null until approved).
    appliedVersionNumber: integer("applied_version_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fr_merge_proposals_primary_idx").on(t.primaryRequestId),
    index("fr_merge_proposals_status_idx").on(t.status),
    // At most one pending proposal per duplicate request — keeps the queue
    // de-duplicated if detection somehow runs twice for the same request.
    uniqueIndex("fr_merge_proposals_dup_pending_unique")
      .on(t.duplicateRequestId)
      .where(sql`status = 'pending'`),
  ],
);

export type FeatureRequestMergeProposal =
  typeof featureRequestMergeProposalsTable.$inferSelect;

export const engineeringTaskStatusEnum = pgEnum("engineering_task_status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

export const engineeringTasksTable = pgTable(
  "engineering_tasks",
  {
    id: serial("id").primaryKey(),
    featureRequestId: integer("feature_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: engineeringTaskStatusEnum("status").notNull().default("backlog"),
    assigneeUserId: text("assignee_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    githubRepo: text("github_repo"),
    githubBranch: text("github_branch"),
    githubPrNumber: integer("github_pr_number"),
    githubPrUrl: text("github_pr_url"),
    githubPrState: text("github_pr_state"),
    githubPrStateUpdatedAt: timestamp("github_pr_state_updated_at", {
      withTimezone: true,
    }),
    createdByUserId: text("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("engineering_tasks_fr_idx").on(t.featureRequestId)],
);

export type EngineeringTask = typeof engineeringTasksTable.$inferSelect;

export const engTaskMessageRoleEnum = pgEnum("eng_task_message_role", [
  "engineer",
  "assistant",
]);

export const engineeringTaskMessagesTable = pgTable(
  "engineering_task_messages",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => engineeringTasksTable.id, { onDelete: "cascade" }),
    role: engTaskMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    authorUserId: text("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    draftId: integer("draft_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("eng_task_messages_task_idx").on(t.taskId)],
);

export type EngineeringTaskMessage =
  typeof engineeringTaskMessagesTable.$inferSelect;

export const customerQuestionDraftStatusEnum = pgEnum(
  "customer_question_draft_status",
  ["pending", "approved", "rejected"],
);

export const customerQuestionDraftsTable = pgTable(
  "customer_question_drafts",
  {
    id: serial("id").primaryKey(),
    featureRequestId: integer("feature_request_id")
      .notNull()
      .references(() => featureRequestsTable.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => engineeringTasksTable.id, {
      onDelete: "set null",
    }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    proposedByUserId: text("proposed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    draftContent: text("draft_content").notNull(),
    contextNote: text("context_note"),
    status: customerQuestionDraftStatusEnum("status")
      .notNull()
      .default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    postedMessageId: integer("posted_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("customer_question_drafts_fr_idx").on(t.featureRequestId),
    index("customer_question_drafts_status_idx").on(t.status),
  ],
);

export type CustomerQuestionDraft =
  typeof customerQuestionDraftsTable.$inferSelect;

export type AttachmentJsonRef = {
  attachmentId: number;
};
export type MessageContentJson = unknown;

export const emailCampaignStatusEnum = pgEnum("email_campaign_status", [
  "draft",
  "sending",
  "sent",
  "failed",
]);

export const emailCampaignAudienceEnum = pgEnum("email_campaign_audience", [
  "all_users",
  "non_admins",
  "admins",
  "specific",
]);

export const emailCampaignsTable = pgTable(
  "email_campaigns",
  {
    id: serial("id").primaryKey(),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    htmlBody: text("html_body").notNull(),
    audience: emailCampaignAudienceEnum("audience")
      .notNull()
      .default("all_users"),
    specificEmails: jsonb("specific_emails").$type<string[]>(),
    status: emailCampaignStatusEnum("status").notNull().default("draft"),
    createdByUserId: text("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    sentByUserId: text("sent_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    totalRecipients: integer("total_recipients").notNull().default(0),
    totalSent: integer("total_sent").notNull().default(0),
    totalFailed: integer("total_failed").notNull().default(0),
    sendError: text("send_error"),
  },
  (t) => [index("email_campaigns_status_idx").on(t.status)],
);

export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;

export const emailCampaignRecipientsTable = pgTable(
  "email_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    trackingId: text("tracking_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sendError: text("send_error"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    lastUserAgent: text("last_user_agent"),
  },
  (t) => [
    uniqueIndex("email_recipients_tracking_idx").on(t.trackingId),
    index("email_recipients_campaign_idx").on(t.campaignId),
  ],
);

export type EmailCampaignRecipient =
  typeof emailCampaignRecipientsTable.$inferSelect;

// ---------------------------------------------------------------------------
// CRM (admin-only)
//
// A first-class customer record independent of app login users. "Customers" in
// the existing /admin → Customers view are just app users grouped by email
// domain; the CRM adds an explicit company/account entity with contacts, call
// notes, uploaded contracts, and a recorded billing model. "Tickets" are NOT a
// new table — they reuse the existing feature_requests, linked to a company by
// matching the requesting user's email domain (and any contact email).
// ---------------------------------------------------------------------------

export const customerCompanyStatusEnum = pgEnum("customer_company_status", [
  "prospect",
  "active",
  "churned",
]);

export const customerBillingKindEnum = pgEnum("customer_billing_kind", [
  "subscription",
  "usage",
  "contract",
]);

export const customerBillingFrequencyEnum = pgEnum(
  "customer_billing_frequency",
  ["monthly", "quarterly", "annual", "one_time"],
);

export const customerCompaniesTable = pgTable(
  "customer_companies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Optional email domain (e.g. "acme.com"). Used to link the account to its
    // app users and their feature requests ("tickets").
    domain: text("domain"),
    website: text("website"),
    status: customerCompanyStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_companies_domain_idx").on(t.domain)],
);

export type CustomerCompany = typeof customerCompaniesTable.$inferSelect;

export const customerContactsTable = pgTable(
  "customer_contacts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => customerCompaniesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_contacts_company_idx").on(t.companyId)],
);

export type CustomerContact = typeof customerContactsTable.$inferSelect;

export const customerCallNotesTable = pgTable(
  "customer_call_notes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => customerCompaniesTable.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(
      () => customerContactsTable.id,
      { onDelete: "set null" },
    ),
    authorUserId: text("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    subject: text("subject"),
    body: text("body").notNull(),
    // When the call / interaction actually happened (admin-set), distinct from
    // the row's createdAt.
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_call_notes_company_idx").on(t.companyId)],
);

export type CustomerCallNote = typeof customerCallNotesTable.$inferSelect;

// Uploaded customer contracts. Stored base64-inline in Postgres, mirroring the
// attachmentsTable pattern (kept simple to avoid object-storage indirection).
export const customerContractsTable = pgTable(
  "customer_contracts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => customerCompaniesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dataBase64: text("data_base64").notNull(),
    uploadedByUserId: text("uploaded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_contracts_company_idx").on(t.companyId)],
);

export type CustomerContract = typeof customerContractsTable.$inferSelect;

// The recorded ("punched in") billing model for a company. A company can have
// several line items spanning kinds: a recurring subscription, usage-based
// rates, and/or a negotiated contract value. Per-kind fields are nullable and
// only meaningful for their kind. `amount` is a decimal string (scale 4) so it
// can hold sub-cent usage rates as well as plan/contract totals.
export const customerBillingTable = pgTable(
  "customer_billing",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => customerCompaniesTable.id, { onDelete: "cascade" }),
    kind: customerBillingKindEnum("kind").notNull(),
    label: text("label").notNull(),
    currency: text("currency").notNull().default("USD"),
    amount: numeric("amount", { precision: 14, scale: 4 }),
    // subscription only
    frequency: customerBillingFrequencyEnum("frequency"),
    // usage only, e.g. "per charger / month"
    unitLabel: text("unit_label"),
    // contract only
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_billing_company_idx").on(t.companyId)],
);

export type CustomerBilling = typeof customerBillingTable.$inferSelect;

// ---------------------------------------------------------------------------
// Admin to-do list
//
// A lightweight, admin-managed task tracker that is separate from both the
// AI-scoped feature_requests and the feature-request-scoped engineering_tasks.
// Admins create tasks against a reusable customer (the CRM `customer_companies`
// entity) and assign them to a staff member (a `users` row that is
// an admin or engineer). Staff can view every task, change status, and leave
// comments. Customers are reused from the CRM so a name entered here is
// selectable for later tasks.
// ---------------------------------------------------------------------------
export const todoTaskStatusEnum = pgEnum("todo_task_status", [
  "todo",
  "in_progress",
  "done",
]);

export const todoTasksTable = pgTable(
  "todo_tasks",
  {
    id: serial("id").primaryKey(),
    // Reusable customer (CRM company). Nullable so a task can exist without a
    // customer; set null if the company is later deleted.
    customerId: integer("customer_id").references(
      () => customerCompaniesTable.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    details: text("details"),
    status: todoTaskStatusEnum("status").notNull().default("todo"),
    // The staff member working the item.
    assigneeUserId: text("assignee_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("todo_tasks_assignee_idx").on(t.assigneeUserId),
    index("todo_tasks_customer_idx").on(t.customerId),
  ],
);

export type TodoTask = typeof todoTasksTable.$inferSelect;

export const todoTaskCommentsTable = pgTable(
  "todo_task_comments",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => todoTasksTable.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("todo_task_comments_task_idx").on(t.taskId)],
);

export type TodoTaskComment = typeof todoTaskCommentsTable.$inferSelect;

// Silence "unused" type imports
export const _jsonbTypeRef = jsonb;
