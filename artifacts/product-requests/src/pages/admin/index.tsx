import {
  useGetMe,
  useAdminStats,
  useAdminListFeatureRequests,
  useAdminGetConversation,
  useAdminPostMessage,
  useUpdateFeatureRequest,
  useDeleteFeatureRequest,
  useResynthesizeFeatureRequest,
  useAdminGetAiPrioritization,
  useAdminRefreshAiPrioritization,
  getAdminListFeatureRequestsQueryKey,
  getAdminStatsQueryKey,
  getAdminGetConversationQueryKey,
  getGetFeatureRequestQueryKey,
  getListFeatureRequestVersionsQueryKey,
  getAdminGetAiPrioritizationQueryKey,
  getListFeatureRequestsQueryKey,
  type FeatureRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import {
  Loader2,
  ShieldCheck,
  Kanban,
  TrendingUp,
  Search,
  Bot,
  User as UserIcon,
  Send,
  MessageSquare,
  Download,
  History,
  RefreshCw,
  LayoutGrid,
  List,
  MoreHorizontal,
  Trash2,
  Clock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  VersionHistorySheet,
  downloadFeatureRequestPdf,
} from "@/components/version-history-sheet";
import { MoveToPlannedDialog } from "@/components/move-to-planned-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Markdown } from "@/components/markdown";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TeamSettingsPanel } from "@/components/team-settings-panel";
import { EngineeringSpacePanel } from "@/components/engineering-space-panel";
import { Sparkles } from "lucide-react";
import EmailCampaignsPanel from "./email";
import CustomersPanel from "./customers";
import CrmPanel from "./crm";
import DuplicatesPanel from "./duplicates";
import { formatDistanceToNow } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  requested: "bg-muted text-foreground/85",
  ready_for_execution: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  planned: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300",
  in_progress: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300",
  deployed: "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 dark:bg-slate-950/50 text-slate-700 border-slate-200 dark:border-slate-900/60",
  medium: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
  high: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60",
};

const STATUS_OPTIONS = [
  { value: "requested", label: "Requested" },
  { value: "ready_for_execution", label: "Ready for Execution" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "deployed", label: "Deployed" },
];

const KANBAN_COLUMNS = [
  { id: "requested", label: "Requested", color: "bg-muted border-border text-foreground" },
  { id: "ready_for_execution", label: "Ready for Execution", color: "bg-amber-100 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200" },
  { id: "planned", label: "Planned", color: "bg-blue-100 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900/60 text-blue-800 dark:text-blue-200" },
  { id: "in_progress", label: "In Progress", color: "bg-purple-100 dark:bg-purple-950/50 border-purple-200 dark:border-purple-900/60 text-purple-800 dark:text-purple-200" },
  { id: "deployed", label: "Deployed", color: "bg-green-100 dark:bg-green-950/50 border-green-200 dark:border-green-900/60 text-green-800 dark:text-green-200" },
] as const;

