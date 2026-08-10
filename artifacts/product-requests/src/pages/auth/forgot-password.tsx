import { useState } from "react";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth";
import AuthLayout, {
  ErrorBanner,
  FieldInput,
  FieldLabel,
  SubmitButton,
  SuccessBanner,
} from "./_layout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authFetch("/auth/forgot-password", {
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={done ? "Check your email" : "Forgot your password?"}
      subtitle={
        done
          ? "If an account exists for that email, we just sent a reset link."
          : "We'll email you a link to set a new password."
      }
      footer={
        <span>
          Remembered it?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Sign in
          </Link>
        </span>
      }
    >
      {done ? (
        <SuccessBanner message="The link expires in 1 hour. Check your spam folder if you don't see it." />
      ) : (
        <form onSubmit={onSubmit}>
          <ErrorBanner message={error} />
          <div className="mb-5">
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
          <SubmitButton loading={submitting}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
