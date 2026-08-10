import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2,
  User as UserIcon,
  Loader2,
  ChevronDown,
  ChevronRight,
  Search,
  Mail,
  ExternalLink,
  Users,
  Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { format, formatDistanceToNow } from "date-fns";

interface CustomerUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  requestCount: number;
  lastRequestAt: string | null;
}

interface CustomerGroup {
  domain: string;
  users: CustomerUser[];
  userCount: number;
  requestCount: number;
  lastRequestAt: string | null;
}

interface CustomerListPayload {
  groups: CustomerGroup[];
  individuals: CustomerUser[];
  stats: {
    totalCustomers: number;
    totalOrganizations: number;
    totalIndividuals: number;
  };
}

interface CustomerRequest {
  id: number;
  title: string;
  status: string;
  priority: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

interface CustomerRequestsPayload {
  user: { id: string; email: string; name: string | null; createdAt: string };
  requests: CustomerRequest[];
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-muted text-foreground/85 border-border",
  planned: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60",
  in_progress: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900/60",
  deployed: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60",
};

export default function CustomersPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminCustomers"],
    queryFn: () => api<CustomerListPayload>("/api/admin/customers"),
  });

  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return { groups: [] as CustomerGroup[], individuals: [] as CustomerUser[] };
    const q = search.trim().toLowerCase();
    if (!q) return { groups: data.groups, individuals: data.individuals };
    const matchUser = (u: CustomerUser) =>
      u.email.toLowerCase().includes(q) ||
      (u.name ?? "").toLowerCase().includes(q);
    return {
      groups: data.groups
        .map((g) => ({
          ...g,
          users: g.users.filter(matchUser),
        }))
        .filter((g) => g.users.length > 0 || g.domain.toLowerCase().includes(q)),
      individuals: data.individuals.filter(matchUser),
    };
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Customers
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every signed-up customer, grouped by their company email domain.
            Personal email accounts (Gmail, Yahoo) appear individually.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Customers"
          value={data.stats.totalCustomers}
          icon={<Users className="w-5 h-5" />}
          tone="indigo"
        />
        <StatCard
          label="Organizations"
          value={data.stats.totalOrganizations}
          icon={<Building2 className="w-5 h-5" />}
          tone="purple"
        />
        <StatCard
          label="Individual accounts"
          value={data.stats.totalIndividuals}
          icon={<UserIcon className="w-5 h-5" />}
          tone="emerald"
        />
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or domain…"
          className="pl-9"
        />
      </div>

      {filtered.groups.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Organizations
          </div>
          <div className="space-y-2">
            {filtered.groups.map((g) => {
              const isOpen = openGroups[g.domain] ?? false;
              return (
                <div
                  key={g.domain}
                  className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((p) => ({ ...p, [g.domain]: !isOpen }))
                    }
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                    )}
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center flex-shrink-0 font-bold uppercase">
                      {g.domain.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-muted-foreground/70" />
                        {g.domain}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {g.userCount} {g.userCount === 1 ? "user" : "users"} ·{" "}
                        {g.requestCount} request{g.requestCount === 1 ? "" : "s"}
                        {g.lastRequestAt
                          ? ` · last activity ${formatDistanceToNow(new Date(g.lastRequestAt), { addSuffix: true })}`
                          : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60">
                      {g.requestCount} {g.requestCount === 1 ? "req" : "reqs"}
                    </Badge>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/60 divide-y divide-gray-100">
                      {g.users.map((u) => (
                        <UserRow
                          key={u.id}
                          user={u}
                          onClick={() => setSelectedUserId(u.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filtered.individuals.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Individual accounts
          </div>
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
            {filtered.individuals.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onClick={() => setSelectedUserId(u.id)}
              />
            ))}
          </div>
        </div>
      )}

      {filtered.groups.length === 0 && filtered.individuals.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Users className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {search ? "No customers match your search." : "No customers yet."}
          </p>
        </div>
      )}

      <CustomerSheet
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}

function UserRow(props: { user: CustomerUser; onClick: () => void }) {
  const { user } = props;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-semibold text-sm flex-shrink-0">
        {(user.name || user.email).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground truncate">
          {user.name || <span className="text-muted-foreground/70 italic">No name on file</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Mail className="w-3 h-3" /> {user.email}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold text-foreground tabular-nums">
          {user.requestCount}
        </div>
        <div className="text-xs text-muted-foreground/70">
          {user.requestCount === 1 ? "request" : "requests"}
        </div>
      </div>
      {user.lastRequestAt && (
        <div className="text-xs text-muted-foreground/70 w-32 text-right hidden md:block">
          {formatDistanceToNow(new Date(user.lastRequestAt), { addSuffix: true })}
        </div>
      )}
    </button>
  );
}

function CustomerSheet(props: { userId: string | null; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["adminCustomerRequests", props.userId],
    queryFn: () =>
      api<CustomerRequestsPayload>(
        `/api/admin/customers/${props.userId}/requests`,
      ),
    enabled: !!props.userId,
  });

  return (
    <Sheet open={!!props.userId} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {isLoading || !data ? (
          <div className="p-12 text-center text-muted-foreground/70">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center font-bold">
                  {(data.user.name || data.user.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-lg truncate">
                    {data.user.name || (
                      <span className="text-muted-foreground/70 italic font-normal">
                        No name on file
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-normal truncate">
                    {data.user.email}
                  </div>
                </div>
              </SheetTitle>
              <SheetDescription>
                Joined {format(new Date(data.user.createdAt), "PP")} ·{" "}
                {data.requests.length}{" "}
                {data.requests.length === 1 ? "request" : "requests"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-3">
              {data.requests.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground/70 py-12">
                  This customer hasn't submitted any feature requests yet.
                </div>
              ) : (
                data.requests.map((r) => (
                  <div
                    key={r.id}
                    className="border border-border rounded-xl p-4 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="font-semibold text-foreground leading-snug">
                        {r.title}
                      </div>
                      <Badge
                        variant="outline"
                        className={STATUS_STYLES[r.status] || ""}
                      >
                        {r.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {r.summary}
                    </p>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground/70">
                      <span>
                        {formatDistanceToNow(new Date(r.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 gap-1 h-7"
                        onClick={() => {
                          setLocation(`/requests/${r.id}`);
                          props.onClose();
                        }}
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatCard(props: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: "indigo" | "purple" | "emerald";
}) {
  const tones = {
    indigo: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400",
    purple: "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400",
    emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
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
