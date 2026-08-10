import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2,
  GitMerge,
  Check,
  X,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { useToast } from "@/hooks/use-toast";

interface ProposalRequest {
  id: number;
  title: string;
  summary: string;
  scope: string;
  status: string;
  priority: string;
  userEmail: string;
  userName: string | null;
  createdAt: string | null;
}

interface MergeProposal {
  id: number;
  confidence: string;
  relationRationale: string;
  proposedScope: string;
  createdAt: string | null;
  duplicate: ProposalRequest;
  primary: ProposalRequest;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

async function mutate<T>(path: string, method: "POST"): Promise<T> {
  const res = await fetch(path, { method, credentials: "include" });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/60",
  medium:
    "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
};

function RequestCard({
  request,
  label,
}: {
  request: ProposalRequest;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Link
          href={`/requests/${request.id}?from=admin`}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
        >
          #{request.id} <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      <h4 className="font-semibold text-foreground leading-snug">
        {request.title}
      </h4>
      <p className="text-sm text-muted-foreground mt-1">{request.summary}</p>
      <p className="text-xs text-muted-foreground mt-2">
        {request.userName || request.userEmail}
      </p>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: MergeProposal }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDiff, setShowDiff] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "merge-proposals"] });

  const approveMut = useMutation({
    mutationFn: () =>
      mutate<{ ok: true }>(
        `/api/admin/merge-proposals/${proposal.id}/approve`,
        "POST",
      ),
    onSuccess: () => {
      toast({
        title: "Merged",
        description: `Request #${proposal.primary.id}'s scope has been updated.`,
      });
      refresh();
    },
    onError: (err) =>
      toast({
        title: "Approve failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const rejectMut = useMutation({
    mutationFn: () =>
      mutate<{ ok: true }>(
        `/api/admin/merge-proposals/${proposal.id}/reject`,
        "POST",
      ),
    onSuccess: () => {
      toast({ title: "Dismissed" });
      refresh();
    },
    onError: (err) =>
      toast({
        title: "Reject failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <GitMerge className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <span className="font-semibold text-foreground">Possible duplicate</span>
        <Badge
          variant="outline"
          className={
            CONFIDENCE_STYLES[proposal.confidence] ?? CONFIDENCE_STYLES.medium
          }
        >
          {proposal.confidence} confidence
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => rejectMut.mutate()}
          >
            {rejectMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
            Dismiss
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => approveMut.mutate()}
          >
            {approveMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Approve merge
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <RequestCard request={proposal.primary} label="Primary (gets updated)" />
          <RequestCard
            request={proposal.duplicate}
            label="Duplicate (stays independent)"
          />
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Why this was flagged (admin-only)
          </p>
          <p className="text-sm text-foreground">{proposal.relationRationale}</p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowDiff((s) => !s)}
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            {showDiff ? "Hide" : "Compare"} current vs proposed scope
            <ArrowRight
              className={`w-4 h-4 transition-transform ${
                showDiff ? "rotate-90" : ""
              }`}
            />
          </button>

          {showDiff && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Current scope (primary #{proposal.primary.id})
                </p>
                <Markdown content={proposal.primary.scope} />
              </div>
              <div className="rounded-xl border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-2">
                  Proposed merged scope
                </p>
                <Markdown content={proposal.proposedScope} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DuplicatesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "merge-proposals"],
    queryFn: () =>
      api<{ proposals: MergeProposal[] }>("/api/admin/merge-proposals"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  const proposals = data?.proposals ?? [];

  if (proposals.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
        <GitMerge className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium text-foreground">No duplicates to review</p>
        <p className="text-sm text-muted-foreground mt-1">
          When a new request closely matches an existing PRD, a merge proposal
          will appear here for your approval.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </div>
  );
}
