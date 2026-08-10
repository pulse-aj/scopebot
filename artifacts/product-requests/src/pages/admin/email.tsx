import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Plus,
  Send,
  Trash2,
  Eye,
  Sparkles,
  ChevronLeft,
  Loader2,
  Users,
  AlertCircle,
  CheckCircle2,
  Code2,
  Monitor,
  Pencil,
  Wand2,
  ImagePlus,
  Copy,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
import { format, formatDistanceToNow } from "date-fns";

// ---- Types ----

type Audience = "all_users" | "non_admins" | "admins" | "specific";
type Status = "draft" | "sending" | "sent" | "failed";

interface CampaignSummary {
  id: number;
  subject: string;
  status: Status;
  audience: Audience;
  createdAt: string;
  sentAt: string | null;
  totalRecipients: number;
  totalSent: number;
  totalFailed: number;
  uniqueOpens: number;
  totalOpens: number;
}

interface Campaign {
  id: number;
  subject: string;
  preheader: string | null;
  htmlBody: string;
  audience: Audience;
  specificEmails: string[] | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  totalRecipients: number;
  totalSent: number;
  totalFailed: number;
  sendError: string | null;
}

interface RecipientRow {
  id: number;
  email: string;
  sentAt: string | null;
  sendError: string | null;
  openedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
}

interface CampaignDetail {
  campaign: Campaign;
  recipients: RecipientRow[];
  stats: { uniqueOpens: number; totalOpens: number; openRate: number };
}

// ---- API helpers ----

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ---- Templates ----

