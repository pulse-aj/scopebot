import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2,
  Users,
  Loader2,
  Search,
  Plus,
  Globe,
  Mail,
  Phone,
  Star,
  Trash2,
  Pencil,
  Upload,
  Download,
  FileText,
  ExternalLink,
  Ticket,
  Receipt,
  Phone as PhoneCall,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

// --- Types -----------------------------------------------------------------

type CompanyStatus = "prospect" | "active" | "churned";
type BillingKind = "subscription" | "usage" | "contract";
type BillingFrequency = "monthly" | "quarterly" | "annual" | "one_time";

interface CompanyListItem {
  id: number;
  name: string;
  domain: string | null;
  website: string | null;
  status: CompanyStatus;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  contactCount: number;
  contractCount: number;
  billingCount: number;
  ticketCount: number;
  openTicketCount: number;
}

interface CompanyListPayload {
  companies: CompanyListItem[];
  stats: {
    total: number;
    active: number;
    prospects: number;
    openTickets: number;
  };
}

interface Contact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string | null;
}

interface CallNote {
  id: number;
  contactId: number | null;
  subject: string | null;
  body: string;
  occurredAt: string | null;
  createdAt: string | null;
}

interface Contract {
  id: number;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string | null;
}

interface Billing {
  id: number;
  kind: BillingKind;
  label: string;
  currency: string;
  amount: string | null;
  frequency: BillingFrequency | null;
  unitLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  isActive: boolean;
}

interface Ticket {
  id: number;
  title: string;
  status: string;
  priority: string;
  summary: string;
  userEmail: string;
  userName: string | null;
  createdAt: string | null;
}

interface CompanyDetailPayload {
  company: CompanyListItem;
  contacts: Contact[];
  callNotes: CallNote[];
  contracts: Contract[];
  billing: Billing[];
  tickets: Ticket[];
}

// --- Fetch helpers ---------------------------------------------------------

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

async function mutate<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

// --- Constants -------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  prospect:
    "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
  active:
    "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60",
  churned:
    "bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/60",
};

const TICKET_STATUS_STYLES: Record<string, string> = {
  requested: "bg-muted text-foreground/85 border-border",
  planned:
    "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60",
  in_progress:
    "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60",
  deployed:
    "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60",
};

const BILLING_KIND_LABELS: Record<BillingKind, string> = {
  subscription: "Subscription",
  usage: "Usage-based",
  contract: "Contract value",
};

const FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  annual: "/yr",
  one_time: " one-time",
};

const MAX_CONTRACT_BYTES = 7 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(amount: string | null, currency: string): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

// --- Main panel ------------------------------------------------------------

export default function CrmPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["crmCompanies"],
    queryFn: () => api<CompanyListPayload>("/api/admin/crm/companies"),
  });

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [] as CompanyListItem[];
    const q = search.trim().toLowerCase();
    if (!q) return data.companies;
    return data.companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.domain ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  if (isLoading || !data) {
    return (
      <div className="p-12 text-center text-muted-foreground/70">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />{" "}
            CRM
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage accounts, contacts, call notes, contracts, and billing.
            Tickets link automatically from feature requests by email domain.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> New company
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Companies"
          value={data.stats.total}
          icon={<Building2 className="w-5 h-5" />}
          tone="indigo"
        />
        <StatCard
          label="Active"
          value={data.stats.active}
          icon={<Users className="w-5 h-5" />}
          tone="emerald"
        />
        <StatCard
          label="Prospects"
          value={data.stats.prospects}
          icon={<Star className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Open tickets"
          value={data.stats.openTickets}
          icon={<Ticket className="w-5 h-5" />}
          tone="purple"
        />
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or domain…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No companies match your search."
              : "No companies yet. Create your first one."}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden divide-y divide-border/60">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center flex-shrink-0 font-bold uppercase">
                {c.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground flex items-center gap-2">
                  {c.name}
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[c.status] || ""}
                  >
                    {c.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
                  {c.domain ? (
                    <>
                      <Globe className="w-3 h-3" /> {c.domain}
                    </>
                  ) : (
                    <span className="italic text-muted-foreground/70">
                      No domain
                    </span>
                  )}
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground/80 flex-shrink-0">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> {c.contactCount}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> {c.contractCount}
                </span>
                <span className="flex items-center gap-1">
                  <Receipt className="w-3.5 h-3.5" /> {c.billingCount}
                </span>
              </div>
              <Badge
                variant="outline"
                className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60 flex-shrink-0"
              >
                {c.openTicketCount} open
              </Badge>
            </button>
          ))}
        </div>
      )}

      <CreateCompanyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setSelectedId(id);
        }}
      />

      <CompanySheet
        companyId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// --- Create company dialog -------------------------------------------------

function CreateCompanyDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<CompanyStatus>("active");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setName("");
    setDomain("");
    setWebsite("");
    setStatus("active");
    setNotes("");
  };

  const createMut = useMutation({
    mutationFn: () =>
      mutate<CompanyListItem>("/api/admin/crm/companies", "POST", {
        name,
        domain: domain || undefined,
        website: website || undefined,
        status,
        notes: notes || undefined,
      }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["crmCompanies"] });
      toast({ title: "Company created" });
      reset();
      props.onCreated(c.id);
    },
    onError: (e: Error) =>
      toast({ title: "Could not create company", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          props.onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            Add an account to the CRM. Set a domain to auto-link feature-request
            tickets.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-name">Name *</Label>
            <Input
              id="cmp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-domain">Email domain</Label>
              <Input
                id="cmp-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as CompanyStatus)}
              >
                <SelectTrigger id="cmp-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-website">Website</Label>
            <Input
              id="cmp-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acme.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-notes">Notes</Label>
            <Textarea
              id="cmp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || createMut.isPending}
          >
            {createMut.isPending && (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Company detail sheet --------------------------------------------------

function CompanySheet(props: { companyId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const id = props.companyId;

  const { data, isLoading } = useQuery({
    queryKey: ["crmCompany", id],
    queryFn: () => api<CompanyDetailPayload>(`/api/admin/crm/companies/${id}`),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["crmCompany", id] });
    queryClient.invalidateQueries({ queryKey: ["crmCompanies"] });
  };

  const deleteCompany = useMutation({
    mutationFn: () =>
      mutate<{ ok: true }>(`/api/admin/crm/companies/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crmCompanies"] });
      toast({ title: "Company deleted" });
      props.onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: (status: CompanyStatus) =>
      mutate<CompanyListItem>(`/api/admin/crm/companies/${id}`, "PATCH", {
        status,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Status updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet
      open={!!id}
      onOpenChange={(o) => !o && props.onClose()}
    >
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        {isLoading || !data ? (
          <div className="p-12 text-center text-muted-foreground/70">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center font-bold text-lg uppercase">
                  {data.company.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="text-lg truncate">{data.company.name}</div>
                  <div className="text-xs text-muted-foreground font-normal truncate flex items-center gap-1.5">
                    {data.company.domain ? (
                      <>
                        <Globe className="w-3 h-3" /> {data.company.domain}
                      </>
                    ) : (
                      <span className="italic">No domain</span>
                    )}
                  </div>
                </div>
              </SheetTitle>
              <SheetDescription className="flex items-center flex-wrap gap-2 pt-1">
                <Select
                  value={data.company.status}
                  onValueChange={(v) =>
                    updateStatus.mutate(v as CompanyStatus)
                  }
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
                {data.company.website && (
                  <a
                    href={data.company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 text-xs"
                  >
                    Website <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 ml-auto gap-1"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete ${data.company.name}? This removes all its contacts, notes, contracts, and billing.`,
                      )
                    )
                      deleteCompany.mutate();
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-8">
              {data.company.notes && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-xl p-4">
                  {data.company.notes}
                </p>
              )}

              <BillingSection
                companyId={data.company.id}
                billing={data.billing}
                onChange={invalidate}
              />

              <ContactsSection
                companyId={data.company.id}
                contacts={data.contacts}
                onChange={invalidate}
              />

              <CallNotesSection
                companyId={data.company.id}
                contacts={data.contacts}
                notes={data.callNotes}
                onChange={invalidate}
              />

              <ContractsSection
                companyId={data.company.id}
                contracts={data.contracts}
                onChange={invalidate}
              />

              <TicketsSection
                tickets={data.tickets}
                onOpen={(tid) => {
                  setLocation(`/requests/${tid}`);
                  props.onClose();
                }}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// --- Section primitives ----------------------------------------------------

function SectionHeader(props: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        {props.icon}
        {props.title}
        {props.count != null && (
          <span className="text-muted-foreground/70 font-normal">
            ({props.count})
          </span>
        )}
      </h3>
      {props.action}
    </div>
  );
}

// --- Billing ---------------------------------------------------------------

function BillingSection(props: {
  companyId: number;
  billing: Billing[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Billing | null>(null);
  const [adding, setAdding] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (bid: number) =>
      mutate<{ ok: true }>(`/api/admin/crm/billing/${bid}`, "DELETE"),
    onSuccess: () => {
      props.onChange();
      toast({ title: "Billing item removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  return (
    <section>
      <SectionHeader
        icon={<Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
        title="Billing"
        count={props.billing.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        }
      />
      {props.billing.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-2">
          No billing items. Add a subscription, usage rate, or contract value.
        </p>
      ) : (
        <div className="space-y-2">
          {props.billing.map((b) => (
            <div
              key={b.id}
              className="border border-border rounded-xl p-3.5 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{b.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {BILLING_KIND_LABELS[b.kind]}
                  </Badge>
                  {!b.isActive && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-muted text-muted-foreground"
                    >
                      inactive
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-foreground mt-1 font-semibold tabular-nums">
                  {formatMoney(b.amount, b.currency)}
                  {b.kind === "usage" && b.unitLabel ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      per {b.unitLabel}
                    </span>
                  ) : b.frequency ? (
                    <span className="font-normal text-muted-foreground">
                      {FREQUENCY_LABELS[b.frequency]}
                    </span>
                  ) : null}
                </div>
                {(b.startDate || b.endDate) && (
                  <div className="text-xs text-muted-foreground/70 mt-0.5">
                    {b.startDate
                      ? format(new Date(b.startDate), "PP")
                      : "—"}{" "}
                    →{" "}
                    {b.endDate ? format(new Date(b.endDate), "PP") : "ongoing"}
                  </div>
                )}
                {b.notes && (
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                    {b.notes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditing(b)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-rose-600 dark:text-rose-400"
                  onClick={() => {
                    if (confirm(`Remove "${b.label}"?`)) deleteMut.mutate(b.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <BillingDialog
          companyId={props.companyId}
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            props.onChange();
          }}
        />
      )}
    </section>
  );
}

function BillingDialog(props: {
  companyId: number;
  existing: Billing | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const e = props.existing;
  const [kind, setKind] = useState<BillingKind>(e?.kind ?? "subscription");
  const [label, setLabel] = useState(e?.label ?? "");
  const [currency, setCurrency] = useState(e?.currency ?? "USD");
  const [amount, setAmount] = useState(e?.amount ?? "");
  const [frequency, setFrequency] = useState<BillingFrequency | "">(
    e?.frequency ?? "monthly",
  );
  const [unitLabel, setUnitLabel] = useState(e?.unitLabel ?? "");
  const [startDate, setStartDate] = useState(
    e?.startDate ? e.startDate.slice(0, 10) : "",
  );
  const [endDate, setEndDate] = useState(
    e?.endDate ? e.endDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [isActive, setIsActive] = useState(e?.isActive ?? true);

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        kind,
        label,
        currency,
        amount: amount === "" ? null : amount,
        frequency: kind === "usage" ? null : frequency || null,
        unitLabel: kind === "usage" ? unitLabel || null : null,
        startDate: startDate || null,
        endDate: endDate || null,
        notes: notes || null,
        isActive,
      };
      return props.existing
        ? mutate<Billing>(
            `/api/admin/crm/billing/${props.existing.id}`,
            "PATCH",
            payload,
          )
        : mutate<Billing>(
            `/api/admin/crm/companies/${props.companyId}/billing`,
            "POST",
            payload,
          );
    },
    onSuccess: () => {
      toast({ title: props.existing ? "Billing updated" : "Billing added" });
      props.onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.existing ? "Edit billing item" : "Add billing item"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as BillingKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscription">Subscription</SelectItem>
                  <SelectItem value="usage">Usage-based</SelectItem>
                  <SelectItem value="contract">Contract value</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Active</Label>
              <Select
                value={isActive ? "yes" : "no"}
                onValueChange={(v) => setIsActive(v === "yes")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Active</SelectItem>
                  <SelectItem value="no">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-label">Label *</Label>
            <Input
              id="b-label"
              value={label}
              onChange={(ev) => setLabel(ev.target.value)}
              placeholder={
                kind === "usage"
                  ? "API calls"
                  : kind === "contract"
                    ? "Annual contract"
                    : "Pro plan"
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-currency">Currency</Label>
              <Input
                id="b-currency"
                value={currency}
                onChange={(ev) => setCurrency(ev.target.value)}
                placeholder="USD"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="b-amount">Amount</Label>
              <Input
                id="b-amount"
                type="number"
                min="0"
                step="0.0001"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          {kind === "usage" ? (
            <div className="space-y-1.5">
              <Label htmlFor="b-unit">Per unit</Label>
              <Input
                id="b-unit"
                value={unitLabel}
                onChange={(ev) => setUnitLabel(ev.target.value)}
                placeholder="1,000 requests"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select
                value={frequency || "monthly"}
                onValueChange={(v) => setFrequency(v as BillingFrequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="one_time">One-time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-start">Start date</Label>
              <Input
                id="b-start"
                type="date"
                value={startDate}
                onChange={(ev) => setStartDate(ev.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-end">End date</Label>
              <Input
                id="b-end"
                type="date"
                value={endDate}
                onChange={(ev) => setEndDate(ev.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-notes">Notes</Label>
            <Textarea
              id="b-notes"
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!label.trim() || saveMut.isPending}
          >
            {saveMut.isPending && (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Contacts --------------------------------------------------------------

function ContactsSection(props: {
  companyId: number;
  contacts: Contact[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (cid: number) =>
      mutate<{ ok: true }>(`/api/admin/crm/contacts/${cid}`, "DELETE"),
    onSuccess: () => {
      props.onChange();
      toast({ title: "Contact removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  return (
    <section>
      <SectionHeader
        icon={<Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
        title="Contacts"
        count={props.contacts.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        }
      />
      {props.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-2">No contacts yet.</p>
      ) : (
        <div className="space-y-2">
          {props.contacts.map((c) => (
            <div
              key={c.id}
              className="border border-border rounded-xl p-3.5 flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-semibold text-sm flex-shrink-0">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground flex items-center gap-2">
                  {c.name}
                  {c.isPrimary && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60 gap-1"
                    >
                      <Star className="w-3 h-3" /> Primary
                    </Badge>
                  )}
                </div>
                {c.title && (
                  <div className="text-xs text-muted-foreground">{c.title}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1 flex flex-col gap-0.5">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="flex items-center gap-1.5 hover:text-foreground"
                    >
                      <Mail className="w-3 h-3" /> {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3 h-3" /> {c.phone}
                    </span>
                  )}
                </div>
                {c.notes && (
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                    {c.notes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditing(c)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-rose-600 dark:text-rose-400"
                  onClick={() => {
                    if (confirm(`Remove ${c.name}?`)) deleteMut.mutate(c.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <ContactDialog
          companyId={props.companyId}
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            props.onChange();
          }}
        />
      )}
    </section>
  );
}

function ContactDialog(props: {
  companyId: number;
  existing: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const e = props.existing;
  const [name, setName] = useState(e?.name ?? "");
  const [email, setEmail] = useState(e?.email ?? "");
  const [phone, setPhone] = useState(e?.phone ?? "");
  const [title, setTitle] = useState(e?.title ?? "");
  const [isPrimary, setIsPrimary] = useState(e?.isPrimary ?? false);
  const [notes, setNotes] = useState(e?.notes ?? "");

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        email: email || null,
        phone: phone || null,
        title: title || null,
        isPrimary,
        notes: notes || null,
      };
      return props.existing
        ? mutate<Contact>(
            `/api/admin/crm/contacts/${props.existing.id}`,
            "PATCH",
            payload,
          )
        : mutate<Contact>(
            `/api/admin/crm/companies/${props.companyId}/contacts`,
            "POST",
            payload,
          );
    },
    onSuccess: () => {
      toast({ title: props.existing ? "Contact updated" : "Contact added" });
      props.onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.existing ? "Edit contact" : "Add contact"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name *</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input
                id="c-phone"
                value={phone}
                onChange={(ev) => setPhone(ev.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-title">Title</Label>
            <Input
              id="c-title"
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder="VP of Engineering"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(ev) => setIsPrimary(ev.target.checked)}
              className="rounded border-border"
            />
            Primary contact
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Notes</Label>
            <Textarea
              id="c-notes"
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || saveMut.isPending}
          >
            {saveMut.isPending && (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Call notes ------------------------------------------------------------

function CallNotesSection(props: {
  companyId: number;
  contacts: Contact[];
  notes: CallNote[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (nid: number) =>
      mutate<{ ok: true }>(`/api/admin/crm/call-notes/${nid}`, "DELETE"),
    onSuccess: () => {
      props.onChange();
      toast({ title: "Note removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const contactName = (cid: number | null) =>
    cid == null ? null : props.contacts.find((c) => c.id === cid)?.name ?? null;

  return (
    <section>
      <SectionHeader
        icon={<PhoneCall className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
        title="Call notes"
        count={props.notes.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        }
      />
      {props.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-2">
          No call notes logged.
        </p>
      ) : (
        <div className="space-y-2">
          {props.notes.map((n) => (
            <div key={n.id} className="border border-border rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {n.subject && (
                    <div className="font-medium text-foreground">
                      {n.subject}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground/70">
                    {n.occurredAt
                      ? format(new Date(n.occurredAt), "PPp")
                      : ""}
                    {contactName(n.contactId)
                      ? ` · ${contactName(n.contactId)}`
                      : ""}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-rose-600 dark:text-rose-400 flex-shrink-0"
                  onClick={() => {
                    if (confirm("Remove this note?")) deleteMut.mutate(n.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-sm text-foreground/90 mt-2 whitespace-pre-wrap">
                {n.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <CallNoteDialog
          companyId={props.companyId}
          contacts={props.contacts}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            props.onChange();
          }}
        />
      )}
    </section>
  );
}

function CallNoteDialog(props: {
  companyId: number;
  contacts: Contact[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contactId, setContactId] = useState<string>("none");
  const [occurredAt, setOccurredAt] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );

  const saveMut = useMutation({
    mutationFn: () =>
      mutate<CallNote>(
        `/api/admin/crm/companies/${props.companyId}/call-notes`,
        "POST",
        {
          subject: subject || null,
          body,
          contactId: contactId === "none" ? null : Number(contactId),
          occurredAt: occurredAt
            ? new Date(occurredAt).toISOString()
            : undefined,
        },
      ),
    onSuccess: () => {
      toast({ title: "Note logged" });
      props.onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a call note</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="n-when">When</Label>
              <Input
                id="n-when"
                type="datetime-local"
                value={occurredAt}
                onChange={(ev) => setOccurredAt(ev.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {props.contacts.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-subject">Subject</Label>
            <Input
              id="n-subject"
              value={subject}
              onChange={(ev) => setSubject(ev.target.value)}
              placeholder="Quarterly check-in"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-body">Note *</Label>
            <Textarea
              id="n-body"
              value={body}
              onChange={(ev) => setBody(ev.target.value)}
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!body.trim() || saveMut.isPending}
          >
            {saveMut.isPending && (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Contracts -------------------------------------------------------------

function ContractsSection(props: {
  companyId: number;
  contracts: Contract[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (cid: number) =>
      mutate<{ ok: true }>(`/api/admin/crm/contracts/${cid}`, "DELETE"),
    onSuccess: () => {
      props.onChange();
      toast({ title: "Contract removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    if (file.size > MAX_CONTRACT_BYTES) {
      toast({
        title: "File too large",
        description: "Contracts must be 7 MB or smaller.",
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result as string;
          const comma = r.indexOf(",");
          resolve(comma >= 0 ? r.slice(comma + 1) : r);
        };
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      await mutate(
        `/api/admin/crm/companies/${props.companyId}/contracts`,
        "POST",
        {
          title: file.name,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64,
        },
      );
      toast({ title: "Contract uploaded" });
      props.onChange();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section>
      <SectionHeader
        icon={<FileText className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
        title="Contracts"
        count={props.contracts.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}{" "}
            Upload
          </Button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      {props.contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-2">
          No contracts uploaded (max 7 MB each).
        </p>
      ) : (
        <div className="space-y-2">
          {props.contracts.map((c) => (
            <div
              key={c.id}
              className="border border-border rounded-xl p-3.5 flex items-center gap-3"
            >
              <FileText className="w-5 h-5 text-muted-foreground/70 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {c.title}
                </div>
                <div className="text-xs text-muted-foreground/70">
                  {formatBytes(c.sizeBytes)}
                  {c.createdAt
                    ? ` · ${formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}`
                    : ""}
                </div>
              </div>
              <a
                href={`/api/admin/crm/contracts/${c.id}/download`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex"
              >
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </a>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-rose-600 dark:text-rose-400"
                onClick={() => {
                  if (confirm(`Remove "${c.title}"?`)) deleteMut.mutate(c.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Tickets ---------------------------------------------------------------

function TicketsSection(props: {
  tickets: Ticket[];
  onOpen: (id: number) => void;
}) {
  return (
    <section>
      <SectionHeader
        icon={<Ticket className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
        title="Tickets"
        count={props.tickets.length}
      />
      {props.tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 py-2">
          No linked feature requests. Tickets are matched by contact email and
          the company's email domain.
        </p>
      ) : (
        <div className="space-y-2">
          {props.tickets.map((t) => (
            <div
              key={t.id}
              className="border border-border rounded-xl p-3.5 hover:border-indigo-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="font-medium text-foreground leading-snug">
                  {t.title}
                </div>
                <Badge
                  variant="outline"
                  className={TICKET_STATUS_STYLES[t.status] || ""}
                >
                  {t.status.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                {t.summary}
              </p>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground/70">
                <span className="truncate">
                  {t.userName || t.userEmail}
                  {t.createdAt
                    ? ` · ${formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}`
                    : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-indigo-600 dark:text-indigo-400 gap-1 h-7"
                  onClick={() => props.onOpen(t.id)}
                >
                  Open <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Stat card -------------------------------------------------------------

function StatCard(props: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: "indigo" | "purple" | "emerald" | "amber";
}) {
  const tones = {
    indigo:
      "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400",
    purple:
      "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400",
    emerald:
      "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
    amber:
      "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {props.label}
        </div>
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center ${tones[props.tone]}`}
        >
          {props.icon}
        </div>
      </div>
      <div className="text-3xl font-extrabold text-foreground tabular-nums">
        {props.value}
      </div>
    </div>
  );
}
