import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Ambient gradient — same language as the landing page hero. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,hsl(244_70%_60%/0.18),transparent_55%),radial-gradient(circle_at_85%_30%,hsl(268_70%_60%/0.16),transparent_50%),radial-gradient(circle_at_50%_100%,hsl(160_70%_50%/0.10),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.06] dark:opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--foreground) / 0.4) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground) / 0.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage:
              "radial-gradient(circle at 50% 30%, black 0%, transparent 80%)",
          }}
        />
      </div>

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <img
            src={`${basePath}/logo-horizontal.svg`}
            alt="ScopeBot"
            className="h-10 w-auto dark:brightness-0 dark:invert dark:opacity-90"
          />
        </div>
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card/95 shadow-xl backdrop-blur-sm dark:bg-card/80">
          <div className="px-8 pb-2 pt-7">
            <h1 className="text-2xl font-bold text-card-foreground">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="px-8 pb-7 pt-4">{children}</div>
          {footer && (
            <div className="border-t border-border bg-muted/40 px-8 py-4 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-foreground/80"
    >
      {children}
    </label>
  );
}

export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
    />
  );
}

export function SubmitButton({
  loading,
  children,
}: {
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="bg-brand-gradient w-full rounded-lg py-2.5 font-semibold text-white transition-all hover:shadow-brand-glow disabled:opacity-60"
    >
      {loading ? "Working…" : children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
      {message}
    </div>
  );
}
