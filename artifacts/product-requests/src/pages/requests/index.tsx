import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useListFeatureRequests, useUpdateFeatureRequest, useDeleteFeatureRequest, getListFeatureRequestsQueryKey, getAdminListFeatureRequestsQueryKey, useGetMe } from "@workspace/api-client-react";
import type { FeatureRequest } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  Kanban as KanbanIcon, 
  Loader2, 
  MoreHorizontal, 
  Clock,
  Sparkles,
  UserCog,
  Clock3,
  GripVertical,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MoveToPlannedDialog } from "@/components/move-to-planned-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const COLUMNS = [
  { id: "requested", label: "Requested", color: "bg-muted border-border text-foreground" },
  { id: "ready_for_execution", label: "Ready for Execution", color: "bg-amber-100 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200" },
  { id: "planned", label: "Planned", color: "bg-blue-100 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900/60 text-blue-800 dark:text-blue-200" },
  { id: "in_progress", label: "In Progress", color: "bg-purple-100 dark:bg-purple-950/50 border-purple-200 dark:border-purple-900/60 text-purple-800 dark:text-purple-200" },
  { id: "deployed", label: "Deployed", color: "bg-green-100 dark:bg-green-950/50 border-green-200 dark:border-green-900/60 text-green-800 dark:text-green-200" },
] as const;

const PRIORITY_COLORS = {
  low: "bg-slate-100 dark:bg-slate-950/50 text-slate-700 border-slate-200 dark:border-slate-900/60",
  medium: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
  high: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60",
};

