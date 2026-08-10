import { useMemo, useState } from "react";
import { Redirect } from "wouter";
import {
  useListTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useListTodoCustomers,
  useListTodoAssignees,
  useListTodoComments,
  useCreateTodoComment,
  getListTodosQueryKey,
  getListTodoCommentsQueryKey,
  getListTodoCustomersQueryKey,
  getListTodoAssigneesQueryKey,
} from "@workspace/api-client-react";
import type { TodoTask, TodoStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Plus,
  Trash2,
  MessageSquare,
  Building2,
  User as UserIcon,
  ListChecks,
} from "lucide-react";

const COLUMNS: { id: TodoStatus; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

const STATUS_LABEL: Record<TodoStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

const UNASSIGNED = "__unassigned__";
const NO_CUSTOMER = "__none__";

function initials(name: string | null | undefined, email?: string | null) {
  const src = name || email || "?";
  return src.charAt(0).toUpperCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TasksPage() {
  const { me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = !!me?.isAdmin;
  const isStaff = isAdmin || !!me?.isEngineer;

  const [mineOnly, setMineOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const params = mineOnly ? { mine: true } : undefined;
  const tasksQuery = useListTodos(params, {
    query: { enabled: isStaff, queryKey: getListTodosQueryKey(params) },
  });
  const customersQuery = useListTodoCustomers({
    query: { enabled: isStaff, queryKey: getListTodoCustomersQueryKey() },
  });
  const assigneesQuery = useListTodoAssignees({
    query: { enabled: isStaff, queryKey: getListTodoAssigneesQueryKey() },
  });

  const createMut = useCreateTodo();
  const updateMut = useUpdateTodo();
  const deleteMut = useDeleteTodo();

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: getListTodosQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListTodosQueryKey({ mine: true }),
    });
  };

  const tasks = tasksQuery.data ?? [];
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  if (!isStaff) return <Redirect to="/app" />;

  const grouped = (status: TodoStatus) =>
    tasks.filter((t) => t.status === status);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex-shrink-0 px-6 py-5 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" /> Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Team to-do list across all customers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            <button
              onClick={() => setMineOnly(false)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                !mineOnly
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setMineOnly(true)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                mineOnly
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Assigned to me
            </button>
          </div>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New task
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {tasksQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <ListChecks className="w-10 h-10 mb-3 opacity-40" />
            <p className="font-medium text-foreground">No tasks yet</p>
            <p className="text-sm mt-1">
              {isAdmin
                ? "Create the first task to get started."
                : "Tasks assigned to the team will appear here."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COLUMNS.map((col) => {
              const items = grouped(col.id);
              return (
                <div key={col.id} className="flex flex-col min-w-0">
                  <div className="flex items-center justify-between px-1 pb-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      {col.label}
                    </h2>
                    <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {items.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onClick={() => setSelectedId(t.id)}
                      />
                    ))}
                    {items.length === 0 && (
                      <div className="text-xs text-muted-foreground/70 border border-dashed border-border rounded-lg py-6 text-center">
                        Nothing here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          customers={customersQuery.data ?? []}
          assignees={assigneesQuery.data ?? []}
          submitting={createMut.isPending}
          onSubmit={(data) => {
            createMut.mutate(
              { data },
              {
                onSuccess: () => {
                  invalidateList();
                  queryClient.invalidateQueries({
                    queryKey: getListTodoCustomersQueryKey(),
                  });
                  toast({ title: "Task created" });
                  setCreateOpen(false);
                },
                onError: () =>
                  toast({
                    title: "Failed to create task",
                    variant: "destructive",
                  }),
              },
            );
          }}
        />
      )}

      <TaskDetailSheet
        task={selectedTask}
        open={selectedId != null}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        isAdmin={isAdmin}
        customers={customersQuery.data ?? []}
        assignees={assigneesQuery.data ?? []}
        onUpdate={(id, data, opts) =>
          updateMut.mutate(
            { id, data },
            {
              onSuccess: () => {
                invalidateList();
                opts?.onSuccess?.();
              },
              onError: () =>
                toast({
                  title: "Failed to update task",
                  variant: "destructive",
                }),
            },
          )
        }
        updating={updateMut.isPending}
        onRequestDelete={(id) => setDeleteId(id)}
      />

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the task and all of its comments. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId == null) return;
                deleteMut.mutate(
                  { id: deleteId },
                  {
                    onSuccess: () => {
                      invalidateList();
                      toast({ title: "Task deleted" });
                      if (selectedId === deleteId) setSelectedId(null);
                      setDeleteId(null);
                    },
                    onError: () =>
                      toast({
                        title: "Failed to delete task",
                        variant: "destructive",
                      }),
                  },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TaskCard({
  task,
  onClick,
}: {
  task: TodoTask;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary/50 hover:shadow-sm transition-all"
    >
      <p className="text-sm font-medium text-foreground line-clamp-2">
        {task.title}
      </p>
      {task.customerName && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="w-3.5 h-3.5" />
          <span className="truncate">{task.customerName}</span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        {task.assigneeUserId ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar className="w-5 h-5 bg-accent text-accent-foreground text-[10px]">
              <AvatarFallback>
                {initials(task.assigneeName, task.assigneeEmail)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground truncate">
              {task.assigneeName}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/60">Unassigned</span>
        )}
        {task.commentCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
            <MessageSquare className="w-3.5 h-3.5" /> {task.commentCount}
          </span>
        )}
      </div>
    </button>
  );
}

interface CustomerOpt {
  id: number;
  name: string;
}
interface AssigneeOpt {
  id: string;
  name: string;
  email: string;
}

function CreateTaskDialog({
  open,
  onOpenChange,
  customers,
  assignees,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: CustomerOpt[];
  assignees: AssigneeOpt[];
  onSubmit: (data: {
    title: string;
    details?: string | null;
    customerId?: number | null;
    customerName?: string | null;
    assigneeUserId?: string | null;
  }) => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    "existing",
  );
  const [customerId, setCustomerId] = useState<string>(NO_CUSTOMER);
  const [customerName, setCustomerName] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);

  const reset = () => {
    setTitle("");
    setDetails("");
    setCustomerMode("existing");
    setCustomerId(NO_CUSTOMER);
    setCustomerName("");
    setAssignee(UNASSIGNED);
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    const data: {
      title: string;
      details?: string | null;
      customerId?: number | null;
      customerName?: string | null;
      assigneeUserId?: string | null;
    } = { title: title.trim() };
    if (details.trim()) data.details = details.trim();
    if (customerMode === "new") {
      if (customerName.trim()) data.customerName = customerName.trim();
    } else if (customerId !== NO_CUSTOMER) {
      data.customerId = Number(customerId);
    }
    if (assignee !== UNASSIGNED) data.assigneeUserId = assignee;
    onSubmit(data);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Request</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Details <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add any context…"
              rows={3}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium">Customer</label>
              <button
                type="button"
                onClick={() =>
                  setCustomerMode((m) => (m === "existing" ? "new" : "existing"))
                }
                className="text-xs text-primary hover:underline"
              >
                {customerMode === "existing"
                  ? "+ New customer"
                  : "Select existing"}
              </button>
            </div>
            {customerMode === "existing" ? (
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="No customer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CUSTOMER}>No customer</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="New customer name"
              />
            )}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Assignee</label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || submitting}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailSheet({
  task,
  open,
  onOpenChange,
  isAdmin,
  customers,
  assignees,
  onUpdate,
  updating,
  onRequestDelete,
}: {
  task: TodoTask | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  isAdmin: boolean;
  customers: CustomerOpt[];
  assignees: AssigneeOpt[];
  onUpdate: (
    id: number,
    data: Record<string, unknown>,
    opts?: { onSuccess?: () => void },
  ) => void;
  updating: boolean;
  onRequestDelete: (id: number) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        {task && (
          <TaskDetailBody
            task={task}
            isAdmin={isAdmin}
            customers={customers}
            assignees={assignees}
            onUpdate={onUpdate}
            updating={updating}
            onRequestDelete={onRequestDelete}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailBody({
  task,
  isAdmin,
  customers,
  assignees,
  onUpdate,
  updating,
  onRequestDelete,
}: {
  task: TodoTask;
  isAdmin: boolean;
  customers: CustomerOpt[];
  assignees: AssigneeOpt[];
  onUpdate: (
    id: number,
    data: Record<string, unknown>,
    opts?: { onSuccess?: () => void },
  ) => void;
  updating: boolean;
  onRequestDelete: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [details, setDetails] = useState(task.details ?? "");

  const commentsQuery = useListTodoComments(task.id);
  const commentMut = useCreateTodoComment();
  const [comment, setComment] = useState("");

  const comments = commentsQuery.data ?? [];

  const refreshComments = () =>
    queryClient.invalidateQueries({
      queryKey: getListTodoCommentsQueryKey(task.id),
    });

  return (
    <>
      <SheetHeader className="px-5 py-4 border-b border-border space-y-0">
        <SheetTitle className="text-base pr-6">
          {editing ? "Edit task" : task.title}
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Title / details */}
        {isAdmin && editing ? (
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              placeholder="Details"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!title.trim() || updating}
                onClick={() =>
                  onUpdate(
                    task.id,
                    { title: title.trim(), details: details.trim() || null },
                    {
                      onSuccess: () => {
                        toast({ title: "Task updated" });
                        setEditing(false);
                      },
                    },
                  )
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTitle(task.title);
                  setDetails(task.details ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          task.details && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {task.details}
            </p>
          )
        )}

        {/* Meta controls */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Status
            </label>
            <Select
              value={task.status}
              onValueChange={(v) =>
                onUpdate(
                  task.id,
                  { status: v },
                  { onSuccess: () => toast({ title: "Status updated" }) },
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMNS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {STATUS_LABEL[c.id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Assignee
            </label>
            {isAdmin ? (
              <Select
                value={task.assigneeUserId ?? UNASSIGNED}
                onValueChange={(v) =>
                  onUpdate(
                    task.id,
                    { assigneeUserId: v === UNASSIGNED ? null : v },
                    { onSuccess: () => toast({ title: "Assignee updated" }) },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                {task.assigneeName ?? "Unassigned"}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Customer
            </label>
            {isAdmin ? (
              <Select
                value={
                  task.customerId != null ? String(task.customerId) : NO_CUSTOMER
                }
                onValueChange={(v) =>
                  onUpdate(
                    task.id,
                    { customerId: v === NO_CUSTOMER ? null : Number(v) },
                    { onSuccess: () => toast({ title: "Customer updated" }) },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No customer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CUSTOMER}>No customer</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                {task.customerName ?? "No customer"}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground pt-1">
            Created {formatDate(task.createdAt)}
          </p>
        </div>

        {/* Comments */}
        <div className="pt-2 border-t border-border">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> Comments
            {comments.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({comments.length})
              </span>
            )}
          </h3>
          {commentsQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No comments yet.
            </p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar className="w-7 h-7 bg-accent text-accent-foreground text-xs flex-shrink-0">
                    <AvatarFallback>
                      {initials(c.authorName, c.authorEmail)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium truncate">
                        {c.authorName ?? "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatDate(c.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer: add comment + admin actions */}
      <div className="flex-shrink-0 border-t border-border p-4 space-y-3">
        <div className="flex gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (comment.trim() && !commentMut.isPending) {
                  commentMut.mutate(
                    { id: task.id, data: { body: comment.trim() } },
                    {
                      onSuccess: () => {
                        setComment("");
                        refreshComments();
                      },
                      onError: () =>
                        toast({
                          title: "Failed to add comment",
                          variant: "destructive",
                        }),
                    },
                  );
                }
              }
            }}
          />
          <Button
            size="icon"
            disabled={!comment.trim() || commentMut.isPending}
            onClick={() =>
              commentMut.mutate(
                { id: task.id, data: { body: comment.trim() } },
                {
                  onSuccess: () => {
                    setComment("");
                    refreshComments();
                  },
                  onError: () =>
                    toast({
                      title: "Failed to add comment",
                      variant: "destructive",
                    }),
                },
              )
            }
          >
            {commentMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MessageSquare className="w-4 h-4" />
            )}
          </Button>
        </div>
        {isAdmin && (
          <div className="flex items-center justify-between">
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Edit details
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
              onClick={() => onRequestDelete(task.id)}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
