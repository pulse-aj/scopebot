import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { authFetch, useAuth, type Me } from "@/lib/auth";
import AuthLayout, { ErrorBanner, SuccessBanner } from "./_layout";

export default function VerifyEmailPage() {
  const [, setLocation] = useLocation();
  const { refreshAndReset } = useAuth();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setMessage("This page needs a token in the URL.");
      return;
    }
    (async () => {
      try {
        const { user } = await authFetch<{ ok: true; user: Me }>(
          "/auth/verify-email",
          {
            body: JSON.stringify({ token }),
          },
        );
        await refreshAndReset(user);
        setStatus("ok");
        setMessage("You're verified — taking you in…");
        setTimeout(() => setLocation("/app"), 800);
      } catch (e) {
        setStatus("error");
        setMessage((e as Error).message);
      }
    })();
  }, [refreshAndReset, setLocation]);

  return (
    <AuthLayout
      title={status === "ok" ? "Email confirmed" : "Confirming your email…"}
      footer={
        status === "error" ? (
          <span>
            <Link
              href="/sign-in"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Back to sign in
            </Link>
          </span>
        ) : null
      }
    >
      {status === "ok" && <SuccessBanner message={message} />}
      {status === "error" && <ErrorBanner message={message} />}
      {status === "loading" && (
        <p className="text-sm text-gray-500">One moment…</p>
      )}
    </AuthLayout>
  );
}
