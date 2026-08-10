import { useMemo, useState } from "react";
import { Link, Redirect } from "wouter";
import { authFetch, useAuth, type Me } from "@/lib/auth";
import AuthLayout, {
  ErrorBanner,
  FieldInput,
  FieldLabel,
  SubmitButton,
} from "./_layout";

export default function ResetPasswordPage() {
  const { me, refreshAndReset } = useAuth();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await authFetch<{ ok: true; user: Me }>(
        "/auth/reset-password",
        {
          body: JSON.stringify({ token, password }),
        },
      );
      // Seed the session; the <Redirect> below takes the user into the app
      // reactively once `me` is set.
      await refreshAndReset(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (me) return <Redirect to="/app" />;

  if (!token) {
    return (
      <AuthLayout
        title="Reset link required"
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Request a new link
          </Link>
        }
      >
        <ErrorBanner message="This page needs a token in the URL. Use the link in your email." />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Pick something you'll remember — at least 8 characters."
    >
      <form onSubmit={onSubmit}>
        <ErrorBanner message={error} />
        <div className="mb-4">
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <FieldInput
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="mb-5">
          <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
          <FieldInput
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <SubmitButton loading={submitting}>Save new password</SubmitButton>
      </form>
    </AuthLayout>
  );
}
