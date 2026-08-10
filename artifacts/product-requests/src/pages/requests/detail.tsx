import { useParams, Link, useSearch, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import {
  useGetFeatureRequest,
  getGetFeatureRequestQueryKey,
  useUpdateFeatureRequest,
  useDeleteFeatureRequest,
  useResynthesizeFeatureRequest,
  getListFeatureRequestsQueryKey,
  getAdminListFeatureRequestsQueryKey,
  getAdminStatsQueryKey,
  getListFeatureRequestVersionsQueryKey,
  useGetMe,
  useGetConversation,
  useAdminGetConversation,
  useAdminPostMessage,
  getGetConversationQueryKey,
  getAdminGetConversationQueryKey,
  type Conversation,
} from "@workspace/api-client-react";
import { EngineeringPanel } from "@/components/engineering-panel";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, ArrowLeft, Target, AlertTriangle, Lightbulb, DollarSign, Calendar, Activity, BarChart2, Download, History, RefreshCw, MessageSquare, Bot, User, ShieldCheck, File as FileIcon, FileText, Send, ExternalLink, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  VersionHistorySheet,
  downloadFeatureRequestPdf,
  downloadFeatureRequestMarkdown,
} from "@/components/version-history-sheet";

const PRIORITY_COLORS = {
  low: "bg-slate-100 dark:bg-slate-950/50 text-slate-700 border-slate-200 dark:border-slate-900/60",
  medium: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
  high: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60",
};

const STATUS_LABELS = {
  requested: "Requested",
  ready_for_execution: "Ready for Execution",
  planned: "Planned",
  in_progress: "In Progress",
  deployed: "Deployed"
};

