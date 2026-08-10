import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  isEngineer: boolean;
}

interface AuthApiError extends Error {
  status: number;
  needsEmailVerification?: boolean;
  needsInitialPasswordSet?: boolean;
}

/**
 * Thin wrapper around fetch for our `/api/auth/*` endpoints. Always
 * sends cookies (same-origin behind the Replit proxy), throws a typed
 * error on non-2xx so callers can render the server's `error` message
 * directly.
 */
export async function authFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });
  const text = await res.text();
  const data: unknown = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const obj = (data ?? {}) as {
      error?: string;
      needsEmailVerification?: boolean;
      needsInitialPasswordSet?: boolean;
    };
    const err = new Error(
      obj.error || `Request failed (${res.status})`,
    ) as AuthApiError;
    err.status = res.status;
    if (obj.needsEmailVerification)
      err.needsEmailVerification = obj.needsEmailVerification;
    if (obj.needsInitialPasswordSet)
      err.needsInitialPasswordSet = obj.needsInitialPasswordSet;
    throw err;
  }
  return data as T;
}

const ME_QUERY_KEY = ["auth", "me"] as const;

async function fetchMe(): Promise<Me | null> {
  // Single source of truth — same endpoint the Orval-generated `useGetMe`
  // hits, so both stay in lockstep. `cache: "no-store"` keeps the browser
  // from revalidating with `If-None-Match`, which would let the server
  // answer 304 and trip the "not signed in" branch below right after a
  // successful sign-in.
  const res = await fetch(`/api/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return (await res.json()) as Me;
}

interface AuthContextValue {
  me: Me | null;
  isLoading: boolean;
  /**
   * Seed the cached session and drop other per-user queries — used after
   * sign-in / verify-email / reset-password. Pass the `user` object the auth
   * endpoint already returned to skip a redundant /api/me round-trip.
   */
  refreshAndReset: (knownMe?: Me | null) => Promise<void>;
  /** Sign out: kill the cookie + clear every cached query. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<Me | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    // Always honor a fresh session probe — staleTime 0 so React Query
    // refetches on remount (e.g. immediately after sign-in invalidates).
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // queryClient from useQueryClient is stable, so these callbacks keep a
  // stable identity. That matters for consumers like verify-email.tsx whose
  // useEffect depends on `refreshAndReset` — an unstable identity would
  // re-run the effect and re-consume the one-shot verification token.
  const refreshAndReset = useCallback(
    (knownMe?: Me | null) => refreshSession(queryClient, knownMe),
    [queryClient],
  );
  const signOut = useCallback(
    () => signOutAndReset(queryClient),
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      me: data ?? null,
      isLoading,
      refreshAndReset,
      signOut,
    }),
    [data, isLoading, refreshAndReset, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function refreshSession(
  qc: QueryClient,
  knownMe?: Me | null,
): Promise<void> {
  // Resolve the signed-in user. Prefer the object the auth endpoint already
  // returned (sign-in / verify-email / reset-password all respond with
  // `{ user }`) so we skip a redundant /api/me round-trip; fall back to a
  // probe only when the caller doesn't hand us one.
  const me = knownMe !== undefined ? knownMe : await fetchMe();

  // Stop any in-flight fetches so a late response can't overwrite what we
  // seed below.
  await qc.cancelQueries();

  // Seed the LIVE ["auth","me"] query directly.
  //
  // IMPORTANT: we must NOT call qc.clear() here. clear() destroys the
  // ["auth","me"] query, which severs it from the AuthProvider's mounted
  // useQuery observer. A setQueryData *after* clear() then writes to a brand
  // new query the observer is no longer attached to, so `me` never updates in
  // context and the user appears signed-out until a full page reload. Writing
  // to the existing query notifies the mounted observer normally.
  qc.setQueryData(ME_QUERY_KEY, me);

  // Drop every OTHER per-user query so stale data from a previous session
  // doesn't leak into this one.
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
}

async function signOutAndReset(qc: QueryClient): Promise<void> {
  try {
    await authFetch("/auth/sign-out");
  } catch {
    // best-effort — even if the request fails, clear local state
  }
  // Mark signed-out authoritatively and synchronously so the AuthProvider
  // observer re-renders with `me: null` in the same batch as the caller's
  // navigation.
  //
  // We deliberately AVOID qc.clear() here. clear() destroys the `me` query,
  // which makes the mounted observer (staleTime: 0) immediately refetch
  // /api/me. That refetch can race the just-killed session cookie and
  // momentarily repopulate `me` with the old user — bouncing the user back
  // into the app until they refresh. Instead we cancel any in-flight
  // fetches, set `me` to null directly, and drop only the *other* per-user
  // queries so the next user doesn't see stale data.
  await qc.cancelQueries();
  qc.setQueryData(ME_QUERY_KEY, null);
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
