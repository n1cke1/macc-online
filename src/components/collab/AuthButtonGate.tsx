'use client';
// Gated header sign-in control. Like AnchorComments, it pulls in the Supabase
// auth UI only via a lazy dynamic import, and renders nothing when the collab
// layer is disabled — so the static core header has no Supabase dependency.
import dynamic from 'next/dynamic';
import { collabEnabled } from '@/lib/config';

const AuthButton = dynamic(() => import('./AuthButton'), { ssr: false });

export default function AuthButtonGate() {
  if (!collabEnabled) return null;
  return <AuthButton />;
}