export default function RequestDetailPage() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const search = useSearch();
  const fromAdmin = new URLSearchParams(search).get("from") === "admin";
  const backHref = fromAdmin ? "/admin" : "/requests";
  const backLabel = fromAdmin ? "Back to admin" : "Back to board";
  const { data: req, isLoading } = useGetFeatureRequest(id, {
    query: { enabled: !!id, queryKey: getGetFeatureRequestQueryKey(id) }
  });
  const { data: me } = useGetMe();
  
  const updateReqMut = useUpdateFeatureRequest();
  const resynthMut = useResynthesizeFeatureRequest();
  const deleteReqMut = useDeleteFeatureRequest();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"scope" | "conversation">("scope");

  const handleResynth = () => {
    resynthMut.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFeatureRequestQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListFeatureRequestVersionsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
          toast({ title: "Requirements re-synthesized", description: "A new version has been added to the history." });
        },
        onError: () => toast({ title: "Re-synthesis failed", variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (
      !window.confirm(
        "Delete this request? This permanently removes the requirements doc, the full chat, attachments, version history, and any engineering tasks. This cannot be undone.",
      )
    )
      return;
    deleteReqMut.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getAdminListFeatureRequestsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getAdminStatsQueryKey() });
          toast({ title: "Request deleted" });
          navigate(backHref);
        },
        onError: () => toast({ title: "Failed to delete request", variant: "destructive" }),
      },
    );
  };

  const handleUpdate = (field: 'status' | 'priority', value: string) => {
    updateReqMut.mutate({ id, data: { [field]: value } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeatureRequestQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminListFeatureRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminStatsQueryKey() });
        toast({ title: "Request updated successfully" });
      },
      onError: () => {
        toast({ title: "Failed to update request", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-muted/40"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" /></div>;
  }

  if (!req) {
    return <div className="min-h-screen flex items-center justify-center bg-muted/40 text-muted-foreground">Request not found.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-muted/40">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-indigo-600 dark:text-indigo-400 transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          {/* Header */}
          <div className="px-8 py-8 border-b border-border bg-card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 dark:bg-indigo-950/40 rounded-full mix-blend-multiply filter blur-3xl opacity-70 -translate-y-1/2 translate-x-1/2"></div>
            
            <div className="relative z-10">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={`uppercase font-bold tracking-wider px-3 py-1 ${PRIORITY_COLORS[req.priority as keyof typeof PRIORITY_COLORS]}`}>
                    {req.priority} Priority
                  </Badge>
                  {req.minor && (
                    <Badge variant="outline" className="uppercase font-bold tracking-wider px-3 py-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60">
                      Minor
                    </Badge>
                  )}
                  <Badge variant="secondary" className="uppercase font-bold tracking-wider px-3 py-1 bg-muted text-foreground/85">
                    {STATUS_LABELS[req.status as keyof typeof STATUS_LABELS]}
                  </Badge>
                  {req.engineeringOwner === "human" && (
                    <Badge variant="outline" className="uppercase font-bold tracking-wider px-3 py-1 bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-900/60">
                      Human team
                    </Badge>
                  )}
                  {req.engineeringOwner === "agent" && (
                    <Badge variant="outline" className="uppercase font-bold tracking-wider px-3 py-1 bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900/60">
                      Agentic team
                    </Badge>
                  )}
                  {req.notionUrl && (
                    <a
                      href={req.notionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Notion{req.notionStatus ? ` · ${req.notionStatus}` : ""}
                      {req.notionAssignee ? ` · ${req.notionAssignee}` : ""}
                    </a>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium mr-2">
                    <Calendar className="w-4 h-4" />
                    {format(new Date(req.createdAt), "MMM d, yyyy")}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History className="w-4 h-4" /> Version history
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleResynth}
                    disabled={resynthMut.isPending}
                  >
                    {resynthMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Re-synthesize
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => downloadFeatureRequestMarkdown(id)}
                  >
                    <Download className="w-4 h-4" /> Download Markdown
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={() => downloadFeatureRequestPdf(id)}
                  >
                    <Download className="w-4 h-4" /> Download PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:text-red-400 dark:hover:bg-red-950/40 dark:border-red-900/60"
                    onClick={handleDelete}
                    disabled={deleteReqMut.isPending}
                  >
                    {deleteReqMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
              
              <h1 className="text-3xl font-extrabold text-foreground tracking-tight leading-tight mb-4 max-w-3xl">
                {req.title}
              </h1>
              
              <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                {req.summary}
              </p>
            </div>
          </div>
          
          <div className={`grid grid-cols-1 ${activeTab === "conversation" ? "" : "lg:grid-cols-3 lg:divide-x"} divide-y lg:divide-y-0 divide-gray-200`}>
            {/* Main Content */}
            <div className={`${activeTab === "conversation" ? "" : "lg:col-span-2"} p-8 bg-card`}>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "scope" | "conversation")} className="w-full">
                <TabsList className="mb-6">
                  <TabsTrigger value="scope" className="gap-1.5">
                    <FileText className="w-4 h-4" />
                    Requirements
                  </TabsTrigger>
                  <TabsTrigger value="conversation" className="gap-1.5">
                    <MessageSquare className="w-4 h-4" />
                    Conversation
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="scope">
                  <div className="flex items-center gap-2 mb-6">
                    <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <h2 className="text-xl font-bold text-foreground">Product Scope</h2>
                  </div>
                  <Markdown content={req.scope} />
                </TabsContent>

                <TabsContent value="conversation">
                  <ConversationTab
                    conversationId={req.conversationId}
                    isAdminViewer={!!me?.isAdmin}
                    isOwner={req.userId === me?.id}
                  />
                </TabsContent>
              </Tabs>
            </div>
            
            {/* Sidebar Details — hidden on the Conversation tab */}
            <div className={`bg-muted/40 p-8 space-y-8 ${activeTab === "conversation" ? "hidden" : ""}`}>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Controls
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/85">Status</label>
                    <Select value={req.status} onValueChange={(v) => handleUpdate('status', v)}>
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/85">Priority</label>
                    <Select value={req.priority} onValueChange={(v) => handleUpdate('priority', v)}>
                      <SelectTrigger className="w-full bg-card">
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
              </div>

              <div className="space-y-6 pt-6 border-t border-border">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Core Problem
                  </h3>
                  <p className="text-sm text-foreground/85 bg-card p-4 rounded-xl border border-border shadow-sm">
                    {req.problem}
                  </p>
                </div>
                
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" /> Key Benefits
                  </h3>
                  <p className="text-sm text-foreground/85 bg-card p-4 rounded-xl border border-border shadow-sm">
                    {req.benefits}
                  </p>
                </div>
                
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Current Spend / Pain
                  </h3>
                  <p className="text-sm text-foreground/85 bg-card p-4 rounded-xl border border-border shadow-sm font-mono">
                    {req.currentSpend}
                  </p>
                </div>
                
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4" /> Requester Info
                  </h3>
                  <div className="bg-card p-4 rounded-xl border border-border shadow-sm text-sm">
                    <div className="font-medium text-foreground">{req.userName || 'Anonymous'}</div>
                    <div className="text-muted-foreground mt-1">{req.userEmail}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {me?.isAdmin && (
        <div className="max-w-5xl mx-auto px-6 pb-10">
          <EngineeringPanel
            featureRequestId={id}
            conversationId={req.conversationId}
          />
        </div>
      )}
      <VersionHistorySheet
        featureRequestId={id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

// Renders the full chat transcript between the requester and the AI PM
// (plus any admin-posted clarifying questions). Admins viewing somebody
// else's request hit the admin-only endpoint; owners and admins viewing
// their own request use the regular one. `conversationId` may be null for
// legacy requests that pre-date the chat flow.
function ConversationTab({
  conversationId,
  isAdminViewer,
  isOwner,
}: {
  conversationId: number | null | undefined;
  isAdminViewer: boolean;
  isOwner: boolean;
}) {
  // Owners always hit the user endpoint (works for their own conv).
  // Admins viewing someone else's request must hit the admin endpoint.
  const useAdminEndpoint = isAdminViewer && !isOwner;
  const cid = conversationId ?? 0;

  const ownerQuery = useGetConversation(cid, {
    query: {
      enabled: !!conversationId && !useAdminEndpoint,
      queryKey: getGetConversationQueryKey(cid),
    },
  });
  const adminQuery = useAdminGetConversation(cid, {
    query: {
      enabled: !!conversationId && useAdminEndpoint,
      queryKey: getAdminGetConversationQueryKey(cid),
    },
  });

  const isLoading = useAdminEndpoint ? adminQuery.isLoading : ownerQuery.isLoading;
  const error = useAdminEndpoint ? adminQuery.error : ownerQuery.error;
  const conv: Conversation | undefined = useAdminEndpoint
    ? adminQuery.data
    : ownerQuery.data;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [adminMessage, setAdminMessage] = useState("");
  const postMut = useAdminPostMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever a new message arrives.
  useEffect(() => {
    if (conv?.messages.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [conv?.messages.length]);

  // Any admin viewing the request (owner or not) can post clarifying
  // questions back into the conversation. Finalized requests are fine
  // too — the server auto-resynthesizes the spec when the user replies.
  const canPost = isAdminViewer && !!conversationId;

  const onPostMessage = () => {
    if (!conversationId) return;
    const content = adminMessage.trim();
    if (!content) return;
    postMut.mutate(
      { id: conversationId, data: { content } },
      {
        onSuccess: (updated) => {
          setAdminMessage("");
          // Update whichever cache we're reading from so the new message
          // appears immediately; invalidate the other for good measure.
          queryClient.setQueryData(
            useAdminEndpoint
              ? getAdminGetConversationQueryKey(conversationId)
              : getGetConversationQueryKey(conversationId),
            updated,
          );
          queryClient.invalidateQueries({
            queryKey: useAdminEndpoint
              ? getGetConversationQueryKey(conversationId)
              : getAdminGetConversationQueryKey(conversationId),
          });
          toast({
            title: "Question sent",
            description: "It now appears in the user's chat.",
          });
        },
        onError: () =>
          toast({ title: "Failed to send", variant: "destructive" }),
      },
    );
  };

  if (!conversationId) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        This request has no chat conversation attached.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  if (error || !conv) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Couldn't load the conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-muted/30 overflow-hidden h-[min(55vh,480px)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card/60 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
          <h2 className="text-sm font-semibold text-foreground truncate">
            Conversation transcript
          </h2>
        </div>
        <span className="text-[11px] text-muted-foreground font-medium flex-shrink-0">
          {conv.messages.length} message{conv.messages.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Scrollable message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {conv.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-muted-foreground">
            No messages in this conversation yet.
          </div>
        ) : (
          conv.messages.map((msg) => {
            if (msg.role === "admin") {
              return (
                <div
                  key={msg.id}
                  className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg p-3"
                >
                  <div className="w-7 h-7 flex-shrink-0 rounded-full bg-amber-500 text-white flex items-center justify-center">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                        {msg.authorName || "ScopeBot admin"}
                      </div>
                      <time className="text-[10px] text-muted-foreground">
                        {format(new Date(msg.createdAt), "MMM d, h:mm a")}
                      </time>
                    </div>
                    <div className="text-sm text-foreground break-words">
                      <Markdown content={msg.content} />
                    </div>
                  </div>
                </div>
              );
            }

            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ${
                    isUser
                      ? "bg-muted text-foreground/85"
                      : "bg-indigo-600 text-white"
                  }`}
                >
                  {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div
                  className={`flex flex-col gap-1.5 min-w-0 max-w-[80%] sm:max-w-[75%] ${
                    isUser ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-sm break-words ${
                      isUser
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-card border border-border text-foreground"
                    }`}
                  >
                    <Markdown
                      content={msg.content}
                      className={
                        isUser
                          ? "text-white dark:text-white prose-p:text-white prose-headings:text-white prose-strong:text-white prose-li:text-white"
                          : ""
                      }
                    />
                  </div>
                  <div
                    className={`text-[10px] text-muted-foreground ${
                      isUser ? "text-right" : ""
                    }`}
                  >
                    {format(new Date(msg.createdAt), "MMM d, h:mm a")}
                  </div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div
                      className={`flex flex-wrap gap-1.5 ${
                        isUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      {msg.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center gap-1.5 bg-card border border-border px-2 py-1 rounded-md text-[10px] text-muted-foreground"
                        >
                          <FileIcon className="w-3 h-3 text-indigo-500" />
                          <span className="truncate max-w-[140px] font-medium">
                            {att.filename}
                          </span>
                          <span className="text-muted-foreground/70">
                            ({Math.round(att.sizeBytes / 1024)}kb)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Admin chat composer — visible to any admin on the conversation */}
      {canPost && (
        <div className="border-t border-border bg-card/60 p-3 flex-shrink-0">
          <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            {conv.status === "finalized"
              ? "Ask a clarifying question — when the user replies, the requirements doc is automatically re-synthesized."
              : "Ask a clarifying question — posts to the user's chat and feeds into the AI's next reply."}
          </div>
          <div className="flex gap-2 items-end">
            <Textarea
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              placeholder="e.g. Which sites is this for? Any deadline?"
              className="min-h-[56px] max-h-32 resize-none bg-card text-sm"
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
              className="bg-amber-600 hover:bg-amber-700 text-white"
              size="sm"
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