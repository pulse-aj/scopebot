import { useState, useMemo, useEffect, useRef } from "react";
import {
  useListEngineeringTasks,
  getListEngineeringTasksQueryKey,
  useCreateEngineeringTask,
  useUpdateEngineeringTask,
  useDeleteEngineeringTask,
  useListEngineeringTaskMessages,
  getListEngineeringTaskMessagesQueryKey,
  usePostEngineeringTaskMessage,
  useListCustomerQuestionDrafts,
  getListCustomerQuestionDraftsQueryKey,
  useApproveCustomerQuestionDraft,
  useRejectCustomerQuestionDraft,
  useAdminListUsers,
  getAdminListUsersQueryKey,
  getGetConversationQueryKey,
  getAdminGetConversationQueryKey,
  useRefreshEngineeringTaskPrState,
} from "@workspace/api-client-react";
import type {
  EngineeringTask,
  EngineeringTaskMessage,
  CustomerQuestionDraft,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  Send,
  Github,
  Trash2,
  MessageSquare,
  Check,
  X,
  Sparkles,
  User as UserIcon,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  RepoPicker,
  BranchPicker,
  PullPicker,
} from "@/components/github-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type Status = EngineeringTask["status"];

const STATUS_COLUMNS: { key: Status; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "in_review", label: "In review" },
  { key: "done", label: "Done" },
];

