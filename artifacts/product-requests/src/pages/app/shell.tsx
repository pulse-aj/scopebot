import { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  MessageSquare,
  Kanban,
  ShieldCheck,
  LogOut,
  Loader2,
  Menu,
  X,
  Sparkles,
  Wrench,
  Building2,
  Contact,
  Mail,
  Users,
  GitMerge,
  ListChecks,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";

interface AppShellProps {
  children: ReactNode;
}

const ADMIN_TABS = [
  { id: "requests", label: "Requests", Icon: Kanban },
  { id: "ai-priorities", label: "AI Priorities", Icon: Sparkles },
  { id: "engineering-space", label: "Engineering", Icon: Wrench },
  { id: "customers", label: "Customers", Icon: Building2 },
  { id: "crm", label: "CRM", Icon: Contact },
  { id: "duplicates", label: "Duplicates", Icon: GitMerge },
  { id: "email", label: "Mail", Icon: Mail },
  { id: "team", label: "Team", Icon: Users },
] as const;

function getAdminTab(search: string): string {
  const tab = new URLSearchParams(search).get("tab");
  return tab && ADMIN_TABS.some((t) => t.id === tab) ? tab : "requests";
}

export default function AppShell({ children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { me, isLoading, signOut } = useAuth();
  const handleSignOut = async () => {
    await signOut();
    setLocation("/sign-in");
  };
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isAdminRoute = location.startsWith("/admin");
  const activeAdminTab = isAdminRoute ? getAdminTab(search) : null;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const navLinkClass = (active: boolean, mobile = false) => {
    const base = mobile
      ? "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium"
      : "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors";
    return `${base} ${
      active
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;
  };

  const adminLinkClass = (tabId: string, mobile = false) =>
    navLinkClass(activeAdminTab === tabId, mobile);

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] overflow-hidden bg-background text-foreground">
      {/* Mobile top bar */}
      <div className="md:hidden h-14 flex items-center justify-between px-4 border-b border-border bg-card flex-shrink-0 z-20">
        <Link href="/app" className="flex items-center gap-2">
          <img
            src={`${basePath}/logo-horizontal.svg`}
            alt="ScopeBot"
            className="h-6 w-auto dark:brightness-0 dark:invert dark:opacity-90"
          />
          <span className="text-sm font-semibold text-muted-foreground tracking-tight border-l border-border pl-2">PM</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMobileNavOpen((o) => !o)}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-foreground/40"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="absolute top-14 left-0 right-0 bg-card border-b border-border shadow-lg p-4 space-y-1 max-h-[calc(100dvh-3.5rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              href="/app"
              onClick={() => setMobileNavOpen(false)}
              className={navLinkClass(
                location === "/app" || location.startsWith("/app/conversations"),
                true,
              )}
            >
              <MessageSquare className="w-4 h-4" /> Conversations
            </Link>
            <Link
              href="/requests"
              onClick={() => setMobileNavOpen(false)}
              className={navLinkClass(location.startsWith("/requests"), true)}
            >
              <Kanban className="w-4 h-4" /> My Requests
            </Link>
            {(me?.isAdmin || me?.isEngineer) && (
              <div className="pt-3 mt-3 border-t border-border">
                <div className="px-3 pb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin
                </div>
                <Link
                  href="/tasks"
                  onClick={() => setMobileNavOpen(false)}
                  className={navLinkClass(location.startsWith("/tasks"), true)}
                >
                  <ListChecks className="w-4 h-4" /> Tasks
                </Link>
                {me?.isAdmin &&
                  ADMIN_TABS.map(({ id, label, Icon }) => (
                    <Link
                      key={id}
                      href={`/admin?tab=${id}`}
                      onClick={() => setMobileNavOpen(false)}
                      className={adminLinkClass(id, true)}
                    >
                      <Icon className="w-4 h-4" /> {label}
                    </Link>
                  ))}
              </div>
            )}

            <button
              onClick={() => { setMobileNavOpen(false); void handleSignOut(); }}
              className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground mt-3 pt-3 border-t border-border"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      )}

      {/* Sidebar (desktop) */}
      <aside className="w-64 border-r border-border bg-muted/40 flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/app" className="flex items-center gap-2">
            <img
              src={`${basePath}/logo-horizontal.svg`}
              alt="ScopeBot"
              className="h-7 w-auto dark:brightness-0 dark:invert dark:opacity-90"
            />
            <span className="text-base font-semibold text-muted-foreground tracking-tight border-l border-border pl-2">PM</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          <Link
            href="/app"
            className={navLinkClass(
              location === "/app" || location.startsWith("/app/conversations"),
            )}
          >
            <MessageSquare className="w-4 h-4" />
            Conversations
          </Link>
          <Link
            href="/requests"
            className={navLinkClass(location.startsWith("/requests"))}
          >
            <Kanban className="w-4 h-4" />
            My Requests
          </Link>
          {(me?.isAdmin || me?.isEngineer) && (
            <div className="pt-6 mt-2">
              <div className="px-3 pb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" /> Admin
              </div>
              <div className="space-y-0.5">
                <Link
                  href="/tasks"
                  className={navLinkClass(location.startsWith("/tasks"))}
                >
                  <ListChecks className="w-4 h-4" />
                  Tasks
                </Link>
                {me?.isAdmin &&
                  ADMIN_TABS.map(({ id, label, Icon }) => (
                    <Link
                      key={id}
                      href={`/admin?tab=${id}`}
                      className={adminLinkClass(id)}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4 px-2">
            <Avatar className="w-8 h-8 bg-accent text-accent-foreground">
              <AvatarFallback>{me?.name?.charAt(0)?.toUpperCase() || me?.email.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col truncate flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">{me?.name || me?.email}</span>
              {me?.isAdmin && <span className="text-xs text-primary font-medium">Admin</span>}
            </div>
            <ThemeToggle />
          </div>
          <button
            onClick={() => void handleSignOut()}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
