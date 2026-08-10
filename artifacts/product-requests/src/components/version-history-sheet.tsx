import { useState } from "react";
import {
  useListFeatureRequestVersions,
  type FeatureRequestVersion,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Loader2, History, ArrowLeft, Clock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";

interface Props {
  featureRequestId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistorySheet({
  featureRequestId,
  open,
  onOpenChange,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        {featureRequestId != null && open && (
          <Inner featureRequestId={featureRequestId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Inner({ featureRequestId }: { featureRequestId: number }) {
  const { data, isLoading } = useListFeatureRequestVersions(featureRequestId);
  const [selected, setSelected] = useState<FeatureRequestVersion | null>(null);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
      </div>
    );
  }

  const versions = data ?? [];

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <button
            onClick={() => setSelected(null)}
            className="text-xs font-medium text-muted-foreground hover:text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 mb-2 self-start"
          >
            <ArrowLeft className="w-3 h-3" /> Back to history
          </button>
          <SheetTitle className="text-lg font-bold text-foreground">
            Version {selected.versionNumber} · {selected.title}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">
            {format(new Date(selected.createdAt), "MMM d, yyyy 'at' h:mm a")}
            {selected.createdByName ? ` · ${selected.createdByName}` : ""} ·{" "}
            {selected.changeReason}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <Section title="Summary" body={selected.summary} />
          <Section title="Problem" body={selected.problem} />
          <Section title="Benefits" body={selected.benefits} />
          <Section title="Current cost / pain" body={selected.currentSpend} />
          <Section title="Scope" body={selected.scope} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
        <SheetTitle className="text-xl font-bold text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Version history
        </SheetTitle>
        <SheetDescription className="text-muted-foreground">
          Every time the AI re-synthesizes the requirements doc — including
          after admin clarifying questions are answered — a new version is
          recorded here.
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {versions.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            No versions yet.
          </div>
        ) : (
          <ol className="relative border-l border-border ml-3 space-y-5">
            {versions.map((v, idx) => (
              <li key={v.id} className="ml-6">
                <span
                  className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-4 ring-white text-[10px] font-bold ${
                    idx === 0
                      ? "bg-indigo-600 text-white"
                      : "bg-muted text-foreground/85"
                  }`}
                >
                  v{v.versionNumber}
                </span>
                <button
                  className="text-left w-full bg-card border border-border rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                  onClick={() => setSelected(v)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-semibold text-foreground text-sm">
                      {v.title}
                    </div>
                    {idx === 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Clock className="w-3 h-3" />
                    {format(new Date(v.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    {v.createdByName ? ` · ${v.createdByName}` : ""}
                  </div>
                  <div className="text-xs text-foreground/85 italic">
                    {v.changeReason}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
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

export function downloadFeatureRequestPdf(id: number) {
  const url = `${import.meta.env.BASE_URL}api/feature-requests/${id}/pdf`;
  // Open in same tab — server sets Content-Disposition: attachment so the
  // browser downloads instead of navigating.
  window.location.assign(url);
}

export function downloadFeatureRequestMarkdown(id: number) {
  const url = `${import.meta.env.BASE_URL}api/feature-requests/${id}/markdown`;
  // Same approach as the PDF download — server sets Content-Disposition:
  // attachment so the browser downloads the .md instead of navigating.
  window.location.assign(url);
}
