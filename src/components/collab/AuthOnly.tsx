'use client';
// Renders `children` to a signed-in visitor and `fallback` to everyone else. Loaded only
// through AuthGate, so the Supabase auth helpers never reach the static core.
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/supabase/auth';

export default function AuthOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  return <>{session ? children : fallback ?? null}</>;
}
