'use client';
// Global comments feed for the bottom panel: every comment across all anchors,
// each tagged with which element it was left on (resolved via useAnchorLabel).
// Reuses CommentItem for actions/replies. Loaded lazily by the gated AllComments.
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { modelVersion } from '@/lib/data';
import { useAuth } from '@/lib/supabase/auth';
import {
  listAllComments,
  postComment,
  setStatus,
  setPinned,
  deleteComment,
} from '@/lib/supabase/comments';
import { refreshSummaries } from '@/lib/supabase/summaries';
import type { Anchor, CommentStatus, CommentWithAuthor } from '@/lib/supabase/types';
import CommentItem from './CommentItem';
import CommentComposer from './CommentComposer';
import StatusBadge from './StatusBadge';
import { useAnchorLabel } from './useAnchorLabel';

export default function CommentsFeed() {
  const t = useTranslations('collab');
  const anchorLabel = useAnchorLabel();
  const { session, profile } = useAuth();
  const [comments, setComments] = useState<CommentWithAuthor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user?.id ?? null;

  const reload = useCallback(async () => {
    try {
      setComments(await listAllComments());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <p className="text-xs text-muted">{t('offline')}</p>;
  if (comments === null) return <p className="text-xs text-muted">{t('loading')}</p>;

  const byId = new Map(comments.map((c) => [c.id, c]));
  const anchorOf = (c: CommentWithAuthor): Anchor => ({ type: c.target_type, id: c.target_id });

  const post = async (body: string, anchor: Anchor, parentId: string | null) => {
    if (!userId) return;
    await postComment({ anchor, body, parentId, modelVersion, authorId: userId });
    await reload();
    void refreshSummaries();
  };
  const onReply = async (parentId: string, body: string) => {
    const parent = byId.get(parentId);
    if (parent) await post(body, anchorOf(parent), parentId);
  };
  const onSetStatus = async (id: string, status: CommentStatus) => {
    await setStatus(id, status);
    await reload();
  };
  const onTogglePin = async (id: string, pinned: boolean) => {
    await setPinned(id, pinned);
    await reload();
  };
  const onDelete = async (id: string) => {
    await deleteComment(id);
    await reload();
    void refreshSummaries();
  };

  // Promote replies whose parent is no longer visible to roots (see CommentThread).
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments
    .filter((c) => (c.parent_id === null || !ids.has(c.parent_id)) && !c.is_deleted)
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });
  const repliesByParent = new Map<string, CommentWithAuthor[]>();
  for (const c of comments) {
    if (c.parent_id && ids.has(c.parent_id)) {
      const arr = repliesByParent.get(c.parent_id) ?? [];
      arr.push(c);
      repliesByParent.set(c.parent_id, arr);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        {t('feedTitle')}{' '}
        {roots.length > 0 && <span className="text-slate-400">({roots.length})</span>}
      </h3>

      {userId ? (
        <CommentComposer
          placeholder={t('feedComposerPlaceholder')}
          onSubmit={(body) => post(body, { type: 'curve', id: 'kz' }, null)}
        />
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">{t('signInToComment')}</p>
      )}

      {roots.length === 0 ? (
        <p className="text-xs text-muted">{t('noComments')}</p>
      ) : (
        <ul className="space-y-2">
          {roots.map((c) => (
            <li key={c.id}>
              {/* Which element this comment was left on */}
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-block max-w-full truncate rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                  {anchorLabel(c.target_type, c.target_id)}
                </span>
                <StatusBadge status={c.status} />
              </div>
              <CommentItem
                comment={c}
                replies={(repliesByParent.get(c.id) ?? []).sort((a, b) =>
                  a.created_at.localeCompare(b.created_at),
                )}
                currentUserId={userId}
                currentRole={profile?.role ?? null}
                onReply={onReply}
                onSetStatus={onSetStatus}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
