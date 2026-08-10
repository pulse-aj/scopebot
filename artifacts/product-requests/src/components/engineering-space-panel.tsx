import {
  useAdminEngineeringSpace,
  useAdminEngineeringSpaceRefresh,
  useAdminRetryPaperclipPush,
  useAdminRetryNotionPush,
  getAdminEngineeringSpaceQueryKey,
  type EngineeringSpaceRequest,
  type PaperclipAgent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Wrench,
  CircleDot,
  CheckCircle2,
  XCircle,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const PAPERCLIP_STATUS_STYLE: Record<string, { color: string; icon: typeof CircleDot }> = {
  open: { color: "bg-muted text-foreground/85 border-border", icon: CircleDot },
  backlog: { color: "bg-muted text-foreground/85 border-border", icon: CircleDot },
  todo: { color: "bg-muted text-foreground/85 border-border", icon: CircleDot },
  in_progress: { color: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60", icon: Loader2 },
  in_review: { color: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60", icon: Eye },
  done: { color: "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/60", icon: CheckCircle2 },
  cancelled: { color: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60", icon: XCircle },
};

function statusStyle(status: string | null | undefined) {
  if (!status) return PAPERCLIP_STATUS_STYLE.open!;
  return PAPERCLIP_STATUS_STYLE[status] ?? PAPERCLIP_STATUS_STYLE.open!;
}

function agentLabel(
  agentId: string | null | undefined,
  agentsById: Map<string, PaperclipAgent>,
) {
  if (!agentId) return "Unassigned";
  const a = agentsById.get(agentId);
  if (!a) return agentId.slice(0, 8);
  return a.name;
}

export function EngineeringSpacePanel() {
  const { data, isLoading, isError, error } = useAdminEngineeringSpace({
    query: {
      queryKey: getAdminEngineeringSpaceQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const refreshMut = useAdminEngineeringSpaceRefresh();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleRefresh = () => {
    refreshMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Refresh kicked off" });
        // Give push+poll a moment to complete before re-fetching.
        setTimeout(() => {
          queryClient.invalidateQueries({
            queryKey: getAdminEngineeringSpaceQueryKey(),
          });
        }, 3000);
      },
      onError: () =>
        toast({
          title: "Failed to trigger refresh",
          variant: "destructive",
        }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl p-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-900 dark:text-red-100">
            Couldn't load Engineering Space
          </h3>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const { schedulerStatus, notionSchedulerStatus, agents, requests } = data;
  const agentsById = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      {/* Scheduler status banner */}
      <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                schedulerStatus.configured
                  ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
              }`}
            >
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Paperclip integration</h3>
              {schedulerStatus.configured ? (
                <p className="text-sm text-muted-foreground mt-0.5">
                  Push every 5 min · poll every 1 min
                  {schedulerStatus.lastPushAt && (
                    <>
                      {" · "}last push{" "}
                      {formatDistanceToNow(new Date(schedulerStatus.lastPushAt), {
                        addSuffix: true,
                      })}
                    </>
                  )}
                  {schedulerStatus.lastPollAt && (
                    <>
                      {" · "}last sync{" "}
                      {formatDistanceToNow(new Date(schedulerStatus.lastPollAt), {
                        addSuffix: true,
                      })}
                    </>
                  )}
                </p>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                  Not configured. Set <code className="text-xs bg-amber-100 dark:bg-amber-950/50 px-1 rounded">PAPERCLIP_URL</code>,{" "}
                  <code className="text-xs bg-amber-100 dark:bg-amber-950/50 px-1 rounded">COMPANY_ID</code>, and{" "}
                  <code className="text-xs bg-amber-100 dark:bg-amber-950/50 px-1 rounded">PAPERCLIP_API_KEY</code> to enable.
                </p>
              )}
              {(schedulerStatus.lastPushError || schedulerStatus.lastPollError) && (
                <p className="text-xs text-red-700 dark:text-red-300 mt-2 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>
                    {schedulerStatus.lastPushError ?? schedulerStatus.lastPollError}
                  </span>
                </p>
              )}
            </div>
          </div>
          {(schedulerStatus.configured || notionSchedulerStatus.configured) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshMut.isPending}
              className="gap-1.5"
            >
              {refreshMut.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Refresh now
            </Button>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-border/60 flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              notionSchedulerStatus.configured
                ? "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"
                : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
            }`}
          >
            <CircleDot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">Notion integration</h3>
            {notionSchedulerStatus.configured ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                Push every 5 min · poll every 1 min
                {notionSchedulerStatus.lastPushAt && (
                  <>
                    {" · "}last push{" "}
                    {formatDistanceToNow(
                      new Date(notionSchedulerStatus.lastPushAt),
                      { addSuffix: true },
                    )}
                  </>
                )}
                {notionSchedulerStatus.lastPollAt && (
                  <>
                    {" · "}last sync{" "}
                    {formatDistanceToNow(
                      new Date(notionSchedulerStatus.lastPollAt),
                      { addSuffix: true },
                    )}
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                Not configured. Set{" "}
                <code className="text-xs bg-amber-100 dark:bg-amber-950/50 px-1 rounded">
                  NOTION_DATABASE_ID
                </code>{" "}
                to enable routing tickets to human engineers.
              </p>
            )}
            {(notionSchedulerStatus.lastPushError ||
              notionSchedulerStatus.lastPollError) && (
              <p className="text-xs text-red-700 dark:text-red-300 mt-2 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {notionSchedulerStatus.lastPushError ??
                    notionSchedulerStatus.lastPollError}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Requests pushed to Paperclip */}
      {requests.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center">
          <Wrench className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
          <h3 className="font-semibold text-foreground">
            Nothing in Paperclip yet
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            When you move a request into <span className="font-semibold">Planned</span>, it
            will be pushed to Paperclip within ~5 minutes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              req={req}
              agentsById={agentsById}
              onOpen={() => setLocation(`/requests/${req.id}?from=admin`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  req,
  agentsById,
  onOpen,
}: {
  req: EngineeringSpaceRequest;
  agentsById: Map<string, PaperclipAgent>;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const retryMut = useAdminRetryPaperclipPush();
  const retryNotionMut = useAdminRetryNotionPush();
  const isHuman = req.engineeringOwner === "human";
  const parentStyle = statusStyle(req.paperclipStatus);
  const ParentIcon = parentStyle.icon;
  // A row that errored and never landed in Paperclip has no issueId and a
  // recorded error. The scheduler will NOT auto-retry these — surface a
  // clear Retry button.
  const canRetry = !req.paperclipIssueId && !!req.paperclipPushError;
  // Same idea for Notion: a human-routed row that errored and never got a
  // notionPageId can be re-attempted manually.
  const canRetryNotion = !req.notionPageId && !!req.notionPushError;

  const handleRetry = () => {
    retryMut.mutate(
      { id: req.id },
      {
        onSuccess: () => {
          toast({ title: "Pushed to Paperclip" });
          queryClient.invalidateQueries({
            queryKey: getAdminEngineeringSpaceQueryKey(),
          });
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Push failed again";
          toast({
            title: "Retry failed",
            description: message,
            variant: "destructive",
          });
          queryClient.invalidateQueries({
            queryKey: getAdminEngineeringSpaceQueryKey(),
          });
        },
      },
    );
  };

  const handleRetryNotion = () => {
    retryNotionMut.mutate(
      { id: req.id },
      {
        onSuccess: () => {
          toast({ title: "Pushed to Notion" });
          queryClient.invalidateQueries({
            queryKey: getAdminEngineeringSpaceQueryKey(),
          });
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Push failed again";
          toast({
            title: "Retry failed",
            description: message,
            variant: "destructive",
          });
          queryClient.invalidateQueries({
            queryKey: getAdminEngineeringSpaceQueryKey(),
          });
        },
      },
    );
  };
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="p-5 border-b border-border/60">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 ${
                  isHuman
                    ? "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900/60"
                    : "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/60"
                }`}
              >
                {isHuman ? "Human · Notion" : "Agent · Paperclip"}
              </Badge>
              {!isHuman && req.paperclipIdentifier && (
                <span className="text-[11px] font-mono font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {req.paperclipIdentifier}
                </span>
              )}
              {isHuman ? (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 bg-muted text-foreground/85 border-border"
                >
                  {req.notionStatus ?? (req.notionPageId ? "synced" : "pending")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 ${parentStyle.color}`}
                >
                  <ParentIcon
                    className={`w-3 h-3 mr-1 ${
                      req.paperclipStatus === "in_progress" ? "animate-spin" : ""
                    }`}
                  />
                  {req.paperclipStatus ?? "open"}
                </Badge>
              )}
              {req.adminPriorityRank !== null && (
                <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
                  #{req.adminPriorityRank}
                </span>
              )}
            </div>
            <h3 className="font-bold text-foreground text-base leading-tight">
              {req.title}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {req.summary}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpen}
            className="gap-1 flex-shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Assignee:{" "}
            <span className="font-medium text-foreground/85">
              {isHuman
                ? req.notionAssignee ?? "Unassigned"
                : agentLabel(req.paperclipAssigneeAgentId, agentsById)}
            </span>
          </span>
          {isHuman
            ? req.notionPushedAt && (
                <span>
                  Pushed{" "}
                  {formatDistanceToNow(new Date(req.notionPushedAt), {
                    addSuffix: true,
                  })}
                </span>
              )
            : req.paperclipPushedAt && (
                <span>
                  Pushed{" "}
                  {formatDistanceToNow(new Date(req.paperclipPushedAt), {
                    addSuffix: true,
                  })}
                </span>
              )}
          {isHuman
            ? req.notionLastSyncedAt && (
                <span>
                  Synced{" "}
                  {formatDistanceToNow(new Date(req.notionLastSyncedAt), {
                    addSuffix: true,
                  })}
                </span>
              )
            : req.paperclipLastSyncedAt && (
                <span>
                  Synced{" "}
                  {formatDistanceToNow(new Date(req.paperclipLastSyncedAt), {
                    addSuffix: true,
                  })}
                </span>
              )}
          {isHuman && req.notionUrl && (
            <a
              href={req.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline font-medium"
            >
              <ExternalLink className="w-3 h-3" />
              Notion page
            </a>
          )}
        </div>
        {isHuman && req.notionPushError && (
          <div className="mt-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="break-all flex-1">{req.notionPushError}</span>
            </div>
            {canRetryNotion && (
              <div className="mt-2 flex items-center justify-between gap-2 pl-5">
                <span className="text-[11px] text-red-600/80">
                  Won't auto-retry. Click below to re-attempt the Notion page
                  creation.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetryNotion}
                  disabled={retryNotionMut.isPending}
                  className="h-7 gap-1 text-xs border-red-300 text-red-700 dark:text-red-300 hover:bg-red-100 dark:bg-red-950/50 flex-shrink-0"
                >
                  {retryNotionMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Retry push
                </Button>
              </div>
            )}
          </div>
        )}
        {!isHuman && req.paperclipPushError && (
          <div className="mt-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="break-all flex-1">
                {req.paperclipPushError}
              </span>
            </div>
            {canRetry && (
              <div className="mt-2 flex items-center justify-between gap-2 pl-5">
                <span className="text-[11px] text-red-600/80">
                  Won't auto-retry. Click below to re-attempt — duplicates
                  may occur if Paperclip already created an issue.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  disabled={retryMut.isPending}
                  className="h-7 gap-1 text-xs border-red-300 text-red-700 dark:text-red-300 hover:bg-red-100 dark:bg-red-950/50 flex-shrink-0"
                >
                  {retryMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Retry push
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Child tasks */}
      {req.children.length > 0 && (
        <div className="bg-muted/60 px-5 py-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Tasks · {req.children.length}
          </div>
          {req.children.map((child) => {
            const cs = statusStyle(child.status);
            const CIcon = cs.icon;
            return (
              <div
                key={child.id}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 flex-shrink-0 ${cs.color}`}
                >
                  <CIcon
                    className={`w-3 h-3 mr-1 ${
                      child.status === "in_progress" ? "animate-spin" : ""
                    }`}
                  />
                  {child.status}
                </Badge>
                {child.identifier && (
                  <span className="text-[11px] font-mono text-muted-foreground flex-shrink-0">
                    {child.identifier}
                  </span>
                )}
                <span className="text-foreground truncate flex-1">
                  {child.title}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {agentLabel(child.assigneeAgentId, agentsById)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
