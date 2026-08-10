import { randomUUID } from "node:crypto";
import { logger } from "./logger";

const REQUEST_TIMEOUT_MS = 20_000;

export type PaperclipIssue = {
  id: string;
  companyId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  identifier: string | null;
  issueNumber: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PaperclipAgent = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  icon: string | null;
  status: string | null;
};

export type PaperclipCreateIssueInput = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  assigneeAgentId?: string;
};

export type PaperclipConfig = {
  baseUrl: string;
  companyId: string;
  apiKey: string;
  assigneeAgentId: string | null;
};

export function getPaperclipConfig(): PaperclipConfig | null {
  const baseUrl = process.env.PAPERCLIP_URL?.replace(/\/+$/, "");
  const companyId = process.env.COMPANY_ID;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  if (!baseUrl || !companyId || !apiKey) return null;
  return {
    baseUrl,
    companyId,
    apiKey,
    // Optional: when unset, issues are created unassigned and Paperclip's
    // own routing decides who picks them up.
    assigneeAgentId: process.env.PAPERCLIP_ASSIGNEE_AGENT_ID ?? null,
  };
}

export function isPaperclipConfigured(): boolean {
  return getPaperclipConfig() !== null;
}

// Detect ngrok-fronted hosts so we can conditionally add the skip-warning
// header. ngrok injects a browser-warning interstitial for non-browser
// clients unless `ngrok-skip-browser-warning` is set; sending it to a
// non-ngrok origin is unnecessary noise (some upstreams reject unknown
// headers at the WAF), so we only emit it when the URL actually looks
// like ngrok. Covers ngrok.io, ngrok.app, and ngrok-free.app subdomains.
function isNgrokUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith(".ngrok.io") ||
      host.endsWith(".ngrok.app") ||
      host.endsWith(".ngrok-free.app") ||
      host.endsWith(".ngrok.dev")
    );
  } catch {
    return false;
  }
}

function authHeaders(cfg: PaperclipConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (isNgrokUrl(cfg.baseUrl)) {
    headers["ngrok-skip-browser-warning"] = "true";
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const method = (init.method ?? "GET").toUpperCase();
  // Log every outbound Paperclip call so prod logs show exactly which URL
  // we're hitting. Important when the operator changes PAPERCLIP_URL — a
  // 503 from a misrouted host looks identical to a 503 from the real
  // upstream otherwise.
  logger.info({ paperclipUrl: url, method }, "Paperclip request");
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    logger.info(
      { paperclipUrl: url, method, status: res.status },
      "Paperclip response",
    );
    return res;
  } catch (err) {
    logger.error(
      {
        paperclipUrl: url,
        method,
        err: err instanceof Error ? err.message : String(err),
      },
      "Paperclip request threw (network/timeout)",
    );
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function normalizeIssue(raw: unknown): PaperclipIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    companyId: typeof r.companyId === "string" ? r.companyId : "",
    parentId: typeof r.parentId === "string" ? r.parentId : null,
    title: typeof r.title === "string" ? r.title : "",
    description: typeof r.description === "string" ? r.description : null,
    status: typeof r.status === "string" ? r.status : "unknown",
    priority: typeof r.priority === "string" ? r.priority : null,
    assigneeAgentId:
      typeof r.assigneeAgentId === "string" ? r.assigneeAgentId : null,
    assigneeUserId:
      typeof r.assigneeUserId === "string" ? r.assigneeUserId : null,
    identifier: typeof r.identifier === "string" ? r.identifier : null,
    issueNumber: typeof r.issueNumber === "number" ? r.issueNumber : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

function normalizeAgent(raw: unknown): PaperclipAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return {
    id: r.id,
    name: r.name,
    role: typeof r.role === "string" ? r.role : null,
    title: typeof r.title === "string" ? r.title : null,
    icon: typeof r.icon === "string" ? r.icon : null,
    status: typeof r.status === "string" ? r.status : null,
  };
}

export async function createIssue(
  input: PaperclipCreateIssueInput,
): Promise<PaperclipIssue> {
  const cfg = getPaperclipConfig();
  if (!cfg) throw new Error("Paperclip is not configured");
  const url = `${cfg.baseUrl}/api/companies/${cfg.companyId}/issues`;
  const assigneeAgentId = input.assigneeAgentId ?? cfg.assigneeAgentId;
  const body = {
    title: input.title,
    description: input.description,
    priority: input.priority,
    ...(assigneeAgentId ? { assigneeAgentId } : {}),
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      ...authHeaders(cfg),
      "X-Paperclip-Run-Id": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Paperclip createIssue failed: ${res.status} ${res.statusText} at ${url} — ${text.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as unknown;
  const normalized = normalizeIssue(json);
  if (!normalized) {
    throw new Error(
      `Paperclip createIssue returned unexpected payload from ${url}: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return normalized;
}

export async function listIssues(): Promise<PaperclipIssue[]> {
  const cfg = getPaperclipConfig();
  if (!cfg) throw new Error("Paperclip is not configured");
  const url = `${cfg.baseUrl}/api/companies/${cfg.companyId}/issues`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: authHeaders(cfg),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Paperclip listIssues failed: ${res.status} ${res.statusText} at ${url} — ${text.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) {
    logger.warn(
      { sample: JSON.stringify(json).slice(0, 200) },
      "Paperclip listIssues returned non-array",
    );
    return [];
  }
  return json
    .map(normalizeIssue)
    .filter((x): x is PaperclipIssue => x !== null);
}

export async function listAgents(): Promise<PaperclipAgent[]> {
  const cfg = getPaperclipConfig();
  if (!cfg) throw new Error("Paperclip is not configured");
  const url = `${cfg.baseUrl}/api/companies/${cfg.companyId}/agents`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: authHeaders(cfg),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Paperclip listAgents failed: ${res.status} ${res.statusText} at ${url} — ${text.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) return [];
  return json
    .map(normalizeAgent)
    .filter((x): x is PaperclipAgent => x !== null);
}
