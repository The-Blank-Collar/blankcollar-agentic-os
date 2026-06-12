import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Auth gateway (Phase 8.1).
 *
 * Two modes, decided at build time:
 *
 *   1. Demo (no VITE_SUPABASE_URL set)
 *      The whole module short-circuits — `useAuth()` returns
 *      { mode: "demo", session: null }, the api client doesn't attach
 *      a Bearer token, the App shell renders unconditionally.
 *
 *   2. Auth (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY set)
 *      A real Supabase client is constructed; <AuthProvider> reads the
 *      session and pipes auth state changes into React. The App shell
 *      gates on session presence.
 *
 * Token rotation is automatic — the api client calls `getAuthToken()`
 * on every request, which reads the current session.access_token via
 * `supabase.auth.getSession()` (cached locally in supabase-js).
 */

type Env = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const env =
  (import.meta as unknown as { env?: Env }).env ?? {};

export const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim() || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const isAuthEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isAuthEnabled) return null;
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cachedClient;
}

export type AuthMode = "demo" | "auth";

export type AuthContextValue = {
  mode: AuthMode;
  /** Loading the very first session (only true on initial mount in auth mode). */
  loading: boolean;
  session: Session | null;
  user: User | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName?: string,
  ) => Promise<{ error: string | null; needsEmailConfirm: boolean }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const mode: AuthMode = supabase ? "auth" : "demo";

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(mode === "auth");

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, sess: Session | null) => {
        if (!alive) return;
        setSession(sess);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithPassword = useCallback<
    AuthContextValue["signInWithPassword"]
  >(async (email, password) => {
    if (!supabase) return { error: "auth_disabled" };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    return { error: error?.message ?? null };
  }, [supabase]);

  const signUpWithPassword = useCallback<
    AuthContextValue["signUpWithPassword"]
  >(async (email, password, fullName) => {
    if (!supabase) return { error: "auth_disabled", needsEmailConfirm: false };
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: fullName ? { full_name: fullName.trim() } : undefined,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    if (error) return { error: error.message, needsEmailConfirm: false };
    // Supabase returns a session immediately when email confirmation is
    // disabled; otherwise session=null and the user must click the link.
    return { error: null, needsEmailConfirm: !data.session };
  }, [supabase]);

  const signInWithMagicLink = useCallback<
    AuthContextValue["signInWithMagicLink"]
  >(async (email) => {
    if (!supabase) return { error: "auth_disabled" };
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    return { error: error?.message ?? null };
  }, [supabase]);

  const resetPassword = useCallback<
    AuthContextValue["resetPassword"]
  >(async (email) => {
    if (!supabase) return { error: "auth_disabled" };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    return { error: error?.message ?? null };
  }, [supabase]);

  const signOut = useCallback<AuthContextValue["signOut"]>(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      loading,
      session,
      user: session?.user ?? null,
      signInWithPassword,
      signUpWithPassword,
      signInWithMagicLink,
      resetPassword,
      signOut,
    }),
    [mode, loading, session, signInWithPassword, signUpWithPassword, signInWithMagicLink, resetPassword, signOut],
  );

  return createElement(AuthCtx.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) {
    // Should not happen — App.tsx wraps everything in AuthProvider.
    return {
      mode: isAuthEnabled ? "auth" : "demo",
      loading: false,
      session: null,
      user: null,
      signInWithPassword: async () => ({ error: "auth_unavailable" }),
      signUpWithPassword: async () => ({ error: "auth_unavailable", needsEmailConfirm: false }),
      signInWithMagicLink: async () => ({ error: "auth_unavailable" }),
      resetPassword: async () => ({ error: "auth_unavailable" }),
      signOut: async () => {},
    };
  }
  return ctx;
}

/**
 * Read the current access token without React. The api client uses this
 * because it lives outside the component tree; it pulls a fresh session
 * from supabase-js (which keeps it cached + refreshes automatically).
 */
export async function getCurrentAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
