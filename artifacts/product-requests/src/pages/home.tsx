import { Link } from "wouter";
import {
  ArrowRight,
  Bot,
  Moon,
  GitPullRequest,
  Sparkles,
  Zap,
  Factory,
  Bug,
  MessageSquare,
  Rocket,
  CircleDot,
  ShieldCheck,
} from "lucide-react";

export default function HomePage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#070710] text-white overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.18),transparent_55%),radial-gradient(circle_at_85%_30%,rgba(168,85,247,0.16),transparent_50%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,0.10),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage:
              "radial-gradient(circle at 50% 30%, black 0%, transparent 80%)",
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex h-20 items-center justify-between px-6 lg:px-12 border-b border-white/5">
        <div className="flex items-center gap-3">
          <img
            src={`${basePath}/logo-horizontal.svg`}
            alt="ScopeBot"
            className="h-8 w-auto brightness-0 invert opacity-90"
          />
          <span className="hidden sm:inline text-xs font-semibold uppercase tracking-[0.18em] text-white/40 border-l border-white/10 pl-3">
            Software Factory
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-semibold text-white px-5 py-2.5 rounded-full border border-white/20 hover:border-white/40 hover:bg-white/[0.06] transition-all"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="group flex items-center gap-1.5 text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-5 py-2.5 rounded-full hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] transition-all"
          >
            Sign Up
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* HERO */}
        <section className="px-6 lg:px-12 max-w-7xl mx-auto pt-16 lg:pt-24 pb-20 lg:pb-28">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-white/70">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
              </span>
              World's first autonomous CPMS · live now
            </div>

            <h1 className="mt-8 text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] max-w-5xl">
              Your CPMS{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  builds itself
                </span>
              </span>{" "}
              now.
            </h1>

            <p className="mt-7 text-lg lg:text-xl text-white/60 max-w-2xl leading-relaxed">
              Every other vendor hands you a roadmap and a waitlist. We
              hand you a software factory. Describe the feature, the bug, the
              integration — our agents scope it, build it, test it, and ship
              it to production. Usually before you wake up.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="group flex items-center gap-2 text-base font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-8 py-4 rounded-full hover:shadow-[0_0_40px_rgba(139,92,246,0.5)] transition-all"
              >
                Sign Up — it's free
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/sign-in"
                className="flex items-center gap-2 text-base font-semibold text-white px-8 py-4 rounded-full border border-white/20 hover:border-white/40 hover:bg-white/[0.06] transition-all"
              >
                Sign In
              </Link>
            </div>
            <p className="mt-4 text-xs text-white/40">
              No credit card · Start chatting with your AI PM in seconds
            </p>

            {/* Factory floor visual */}
            <FactoryFloor />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="px-6 lg:px-12 max-w-7xl mx-auto pb-24 lg:pb-32">
          <div className="text-center mb-14">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
              How it works
            </div>
            <h2 className="mt-3 text-3xl lg:text-5xl font-bold tracking-tight">
              Idea in. Feature out.
            </h2>
            <p className="mt-4 text-white/60 max-w-xl mx-auto">
              No tickets. No standups. No roadmap to beg against. Say what you
              need — the factory takes it from there.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StepCard
              n="01"
              icon={<MessageSquare className="w-5 h-5" />}
              title="You describe it"
              body="Chat with the AI PM. It interrogates the real problem, kills the ambiguity, and turns the conversation into a clean, buildable spec."
              glow="rgba(99,102,241,0.5)"
            />
            <StepCard
              n="02"
              icon={<Bot className="w-5 h-5" />}
              title="Agents build it"
              body="Autonomous engineering agents pick up the spec, write the code, test it, and open a PR. While your team sleeps."
              glow="rgba(168,85,247,0.5)"
            />
            <StepCard
              n="03"
              icon={<Rocket className="w-5 h-5" />}
              title="It ships to you"
              body="Approved changes deploy straight into your live CPMS, with a full timeline of who built what, when."
              glow="rgba(16,185,129,0.5)"
            />
          </div>
        </section>

        {/* TRACKING / DASHBOARD CTA */}
        <section className="px-6 lg:px-12 max-w-7xl mx-auto pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-8 lg:p-12">
            <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-purple-500/20 blur-3xl" />

            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">
                  <CircleDot className="w-3.5 h-3.5" /> Live status
                </div>
                <h3 className="mt-3 text-3xl lg:text-4xl font-bold tracking-tight">
                  Every request. Every bug. <br /> Tracked in one place.
                </h3>
                <p className="mt-4 text-white/60 leading-relaxed">
                  A personal kanban board for every customer. See what's
                  requested, what's planned, what's being built right now, and
                  what just shipped — all updated in real-time as the factory
                  works.
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    "Submit feature requests and bug reports in plain English",
                    "Watch them move from Requested → Planned → In Progress → Deployed",
                    "Get the full engineering timeline for every ticket",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-white/80">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gradient-to-r from-indigo-400 to-purple-400 flex-shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className="mt-8 inline-flex items-center gap-2 text-sm font-semibold bg-white text-gray-900 px-5 py-2.5 rounded-full hover:bg-white/90 transition-all"
                >
                  Open the board <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Mock kanban */}
              <MiniKanban />
            </div>
          </div>
        </section>

        {/* AUTONOMOUS CPMS — Industry first */}
        <section className="px-6 lg:px-12 max-w-7xl mx-auto pb-28">
          <div className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/60 via-purple-950/40 to-[#070710] p-10 lg:p-16 text-center">
            <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.4),transparent_60%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
                <Sparkles className="w-3.5 h-3.5" /> World first
              </div>
              <h2 className="mt-6 text-3xl lg:text-5xl font-bold tracking-tight max-w-4xl mx-auto leading-tight">
                The only{" "}
                <span className="bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
                  agentic CPMS
                </span>{" "}
                on the planet.
              </h2>

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
                <Pillar
                  icon={<Bot className="w-4 h-4" />}
                  title="AI-native"
                  body="Agents that own the full SDLC, not a chatbot bolted onto old software."
                />
                <Pillar
                  icon={<Moon className="w-4 h-4" />}
                  title="Ships while you sleep"
                  body="24/7 throughput. Your roadmap never clocks out."
                />
                <Pillar
                  icon={<Bug className="w-4 h-4" />}
                  title="Bugs fix themselves"
                  body="Report it in plain English. It's patched before you've finished typing the next one."
                />
                <Pillar
                  icon={<ShieldCheck className="w-4 h-4" />}
                  title="Human-reviewed"
                  body="Nothing hits production unreviewed. Autonomous, not reckless."
                />
              </div>

              <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center gap-2 text-base font-semibold bg-white text-gray-900 px-7 py-3.5 rounded-full hover:shadow-[0_0_40px_rgba(255,255,255,0.25)] transition-all"
                >
                  Sign Up free <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center gap-2 text-base font-semibold text-white px-7 py-3.5 rounded-full border border-white/20 hover:border-white/40 hover:bg-white/[0.06] transition-all"
                >
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 py-8 text-center text-white/40 text-sm border-t border-white/5 px-6">
        <p>&copy; {new Date().getFullYear()} ScopeBot</p>
      </footer>
    </div>
  );
}

