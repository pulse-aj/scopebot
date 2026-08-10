// Replit GitHub integration (blueprint: github). Calls are proxied through
// the Replit Connectors SDK, which injects the connected user's OAuth token
// and refreshes it as needed. Never cache the client.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger.js";

const connectors = new ReplitConnectors();

async function ghFetch<T>(path: string): Promise<T> {
  const res = await connectors.proxy("github", path, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { path, status: res.status, body: body.slice(0, 500) },
      "GitHub proxy request failed",
    );
    const err: Error & { status?: number } = new Error(
      `GitHub ${path} → ${res.status}`,
    );
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export type GhRepo = {
  fullName: string; // "owner/repo"
  name: string;
  description: string | null;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
  updatedAt: string | null;
};

export type GhBranch = {
  name: string;
  protected: boolean;
  sha: string;
};

export type GhPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  updatedAt: string;
};

type RepoRaw = {
  full_name: string;
  name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  updated_at: string | null;
};

type BranchRaw = {
  name: string;
  protected: boolean;
  commit: { sha: string };
};

type PullRaw = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged_at: string | null;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  updated_at: string;
};

export async function listRepos(query: string | null): Promise<GhRepo[]> {
  // Pull up to 100 of the user's most-recently pushed repos. Filter client-side
  // by query — GitHub's /user/repos doesn't support search params.
  const raw = await ghFetch<RepoRaw[]>(
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
  );
  const q = (query ?? "").trim().toLowerCase();
  const filtered = q
    ? raw.filter((r) => r.full_name.toLowerCase().includes(q))
    : raw;
  return filtered.slice(0, 50).map((r) => ({
    fullName: r.full_name,
    name: r.name,
    description: r.description,
    private: r.private,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
  }));
}

function encodeRepoPath(repo: string): string {
  // Caller has already validated repo is owner/name; encode each segment
  // independently so a stray '?', '#', or '%' can't reshape the request path.
  const [owner, name] = repo.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export async function listBranches(
  repo: string,
  query: string | null,
): Promise<GhBranch[]> {
  const raw = await ghFetch<BranchRaw[]>(
    `/repos/${encodeRepoPath(repo)}/branches?per_page=100`,
  );
  const q = (query ?? "").trim().toLowerCase();
  const filtered = q
    ? raw.filter((b) => b.name.toLowerCase().includes(q))
    : raw;
  return filtered.slice(0, 50).map((b) => ({
    name: b.name,
    protected: b.protected,
    sha: b.commit.sha,
  }));
}

export async function listPulls(
  repo: string,
  query: string | null,
): Promise<GhPull[]> {
  // state=all so users can attach to a closed/merged PR for historical record.
  const raw = await ghFetch<PullRaw[]>(
    `/repos/${encodeRepoPath(repo)}/pulls?state=all&per_page=50&sort=updated&direction=desc`,
  );
  const q = (query ?? "").trim().toLowerCase();
  const filtered = q
    ? raw.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          String(p.number).includes(q) ||
          p.head.ref.toLowerCase().includes(q),
      )
    : raw;
  return filtered.slice(0, 50).map(rawToPull);
}

function rawToPull(p: PullRaw): GhPull {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    merged: p.merged_at != null,
    htmlUrl: p.html_url,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    updatedAt: p.updated_at,
  };
}

const PR_URL_RE =
  /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/** Parse a github.com/owner/repo/pull/123 URL. Returns null if not a PR URL. */
export function parsePullUrl(
  url: string,
): { repo: string; number: number } | null {
  const m = PR_URL_RE.exec(url.trim());
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}

export async function getPull(
  repo: string,
  number: number,
): Promise<GhPull> {
  const raw = await ghFetch<PullRaw>(
    `/repos/${encodeRepoPath(repo)}/pulls/${number}`,
  );
  return rawToPull(raw);
}