export default function RequestsPage() {
  const { data: requests, isLoading } = useListFeatureRequests();
  const { data: me } = useGetMe();
  const updateReqMut = useUpdateFeatureRequest();
  const deleteReqMut = useDeleteFeatureRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleDelete = (req: FeatureRequest) => {
    if (
      !window.confirm(
        `Delete "${req.title}"? This permanently removes the requirements doc, the full chat, attachments, version history, and any engineering tasks. This cannot be undone.`,
      )
    )
      return;
    deleteReqMut.mutate(
      { id: req.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getAdminListFeatureRequestsQueryKey() });
          toast({ title: "Request deleted" });
        },
        onError: () => toast({ title: "Failed to delete request", variant: "destructive" }),
      },
    );
  };

  // When an admin moves a card into "Planned" we prompt them for an admin
  // priority rank (defaulting to the AI rank) so the external dev-agent
  // queue stays explicitly ordered. Non-admins skip the prompt and just
  // see a plain status change.
  const [plannedPrompt, setPlannedPrompt] = useState<FeatureRequest | null>(null);

  // Sort order for non-Planned columns. Planned always uses its own
  // adminPriorityRank ordering — only the tiebreaker switches.
  const [sortMode, setSortMode] = useState<"ai" | "latest">("ai");

  // Drag-and-drop state. We use native HTML5 DnD to avoid pulling in a
  // new library. `draggingId` is the id of the card currently being
  // dragged; `dragOverCol` is the column highlighted as a drop target.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // After a drop, the trailing `click` event on the source card still
  // fires in most browsers. We flag the drag so the next click on that
  // card is swallowed instead of navigating to its detail page.
  const justDraggedRef = useRef(false);

  const handleStatusChange = (
    id: number,
    status: any,
    extra?: {
      adminPriorityRank?: number | null;
      engineeringOwner?: "agent" | "human" | null;
    },
  ) => {
    const data: {
      status: any;
      adminPriorityRank?: number | null;
      engineeringOwner?: "agent" | "human" | null;
    } = { status };
    if (extra && "adminPriorityRank" in extra) {
      data.adminPriorityRank = extra.adminPriorityRank ?? null;
    }
    if (extra && "engineeringOwner" in extra) {
      data.engineeringOwner = extra.engineeringOwner ?? null;
    }
    updateReqMut.mutate({ id, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
        toast({ title: "Status updated" });
      },
      onError: () => {
        toast({ title: "Failed to update status", variant: "destructive" });
      }
    });
  };

  const handleMoveTarget = (req: FeatureRequest, targetStatus: string) => {
    if (req.status === targetStatus) return;
    // Admin moving INTO "planned" → open the rank-prompt modal first.
    if (targetStatus === "planned" && me?.isAdmin) {
      setPlannedPrompt(req);
      return;
    }
    handleStatusChange(req.id, targetStatus);
  };

  const handleDrop = (targetStatus: string) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (id == null) return;
    const req = requests?.find((r) => r.id === id);
    if (!req) return;
    handleMoveTarget(req, targetStatus);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/40">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-muted/40">
      <header className="h-16 flex flex-shrink-0 items-center justify-between gap-4 px-4 sm:px-8 bg-card border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg flex items-center justify-center flex-shrink-0">
            <KanbanIcon className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-foreground tracking-tight truncate">Requested Features</h1>
        </div>
        <SortToggle value={sortMode} onChange={setSortMode} />
      </header>

      <div className="flex-1 overflow-x-auto p-4 sm:p-8">
        <div className="flex gap-6 h-full min-w-max items-start">
          {COLUMNS.map(col => {
            const columnRequests = sortColumn(
              (requests?.filter(r => r.status === col.id) || []).slice(),
              col.id,
              sortMode,
            );

            const isOver = dragOverCol === col.id;

            return (
              <div
                key={col.id}
                className={`flex flex-col w-80 max-h-full rounded-2xl border transition-colors ${
                  isOver
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700"
                    : "bg-muted/50 border-border"
                }`}
                onDragEnter={() => {
                  if (draggingId == null) return;
                  // Use dragenter (not dragleave) as the source of truth:
                  // entering a new column overwrites the previous highlight,
                  // and only dragend/drop clear it. This sidesteps the
                  // null-relatedTarget flicker in native HTML5 DnD.
                  if (dragOverCol !== col.id) setDragOverCol(col.id);
                }}
                onDragOver={(e) => {
                  if (draggingId == null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(col.id);
                }}
              >
                <div className="p-4 flex items-center justify-between border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <div className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider border ${col.color}`}>
                      {col.label}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
                    {columnRequests.length}
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {columnRequests.map(req => (
                    <div
                      key={req.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggingId(req.id);
                        justDraggedRef.current = true;
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", String(req.id));
                        } catch {
                          /* some browsers throw on synthetic events */
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                        // Clear the flag on the next tick, after the
                        // trailing click has fired and been swallowed.
                        setTimeout(() => {
                          justDraggedRef.current = false;
                        }, 0);
                      }}
                      className={`relative bg-card rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.1)] border border-border hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-900/60 transition-all cursor-pointer group ${
                        draggingId === req.id ? "opacity-40" : ""
                      }`}
                      onClick={() => {
                        if (justDraggedRef.current) return;
                        setLocation(`/requests/${req.id}`);
                      }}
                    >
                      <span className="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0 ${PRIORITY_COLORS[req.priority as keyof typeof PRIORITY_COLORS]}`}>
                            {req.priority}
                          </Badge>
                          {req.minor && (
                            <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60">
                              Minor
                            </Badge>
                          )}
                        </div>

                        {/*
                          Stop pointerdown from bubbling to the draggable
                          parent — otherwise clicking the "..." menu can
                          accidentally initiate a drag. draggable={false}
                          on the wrapper also disables drag for this region.
                        */}
                        <div
                          draggable={false}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-6 w-6 p-0 text-muted-foreground/70 hover:text-foreground">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Move to...</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {COLUMNS.filter(c => c.id !== req.status).map(c => (
                                <DropdownMenuItem key={c.id} onClick={() => handleMoveTarget(req, c.id)}>
                                  {c.label}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(req)}
                                className="text-red-600 focus:text-red-700 dark:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      
                      <h3 className="font-semibold text-foreground text-sm leading-tight mb-2 group-hover:text-indigo-600 dark:text-indigo-400 transition-colors line-clamp-2">
                        {req.title}
                      </h3>
                      
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-4 leading-relaxed">
                        {req.summary}
                      </p>

                      {me?.isAdmin && col.id === "planned" && req.adminPriorityRank != null && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/60 rounded-lg p-2.5 mb-3">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-emerald-700 text-white text-[10px] font-bold">
                              #{req.adminPriorityRank}
                            </span>
                            <UserCog className="w-3 h-3 text-emerald-700 dark:text-emerald-300" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-200">
                              Admin priority
                            </span>
                            {req.aiPriorityRank != null && req.aiPriorityRank !== req.adminPriorityRank && (
                              <span className="text-[10px] text-muted-foreground">
                                (AI suggested #{req.aiPriorityRank})
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {me?.isAdmin && col.id === "requested" && req.aiPriorityRank != null && (
                        <div className="bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 rounded-lg p-2.5 mb-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-foreground text-background text-[10px] font-bold">
                              #{req.aiPriorityRank}
                            </span>
                            <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                              AI priority
                            </span>
                          </div>
                          {req.aiPriorityRationale && (
                            <p className="text-[11px] text-foreground/85 leading-relaxed line-clamp-3">
                              {req.aiPriorityRationale}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground/70 border-t border-border/60 pt-3 mt-1">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {format(new Date(req.createdAt), "MMM d")}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 px-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:bg-indigo-950/40 -mr-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocation(`/requests/${req.id}`);
                          }}
                        >
                          View Spec
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {columnRequests.length === 0 && (
                    <div className="h-24 flex items-center justify-center border-2 border-dashed border-border rounded-xl bg-muted/50">
                      <span className="text-sm text-muted-foreground/70 font-medium">No requests</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {draggingId != null && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-foreground text-background text-xs font-medium shadow-lg">
          Drop on a column to change status
        </div>
      )}

      <MoveToPlannedDialog
        request={plannedPrompt}
        pending={updateReqMut.isPending}
        onClose={() => setPlannedPrompt(null)}
        onConfirm={(rank, owner) => {
          if (!plannedPrompt) return;
          handleStatusChange(plannedPrompt.id, "planned", {
            adminPriorityRank: rank,
            engineeringOwner: owner,
          });
          setPlannedPrompt(null);
        }}
      />
    </div>
  );
}

type SortMode = "ai" | "latest";

function sortColumn(
  list: FeatureRequest[],
  colId: string,
  mode: SortMode,
): FeatureRequest[] {
  const byLatest = (a: FeatureRequest, b: FeatureRequest) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const byAi = (a: FeatureRequest, b: FeatureRequest) => {
    const ar = a.aiPriorityRank ?? Number.POSITIVE_INFINITY;
    const br = b.aiPriorityRank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return byLatest(a, b);
  };

  // The "Planned" column always anchors on admin-set rank (NULLS LAST)
  // because that's what drives the external dev-agent queue. The view
  // toggle only changes the tiebreaker for cards with no admin rank.
  if (colId === "planned") {
    list.sort((a, b) => {
      const ar = a.adminPriorityRank ?? Number.POSITIVE_INFINITY;
      const br = b.adminPriorityRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return mode === "ai" ? byAi(a, b) : byLatest(a, b);
    });
    return list;
  }

  list.sort(mode === "ai" ? byAi : byLatest);
  return list;
}

function SortToggle({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const baseBtn =
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all";
  const active = "bg-card text-foreground shadow-sm";
  const inactive = "text-muted-foreground hover:text-foreground";
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-border bg-muted/50 flex-shrink-0">
      <button
        type="button"
        onClick={() => onChange("ai")}
        className={`${baseBtn} ${value === "ai" ? active : inactive}`}
        aria-pressed={value === "ai"}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">AI Prioritized</span>
        <span className="sm:hidden">AI</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("latest")}
        className={`${baseBtn} ${value === "latest" ? active : inactive}`}
        aria-pressed={value === "latest"}
      >
        <Clock3 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Latest</span>
        <span className="sm:hidden">New</span>
      </button>
    </div>
  );
}