function StepCard(props: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  glow: string;
}) {
  return (
    <div className="group relative rounded-2xl border border-white/10 bg-white/[0.02] p-6 hover:border-white/20 transition-all overflow-hidden">
      <div
        className="absolute -top-20 -right-20 w-48 h-48 rounded-full blur-2xl opacity-60 group-hover:opacity-100 transition-opacity"
        style={{
          background: `radial-gradient(circle, ${props.glow}, transparent 70%)`,
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-mono text-white/40">{props.n}</span>
          <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/80">
            {props.icon}
          </div>
        </div>
        <h3 className="text-xl font-bold text-white mb-2">{props.title}</h3>
        <p className="text-sm text-white/60 leading-relaxed">{props.body}</p>
      </div>
    </div>
  );
}

function Pillar(props: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-sm p-5">
      <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center mb-3">
        {props.icon}
      </div>
      <div className="font-semibold text-white text-sm">{props.title}</div>
      <div className="text-xs text-white/50 mt-1 leading-relaxed">
        {props.body}
      </div>
    </div>
  );
}

function FactoryFloor() {
  return (
    <div className="mt-16 w-full max-w-4xl mx-auto">
      <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent p-1 shadow-[0_30px_80px_-20px_rgba(99,102,241,0.35)]">
        <div className="rounded-[20px] bg-[#0a0a18] p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Factory className="w-4 h-4 text-indigo-300" />
              <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                factory floor · live
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-white/40">
                03:42 AM
              </span>
              <Moon className="w-3.5 h-3.5 text-white/40" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
            <AgentTile
              status="Building"
              title="Add CSV export to billing"
              detail="commit · 'wire up streaming download'"
              color="indigo"
            />
            <AgentTile
              status="Testing"
              title="Fix idle session timer"
              detail="42 tests · 41 passed"
              color="amber"
            />
            <AgentTile
              status="Shipping"
              title="Operator dashboard v2"
              detail="PR #218 · merging to main"
              color="emerald"
            />
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-white/40 font-mono">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span className="flex-1">
              7 features shipped this week · 3 in flight right now
            </span>
            <GitPullRequest className="w-3 h-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentTile(props: {
  status: string;
  title: string;
  detail: string;
  color: "indigo" | "amber" | "emerald";
}) {
  const colors = {
    indigo: {
      dot: "bg-indigo-400",
      ring: "ring-indigo-400/30",
      text: "text-indigo-300",
    },
    amber: {
      dot: "bg-amber-400",
      ring: "ring-amber-400/30",
      text: "text-amber-300",
    },
    emerald: {
      dot: "bg-emerald-400",
      ring: "ring-emerald-400/30",
      text: "text-emerald-300",
    },
  };
  const c = colors[props.color];
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c.dot} opacity-60`}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${c.dot} ring-2 ${c.ring}`}
          />
        </span>
        <span className={`text-[10px] font-mono uppercase tracking-wider ${c.text}`}>
          {props.status}
        </span>
      </div>
      <div className="text-sm font-semibold text-white leading-snug">
        {props.title}
      </div>
      <div className="mt-1.5 text-[11px] font-mono text-white/40 truncate">
        {props.detail}
      </div>
    </div>
  );
}