const STATUS_COLORS: Record<Status, string> = {
  backlog: "bg-slate-100 dark:bg-slate-950/50 text-slate-700 border-slate-200 dark:border-slate-900/60",
  todo: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60",
  in_progress: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
  in_review: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60",
  done: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export function EngineeringPanel({
  featureRequestId,
  conversationId,
}: {
  featureRequestId: number;
  conversationId: number;
}) {
  const { data: tasks } = useListEngineeringTasks(featureRequestId);
  const { data: drafts } = useListCustomerQuestionDrafts(featureRequestId);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const grouped = useMemo(() => {
    const byStatus: Record<Status, EngineeringTask[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      cancelled: [],
    };
    for (const t of tasks ?? []) byStatus[t.status].push(t);
    return byStatus;
  }, [tasks]);

  const openTask = (tasks ?? []).find((t) => t.id === openTaskId) ?? null;
  const pendingDrafts = (drafts ?? []).filter((d) => d.status === "pending");

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Engineering
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tasks, engineer ↔ AI PM chat, and customer question reviews. Admin
            only.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add task
        </Button>
      </div>

      {pendingDrafts.length > 0 && (
        <div className="px-6 py-4 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60">
          <div className="text-xs uppercase tracking-wider font-bold text-amber-900 dark:text-amber-100 mb-3">
            Pending customer questions ({pendingDrafts.length})
          </div>
          <div className="space-y-3">
            {pendingDrafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                featureRequestId={featureRequestId}
                conversationId={conversationId}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 p-4 bg-muted/40">
        {STATUS_COLUMNS.map((col) => (
          <div key={col.key} className="flex flex-col min-w-0">
            <div className="px-2 py-2 flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                {col.label}
              </span>
              <span className="text-xs text-muted-foreground/70 font-medium">
                {grouped[col.key].length}
              </span>
            </div>
            <div className="space-y-2 min-h-[60px]">
              {grouped[col.key].map((t) => (
                <TaskCard key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />
              ))}
              {grouped[col.key].length === 0 && (
                <div className="text-xs text-muted-foreground/70 italic px-2 py-3">
                  Nothing here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <CreateTaskSheet
        featureRequestId={featureRequestId}
        open={creating}
        onOpenChange={setCreating}
      />
      <TaskDetailSheet
        task={openTask}
        featureRequestId={featureRequestId}
        onOpenChange={(o) => {
          if (!o) setOpenTaskId(null);
        }}
      />
    </div>
  );
}

function TaskCard({
  task,
  onOpen,
}: {
  task: EngineeringTask;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-indigo-300 hover:shadow-sm transition group"
    >
      <div className="text-sm font-medium text-foreground group-hover:text-indigo-700 dark:text-indigo-300 mb-1.5 line-clamp-2">
        {task.title}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {task.assigneeName ? (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <UserIcon className="w-3 h-3" />
            {task.assigneeName}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground/70">Unassigned</div>
        )}
        <div className="flex items-center gap-1.5">
          {task.githubPrUrl && (
            <Badge
              variant="outline"
              className={`text-[10px] gap-1 ${
                task.githubPrState === "merged"
                  ? "bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60"
                  : task.githubPrState === "closed"
                    ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60"
                    : "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/60"
              }`}
            >
              <Github className="w-3 h-3" />
              {task.githubPrNumber ? `#${task.githubPrNumber}` : "PR"}
            </Badge>
          )}
          {task.githubBranch && !task.githubPrUrl && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60"
            >
              <Github className="w-3 h-3" />
              branch
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function CreateTaskSheet({
  featureRequestId,
  open,
  onOpenChange,
}: {
  featureRequestId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState<string>("__none__");
  const { data: users } = useAdminListUsers({
    query: { enabled: open, queryKey: getAdminListUsersQueryKey() },
  });
  const createMut = useCreateEngineeringTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setAssigneeUserId("__none__");
    }
  }, [open]);

  const submit = () => {
    if (!title.trim()) return;
    createMut.mutate(
      {
        id: featureRequestId,
        data: {
          title: title.trim(),
          description,
          assigneeUserId:
            assigneeUserId === "__none__" ? null : assigneeUserId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEngineeringTasksQueryKey(featureRequestId),
          });
          toast({ title: "Task created" });
          onOpenChange(false);
        },
        onError: () =>
          toast({ title: "Failed to create task", variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New engineering task</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <label className="text-sm font-medium text-foreground/85">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Wire OCPP idTag whitelist"
              className="mt-1.5"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/85">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="mt-1.5"
              placeholder="Implementation notes, acceptance criteria, links…"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/85">
              Assignee
            </label>
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {(users ?? [])
                  .filter((u) => u.isAdmin || u.isEngineer)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email}
                      {u.isAdmin
                        ? " · admin"
                        : u.isEngineer
                          ? " · engineer"
                          : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={submit}
            disabled={!title.trim() || createMut.isPending}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            {createMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Create task"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailSheet({
  task,
  featureRequestId,
  onOpenChange,
}: {
  task: EngineeringTask | null;
  featureRequestId: number;
  onOpenChange: (o: boolean) => void;
}) {
  const open = !!task;
  const { data: users } = useAdminListUsers({
    query: { enabled: open, queryKey: getAdminListUsersQueryKey() },
  });
  const updateMut = useUpdateEngineeringTask();
  const deleteMut = useDeleteEngineeringTask();
  const refreshPrMut = useRefreshEngineeringTaskPrState();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
  }, [task]);

  if (!task) {
    return (
      <Sheet open={false} onOpenChange={onOpenChange}>
        <SheetContent />
      </Sheet>
    );
  }

  const patch = (data: Parameters<typeof updateMut.mutate>[0]["data"]) => {
    updateMut.mutate(
      { id: task.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEngineeringTasksQueryKey(featureRequestId),
          });
        },
        onError: () =>
          toast({ title: "Failed to update task", variant: "destructive" }),
      },
    );
  };

  const saveText = () => {
    patch({ title, description });
    toast({ title: "Saved" });
  };

  const refreshPr = () => {
    refreshPrMut.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEngineeringTasksQueryKey(featureRequestId),
          });
          toast({ title: "PR state refreshed" });
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { error?: string } } };
          toast({
            title: e.response?.data?.error ?? "Could not refresh PR state",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleDelete = () => {
    if (!confirm("Delete this task and all engineer-AI chat? This cannot be undone.")) return;
    deleteMut.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEngineeringTasksQueryKey(featureRequestId),
          });
          toast({ title: "Task deleted" });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-base">Engineering task</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== task.title) patch({ title });
              }}
              className="text-lg font-bold border-0 px-0 focus-visible:ring-0"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Status
              </label>
              <Select
                value={task.status}
                onValueChange={(v) => patch({ status: v as Status })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_COLUMNS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Assignee
              </label>
              <Select
                value={task.assigneeUserId ?? "__none__"}
                onValueChange={(v) =>
                  patch({ assigneeUserId: v === "__none__" ? null : v })
                }
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {(users ?? [])
                    .filter((u) => u.isAdmin || u.isEngineer)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email}
                        {u.isAdmin
                          ? " · admin"
                          : u.isEngineer
                            ? " · engineer"
                            : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveText}
              rows={4}
              className="mt-1.5"
              placeholder="Implementation notes…"
            />
          </div>

          <div className="border border-border rounded-xl p-4 bg-muted/40">
            <div className="flex items-center gap-2 mb-3">
              <Github className="w-4 h-4 text-foreground/85" />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground/85">
                GitHub
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Repository</label>
                <RepoPicker
                  value={task.githubRepo ?? null}
                  onChange={(r) => {
                    // Clear branch/PR when the repo changes — they belong to
                    // the old repo and would be misleading.
                    if (!r) {
                      patch({
                        githubRepo: null,
                        githubBranch: null,
                        githubPrUrl: null,
                        githubPrNumber: null,
                      });
                    } else if (r.fullName !== task.githubRepo) {
                      patch({
                        githubRepo: r.fullName,
                        githubBranch: null,
                        githubPrUrl: null,
                        githubPrNumber: null,
                      });
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Branch</label>
                  <BranchPicker
                    repo={task.githubRepo ?? null}
                    value={task.githubBranch ?? null}
                    onChange={(b) =>
                      patch({ githubBranch: b ? b.name : null })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Pull request</label>
                  <PullPicker
                    repo={task.githubRepo ?? null}
                    value={
                      task.githubPrNumber
                        ? `#${task.githubPrNumber}`
                        : null
                    }
                    onChange={(p) => {
                      if (!p) {
                        patch({
                          githubPrUrl: null,
                          githubPrNumber: null,
                        });
                        return;
                      }
                      patch({
                        githubPrUrl: p.htmlUrl,
                        githubPrNumber: p.number,
                        // Use the PR's branch unless the user already set a
                        // different branch explicitly.
                        githubBranch: task.githubBranch ?? p.headRef ?? null,
                      });
                    }}
                  />
                </div>
              </div>
              {(task.githubPrUrl || task.githubPrState) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  {task.githubPrState && (
                    <span
                      className={`uppercase tracking-wider text-[10px] font-bold rounded px-1.5 py-0.5 ${
                        task.githubPrState === "merged"
                          ? "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300"
                          : task.githubPrState === "closed"
                            ? "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300"
                            : "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300"
                      }`}
                    >
                      {task.githubPrState}
                    </span>
                  )}
                  {task.githubPrUrl && (
                    <a
                      href={task.githubPrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Open PR <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {task.githubPrUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={refreshPr}
                      disabled={refreshPrMut.isPending}
                      className="ml-auto h-6 px-2 text-[11px] gap-1"
                    >
                      {refreshPrMut.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Refresh state
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <EngineerChat taskId={task.id} featureRequestId={featureRequestId} />
        </div>
        <div className="border-t px-6 py-3 flex items-center justify-between bg-muted/40">
          <div className="text-xs text-muted-foreground">
            Created {format(new Date(task.createdAt), "MMM d, yyyy")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-50 dark:bg-red-950/40 gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete task
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EngineerChat({
  taskId,
  featureRequestId,
}: {
  taskId: number;
  featureRequestId: number;
}) {
  const { data: messages, isLoading } = useListEngineeringTaskMessages(taskId);
  const postMut = usePostEngineeringTaskMessage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = () => {
    if (!draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    postMut.mutate(
      { id: taskId, data: { content } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEngineeringTaskMessagesQueryKey(taskId),
          });
          // AI may have drafted a customer question during this turn —
          // refresh the review queue so it appears immediately.
          queryClient.invalidateQueries({
            queryKey:
              getListCustomerQuestionDraftsQueryKey(featureRequestId),
          });
        },
      },
    );
  };

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-gradient-to-r from-indigo-50 to-purple-50">
        <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-100">
          Engineer ↔ AI PM
        </span>
        <span className="text-[10px] text-indigo-700 dark:text-indigo-300/70 ml-1">
          AI-drafted customer questions go to admin review
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 overflow-y-auto px-4 py-4 space-y-3 bg-muted/40"
      >
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" />
          </div>
        ) : (messages ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Ask the AI PM anything about scope, intent, or edge cases. If
            something genuinely needs the customer to clarify, the AI will draft
            a question for admin review.
          </div>
        ) : (
          (messages ?? []).map((m) => (
            <ChatBubble key={m.id} msg={m} />
          ))
        )}
        {postMut.isPending && (
          <div className="text-xs text-muted-foreground italic flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> AI PM thinking…
          </div>
        )}
      </div>
      <div className="border-t p-2 flex gap-2 items-end">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Ask the AI PM…"
          className="resize-none text-sm flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!draft.trim() || postMut.isPending}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: EngineeringTaskMessage }) {
  const isEng = msg.role === "engineer";
  return (
    <div className={`flex ${isEng ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isEng
            ? "bg-indigo-600 text-white"
            : "bg-card border border-border text-foreground"
        }`}
      >
        <div
          className={`text-[10px] uppercase tracking-wider mb-1 font-bold ${
            isEng ? "text-indigo-100" : "text-muted-foreground"
          }`}
        >
          {isEng ? msg.authorName || "Engineer" : "AI PM"}
        </div>
        {msg.content}
        {msg.draftId && (
          <div
            className={`mt-2 text-[11px] flex items-center gap-1.5 px-2 py-1 rounded ${
              isEng ? "bg-indigo-700" : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900/60"
            }`}
          >
            <ChevronRight className="w-3 h-3" />
            Drafted question waiting on admin review
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  featureRequestId,
  conversationId,
}: {
  draft: CustomerQuestionDraft;
  featureRequestId: number;
  conversationId: number;
}) {
  const [edited, setEdited] = useState(draft.draftContent);
  const [editing, setEditing] = useState(false);
  const approveMut = useApproveCustomerQuestionDraft();
  const rejectMut = useRejectCustomerQuestionDraft();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getListCustomerQuestionDraftsQueryKey(featureRequestId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetConversationQueryKey(conversationId),
    });
    queryClient.invalidateQueries({
      queryKey: getAdminGetConversationQueryKey(conversationId),
    });
  };

  const approve = () => {
    approveMut.mutate(
      {
        id: draft.id,
        data: editing && edited.trim() !== draft.draftContent ? { editedContent: edited } : {},
      },
      {
        onSuccess: () => {
          toast({ title: "Question sent to customer" });
          invalidate();
        },
        onError: () =>
          toast({ title: "Failed to approve", variant: "destructive" }),
      },
    );
  };

  const reject = () => {
    rejectMut.mutate(
      { id: draft.id },
      {
        onSuccess: () => {
          toast({ title: "Draft rejected" });
          invalidate();
        },
      },
    );
  };

  return (
    <div className="bg-card border border-amber-300 rounded-lg p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-300 mb-1.5 flex items-center gap-2">
        <Sparkles className="w-3 h-3" /> AI drafted from{" "}
        {draft.proposedByName ?? "engineer chat"}
      </div>
      {editing ? (
        <Textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={3}
          className="text-sm"
        />
      ) : (
        <div className="text-sm text-foreground whitespace-pre-wrap">
          {draft.draftContent}
        </div>
      )}
      {draft.contextNote && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300/80 italic mt-2">
          Rationale: {draft.contextNote}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          onClick={approve}
          disabled={approveMut.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8"
        >
          <Check className="w-3.5 h-3.5" /> Send to customer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing((v) => !v)}
          className="h-8"
        >
          {editing ? "Cancel edit" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={reject}
          disabled={rejectMut.isPending}
          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-50 dark:bg-red-950/40 gap-1.5 h-8 ml-auto"
        >
          <X className="w-3.5 h-3.5" /> Reject
        </Button>
      </div>
    </div>
  );
}
