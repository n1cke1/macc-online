'use client';
// Show something to signed-in visitors only. Same discipline as AuthButtonGate: the
// Supabase-aware part arrives through a lazy, client-only import, so the static core keeps
// working with the backend switched off — and with no backend there is nobody to sign in
// as, so the content is shown rather than hidden forever.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { collabEnabled } from '@/lib/config';

const AuthOnly = dynamic(() => import('./AuthOnly'), { ssr: false });

export default function AuthGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  if (!collabEnabled) return <>{children}</>;
  return <AuthOnly fallback={fallback}>{children}</AuthOnly>;
}