const TEMPLATES: { id: string; name: string; description: string; html: string }[] = [
  {
    id: "feature-launch-aurora",
    name: "Feature Launch — Aurora",
    description: "Bright purple-to-pink gradient with a hero CTA.",
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(124,58,237,0.12);">
        <tr><td style="background:linear-gradient(135deg,#7c3aed 0%,#ec4899 60%,#f97316 100%);padding:48px 32px;color:#ffffff;text-align:center;">
          <div style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.18);border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Just Shipped</div>
          <h1 style="margin:18px 0 8px;font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;">A brand-new way to [feature name]</h1>
          <p style="margin:0;font-size:16px;opacity:0.95;line-height:1.5;">We listened to your requests — here's what's new this week.</p>
        </td></tr>
        <tr><td style="padding:36px 32px 8px;color:#0f172a;">
          <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;">What's new</h2>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Describe the headline change in one or two sentences. Why does it matter to the customer?</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#334155;font-size:15px;line-height:1.7;">
            <li>Highlight #1 — the most exciting thing</li>
            <li>Highlight #2 — the time it saves</li>
            <li>Highlight #3 — what's coming next</li>
          </ul>
        </td></tr>
        <tr><td style="padding:0 32px 36px;text-align:center;">
          <a href="https://yourapp.com/whats-new" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:16px;box-shadow:0 6px 20px rgba(124,58,237,0.35);">Try it out →</a>
        </td></tr>
        <tr><td style="padding:24px 32px;background:#faf5ff;border-top:1px solid #ede9fe;color:#6b21a8;font-size:12px;text-align:center;">
          Built with your feedback · <a href="#" style="color:#6b21a8;">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  },
  {
    id: "feature-launch-sunset",
    name: "Feature Launch — Sunset",
    description: "Warm orange / coral hero with a feature grid.",
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#fff7ed;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7ed;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(249,115,22,0.15);">
        <tr><td style="background:linear-gradient(135deg,#f97316 0%,#ef4444 100%);padding:56px 32px;color:#ffffff;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;">🚀 Shipped this week</h1>
          <p style="margin:0;font-size:16px;opacity:0.95;">Big updates, ready for you now.</p>
        </td></tr>
        <tr><td style="padding:36px 32px;color:#1f2937;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:top;padding:0 0 24px;">
                <div style="font-size:13px;font-weight:700;color:#ea580c;letter-spacing:0.06em;text-transform:uppercase;">Feature 1</div>
                <h3 style="margin:6px 0 6px;font-size:18px;font-weight:700;color:#0f172a;">Headline of the feature</h3>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">One or two sentences explaining what it does and who it helps.</p>
              </td>
            </tr>
            <tr>
              <td style="vertical-align:top;padding:0 0 24px;">
                <div style="font-size:13px;font-weight:700;color:#ea580c;letter-spacing:0.06em;text-transform:uppercase;">Feature 2</div>
                <h3 style="margin:6px 0 6px;font-size:18px;font-weight:700;color:#0f172a;">Headline of the feature</h3>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">One or two sentences explaining what it does and who it helps.</p>
              </td>
            </tr>
          </table>
          <div style="text-align:center;margin-top:8px;">
            <a href="https://yourapp.com" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;">See the changelog</a>
          </div>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#fff7ed;border-top:1px solid #fed7aa;color:#9a3412;font-size:12px;text-align:center;">
          Made with care by the team.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  },
  {
    id: "feature-launch-electric",
    name: "Feature Launch — Electric",
    description: "Bold cyan-to-lime hero, perfect for big releases.",
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#ecfeff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfeff;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#0f172a;border-radius:24px;overflow:hidden;box-shadow:0 12px 60px rgba(8,145,178,0.25);">
        <tr><td style="padding:56px 32px 24px;text-align:center;color:#ffffff;">
          <div style="display:inline-block;padding:6px 14px;background:linear-gradient(90deg,#06b6d4,#a3e635);border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.1em;color:#0f172a;text-transform:uppercase;">New Release</div>
          <h1 style="margin:20px 0 12px;font-size:38px;line-height:1.1;font-weight:900;letter-spacing:-0.025em;background:linear-gradient(90deg,#67e8f9,#bef264);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#67e8f9;">Big news. Bigger features.</h1>
          <p style="margin:0;font-size:16px;line-height:1.5;color:#cbd5e1;">Three things landed this week.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 32px;color:#e2e8f0;">
          <div style="background:#1e293b;border:1px solid #334155;border-radius:14px;padding:20px;margin-bottom:14px;">
            <div style="font-size:11px;color:#a3e635;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">01</div>
            <h3 style="margin:6px 0 6px;font-size:17px;font-weight:700;color:#ffffff;">Feature one headline</h3>
            <p style="margin:0;font-size:14px;line-height:1.55;color:#94a3b8;">What changed and why it matters.</p>
          </div>
          <div style="background:#1e293b;border:1px solid #334155;border-radius:14px;padding:20px;margin-bottom:14px;">
            <div style="font-size:11px;color:#67e8f9;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">02</div>
            <h3 style="margin:6px 0 6px;font-size:17px;font-weight:700;color:#ffffff;">Feature two headline</h3>
            <p style="margin:0;font-size:14px;line-height:1.55;color:#94a3b8;">What changed and why it matters.</p>
          </div>
          <div style="background:#1e293b;border:1px solid #334155;border-radius:14px;padding:20px;margin-bottom:22px;">
            <div style="font-size:11px;color:#f0abfc;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">03</div>
            <h3 style="margin:6px 0 6px;font-size:17px;font-weight:700;color:#ffffff;">Feature three headline</h3>
            <p style="margin:0;font-size:14px;line-height:1.55;color:#94a3b8;">What changed and why it matters.</p>
          </div>
          <div style="text-align:center;">
            <a href="https://yourapp.com" style="display:inline-block;background:linear-gradient(90deg,#06b6d4,#a3e635);color:#0f172a;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:800;font-size:15px;">Explore the release</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  },
];

const AUDIENCE_LABELS: Record<Audience, string> = {
  all_users: "All users",
  non_admins: "Customers only (non-admins)",
  admins: "Admins only",
  specific: "Specific emails",
};

const STATUS_STYLES: Record<Status, string> = {
  draft: "bg-muted text-foreground/85 border-border",
  sending: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60",
  sent: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60",
  failed: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60",
};

// ---- Component ----

type View = { kind: "list" } | { kind: "edit"; id: number | null } | { kind: "detail"; id: number };

