import { useState } from "react";
import {
  useListTeamMembers,
  getListTeamMembersQueryKey,
  useAddTeamMember,
  useRemoveTeamMember,
  getAdminListUsersQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { TeamMember, TeamRole } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Loader2, Plus, Trash2, ShieldCheck, Wrench, Mail } from "lucide-react";

const ROLE_META: Record<
  TeamRole,
  { label: string; icon: typeof ShieldCheck; tint: string; description: string }
> = {
  admin: {
    label: "Admins",
    icon: ShieldCheck,
    tint: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60",
    description:
      "Full access — every feature request, the admin dashboard, engineering tasks, and team settings.",
  },
  engineer: {
    label: "Engineering team",
    icon: Wrench,
    tint: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60",
    description:
      "Show up in the engineering-task assignee picker. No admin dashboard access.",
  },
};

export function TeamSettingsPanel() {
  const { data: members, isLoading } = useListTeamMembers();
  const groupedAdmins = (members ?? []).filter((m) => m.role === "admin");
  const groupedEngineers = (members ?? []).filter((m) => m.role === "engineer");

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Mail className="w-5 h-5 text-foreground/85" /> Team Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who is treated as an admin or an engineer. Roles are matched
            by email and take effect on the teammate's next request.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/70" />
        </div>
      ) : (
        <>
          <RoleSection role="admin" members={groupedAdmins} />
          <RoleSection role="engineer" members={groupedEngineers} />
        </>
      )}
    </div>
  );
}

function RoleSection({
  role,
  members,
}: {
  role: TeamRole;
  members: TeamMember[];
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const addMut = useAddTeamMember();
  const removeMut = useRemoveTeamMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
    // Role changes affect the engineering-task assignee picker and the
    // current user's own admin/engineer flags — refresh both.
    queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    addMut.mutate(
      { data: { email: trimmed, role, note: note.trim() || null } },
      {
        onSuccess: () => {
          setEmail("");
          setNote("");
          invalidate();
          toast({ title: `Added ${trimmed} as ${meta.label.slice(0, -1)}` });
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { error?: string } } };
          toast({
            title: e.response?.data?.error ?? "Could not add teammate",
            variant: "destructive",
          });
        },
      },
    );
  };

  const remove = (m: TeamMember) => {
    if (
      !confirm(
        `Remove ${m.email} as ${meta.label.slice(0, -1).toLowerCase()}?`,
      )
    )
      return;
    removeMut.mutate(
      { id: m.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `Removed ${m.email}` });
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { error?: string } } };
          toast({
            title: e.response?.data?.error ?? "Could not remove",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center ${meta.tint}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-foreground flex items-center gap-2">
            {meta.label}
            <Badge variant="outline" className="text-[10px]">
              {members.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="px-6 py-4 border-b border-border bg-muted/50 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3"
      >
        <Input
          type="email"
          required
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-card"
        />
        <Input
          placeholder="Note (optional, e.g. team or role)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="bg-card"
        />
        <Button
          type="submit"
          disabled={!email.trim() || addMut.isPending}
          className="bg-foreground hover:bg-foreground/90 text-white gap-1.5"
        >
          {addMut.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Plus className="w-4 h-4" /> Add
            </>
          )}
        </Button>
      </form>

      {members.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground italic">
          Nobody assigned yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {members.map((m) => (
            <li
              key={m.id}
              className="px-6 py-3 flex items-center gap-4 hover:bg-muted/40"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {m.email}
                </div>
                {m.note && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {m.note}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                  Added{" "}
                  {format(new Date(m.createdAt), "MMM d, yyyy")}
                  {m.addedByName || m.addedByEmail
                    ? ` by ${m.addedByName ?? m.addedByEmail}`
                    : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(m)}
                disabled={removeMut.isPending}
                className="text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-50 dark:bg-red-950/40 gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
