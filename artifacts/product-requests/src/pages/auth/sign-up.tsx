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

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authFetch("/auth/sign-up", {
        body: JSON.stringify({ email, password, name }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="We just sent you a verification link"
        footer={
          <span>
            Wrong email?{" "}
            <button
              type="button"
              onClick={() => setDone(false)}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Start over
            </button>
          </span>
        }
      >
        <SuccessBanner
          message={`We sent a confirmation link to ${email}. Click it to finish setting up your account.`}
        />
        <p className="text-sm text-gray-500">
          Didn't get it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await authFetch("/auth/resend-verify", {
                  body: JSON.stringify({ email }),
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            resend it
          </button>
          .
        </p>
        <ErrorBanner message={error} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start scoping features with the AI product manager"
      footer={
        <span>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-indigo-600 hover:text-indigo-700">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit}>
        <ErrorBanner message={error} />
        <div className="mb-4">
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <FieldInput
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
        <div className="mb-5">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldInput
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
        </div>
        <SubmitButton loading={submitting}>Create account</SubmitButton>
      </form>
    </AuthLayout>
  );
}
