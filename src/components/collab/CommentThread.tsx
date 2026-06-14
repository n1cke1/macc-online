'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { modelVersion } from '@/lib/data';
import { useAuth } from '@/lib/supabase/auth';
import {
  listComments,
  postComment,
  setStatus,
  setPinned,
  deleteComment,
} from '@/lib/supabase/comments';
import { refreshSummaries } from '@/lib/supabase/summaries';
import type { Anchor, CommentStatus, CommentWithAuthor } from '@/lib/supabase/types';
import CommentItem from './CommentItem';
import CommentComposer from './CommentComposer';

/**
 * A self-contained comment thread for one anchor (curve / project / assumption /
 * scenario / object). Loaded lazily by `AnchorComments` / `Commentable` only when
 * the collab layer is on. `title` overrides the default heading (e.g. the name of
 * the specific value being discussed in a Commentable popover).
 */
export default function CommentThread({ anchor, title }: { anchor: Anchor; title?: string }) {
  const t = useTranslations('collab');
  const { session, profile } = useAuth();
  const [comments, setComments] = useState<CommentWithAuthor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user?.id ?? null;

  const reload = useCallback(async () => {
    try {
      setComments(await listComments(anchor));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [anchor.type, anchor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload();
  }, [reload]);

  const post = async (body: string, parentId: string | null) => {
    if (!userId) return;
    await postComment({ anchor, body, parentId, modelVersion, authorId: userId });
    await reload();
    void refreshSummaries(); // keep presence badges in sync
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

  if (error) {
    return <p className="text-xs text-muted">{t('offline')}</p>;
  }
  if (comments === null) {
    return <p className="text-xs text-muted">{t('loading')}</p>;
  }

  // Group into root comments (pinned first, then newest) + their replies. A
  // reply whose parent is no longer visible (e.g. the parent was soft-deleted
  // and filtered out) is promoted to a root so it never silently vanishes.
  const ids = new Set(comments.map((c) => c.id));
  const isRoot = (c: CommentWithAuthor) => c.parent_id === null || !ids.has(c.parent_id);
  const roots = comments
    .filter(isRoot)
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
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title ?? t('threadTitle')}{' '}
        {comments.length > 0 && <span className="text-slate-400">({comments.length})</span>}
      </h4>

      {userId ? (
        <CommentComposer onSubmit={(body) => post(body, null)} />
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">{t('signInToComment')}</p>
      )}

      {roots.length === 0 ? (
        <p className="text-xs text-muted">{t('noComments')}</p>
      ) : (
        <div className="space-y-2">
          {roots.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              replies={(repliesByParent.get(c.id) ?? []).sort((a, b) =>
                a.created_at.localeCompare(b.created_at),
              )}
              currentUserId={userId}
              currentRole={profile?.role ?? null}
              onReply={(parentId, body) => post(body, parentId)}
              onSetStatus={onSetStatus}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
