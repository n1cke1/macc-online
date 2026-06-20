'use client';
// Bundle-hygiene gate for the read-only measure drill-down (the trust-anchor view
// shown under the table to logged-in users). `collabEnabled` is a build-time
// constant, so when no Supabase backend is configured this returns null and the
// dynamic import is never referenced — the drill chunk (calc core + Supabase auth)
// tree-shakes away and the anonymous static core stays lean (principle #1).
//
// A SECOND gate — «visible to logged-in users only» — lives INSIDE MeasureDrilldown
// (the lazy chunk), where the Supabase-backed auth check is allowed.
import dynamic from 'next/dynamic';
import { collabEnabled } from '@/lib/config';

const MeasureDrilldown = dynamic(() => import('./MeasureDrilldown'), { ssr: false });

export default function MeasureDrilldownGate() {
  if (!collabEnabled) return null;
  return <MeasureDrilldown />;
}
