'use client';
// Shared, lazily-loaded index of comment presence per anchor. One fetch builds a
// `${type}:${id}` → {count, authors} map (see listSummaries); every Commentable
// reads from it to decide whether to show a presence badge — no per-element query.
// A single module store with listeners (mirrors the auth store pattern).
import { useEffect, useState } from 'react';
import { listSummaries, type TargetSummary } from './comments';
import type { CommentTarget } from './types';

let summaries: Record<string, TargetSummary> = {};
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Reload the whole index (call after any comment mutation). */
export async function refreshSummaries(): Promise<void> {
  try {
    summaries = await listSummaries();
    emit();
  } catch {
    // offline / RLS — leave the last good index, badges just won't update
  }
}

/** Load once on first use. */
function ensureSummaries() {
  if (loaded) return;
  loaded = true;
  void refreshSummaries();
}

/** Subscribe to the presence summary for one anchor. */
export function useSummary(type: CommentTarget, id: string): TargetSummary | null {
  const [, force] = useState(0);
  useEffect(() => {
    ensureSummaries();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return summaries[`${type}:${id}`] ?? null;
}
