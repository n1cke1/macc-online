'use client';
// Query/mutation helpers for the anchored comment threads. Collaboration only.
// All writes are RLS-guarded server-side; status/pin/delete go through the
// SECURITY DEFINER RPCs (see supabase/migrations/0003).
import { getSupabase } from './client';
import type { Anchor, CommentStatus, CommentWithAuthor } from './types';

/** All non-deleted comments for one anchor, oldest-first, with author profiles.
 * RLS still returns an author's/owner's own soft-deleted rows, so we also filter
 * `is_deleted` here — otherwise a "[deleted]" tombstone lingers in the thread
 * (the global feed already excludes them; this keeps the two consistent). */
export async function listComments(anchor: Anchor): Promise<CommentWithAuthor[]> {
  const { data, error } = await getSupabase()
    .from('comments')
    .select('*, author:profiles(display_name, avatar_url, role)')
    .eq('target_type', anchor.type)
    .eq('target_id', anchor.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CommentWithAuthor[];
}

/** Every non-deleted comment across all anchors (global feed), oldest-first. */
export async function listAllComments(): Promise<CommentWithAuthor[]> {
  const { data, error } = await getSupabase()
    .from('comments')
    .select('*, author:profiles(display_name, avatar_url, role)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CommentWithAuthor[];
}

export interface NewComment {
  anchor: Anchor;
  body: string;
  parentId?: string | null;
  scenarioId?: string | null;
  modelVersion: string;
  authorId: string;
}

/** A token-staleness error means the request never reached the insert (the JWT
 * was rejected up-front), so retrying after a refresh is safe — it cannot
 * duplicate a row. We deliberately do NOT retry on network/other errors, which
 * could have committed server-side. */
function isStaleTokenError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  return code === 'PGRST301' || msg.includes('jwt'); // PGRST301 = JWT expired
}

export async function postComment(c: NewComment): Promise<void> {
  const sb = getSupabase();
  const row = {
    author_id: c.authorId,
    target_type: c.anchor.type,
    target_id: c.anchor.id,
    parent_id: c.parentId ?? null,
    scenario_id: c.scenarioId ?? null,
    body: c.body,
    model_version: c.modelVersion,
  };
  const insert = async () => (await sb.from('comments').insert(row)).error;

  // Refresh a near-expired token before writing (the root of the "sends on the
  // 2nd click" bug: the 1st insert went out with a stale token → 401). getSession
  // refreshes only when needed, so this is a no-op on a healthy session.
  await sb.auth.getSession();
  let error = await insert();
  if (isStaleTokenError(error)) {
    await sb.auth.refreshSession();
    error = await insert();
  }
  if (error) throw error;
}

export async function setStatus(commentId: string, status: CommentStatus): Promise<void> {
  const { error } = await getSupabase().rpc('set_comment_status', {
    p_comment: commentId,
    p_status: status,
  });
  if (error) throw error;
}

export async function setPinned(commentId: string, pinned: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('set_comment_pinned', {
    p_comment: commentId,
    p_pinned: pinned,
  });
  if (error) throw error;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('soft_delete_comment', { p_comment: commentId });
  if (error) throw error;
}

/** Comment counts grouped by anchor — used to badge anchors with thread activity. */
export async function countByTarget(
  type: Anchor['type'],
): Promise<Record<string, number>> {
  const { data, error } = await getSupabase()
    .from('comments')
    .select('target_id')
    .eq('target_type', type)
    .eq('is_deleted', false);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { target_id: string }[]) {
    out[r.target_id] = (out[r.target_id] ?? 0) + 1;
  }
  return out;
}

/** Lightweight author identity shown on a comment-presence badge. */
export interface SummaryAuthor {
  name: string;
  avatar: string | null;
}
/** Per-anchor presence: how many comments + who authored them (deduped). */
export interface TargetSummary {
  count: number;
  authors: SummaryAuthor[];
}

/**
 * One pass over all non-deleted comments → a `${type}:${id}` → {count, authors}
 * map, so the UI can badge every commented value without a query per element.
 * Small-scale by design (an expert-review tool); revisit with a view/RPC if the
 * comment table ever grows large.
 */
export async function listSummaries(): Promise<Record<string, TargetSummary>> {
  const { data, error } = await getSupabase()
    .from('comments')
    .select('target_type, target_id, author:profiles(display_name, avatar_url)')
    .eq('is_deleted', false);
  if (error) throw error;
  const out: Record<string, TargetSummary> = {};
  for (const r of (data ?? []) as unknown as Array<{
    target_type: string;
    target_id: string;
    author: { display_name: string; avatar_url: string | null } | null;
  }>) {
    const key = `${r.target_type}:${r.target_id}`;
    const s = out[key] ?? (out[key] = { count: 0, authors: [] });
    s.count++;
    const name = r.author?.display_name ?? '—';
    if (!s.authors.some((a) => a.name === name)) {
      s.authors.push({ name, avatar: r.author?.avatar_url ?? null });
    }
  }
  return out;
}