function MiniKanban() {
  const cols: {
    title: string;
    tint: string;
    items: { title: string; tag?: string }[];
  }[] = [
    {
      title: "Requested",
      tint: "text-gray-300",
      items: [
        { title: "Bulk import RFID cards", tag: "feature" },
        { title: "Token refresh 401 on Safari", tag: "bug" },
      ],
    },
    {
      title: "In Progress",
      tint: "text-purple-300",
      items: [{ title: "Per-site pricing rules", tag: "feature" }],
    },
    {
      title: "Deployed",
      tint: "text-emerald-300",
      items: [
        { title: "Custom payout schedules", tag: "feature" },
        { title: "Receipt PDF formatting", tag: "bug" },
      ],
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cols.map((col) => (
        <div
          key={col.title}
          className="rounded-2xl border border-white/10 bg-black/30 p-3"
        >
          <div className={`text-[10px] font-bold uppercase tracking-wider mb-2.5 ${col.tint}`}>
            {col.title}
          </div>
          <div className="space-y-2">
            {col.items.map((it) => (
              <div
                key={it.title}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5"
              >
                <div className="text-[11px] font-medium text-white leading-snug">
                  {it.title}
                </div>
                {it.tag && (
                  <div className="mt-1.5 inline-block text-[9px] font-mono uppercase tracking-wider text-white/40 border border-white/10 rounded px-1.5 py-0.5">
                    {it.tag}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
