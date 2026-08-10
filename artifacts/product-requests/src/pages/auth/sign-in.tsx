import { useState } from "react";
import { Link, Redirect } from "wouter";
import { authFetch, useAuth, type Me } from "@/lib/auth";
import AuthLayout, {
  ErrorBanner,
  FieldInput,
  FieldLabel,
  SubmitButton,
  SuccessBanner,
} from "./_layout";

export default function SignInPage() {
  const { me, refreshAndReset } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { user } = await authFetch<{ ok: true; user: Me }>(
        "/auth/sign-in",
        {
          body: JSON.stringify({ email, password }),
        },
      );
      // Seed the cached session from the user the endpoint just returned.
      // Navigation then happens reactively via the <Redirect> below once
      // `me` flips truthy — no imperative setLocation race.
      await refreshAndReset(user);
    } catch (e) {
      const err = e as Error & {
        needsEmailVerification?: boolean;
        needsInitialPasswordSet?: boolean;
      };
      if (err.needsEmailVerification || err.needsInitialPasswordSet) {
        setNotice(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Once the session is established (after sign-in, or if the user is already
  // signed in), hand off to the app. Reactive redirect avoids the race where
  // an imperative navigation runs before AuthProvider re-renders with `me`.
  if (me) return <Redirect to="/app" />;

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue scoping your features"
      footer={
        <span>
          Don't have an account?{" "}
          <Link href="/sign-up" className="font-medium text-indigo-600 hover:text-indigo-700">
            Sign up
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit}>
        <ErrorBanner message={error} />
        <SuccessBanner message={notice} />
        <div className="mb-4">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldInput
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="mb-2">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldInput
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="mb-5 text-right">
          <Link
            href="/forgot-password"
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            Forgot password?
          </Link>
        </div>
        <SubmitButton loading={submitting}>Sign in</SubmitButton>
      </form>
    </AuthLayout>
  );
}
