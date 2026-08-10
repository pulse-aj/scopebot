# Product Request Bot

ScopeBot is a small in-house web app where teammates and customers chat with a Claude-powered AI product manager to scope feature requests, then track those requests on a kanban board. Admins (see `ADMIN_EMAILS`) see every request across the company along with the full AI-generated requirements doc.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/product-requests run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`
- Recommended env: `ADMIN_EMAILS` (comma-separated bootstrap admin emails, seeded only when `team_members` is empty; notification recipients otherwise come from `team_members` admins), `INTERNAL_DOMAINS` (comma-separated company email domains excluded from the Customers view). Keep company-specific values in Secrets, not `.replit` env — `.replit` is tracked and ships in the public repo.
- Optional env: `INTEGRATION_API_TOKEN` (bearer token for the external dev-agent API at `/api/integrations/*`; endpoints return 503 if unset)
- Optional env: `PUBLIC_APP_URL` — canonical public origin used in outbound email links (verify, reset, request links, tracking pixel). Set to the production custom domain so emails don't point at the raw `*.replit.app` host. Falls back to `REPLIT_DOMAINS[0]`, then `http://localhost`.
- Paperclip integration env (all three required to enable): `PAPERCLIP_URL`, `COMPANY_ID`, `PAPERCLIP_API_KEY`. Optional `PAPERCLIP_ASSIGNEE_AGENT_ID` sets the default assignee agent (unset = issues created unassigned). If any of the three are missing, the two Paperclip schedulers don't start and the Engineering Space UI shows "not configured".
- Notion integration env: `NOTION_DATABASE_ID` (the "New Project Tracker" database). Auth is via the Replit-managed Notion connector (`@replit/connectors-sdk`, same as the GitHub integration — no API key in env). If `NOTION_DATABASE_ID` is unset, the two Notion schedulers don't start and the Engineering Space UI shows the Notion section as "not configured".

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, self-hosted cookie + Postgres session auth (`bcryptjs` + Resend for verification/reset emails), `@anthropic-ai/sdk`
- Web: React 19 + Vite + Tailwind v4, wouter routing, in-house `AuthProvider` (cookie-based session via `/api/auth/*`), generated React Query hooks (Orval)
- DB: PostgreSQL + Drizzle ORM
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)

## Where things live

- API contract: `lib/api-spec/openapi.yaml` → generated to `lib/api-client-react` & `lib/api-zod`
- DB schema: `lib/db/src/schema/index.ts`
- Server: `artifacts/api-server/src/{app.ts,routes/*,lib/auth.ts,lib/anthropic.ts}`
- Web app: `artifacts/product-requests/src/{App.tsx,pages/**}`

## Architecture decisions

- Self-hosted email + password auth backed by Postgres: bcrypt password hashes on `users.password_hash`, opaque session tokens in `auth_sessions` (sha256-hashed at rest, sliding 30-day expiry), and one-shot links for verify-email / password-reset / migration "initial set" stored in `auth_email_tokens` (also sha256 at rest, atomically consumed via UPDATE … RETURNING). Cookie is `pulse_session`, httpOnly, sameSite=lax, secure in production.
- `requireAuth` resolves the cookie to a user, slides session expiry at most once per day, and re-syncs admin/engineer flags against `team_members` on every request so role changes propagate without re-login.
- Sign-in is blocked on `email_verified_at IS NULL` and on `password_hash IS NULL` (legacy Clerk row) — both auto-issue the appropriate email and return 403/409 with a flag the UI handles.
- Forgot-password and sign-up always return 200 to avoid leaking account existence; a small in-memory `rateLimit` middleware caps abuse per (ip, email) bucket.
- Admin gating: `team_members` table is the source of truth; `ADMIN_EMAILS` env only seeds it on first run of a fresh DB.
- Attachments are stored as base64 inline in Postgres (5 MB cap each); kept simple to avoid object-storage indirection. Images and PDFs are passed to Claude as native content blocks; text files are inlined as text.
- Finalize is idempotent: a unique index on `feature_requests.conversation_id` plus a pre-check + retry-on-conflict avoids duplicate spec rows under concurrent clicks.

## Product

- Sign in / sign up via in-house email + password (verification + reset emails go through the existing Resend integration). Sign-in routes live at `/sign-in`, `/sign-up`, `/forgot-password`, `/auth/reset-password`, `/auth/verify-email`.
- `/app` — chat with the AI product manager. The AI asks questions to cover problem, solution, benefits, and current cost/pain. Users can attach images, PDFs, sheets, docs.
- "Finalize requirements" turns the conversation into a structured FeatureRequest (title, summary, problem, benefits, current spend, full Markdown scope).
- Each request can be exported from its detail page as **PDF** (`GET /api/feature-requests/:id/pdf`) or **Markdown** (`GET /api/feature-requests/:id/markdown`). Both are owner/admin-gated. The Markdown is produced by the shared `buildFeatureRequestMarkdown` helper (`artifacts/api-server/src/lib/feature-request-markdown.ts`): source-PRD backlink, title + metadata, all sections, and an **Attachments** section listing every uploaded image and file as a signed public link (`attachmentPublicUrl`). The auto-appended "Screenshots & references" gallery is stripped from the scope first so images aren't listed twice. This same builder produces the Paperclip issue description (with the hidden `<!-- scopebot-fr-id: N -->` reconciliation marker via `includeMarker: true`), so pushed issues are full Markdown, not just the scope field.
- `/requests` — personal kanban (Requested → Planned → In Progress → Deployed) with priority controls.
- `/admin` — admin-only: stats overview + table of every feature request across all users with the full scope doc.
- Engineering panel on each request detail page (admin-only): kanban of engineering tasks per request, engineer ↔ AI PM chat per task (Claude has full transcript + spec context, can draft customer questions via tool use), and a review queue where admins approve/edit/reject drafted questions before they post to the customer conversation. GitHub fields are plain text in Wave 1 — Wave 2 will wire the connected GitHub integration for real repo/branch/PR pickers.
- Engineering routing (`feature_requests.engineering_owner` enum `agent`|`human`, nullable): when an admin moves a card into "Planned" they pick a destination in the Move-to-Planned modal — **Agentic team** (`agent`, default) routes to Paperclip + the external dev-agent pull queue, **Human engineers** (`human`) routes to Notion ONLY. Human-routed rows are excluded from both the Paperclip push scheduler and the `/api/integrations/*` pull queue via `or(isNull(engineeringOwner), ne(engineeringOwner, 'human'))`. The modal lives in `components/move-to-planned-dialog.tsx` and is shared by the personal kanban (`/requests`) and the admin kanban (`/admin`).
- External dev-agent integration: `/api/integrations/*` exposes the Planned backlog to a Claude Code / Cursor instance behind a single shared `INTEGRATION_API_TOKEN` bearer header. Endpoints: `GET /feature-requests` (planned, ordered by `adminPriorityRank` NULLS LAST), `GET /feature-requests/:id`, `POST /feature-requests/:id/status` (planned ↔ in_progress only — `deployed` is reserved for the future GitHub webhook), `POST /feature-requests/:id/events` (agent posts timeline events: branch_created, commit, pr_opened, pr_merged, note, …). Events are stored in `feature_request_events` for the engineering timeline. Admins set `adminPriorityRank` via a modal when moving a card into "Planned" (defaults to the AI rank, override allowed). The pull queue excludes human-routed rows. Wave 2 will add a GitHub webhook (HMAC) that auto-transitions cards to `deployed` on PR merge.
- Paperclip orchestrator integration: in parallel with the pull-based `/api/integrations/*` surface, the server runs two background schedulers (Reserved-VM in-process `setTimeout` loops in `artifacts/api-server/src/lib/paperclip-scheduler.ts`). **Push loop** (every 5 min): selects every `planned` feature_request with `paperclipIssueId IS NULL AND paperclipPushedAt IS NULL AND paperclipPushError IS NULL` and POSTs it to `${PAPERCLIP_URL}/api/companies/${COMPANY_ID}/issues` (bearer + `X-Paperclip-Run-Id`); idempotency is enforced by a compare-and-set UPDATE that only fills `paperclipIssueId` if it's still null. **Fire-and-forget**: each planned row is attempted at most once by the scheduler. On both success and failure `paperclipPushedAt` is stamped so the scheduler never auto-retries (a 5xx where Paperclip actually persisted the issue would otherwise produce a duplicate per tick). Failures are recorded in `paperclipPushError`; admins re-attempt explicitly via the per-request "Retry push" button in Engineering Space, which calls `POST /api/admin/engineering-space/:id/retry-push` (clears `paperclipPushedAt` + `paperclipPushError`, then synchronously re-pushes). **Poll loop** (every 1 min): fetches the full issue list + agent roster from Paperclip, then updates `paperclipStatus`/`paperclipPriority`/`paperclipAssigneeAgentId`/`paperclipChildrenSnapshot`/`paperclipLastSyncedAt` for every tracked request. Paperclip's "tasks" are just child issues (issues with a `parentId`), inlined as a JSON snapshot per parent. Surfaced in the admin **Engineering Space** tab (`/admin` → "Engineering Space") via `GET /api/admin/engineering-space`. Status updates from Paperclip do NOT auto-flip the ScopeBot card status — admins still drive ScopeBot kanban manually. The single-issue GET endpoint is not implemented in Paperclip, so the poller uses the list endpoint as the source of truth.
- Notion orchestrator integration (human-routed tickets only): mirrors the Paperclip scheduler pattern in `artifacts/api-server/src/lib/notion-scheduler.ts`, gated on `NOTION_DATABASE_ID` + the Notion connector. **Push loop** (every 5 min): selects every `planned` feature_request with `engineering_owner = 'human' AND notionPageId IS NULL AND notionPushedAt IS NULL AND notionPushError IS NULL` and creates a page in the New Project Tracker DB (title=`Task`, `Status`(status; new=`Unpicked`), `Priority`(select; low→P3/med→P2/high→P1), `PRD`(url → ScopeBot request link), `Assignee`(people)). Idempotency is a compare-and-set UPDATE that only fills `notionPageId` if still null; `notionPushedAt` is stamped on both success and failure so the scheduler never auto-retries. Failures land in `notionPushError`; admins re-attempt via the per-request "Retry push" button in Engineering Space → `POST /api/admin/engineering-space/:id/retry-notion-push` (clears `notionPushedAt` + `notionPushError`, then synchronously re-pushes). **Poll loop** (every 1 min): per-page GET for each tracked row, syncing `notionStatus`/`notionAssignee`/`notionUrl`/`notionLastSyncedAt` back. As with Paperclip, Notion status changes do NOT auto-flip the ScopeBot card status. The Engineering Space tab shows both Paperclip (agent) and Notion (human) rows, each with an owner badge; the Notion scheduler status is in `EngineeringSpace.notionSchedulerStatus`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After editing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen` before typechecking.
- After editing `lib/db/src/schema/index.ts`, run `pnpm --filter @workspace/db run push` to sync the dev DB.
- Never call service ports directly when testing with curl — go through `localhost:80` (the shared proxy).
- Web auth is cookie-based; do not add Bearer-token plumbing to the browser client.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Clerk → self-hosted migration helper: `pnpm --filter @workspace/api-server run migrate-users` (emails "set your new password" to every user whose `password_hash IS NULL`; idempotent; pass `-- --force` to resend).
