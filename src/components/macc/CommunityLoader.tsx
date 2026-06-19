'use client';
import { useEffect } from 'react';
import { useScenario } from '@/store';

/**
 * Loads the community-authored published measures (ids beyond the canonical kz-26) and
 * merges them onto the curve — for EVERY visitor, including anonymous ones. Renders
 * nothing; the fetch is lazy (its chunk carries @supabase/supabase-js + the calc engine,
 * never the static core) and degrades to the file dataset if the backend is unreachable.
 */
export default function CommunityLoader() {
  const loadCommunity = useScenario((s) => s.loadCommunity);
  useEffect(() => { loadCommunity(); }, [loadCommunity]);
  return null;
}
