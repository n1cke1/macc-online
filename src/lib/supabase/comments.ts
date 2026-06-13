'use client';
// Query/mutation helpers for the anchored comment threads. Collaboration only.
// All writes are RLS-guarded server-side; status/pin/delete go through the
// SECURITY DEFINER RPCs (see supabase/migrations/0003).
import { getSupabase } from './client';
import type { Anchor, CommentStatus, CommentWithAuthor } from './types';

/** All non-deleted comments for one anchor, oldest-first, with author profiles. */
export async function listComments(anchor: Anchor): Promise<CommentWithAuthor[]> {
  const { data, error } = await getSupabase()
    .from('comments')
    .select('*, author:profiles(display_name, avatar_url, role)')
    .eq('target_type', anchor.type)
    .eq('target_id', anchor.id)
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

export async function postComment(c: NewComment): Promise<void> {
  const { error } = await getSupabase().from('comments').insert({
    author_id: c.authorId,
    target_type: c.anchor.type,
    target_id: c.anchor.id,
    parent_id: c.parentId ?? null,
    scenario_id: c.scenarioId ?? null,
    body: c.body,
    model_version: c.modelVersion,
  });
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