// Most-important-first ordering used by both the kanban and table views.
// Primary key is the AI priority rank (1 = most important) refreshed every 2h
// by the background prioritizer; items the AI hasn't ranked yet fall back to the
// admin's manual rank, then to most-recently-requested. Nulls always sink below
// anything that carries a rank.
function compareByAiPriority(a: FeatureRequest, b: FeatureRequest): number {
  const ai = a.aiPriorityRank ?? null;
  const bi = b.aiPriorityRank ?? null;
  if (ai !== null && bi !== null && ai !== bi) return ai - bi;
  if (ai !== null && bi === null) return -1;
  if (ai === null && bi !== null) return 1;

  const aa = a.adminPriorityRank ?? null;
  const ba = b.adminPriorityRank ?? null;
  if (aa !== null && ba !== null && aa !== ba) return aa - ba;
  if (aa !== null && ba === null) return -1;
  if (aa === null && ba !== null) return 1;

  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default function AdminPage() {
  const { data: me, isLoading: loadingMe } = useGetMe();
  const { data: stats, isLoading: loadingStats } = useAdminStats();
  const { data: requests, isLoading: loadingRequests } =
    useAdminListFeatureRequests();
  const [searchTerm, setSearchTerm] = useState("");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const ADMIN_TAB_IDS = [
    "requests",
    "ai-priorities",
    "engineering-space",
    "customers",
    "crm",
    "duplicates",
    "email",
    "team",
  ] as const;
  const activeTab =
    tabParam && (ADMIN_TAB_IDS as readonly string[]).includes(tabParam)
      ? tabParam
      : "requests";
  const ADMIN_TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
    requests: {
      title: "All Feature Requests",
      subtitle: "View, triage, and reply to every request across the org.",
    },
    "ai-priorities": {
      title: "AI Priorities",
      subtitle: "Latest AI-generated prioritization of the backlog.",
    },
    "engineering-space": {
      title: "Engineering Space",
      subtitle: "Paperclip issues, engineer chat, and review queue.",
    },
    customers: {
      title: "Customers",
      subtitle: "Who's asking for what, grouped by account.",
    },
    crm: {
      title: "CRM",
      subtitle: "Accounts, contacts, call notes, contracts, and billing.",
    },
    duplicates: {
      title: "Duplicate Requests",
      subtitle:
        "Review AI-flagged near-duplicate PRDs and approve merged scope updates.",
    },
    email: {
      title: "Mail",
      subtitle: "Send broadcast and follow-up emails.",
    },
    team: {
      title: "Team Settings",
      subtitle: "Manage admins and engineers.",
    },
  };
  const { title: headerTitle, subtitle: headerSubtitle } =
    ADMIN_TAB_TITLES[activeTab] ?? ADMIN_TAB_TITLES.requests;
  const [openRequest, setOpenRequest] = useState<FeatureRequest | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "kanban" | "ai">(
    "kanban",
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStatusMut = useUpdateFeatureRequest();
  const deleteReqMut = useDeleteFeatureRequest();
  const [plannedPrompt, setPlannedPrompt] = useState<FeatureRequest | null>(
    null,
  );

  const handleDelete = (req: FeatureRequest) => {
    if (
      !window.confirm(
        `Delete "${req.title}" from ${req.userName || req.userEmail}? This permanently removes the requirements doc, the full chat, attachments, version history, and any engineering tasks. This cannot be undone.`,
      )
    )
      return;
    deleteReqMut.mutate(
      { id: req.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getAdminListFeatureRequestsQueryKey(),
          });
          queryClient.invalidateQueries({ queryKey: getAdminStatsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListFeatureRequestsQueryKey(),
          });
          toast({ title: "Request deleted" });
        },
        onError: () =>
          toast({ title: "Failed to delete request", variant: "destructive" }),
      },
    );
  };

  const handleStatusChange = (
    id: number,
    status: FeatureRequest["status"],
    extra?: {
      adminPriorityRank?: number | null;
      engineeringOwner?: "agent" | "human" | null;
    },
  ) => {
    const data: {
      status: FeatureRequest["status"];
      adminPriorityRank?: number | null;
      engineeringOwner?: "agent" | "human" | null;
    } = { status };
    if (extra && "adminPriorityRank" in extra) {
      data.adminPriorityRank = extra.adminPriorityRank ?? null;
    }
    if (extra && "engineeringOwner" in extra) {
      data.engineeringOwner = extra.engineeringOwner ?? null;
    }
    updateStatusMut.mutate(
      { id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getAdminListFeatureRequestsQueryKey(),
          });
          queryClient.invalidateQueries({ queryKey: getAdminStatsQueryKey() });
          toast({ title: "Status updated" });
        },
        onError: () =>
          toast({ title: "Failed to update status", variant: "destructive" }),
      },
    );
  };

  // Moving a card into "Planned" must capture admin priority rank + the
  // engineering destination (agent → Paperclip, human → Notion), so route
  // that transition through the modal instead of an immediate mutation.
  const requestStatusChange = (
    req: FeatureRequest,
    status: FeatureRequest["status"],
  ) => {
    if (status === "planned") {
      setPlannedPrompt(req);
      return;
    }
    handleStatusChange(req.id, status);
  };

  if (loadingMe || loadingStats || loadingRequests) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/40">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  if (!me?.isAdmin) {
    return <Redirect to="/app" />;
  }

  const filteredRequests = (
    requests?.filter(
      (r) =>
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.userEmail.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || []
  )
    .slice()
    .sort(compareByAiPriority);

  return (
    <div className="flex flex-col h-full bg-muted/40 overflow-y-auto">
      <header className="px-8 py-6 bg-card border-b border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 bg-foreground text-background rounded-xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {headerTitle}
            </h1>
          </div>
          <p className="text-muted-foreground ml-12">{headerSubtitle}</p>
        </div>
      </header>

      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-8">
        <Tabs value={activeTab} className="space-y-6">
          <TabsContent value="requests" className="space-y-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Total Requests
              </p>
              <h3 className="text-3xl font-extrabold text-foreground">
                {stats?.total || 0}
              </h3>
            </div>
          </div>

          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Kanban className="w-4 h-4" /> By Status
            </p>
            <div className="space-y-3">
              {stats?.byStatus.map((s) => (
                <div
                  key={s.status}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm font-medium capitalize text-foreground/85">
                    {s.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm font-bold bg-muted px-2 py-0.5 rounded-md text-muted-foreground">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm md:col-span-2">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Recently Created
            </p>
            <div className="space-y-3">
              {stats?.recentlyCreated.slice(0, 3).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-muted/40 rounded-lg border border-border/60 hover:bg-indigo-50 dark:bg-indigo-950/50 transition-colors cursor-pointer"
                  onClick={() => setLocation(`/requests/${r.id}?from=admin`)}
                >
                  <div className="truncate pr-4">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {r.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.userEmail}
                    </div>
                  </div>
                  <div className="mt-2 sm:mt-0 flex-shrink-0 text-xs font-medium text-muted-foreground/70">
                    {format(new Date(r.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Requests — Kanban / Table / AI Priority */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-foreground">
            All Feature Requests
          </h2>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {viewMode !== "ai" && (
              <div className="relative flex-1 sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  placeholder="Search by title or email..."
                  className="pl-9 bg-card border-border focus-visible:ring-indigo-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-0.5 flex-shrink-0">
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "kanban"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                aria-label="Kanban view"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Kanban
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "table"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                aria-label="Table view"
              >
                <List className="w-3.5 h-3.5" /> Table
              </button>
              <button
                onClick={() => setViewMode("ai")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "ai"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                aria-label="AI priority view"
              >
                <Sparkles className="w-3.5 h-3.5" /> AI Priority
              </button>
            </div>
          </div>
        </div>

        {viewMode === "ai" ? (
          <AiPrioritiesPanel />
        ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
          {viewMode === "kanban" ? (
            <div className="overflow-x-auto p-4 bg-muted/30">
              <div className="flex gap-4 min-w-max items-start">
                {KANBAN_COLUMNS.map((col) => {
                  const columnRequests = filteredRequests.filter(
                    (r) => r.status === col.id,
                  );
                  return (
                    <div
                      key={col.id}
                      className="flex flex-col w-72 bg-muted/60 rounded-xl border border-border"
                    >
                      <div className="p-3 flex items-center justify-between border-b border-border/60">
                        <div
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider border ${col.color}`}
                        >
                          {col.label}
                        </div>
                        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {columnRequests.length}
                        </span>
                      </div>
                      <div className="p-2.5 space-y-2.5 min-h-[80px]">
                        {columnRequests.map((req) => (
                          <div
                            key={req.id}
                            onClick={() => setLocation(`/requests/${req.id}?from=admin`)}
                            className="bg-card rounded-lg p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)] border border-border hover:shadow-md hover:border-indigo-200 dark:border-indigo-900/60 transition-all cursor-pointer group"
                          >
                            <div className="flex justify-between items-start mb-1.5">
                              <div className="flex items-center gap-1.5">
                                {req.aiPriorityRank != null && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] font-bold tracking-wider px-1.5 py-0 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60 flex items-center gap-0.5"
                                    title={req.aiPriorityRationale ?? "AI priority rank"}
                                  >
                                    <Sparkles className="w-2.5 h-2.5" />#
                                    {req.aiPriorityRank}
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 ${PRIORITY_COLORS[req.priority]}`}
                                >
                                  {req.priority}
                                </Badge>
                                {req.minor && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60"
                                  >
                                    Minor
                                  </Badge>
                                )}
                                {req.engineeringOwner && (
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0 ${
                                      req.engineeringOwner === "human"
                                        ? "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900/60"
                                        : "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/60"
                                    }`}
                                    title={
                                      req.engineeringOwner === "human"
                                        ? "Routed to human engineers (Notion)"
                                        : "Routed to the agentic team (Paperclip)"
                                    }
                                  >
                                    {req.engineeringOwner === "human"
                                      ? "Human"
                                      : "Agent"}
                                  </Badge>
                                )}
                              </div>
                              <div onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-muted-foreground/70 hover:text-foreground"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="w-44"
                                  >
                                    <DropdownMenuLabel>
                                      Move to...
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {KANBAN_COLUMNS.filter(
                                      (c) => c.id !== req.status,
                                    ).map((c) => (
                                      <DropdownMenuItem
                                        key={c.id}
                                        onClick={() =>
                                          requestStatusChange(req, c.id)
                                        }
                                      >
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
                            <h3 className="font-semibold text-foreground text-sm leading-tight mb-1.5 group-hover:text-indigo-600 dark:text-indigo-400 transition-colors line-clamp-2">
                              {req.title}
                            </h3>
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2.5 leading-relaxed">
                              {req.summary}
                            </p>
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground flex-shrink-0">
                                {req.userName?.charAt(0) ||
                                  req.userEmail.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {req.userName || req.userEmail}
                              </span>
                            </div>
                            <div
                              className="flex items-center text-[11px] text-muted-foreground/70 border-t border-border/60 pt-2"
                              title={`Requested ${format(new Date(req.createdAt), "PPpp")}`}
                            >
                              <Clock className="w-3 h-3 mr-1" />
                              Requested{" "}
                              {formatDistanceToNow(new Date(req.createdAt), {
                                addSuffix: true,
                              })}
                            </div>
                          </div>
                        ))}
                        {columnRequests.length === 0 && (
                          <div className="h-20 flex items-center justify-center border-2 border-dashed border-border rounded-lg bg-card/40">
                            <span className="text-xs text-muted-foreground/70 font-medium">
                              None
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                    Feature Title
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                    Requester
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                    Status
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                    Priority
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground uppercase tracking-wider text-xs text-right">
                    Date
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No feature requests found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRequests.map((req) => (
                    <TableRow
                      key={req.id}
                      className="cursor-pointer hover:bg-indigo-50 dark:bg-indigo-950/30 transition-colors"
                      onClick={() => setLocation(`/requests/${req.id}?from=admin`)}
                    >
                      <TableCell className="font-medium text-foreground max-w-[320px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {req.aiPriorityRank != null && (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[10px] font-bold tracking-wider px-1.5 py-0 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60 flex items-center gap-0.5"
                              title={req.aiPriorityRationale ?? "AI priority rank"}
                            >
                              <Sparkles className="w-2.5 h-2.5" />#{req.aiPriorityRank}
                            </Badge>
                          )}
                          <span className="truncate">{req.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                            {req.userName?.charAt(0) ||
                              req.userEmail.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">
                              {req.userName || "Anonymous"}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {req.userEmail}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className={`capitalize px-2.5 py-0.5 font-semibold ${STATUS_COLORS[req.status]}`}
                          >
                            {req.status.replace("_", " ")}
                          </Badge>
                          {req.engineeringOwner && (
                            <Badge
                              variant="outline"
                              className={`uppercase tracking-wider text-[10px] font-bold px-1.5 py-0 ${
                                req.engineeringOwner === "human"
                                  ? "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900/60"
                                  : "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/60"
                              }`}
                              title={
                                req.engineeringOwner === "human"
                                  ? "Routed to human engineers (Notion)"
                                  : "Routed to the agentic team (Paperclip)"
                              }
                            >
                              {req.engineeringOwner === "human"
                                ? "Human"
                                : "Agent"}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`uppercase tracking-wider text-[10px] font-bold px-2 py-0 ${PRIORITY_COLORS[req.priority]}`}
                          >
                            {req.priority}
                          </Badge>
                          {req.minor && (
                            <Badge
                              variant="outline"
                              className="uppercase tracking-wider text-[10px] font-bold px-2 py-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60"
                            >
                              Minor
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(req.createdAt), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          )}
        </div>
        )}

          </TabsContent>

          <TabsContent value="ai-priorities">
            <AiPrioritiesPanel />
          </TabsContent>

          <TabsContent value="engineering-space">
            <EngineeringSpacePanel />
          </TabsContent>

          <TabsContent value="customers">
            <CustomersPanel />
          </TabsContent>

          <TabsContent value="crm">
            <CrmPanel />
          </TabsContent>

          <TabsContent value="duplicates">
            <DuplicatesPanel />
          </TabsContent>

          <TabsContent value="email">
            <EmailCampaignsPanel />
          </TabsContent>

          <TabsContent value="team">
            <TeamSettingsPanel />
          </TabsContent>
        </Tabs>
      </div>

      <RequestDrawer
        request={openRequest}
        onClose={() => setOpenRequest(null)}
      />

      <MoveToPlannedDialog
        request={plannedPrompt}
        pending={updateStatusMut.isPending}
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

// Admin-only signal flagged by the PM bot when it notices a new request looks
// like a near-duplicate or strong neighbor of existing backlog items. Renders
// related ids as clickable chips (titled via the supplied lookup) plus a short
// rationale. Customer views never render this — see RequestDrawerInner.
function ClusterPanel({
  relatedIds,
  rationale,
  titleById,
  onOpen,
}: {
  relatedIds: number[] | null | undefined;
  rationale: string | null | undefined;
  titleById: Map<number, string>;
  onOpen?: (id: number) => void;
}) {
  const ids = (relatedIds ?? []).filter((id) => Number.isInteger(id));
  if (ids.length === 0 && !rationale) return null;
  return (
    <div className="bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-900/60 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <ShieldCheck className="w-3 h-3 text-amber-700 dark:text-amber-300" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
          Cluster · admin-only
        </span>
      </div>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {ids.map((id) => {
            const title = titleById.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(id);
                }}
                className="text-[11px] px-2 py-0.5 rounded-full bg-card border border-amber-300 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:bg-amber-950/50 transition-colors max-w-[20rem] truncate"
                title={title ?? `Request #${id}`}
              >
                #{id}
                {title ? ` · ${title}` : ""}
              </button>
            );
          })}
        </div>
      )}
      {rationale && (
        <p className="text-sm text-foreground/85 leading-relaxed">{rationale}</p>
      )}
    </div>
  );
}

function AiPrioritiesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  // Poll every 4s while a run is in flight so the rank/rationale and
  // generatedAt timestamp update as soon as the background job persists.
  const { data, isLoading } = useAdminGetAiPrioritization({
    query: {
      queryKey: getAdminGetAiPrioritizationQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.isRunning ? 4000 : false,
    },
  });
  // Cached — already fetched at the top of the admin page; this is a hit on
  // react-query cache so it costs nothing. We use it to (a) look up the
  // admin-only cluster fields by id, and (b) map related ids to titles.
  const { data: allReqs } = useAdminListFeatureRequests({
    query: { queryKey: getAdminListFeatureRequestsQueryKey() },
  });
  const titleById = new Map<number, string>(
    (allReqs ?? []).map((r) => [r.id, r.title]),
  );
  const frById = new Map<number, FeatureRequest>(
    (allReqs ?? []).map((r) => [r.id, r]),
  );
  const refreshMut = useAdminRefreshAiPrioritization();
  const isRunning = data?.isRunning ?? false;

  const onRefresh = () => {
    refreshMut.mutate(undefined, {
      onSuccess: () => {
        // Both 202 (started) and 200 success come through here. Invalidate
        // so polling picks up isRunning=true → false transition.
        queryClient.invalidateQueries({
          queryKey: getAdminGetAiPrioritizationQueryKey(),
        });
        toast({
          title: "Refresh started",
          description: "The new ranking will appear in a moment.",
        });
      },
      onError: (err: unknown) => {
        // 409 = a run is already in flight; everything else is an actual
        // failure to start.
        const status = (err as { status?: number } | null)?.status;
        if (status === 409) {
          toast({
            title: "A run is already in progress",
            description: "Hang tight — the current run will finish shortly.",
          });
          queryClient.invalidateQueries({
            queryKey: getAdminGetAiPrioritizationQueryKey(),
          });
          return;
        }
        toast({
          title: "Refresh failed",
          description:
            "Could not start a new ranking run. Check server logs.",
          variant: "destructive",
        });
      },
    });
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                AI-ranked backlog
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
                Every request still in <span className="font-medium">Requested</span> ranked 1..N by Claude, with rationale. Re-runs automatically every 2 hours.
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                {data?.generatedAt ? (
                  <span>
                    Last generated{" "}
                    <span className="font-medium text-foreground/85">
                      {formatDistanceToNow(new Date(data.generatedAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </span>
                ) : (
                  <span>Never generated yet</span>
                )}
                {data?.nextRunAt && (
                  <span>
                    · next run{" "}
                    {formatDistanceToNow(new Date(data.nextRunAt), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            onClick={onRefresh}
            disabled={refreshMut.isPending || isRunning}
            className="bg-foreground hover:bg-foreground/90 gap-2 flex-shrink-0"
          >
            {refreshMut.isPending || isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {isRunning ? "Running…" : "Refresh now"}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {data?.generatedAt
              ? "Nothing in the Requested column right now."
              : "No ranking yet — click Refresh now to generate one."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => (
              <li
                key={item.featureRequestId}
                className="p-5 hover:bg-indigo-50 dark:bg-indigo-950/30 transition-colors cursor-pointer"
                onClick={() =>
                  setLocation(`/requests/${item.featureRequestId}?from=admin`)
                }
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center font-bold text-sm">
                    {item.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-foreground text-sm">
                        {item.title}
                      </h3>
                      <Badge
                        variant="outline"
                        className={`uppercase tracking-wider text-[10px] font-bold px-2 py-0 ${PRIORITY_COLORS[item.priority]}`}
                      >
                        {item.priority}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {item.userName || item.userEmail}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                      {item.summary}
                    </p>
                    <div className="bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                          AI rationale
                        </span>
                      </div>
                      <p className="text-sm text-foreground/85 leading-relaxed">
                        {item.rationale}
                      </p>
                    </div>
                    {(() => {
                      const fr = frById.get(item.featureRequestId);
                      if (!fr) return null;
                      return (
                        <div className="mt-2">
                          <ClusterPanel
                            relatedIds={fr.relatedRequestIds}
                            rationale={fr.clusterRationale}
                            titleById={titleById}
                            onOpen={(id) =>
                              setLocation(`/requests/${id}?from=admin`)
                            }
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestDrawer({
  request,
  onClose,
}: {
  request: FeatureRequest | null;
  onClose: () => void;
}) {
  const open = !!request;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        {request && <RequestDrawerInner request={request} />}
      </SheetContent>
    </Sheet>
  );
}

function RequestDrawerInner({ request }: { request: FeatureRequest }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"spec" | "chat">("spec");
  const [adminMessage, setAdminMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: conv, isLoading: loadingConv } = useAdminGetConversation(
    request.conversationId,
  );

  // Cached lookup used by the admin-only ClusterPanel to resolve related
  // request ids to human-readable titles.
  const { data: allReqs } = useAdminListFeatureRequests({
    query: { queryKey: getAdminListFeatureRequestsQueryKey() },
  });
  const drawerTitleById = new Map<number, string>(
    (allReqs ?? []).map((r) => [r.id, r.title]),
  );

  const updateMut = useUpdateFeatureRequest();
  const postMut = useAdminPostMessage();
  const resynthMut = useResynthesizeFeatureRequest();

  const onResynth = () => {
    resynthMut.mutate(
      { id: request.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getAdminListFeatureRequestsQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getAdminStatsQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetFeatureRequestQueryKey(request.id),
          });
          queryClient.invalidateQueries({
            queryKey: getListFeatureRequestVersionsQueryKey(request.id),
          });
          toast({
            title: "Requirements re-synthesized",
            description: "A new version was added to the history.",
          });
        },
        onError: () =>
          toast({ title: "Re-synthesis failed", variant: "destructive" }),
      },
    );
  };

  const onChangeStatus = (status: string) => {
    updateMut.mutate(
      { id: request.id, data: { status: status as FeatureRequest["status"] } },
      {
        onSuccess: () => {
          toast({ title: "Status updated" });
          queryClient.invalidateQueries({
            queryKey: getAdminListFeatureRequestsQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getAdminStatsQueryKey(),
          });
        },
        onError: () =>
          toast({ title: "Failed to update status", variant: "destructive" }),
      },
    );
  };

  const onChangePriority = (priority: string) => {
    updateMut.mutate(
      {
        id: request.id,
        data: { priority: priority as FeatureRequest["priority"] },
      },
      {
        onSuccess: () => {
          toast({ title: "Priority updated" });
          queryClient.invalidateQueries({
            queryKey: getAdminListFeatureRequestsQueryKey(),
          });
        },
        onError: () =>
          toast({ title: "Failed to update priority", variant: "destructive" }),
      },
    );
  };

  const onPostMessage = () => {
    const content = adminMessage.trim();
    if (!content) return;
    postMut.mutate(
      { id: request.conversationId, data: { content } },
      {
        onSuccess: (updated) => {
          setAdminMessage("");
          queryClient.setQueryData(
            getAdminGetConversationQueryKey(request.conversationId),
            updated,
          );
          toast({
            title: "Question sent to user",
            description:
              "It now appears in their chat — they'll see it next time they open the conversation.",
          });
        },
        onError: () =>
          toast({ title: "Failed to send", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
        <SheetTitle className="text-xl font-bold text-foreground pr-8">
          {request.title}
        </SheetTitle>
        <SheetDescription className="text-muted-foreground">
          From {request.userName || "Anonymous"} ({request.userEmail}) ·{" "}
          {format(new Date(request.createdAt), "MMM d, yyyy")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="w-3.5 h-3.5" /> History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onResynth}
            disabled={resynthMut.isPending}
          >
            {resynthMut.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Re-synthesize
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => downloadFeatureRequestPdf(request.id)}
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Status
            </span>
            <Select value={request.status} onValueChange={onChangeStatus}>
              <SelectTrigger className="h-8 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Priority
            </span>
            <Select value={request.priority} onValueChange={onChangePriority}>
              <SelectTrigger className="h-8 w-[110px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-1 pt-3">
          <button
            onClick={() => setTab("spec")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === "spec"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Requirements
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              tab === "chat"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Conversation
            {conv ? (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  tab === "chat"
                    ? "bg-card/20 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {conv.messages.length}
              </span>
            ) : null}
          </button>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {tab === "spec" ? (
          <div className="px-6 py-6 space-y-6">
            {(request.relatedRequestIds?.length || request.clusterRationale) && (
              <ClusterPanel
                relatedIds={request.relatedRequestIds}
                rationale={request.clusterRationale}
                titleById={drawerTitleById}
              />
            )}
            <Section title="Summary" body={request.summary} />
            <Section title="Problem" body={request.problem} />
            <Section title="Benefits" body={request.benefits} />
            <Section title="Current cost / pain" body={request.currentSpend} />
            <Section title="Scope" body={request.scope} />
          </div>
        ) : (
          <div className="px-6 py-6 space-y-4">
            {loadingConv && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              </div>
            )}
            {conv?.messages.map((m) => {
              if (m.role === "admin") {
                return (
                  <div
                    key={m.id}
                    className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3"
                  >
                    <div className="w-7 h-7 flex-shrink-0 rounded-full bg-amber-500 text-white flex items-center justify-center">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-200 mb-0.5">
                        Admin · {m.authorName || "Admin"}
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={m.id}
                  className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ${
                      m.role === "assistant"
                        ? "bg-indigo-600 text-white"
                        : "bg-muted text-foreground/85"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <Bot className="w-4 h-4" />
                    ) : (
                      <UserIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div
                    className={`flex flex-col gap-1 max-w-[80%] ${m.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`px-3.5 py-2.5 rounded-xl text-sm ${
                        m.role === "assistant"
                          ? "bg-card border border-border text-foreground"
                          : "bg-indigo-600 text-white"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <Markdown content={m.content} />
                      ) : (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}
                    </div>
                    {m.attachments?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {m.attachments.map((a) => (
                          <span
                            key={a.id}
                            className="text-[10px] bg-card border border-border px-2 py-0.5 rounded text-muted-foreground"
                          >
                            {a.filename}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {conv && conv.messages.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-12">
                No messages yet.
              </div>
            )}
          </div>
        )}
      </div>

      <VersionHistorySheet
        featureRequestId={request.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
      {tab === "chat" && (
        <div className="border-t border-border p-4 bg-muted/40">
          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            Ask a clarifying question — appears in the user's chat and feeds
            into the AI's context for the next reply.
          </div>
          <div className="flex gap-2">
            <Textarea
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              placeholder="e.g. Which fleet sites is this needed for? Any specific OCPP version?"
              className="min-h-[60px] bg-card"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onPostMessage();
                }
              }}
            />
            <Button
              onClick={onPostMessage}
              disabled={postMut.isPending || !adminMessage.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white self-end"
            >
              {postMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h3>
      <div className="text-sm text-foreground prose prose-sm max-w-none">
        <Markdown content={body} />
      </div>
    </div>
  );
}
