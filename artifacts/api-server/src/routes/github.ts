import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, engineeringTasksTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import {
  listRepos,
  listBranches,
  listPulls,
  parsePullUrl,
  getPull,
} from "../lib/github.js";

const router: IRouter = Router();

function handleGithubError(
  req: { log?: { warn: (...a: unknown[]) => void } },
  res: import("express").Response,
  err: unknown,
  context: string,
) {
  const e = err as { status?: number; message?: string };
  req.log?.warn({ err: e?.message, context }, "GitHub proxy error");
  const status = typeof e?.status === "number" ? e.status : null;
  res
    .status(502)
    .json({
      error:
        status === 401 || status === 403
          ? "GitHub authorization failed — reconnect the GitHub integration."
          : "Could not reach GitHub. Try again in a moment.",
      status,
    });
}

router.get("/github/repos", requireAuth, requireAdmin, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : null;
    res.json(await listRepos(q));
  } catch (err) {
    handleGithubError(req, res, err, "list-repos");
  }
});

// GitHub repo slugs are restricted to alphanumerics, dash, underscore, dot.
// Reject anything else so the value can never alter request path/query shape
// when concatenated into the connector path.
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

router.get("/github/branches", requireAuth, requireAdmin, async (req, res) => {
  const repo = typeof req.query.repo === "string" ? req.query.repo.trim() : "";
  if (!REPO_RE.test(repo)) {
    res.status(400).json({ error: "repo must be 'owner/name'" });
    return;
  }
  try {
    const q = typeof req.query.q === "string" ? req.query.q : null;
    res.json(await listBranches(repo, q));
  } catch (err) {
    handleGithubError(req, res, err, "list-branches");
  }
});

router.get("/github/pulls", requireAuth, requireAdmin, async (req, res) => {
  const repo = typeof req.query.repo === "string" ? req.query.repo.trim() : "";
  if (!REPO_RE.test(repo)) {
    res.status(400).json({ error: "repo must be 'owner/name'" });
    return;
  }
  try {
    const q = typeof req.query.q === "string" ? req.query.q : null;
    res.json(await listPulls(repo, q));
  } catch (err) {
    handleGithubError(req, res, err, "list-pulls");
  }
});

router.post(
  "/engineering-tasks/:id/refresh-pr-state",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [task] = await db
      .select()
      .from(engineeringTasksTable)
      .where(eq(engineeringTasksTable.id, id))
      .limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!task.githubPrUrl) {
      res.status(400).json({ error: "Task has no PR URL" });
      return;
    }
    const parsed = parsePullUrl(task.githubPrUrl);
    if (!parsed || !REPO_RE.test(parsed.repo)) {
      res.status(400).json({ error: "PR URL is not a github.com pull URL" });
      return;
    }
    let pull;
    try {
      pull = await getPull(parsed.repo, parsed.number);
    } catch (err) {
      handleGithubError(req, res, err, "get-pull");
      return;
    }
    const state: "open" | "closed" | "merged" = pull.merged
      ? "merged"
      : pull.state;
    const [updated] = await db
      .update(engineeringTasksTable)
      .set({
        githubRepo: parsed.repo,
        githubPrNumber: pull.number,
        githubPrState: state,
        githubPrStateUpdatedAt: new Date(),
        githubBranch: task.githubBranch ?? pull.headRef,
      })
      .where(eq(engineeringTasksTable.id, id))
      .returning();
    res.json({
      id: updated!.id,
      featureRequestId: updated!.featureRequestId,
      title: updated!.title,
      description: updated!.description,
      status: updated!.status,
      assigneeUserId: updated!.assigneeUserId,
      assigneeName: null,
      githubRepo: updated!.githubRepo,
      githubBranch: updated!.githubBranch,
      githubPrNumber: updated!.githubPrNumber,
      githubPrUrl: updated!.githubPrUrl,
      githubPrState: updated!.githubPrState,
      githubPrStateUpdatedAt: updated!.githubPrStateUpdatedAt
        ? updated!.githubPrStateUpdatedAt.toISOString()
        : null,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    });
  },
);

export default router;
