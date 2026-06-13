'use client';
// Auth helpers + a React hook exposing the current session and profile.
// Collaboration layer only.
//
// Session lives in a tiny module-level store with a SINGLE Supabase auth
// subscription shared by every consumer — so scattered comment threads and the
// header auth button don't each open their own subscription, and we avoid having
// to wrap the (server-rendered) layout in a client context provider.
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './client';
import type { OAuthProvider } from '@/lib/config';
import type { Profile } from './types';

/** Where the OAuth / magic-link redirect should return. Current URL, sans hash/query. */
function redirectTo(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin + window.location.pathname;
}

export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  await getSupabase().auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo() },
  });
}

export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

// ── Shared auth store (single subscription) ──────────────────────────────────
export interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
}

let state: AuthState = { session: null, profile: null, loading: true };
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  emit();
}

async function loadProfile(uid: string | undefined) {
  if (!uid) {
    setState({ profile: null });
    return;
  }
  const { data } = await getSupabase().from('profiles').select('*').eq('id', uid).single();
  // Guard against a stale fetch overwriting a newer session.
  if (state.session?.user?.id === uid) setState({ profile: (data as Profile) ?? null });
}

function ensureStarted() {
  if (started) return;
  started = true;
  const sb = getSupabase();
  sb.auth.getSession().then(({ data }) => {
    setState({ session: data.session, loading: false });
    void loadProfile(data.session?.user?.id);
  });
  sb.auth.onAuthStateChange((_event, s) => {
    setState({ session: s });
    void loadProfile(s?.user?.id);
  });
}

/** Subscribe to the shared auth state (session + profile + loading). */
export function useAuth(): AuthState {
  const [, force] = useState(0);
  useEffect(() => {
    ensureStarted();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}
