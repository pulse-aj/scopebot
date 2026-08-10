import { useState } from "react";
import type { FeatureRequest } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MoveToPlannedDialog({
  request,
  pending,
  onClose,
  onConfirm,
}: {
  request: FeatureRequest | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (rank: number, owner: "agent" | "human") => void;
}) {
  const open = !!request;
  const aiRank = request?.aiPriorityRank ?? null;
  const existing = request?.adminPriorityRank ?? null;
  const defaultValue = (existing ?? aiRank ?? "").toString();
  const [value, setValue] = useState<string>(defaultValue);
  // Engineering destination: "agent" routes to the agentic team (Paperclip),
  // "human" routes to Notion only. Default to whatever was previously set, or
  // the agentic team for fresh routes.
  const [owner, setOwner] = useState<"agent" | "human">(
    request?.engineeringOwner === "human" ? "human" : "agent",
  );

  // Reset the input whenever a new request opens the modal.
  // Using a key-less controlled input means we'd otherwise keep the stale
  // value when the user closes & opens for a different card.
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (request && openedFor !== request.id) {
    setOpenedFor(request.id);
    setValue(defaultValue);
    setOwner(request.engineeringOwner === "human" ? "human" : "agent");
  }
  if (!request && openedFor !== null) {
    setOpenedFor(null);
  }

  const parsed = value.trim() === "" ? NaN : Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10000;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Planned</DialogTitle>
          <DialogDescription>
            {aiRank != null
              ? `The AI ranked this request #${aiRank}. Use the same number, or set your own admin priority. Lower = higher priority.`
              : "Set an admin priority rank for this request. Lower = higher priority. This determines the order it's fed to the dev agent."}
          </DialogDescription>
        </DialogHeader>

        {request && (
          <div className="border border-border rounded-lg p-3 bg-muted/40 mb-2">
            <p className="font-semibold text-sm text-foreground line-clamp-1">{request.title}</p>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{request.summary}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label>Engineering destination</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOwner("agent")}
              className={`rounded-lg border p-3 text-left transition-colors ${
                owner === "agent"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
                  : "border-border hover:border-indigo-300"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">Agentic team</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Routes to the AI dev agents.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setOwner("human")}
              className={`rounded-lg border p-3 text-left transition-colors ${
                owner === "human"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
                  : "border-border hover:border-indigo-300"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">Human engineers</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Creates a Notion project page.
              </p>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin-priority-rank">Admin priority rank</Label>
          <Input
            id="admin-priority-rank"
            type="number"
            min={1}
            max={10000}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={aiRank?.toString() ?? "1"}
            autoFocus
          />
          {aiRank != null && parsed !== aiRank && (
            <button
              type="button"
              onClick={() => setValue(aiRank.toString())}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Use AI rank (#{aiRank})
            </button>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() => valid && onConfirm(parsed, owner)}
          >
            {pending ? "Moving…" : "Move to Planned"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