export default function EmailCampaignsPanel() {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "list") {
    return (
      <CampaignList
        onCreate={() => setView({ kind: "edit", id: null })}
        onOpen={(id) => setView({ kind: "detail", id })}
        onEdit={(id) => setView({ kind: "edit", id })}
      />
    );
  }
  if (view.kind === "edit") {
    return (
      <CampaignEditor
        id={view.id}
        onBack={() => setView({ kind: "list" })}
        onSaved={(id) => setView({ kind: "detail", id })}
      />
    );
  }
  return (
    <CampaignDetailView
      id={view.id}
      onBack={() => setView({ kind: "list" })}
      onEdit={(id) => setView({ kind: "edit", id })}
    />
  );
}

// ---- List ----

function CampaignList(props: {
  onCreate: () => void;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["adminEmailCampaigns"],
    queryFn: () =>
      api<{ campaigns: CampaignSummary[] }>("/api/admin/email-campaigns"),
  });
  const campaigns = data?.campaigns ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Mail className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Email Campaigns
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Announce shipped features to your users and track who opens what.
          </p>
        </div>
        <Button onClick={props.onCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Plus className="w-4 h-4" /> New campaign
        </Button>
      </div>

      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground/70">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 mx-auto flex items-center justify-center mb-4">
              <Mail className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">No campaigns yet</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Compose a bright, vibrant announcement and send it to your users.
            </p>
            <Button onClick={props.onCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <Plus className="w-4 h-4" /> Create your first campaign
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Open rate</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="w-[1%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const denom = c.totalSent || c.totalRecipients;
                const rate = denom > 0 ? (c.uniqueOpens / denom) * 100 : 0;
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => props.onOpen(c.id)}
                  >
                    <TableCell className="font-medium text-foreground max-w-[420px] truncate">
                      {c.subject}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[c.status]}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {AUDIENCE_LABELS[c.audience]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground/85">
                      {c.totalRecipients || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.status === "sent" || c.status === "failed" ? (
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                          {rate.toFixed(0)}%
                          <span className="text-muted-foreground/70 font-normal ml-1">
                            ({c.uniqueOpens}/{denom})
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.sentAt
                        ? formatDistanceToNow(new Date(c.sentAt), { addSuffix: true })
                        : <span className="text-muted-foreground/70">draft</span>}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {c.status === "draft" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-indigo-600 dark:text-indigo-400"
                          onClick={() => props.onEdit(c.id)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ---- Editor ----

function CampaignEditor(props: {
  id: number | null;
  onBack: () => void;
  onSaved: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isCreating = props.id === null;

  const { data: existing, isLoading } = useQuery({
    queryKey: ["adminEmailCampaign", props.id],
    queryFn: () =>
      api<CampaignDetail>(`/api/admin/email-campaigns/${props.id}`),
    enabled: props.id !== null,
  });

  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all_users");
  const [specificEmailsText, setSpecificEmailsText] = useState("");
  const [tab, setTab] = useState<"editor" | "preview">("editor");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(isCreating);

  useEffect(() => {
    if (!isCreating && existing?.campaign && !hydrated) {
      setSubject(existing.campaign.subject);
      setPreheader(existing.campaign.preheader ?? "");
      setHtmlBody(existing.campaign.htmlBody);
      setAudience(existing.campaign.audience);
      setSpecificEmailsText((existing.campaign.specificEmails ?? []).join("\n"));
      setHydrated(true);
    }
  }, [isCreating, existing, hydrated]);

  const specificEmailsList = useMemo(
    () =>
      specificEmailsText
        .split(/[\n,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes("@")),
    [specificEmailsText],
  );

  const { data: audiencePreview } = useQuery({
    queryKey: ["adminEmailAudiencePreview", audience, specificEmailsList.join(",")],
    queryFn: () =>
      api<{ count: number; sample: { email: string }[] }>(
        "/api/admin/email-campaigns/preview-audience",
        {
          method: "POST",
          body: JSON.stringify({
            audience,
            specificEmails: audience === "specific" ? specificEmailsList : [],
          }),
        },
      ),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const payload = {
        subject,
        preheader: preheader || null,
        htmlBody,
        audience,
        specificEmails: audience === "specific" ? specificEmailsList : null,
      };
      if (isCreating) {
        const res = await api<{ campaign: Campaign }>("/api/admin/email-campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        return res.campaign;
      }
      const res = await api<{ campaign: Campaign }>(
        `/api/admin/email-campaigns/${props.id}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      return res.campaign;
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["adminEmailCampaigns"] });
      queryClient.invalidateQueries({ queryKey: ["adminEmailCampaign", c.id] });
      toast({ title: "Draft saved" });
      props.onSaved(c.id);
    },
    onError: (err) => {
      toast({
        title: "Couldn't save draft",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const sendNow = useMutation({
    mutationFn: async () => {
      // Persist current edits first.
      const payload = {
        subject,
        preheader: preheader || null,
        htmlBody,
        audience,
        specificEmails: audience === "specific" ? specificEmailsList : null,
      };
      let campaignId = props.id;
      if (isCreating || campaignId === null) {
        const r = await api<{ campaign: Campaign }>("/api/admin/email-campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        campaignId = r.campaign.id;
      } else {
        await api(`/api/admin/email-campaigns/${campaignId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      await api(`/api/admin/email-campaigns/${campaignId}/send`, {
        method: "POST",
      });
      return campaignId;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["adminEmailCampaigns"] });
      queryClient.invalidateQueries({ queryKey: ["adminEmailCampaign", id] });
      toast({
        title: "Campaign sending",
        description: "We'll deliver the emails in the background.",
      });
      props.onSaved(id);
    },
    onError: (err) => {
      toast({
        title: "Couldn't send campaign",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const insertTemplate = useCallback((html: string) => {
    setHtmlBody(html);
    setTab("preview");
  }, []);

  // ---- AI refine ----
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const refineMutation = useMutation({
    mutationFn: async () => {
      return api<{ html: string }>("/api/admin/email/refine-html", {
        method: "POST",
        body: JSON.stringify({
          html: htmlBody,
          instructions: refinePrompt,
        }),
      });
    },
    onSuccess: (r) => {
      setHtmlBody(r.html);
      setRefineOpen(false);
      setRefinePrompt("");
      setTab("preview");
      toast({
        title: "Email refined",
        description: "The AI's revision is loaded — review it in the preview.",
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't refine email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // ---- AI image generation ----
  const [imageOpen, setImageOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<
    "1024x1024" | "1536x1024" | "1024x1536"
  >("1024x1024");
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const imageMutation = useMutation({
    mutationFn: async () => {
      return api<{ dataUrl: string }>("/api/admin/email/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: imagePrompt, size: imageSize }),
      });
    },
    onSuccess: (r) => {
      setGeneratedImage(r.dataUrl);
    },
    onError: (err) => {
      toast({
        title: "Couldn't generate image",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const insertGeneratedImage = useCallback(() => {
    if (!generatedImage) return;
    const altText = imagePrompt.slice(0, 120).replace(/"/g, "&quot;");
    const tag = `<img src="${generatedImage}" alt="${altText}" style="display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`;
    // Append before </body> if present, else just append.
    setHtmlBody((prev) => {
      if (!prev.trim()) return tag;
      const idx = prev.lastIndexOf("</body>");
      if (idx === -1) return prev + "\n" + tag;
      return prev.slice(0, idx) + tag + "\n" + prev.slice(idx);
    });
    toast({
      title: "Image inserted",
      description: "Added to the end of the email — drag it where you want in the HTML.",
    });
    setImageOpen(false);
    setGeneratedImage(null);
    setImagePrompt("");
  }, [generatedImage, imagePrompt, toast]);

  const copyImageTag = useCallback(async () => {
    if (!generatedImage) return;
    const altText = imagePrompt.slice(0, 120).replace(/"/g, "&quot;");
    const tag = `<img src="${generatedImage}" alt="${altText}" style="display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`;
    try {
      await navigator.clipboard.writeText(tag);
      toast({ title: "Copied", description: "Image tag copied to clipboard." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  }, [generatedImage, imagePrompt, toast]);

  if (!isCreating && isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground/70">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  const isLocked = !isCreating && existing?.campaign.status !== "draft";
  const canSend =
    subject.trim().length > 0 &&
    htmlBody.trim().length > 0 &&
    (audiencePreview?.count ?? 0) > 0 &&
    !sendNow.isPending &&
    !isLocked;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={props.onBack} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {isCreating ? "New campaign" : `Edit campaign`}
            </h2>
            <p className="text-sm text-muted-foreground">
              Compose your email, preview it, and send when you're ready.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isLocked && (
            <>
              <Button
                variant="outline"
                onClick={() => saveDraft.mutate()}
                disabled={saveDraft.isPending || !subject.trim() || !htmlBody.trim()}
              >
                {saveDraft.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save draft
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                onClick={() => setConfirmOpen(true)}
                disabled={!canSend}
              >
                <Send className="w-4 h-4" />
                Send to {audiencePreview?.count ?? 0}
              </Button>
            </>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-100 rounded-xl p-4 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <div>
            This campaign is <strong>{existing?.campaign.status}</strong> — content
            is read-only. Duplicate it to send another variant.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Subject
              </label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="🚀 What's new this week"
                disabled={isLocked}
                maxLength={500}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Preheader <span className="text-muted-foreground/70 font-normal normal-case">(preview text shown in the inbox)</span>
              </label>
              <Input
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="A quick look at the features we shipped this week."
                disabled={isLocked}
                maxLength={500}
              />
            </div>
          </div>

          {!isLocked && (
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-foreground">
                  Start from a vibrant template
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => insertTemplate(t.html)}
                    className="text-left border border-border rounded-xl p-3 hover:border-indigo-400 hover:bg-indigo-50 dark:bg-indigo-950/40 transition-colors"
                  >
                    <div className="font-semibold text-sm text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-2">
              <div className="flex">
                <button
                  type="button"
                  onClick={() => setTab("editor")}
                  className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 ${
                    tab === "editor"
                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Code2 className="w-4 h-4" /> HTML
                </button>
                <button
                  type="button"
                  onClick={() => setTab("preview")}
                  className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 ${
                    tab === "preview"
                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Monitor className="w-4 h-4" /> Preview
                </button>
              </div>
              <div className="flex items-center gap-2 pr-2">
                {!isLocked && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setRefineOpen(true)}
                      className="gap-1.5 h-8 border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/40"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Refine with AI
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setGeneratedImage(null);
                        setImageOpen(true);
                      }}
                      className="gap-1.5 h-8 border-pink-300 text-pink-700 hover:bg-pink-50 dark:border-pink-700 dark:text-pink-300 dark:hover:bg-pink-950/40"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      Generate image
                    </Button>
                  </>
                )}
              </div>
            </div>
            {tab === "editor" ? (
              <Textarea
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
                placeholder="<html>… paste your HTML here, or pick a template above</html>"
                disabled={isLocked}
                className="font-mono text-xs leading-relaxed min-h-[480px] rounded-none border-0 focus-visible:ring-0 resize-none"
              />
            ) : (
              <div className="bg-muted p-4">
                <iframe
                  title="Email preview"
                  srcDoc={htmlBody || "<div style='padding:40px;font-family:sans-serif;color:#9ca3af;text-align:center;'>Nothing to preview yet — paste HTML or pick a template.</div>"}
                  className="w-full h-[520px] bg-card rounded-lg border border-border shadow-sm"
                  sandbox=""
                />
              </div>
            )}
          </div>
        </div>

        {/* Right: audience */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-foreground">Audience</h3>
            </div>
            <Select
              value={audience}
              onValueChange={(v) => setAudience(v as Audience)}
              disabled={isLocked}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_users">All users</SelectItem>
                <SelectItem value="non_admins">Customers only (non-admins)</SelectItem>
                <SelectItem value="admins">Admins only</SelectItem>
                <SelectItem value="specific">Specific emails…</SelectItem>
              </SelectContent>
            </Select>

            {audience === "specific" && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Email addresses
                </label>
                <Textarea
                  value={specificEmailsText}
                  onChange={(e) => setSpecificEmailsText(e.target.value)}
                  placeholder="one@example.com&#10;two@example.com"
                  disabled={isLocked}
                  className="font-mono text-xs min-h-[120px]"
                />
                <div className="text-xs text-muted-foreground/70 mt-1">
                  Separated by newlines or commas. {specificEmailsList.length} valid email
                  {specificEmailsList.length === 1 ? "" : "s"} detected.
                </div>
              </div>
            )}

            <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 dark:border-indigo-900/60 p-4">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                This will send to
              </div>
              <div className="text-3xl font-extrabold text-indigo-900 dark:text-indigo-100 mt-1 tabular-nums">
                {audiencePreview?.count ?? "—"}
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300 ml-1">
                  recipient{audiencePreview?.count === 1 ? "" : "s"}
                </span>
              </div>
              {audiencePreview && audiencePreview.sample.length > 0 && (
                <div className="text-xs text-indigo-700 dark:text-indigo-300/80 mt-2 truncate">
                  {audiencePreview.sample.map((s) => s.email).join(", ")}
                  {audiencePreview.count > audiencePreview.sample.length ? " …" : ""}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 text-xs text-muted-foreground leading-relaxed">
            <div className="font-semibold text-foreground/85 text-sm mb-1.5 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> How open tracking works
            </div>
            We append a tiny invisible image to each email. When the recipient's
            mail client loads it, we record the open. Some clients prefetch
            images (Apple Mail, Gmail proxy) which can inflate open counts —
            treat the number as a directional signal, not a guarantee.
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to email <strong>{audiencePreview?.count ?? 0}</strong>{" "}
              recipient{audiencePreview?.count === 1 ? "" : "s"} with the subject
              "<strong>{subject}</strong>". This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                setConfirmOpen(false);
                sendNow.mutate();
              }}
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={refineOpen} onOpenChange={setRefineOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-purple-600" />
              Refine email with AI
            </DialogTitle>
            <DialogDescription>
              Describe what you want changed. The AI will rewrite the full HTML
              based on your current draft.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={refinePrompt}
            onChange={(e) => setRefinePrompt(e.target.value)}
            placeholder="e.g. Make the headline more punchy, swap the gradient to teal, and add a footer with our address."
            className="min-h-[140px]"
            disabled={refineMutation.isPending}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRefineOpen(false)}
              disabled={refineMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => refineMutation.mutate()}
              disabled={!refinePrompt.trim() || refineMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 gap-1.5"
            >
              {refineMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {refineMutation.isPending ? "Refining…" : "Refine email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus className="w-4 h-4 text-pink-600" />
              Generate image with AI
            </DialogTitle>
            <DialogDescription>
              Describe the image you want. It's embedded directly into the email
              HTML, so it works in any inbox without hosting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="e.g. A glowing modern EV charger at dusk, photorealistic, clean studio background."
              className="min-h-[100px]"
              disabled={imageMutation.isPending}
            />
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Size
              </label>
              <Select
                value={imageSize}
                onValueChange={(v) =>
                  setImageSize(v as "1024x1024" | "1536x1024" | "1024x1536")
                }
                disabled={imageMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1024x1024">Square (1024×1024)</SelectItem>
                  <SelectItem value="1536x1024">
                    Landscape (1536×1024)
                  </SelectItem>
                  <SelectItem value="1024x1536">Portrait (1024×1536)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {generatedImage && (
              <div className="border border-border rounded-xl overflow-hidden bg-muted">
                <img
                  src={generatedImage}
                  alt="Generated preview"
                  className="block max-h-[320px] w-auto mx-auto"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setImageOpen(false)}
              disabled={imageMutation.isPending}
            >
              Close
            </Button>
            {generatedImage ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyImageTag}
                  className="gap-1.5"
                >
                  <Copy className="w-4 h-4" /> Copy &lt;img&gt; tag
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setGeneratedImage(null);
                    imageMutation.reset();
                  }}
                  disabled={imageMutation.isPending}
                >
                  Try again
                </Button>
                <Button
                  type="button"
                  onClick={insertGeneratedImage}
                  className="bg-pink-600 hover:bg-pink-700 gap-1.5"
                >
                  <ImagePlus className="w-4 h-4" /> Insert into email
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => imageMutation.mutate()}
                disabled={!imagePrompt.trim() || imageMutation.isPending}
                className="bg-pink-600 hover:bg-pink-700 gap-1.5"
              >
                {imageMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                {imageMutation.isPending ? "Generating…" : "Generate"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Detail ----

function CampaignDetailView(props: {
  id: number;
  onBack: () => void;
  onEdit: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["adminEmailCampaign", props.id],
    queryFn: () => api<CampaignDetail>(`/api/admin/email-campaigns/${props.id}`),
    refetchInterval: (q) => {
      const status = q.state.data?.campaign.status;
      return status === "sending" ? 3000 : false;
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useMutation({
    mutationFn: () =>
      api(`/api/admin/email-campaigns/${props.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminEmailCampaigns"] });
      toast({ title: "Campaign deleted" });
      props.onBack();
    },
    onError: (err) =>
      toast({
        title: "Couldn't delete",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-12 text-center text-muted-foreground/70">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  const { campaign, recipients, stats } = data;
  const denom = campaign.totalSent || campaign.totalRecipients || recipients.length;
  const openRate = denom > 0 ? (stats.uniqueOpens / denom) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={props.onBack} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-foreground truncate">
                {campaign.subject}
              </h2>
              <Badge variant="outline" className={STATUS_STYLES[campaign.status]}>
                {campaign.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {AUDIENCE_LABELS[campaign.audience]} ·{" "}
              {campaign.sentAt
                ? `sent ${format(new Date(campaign.sentAt), "PPp")}`
                : `created ${format(new Date(campaign.createdAt), "PPp")}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "draft" && (
            <Button
              variant="outline"
              onClick={() => props.onEdit(campaign.id)}
              className="gap-1.5"
            >
              <Pencil className="w-4 h-4" /> Edit
            </Button>
          )}
          {campaign.status !== "sending" && (
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(true)}
              className="gap-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {campaign.sendError && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-200 rounded-xl p-4 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <div>
            <strong>Send error:</strong> {campaign.sendError}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard
          label="Recipients"
          value={campaign.totalRecipients || recipients.length}
          icon={<Users className="w-5 h-5" />}
          tone="indigo"
        />
        <StatCard
          label="Delivered"
          value={campaign.totalSent}
          sub={
            campaign.totalFailed > 0
              ? `${campaign.totalFailed} failed`
              : undefined
          }
          icon={<CheckCircle2 className="w-5 h-5" />}
          tone="emerald"
        />
        <StatCard
          label="Unique opens"
          value={stats.uniqueOpens}
          icon={<Eye className="w-5 h-5" />}
          tone="purple"
        />
        <StatCard
          label="Open rate"
          value={`${openRate.toFixed(0)}%`}
          sub={`${stats.totalOpens} total opens`}
          icon={<Sparkles className="w-5 h-5" />}
          tone="pink"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Monitor className="w-4 h-4" /> Email preview
            </div>
            {campaign.preheader && (
              <div className="text-xs text-muted-foreground truncate max-w-[60%]">
                {campaign.preheader}
              </div>
            )}
          </div>
          <div className="bg-muted p-4">
            <iframe
              title="Sent email"
              srcDoc={campaign.htmlBody}
              className="w-full h-[560px] bg-card rounded-lg border border-border shadow-sm"
              sandbox=""
            />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground">
            Top opens
          </div>
          <div className="max-h-[600px] overflow-auto">
            {recipients.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground/70">
                No recipients yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Opens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.slice(0, 50).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">
                        <div className="font-medium text-foreground truncate max-w-[200px]">
                          {r.email}
                        </div>
                        <div className="text-xs text-muted-foreground/70">
                          {r.openedAt
                            ? `opened ${formatDistanceToNow(new Date(r.openedAt), { addSuffix: true })}`
                            : r.sendError
                              ? <span className="text-red-500">failed: {r.sendError}</span>
                              : r.sentAt
                                ? "delivered, not opened"
                                : "queued"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.openCount > 0 ? (
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                            {r.openCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              The campaign and all its open-tracking data will be permanently removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                setConfirmDelete(false);
                del.mutate();
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

function StatCard(props: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  tone: "indigo" | "emerald" | "purple" | "pink";
}) {
  const tones = {
    indigo: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400",
    emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
    purple: "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400",
    pink: "bg-pink-50 dark:bg-pink-950/40 text-pink-600 dark:text-pink-400",
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {props.label}
        </div>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tones[props.tone]}`}>
          {props.icon}
        </div>
      </div>
      <div className="text-3xl font-extrabold text-foreground tabular-nums">
        {props.value}
      </div>
      {props.sub && (
        <div className="text-xs text-muted-foreground mt-1">{props.sub}</div>
      )}
    </div>
  );
}
