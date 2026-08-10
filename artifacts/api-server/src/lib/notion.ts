// Replit Notion integration (blueprint: notion). Calls are proxied through the
// Replit Connectors SDK, which injects the connected workspace's OAuth token and
// refreshes it as needed (the Notion-Version header is added by the proxy — we
// never set it manually). Mirrors the Paperclip client, but for human-routed
// requests we create a page in the Notion "New Project Tracker" database instead
// of a Paperclip issue. Never cache the client.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

// New Project Tracker schema (see replit.md): title prop = "Task", a "Status"
// status-property (new pages land in "Unpicked"), a "Priority" select, a "PRD"
// url, and an "Assignee" people prop that humans fill in (we sync it back).
const TITLE_PROP = "Task";
const STATUS_PROP = "Status";
const PRIORITY_PROP = "Priority";
const PRD_PROP = "PRD";
const ASSIGNEE_PROP = "Assignee";
const INITIAL_STATUS = "Unpicked";

// ScopeBot priority (low/medium/high) → Notion Priority select option.
const PRIORITY_MAP: Record<"low" | "medium" | "high", string> = {
  low: "P3",
  medium: "P2",
  high: "P1",
};

export function getNotionDatabaseId(): string | null {
  return process.env.NOTION_DATABASE_ID?.trim() || null;
}

export function isNotionConfigured(): boolean {
  return getNotionDatabaseId() !== null;
}

async function notionFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await connectors.proxy("notion", path, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { path, status: res.status, body: body.slice(0, 500) },
      "Notion proxy request failed",
    );
    const err: Error & { status?: number } = new Error(
      `Notion ${path} → ${res.status}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// --- Block helpers ---------------------------------------------------------

// Notion caps a single rich_text content string at 2000 chars. Chunk longer
// text so we never get a 400 on create.
function textChunks(s: string, size = 1900): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}

function paragraph(text: string): unknown {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: textChunks(text).map((c) => ({
        type: "text",
        text: { content: c },
      })),
    },
  };
}

function heading(text: string): unknown {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

// Build the page body from the request. We render the scope Markdown as plain
// paragraphs (one per non-empty line) rather than fully translating Markdown to
// Notion blocks — humans get readable content plus a backlink to the canonical
// ScopeBot spec for the authoritative rendering. Notion caps create at 100
// child blocks, so we truncate defensively.
function buildChildren(opts: {
  summary: string;
  scope: string;
  prdUrl: string;
}): unknown[] {
  const blocks: unknown[] = [];
  blocks.push(paragraph(`📋 ScopeBot request: ${opts.prdUrl}`));
  if (opts.summary.trim()) {
    blocks.push(heading("Summary"));
    blocks.push(paragraph(opts.summary.trim()));
  }
  if (opts.scope.trim()) {
    blocks.push(heading("Scope"));
    const lines = opts.scope
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      if (blocks.length >= 95) {
        blocks.push(
          paragraph("… (truncated — see the full spec via the ScopeBot link above)"),
        );
        break;
      }
      blocks.push(paragraph(line));
    }
  }
  return blocks;
}

// --- Public API ------------------------------------------------------------

export type NotionPageResult = {
  pageId: string;
  url: string;
  status: string | null;
};

type NotionPageRaw = {
  id: string;
  url: string;
  properties?: Record<string, unknown>;
};

export type NotionCreatePageInput = {
  title: string;
  summary: string;
  scope: string;
  priority: "low" | "medium" | "high";
  prdUrl: string;
};

/** Create a page in the configured tracker database. Throws on failure. */
export async function createNotionPage(
  input: NotionCreatePageInput,
): Promise<NotionPageResult> {
  const databaseId = getNotionDatabaseId();
  if (!databaseId) throw new Error("NOTION_DATABASE_ID is not configured");

  const properties: Record<string, unknown> = {
    [TITLE_PROP]: { title: [{ text: { content: input.title.slice(0, 2000) } }] },
    [STATUS_PROP]: { status: { name: INITIAL_STATUS } },
    [PRIORITY_PROP]: { select: { name: PRIORITY_MAP[input.priority] } },
    [PRD_PROP]: { url: input.prdUrl },
  };

  const page = await notionFetch<NotionPageRaw>("/v1/pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
      children: buildChildren({
        summary: input.summary,
        scope: input.scope,
        prdUrl: input.prdUrl,
      }),
    },
  });

  return { pageId: page.id, url: page.url, status: readStatus(page) };
}

export type NotionPageSnapshot = {
  status: string | null;
  assignee: string | null;
  url: string;
};

/** Fetch a single page's current status + assignee for the poll loop. */
export async function getNotionPage(
  pageId: string,
): Promise<NotionPageSnapshot> {
  const page = await notionFetch<NotionPageRaw>(
    `/v1/pages/${encodeURIComponent(pageId)}`,
  );
  return {
    status: readStatus(page),
    assignee: readAssignee(page),
    url: page.url,
  };
}

function readStatus(page: NotionPageRaw): string | null {
  const prop = page.properties?.[STATUS_PROP] as
    | { status?: { name?: string } | null }
    | undefined;
  return prop?.status?.name ?? null;
}

function readAssignee(page: NotionPageRaw): string | null {
  const prop = page.properties?.[ASSIGNEE_PROP] as
    | { people?: Array<{ name?: string | null }> }
    | undefined;
  const names = (prop?.people ?? [])
    .map((p) => p.name)
    .filter((n): n is string => !!n);
  return names.length ? names.join(", ") : null;
}
