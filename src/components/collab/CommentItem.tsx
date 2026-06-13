'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CommentStatus, CommentWithAuthor, UserRole } from '@/lib/supabase/types';
import StatusBadge from './StatusBadge';
import CommentComposer from './CommentComposer';

const STATUSES: CommentStatus[] = ['open', 'accepted', 'rejected', 'wontfix'];

export default function CommentItem({
  comment,
  replies,
  currentUserId,
  currentRole,
  onReply,
  onSetStatus,
  onTogglePin,
  onDelete,
}: {
  comment: CommentWithAuthor;
  replies: CommentWithAuthor[];
  currentUserId: string | null;
  currentRole: UserRole | null;
  onReply: (parentId: string, body: string) => Promise<void>;
  onSetStatus: (id: string, status: CommentStatus) => Promise<void>;
  onTogglePin: (id: string, pinned: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useTranslations('collab');
  const locale = useLocale();
  const [replying, setReplying] = useState(false);

  const isRoot = comment.parent_id === null;
  const canModerate = currentRole === 'reviewer' || currentRole === 'owner';
  const isAuthor = currentUserId === comment.author_id;
  const when = new Date(comment.created_at).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className={isRoot ? 'rounded-md border border-line p-2.5' : 'mt-2 border-l-2 border-line pl-3'}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {comment.author?.display_name ?? '—'}
        </span>
        {comment.author && comment.author.role !== 'user' && (
          <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold uppercase text-sky-700">
            {comment.author.role}
          </span>
        )}
        {comment.is_pinned && <span title={t('pinned')}>📌</span>}
        {isRoot && <StatusBadge status={comment.status} />}
        <span className="ml-auto text-[10px] text-muted">{when}</span>
      </div>

      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {currentUserId && (
          <button onClick={() => setReplying((r) => !r)} className="text-sky-600 hover:underline">
            {t('reply')}
          </button>
        )}
        {(isAuthor || currentRole === 'owner') && !comment.is_deleted && (
          <button onClick={() => void onDelete(comment.id)} className="text-red-500 hover:underline">
            {t('delete')}
          </button>
        )}
        {canModerate && isRoot && (
          <>
            <button
              onClick={() => void onTogglePin(comment.id, !comment.is_pinned)}
              className="text-slate-500 hover:underline"
            >
              {comment.is_pinned ? t('unpin') : t('pin')}
            </button>
            <span className="inline-flex items-center gap-1">
              <span className="text-muted">{t('setStatus')}:</span>
              <select
                value={comment.status}
                onChange={(e) => void onSetStatus(comment.id, e.target.value as CommentStatus)}
                className="rounded border border-line bg-white px-1 py-0.5 text-[11px]"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
            </span>
          </>
        )}
      </div>

      {replying && (
        <div className="mt-2">
          <CommentComposer
            compact
            placeholder={t('replyPlaceholder')}
            onSubmit={async (body) => {
              await onReply(comment.id, body);
              setReplying(false);
            }}
          />
        </div>
      )}

      {replies.map((r) => (
        <CommentItem
          key={r.id}
          comment={r}
          replies={[]}
          currentUserId={currentUserId}
          currentRole={currentRole}
          onReply={onReply}
          onSetStatus={onSetStatus}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
