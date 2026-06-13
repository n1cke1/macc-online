'use client';
import { useEffect, useRef } from 'react';
import { encodeScenario, decodeScenario, isBaseline } from '@/lib/scenario';
import { useScenario } from '@/store';

/**
 * Two-way bind the scenario to the URL query string, enabling shareable links.
 * Renders nothing. On mount it hydrates levers from `?c=&g=&e=&w=`; thereafter it
 * mirrors lever changes back into the URL with `replaceState` (no navigation, no
 * history spam). Other query params (e.g. a future locale flag) are preserved.
 */
export default function ScenarioUrlSync() {
  const levers = useScenario((s) => s.levers);
  const applyLevers = useScenario((s) => s.applyLevers);
  const hydrated = useRef(false);

  // Hydrate from the URL once on mount.
  useEffect(() => {
    const fromUrl = decodeScenario(window.location.search);
    if (!isBaseline(fromUrl)) applyLevers(fromUrl);
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect lever changes into the URL (after hydration, to avoid clobbering it).
  useEffect(() => {
    if (!hydrated.current) return;
    const scenario = encodeScenario(levers);
    const current = new URLSearchParams(window.location.search);
    // Drop old scenario keys, then merge in the current ones.
    for (const k of ['c', 'g', 'e', 'w']) current.delete(k);
    for (const [k, v] of scenario) current.set(k, v);
    const qs = current.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
  }, [levers]);

  return null;
}
