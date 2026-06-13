'use client';
// The interactive "comment on this value" layer. Loaded lazily (only when the
// collab layer is on) by the gated `Commentable` wrapper. Wraps an inline value
// and provides three entry points to its thread:
//   • right-click (desktop)         → open the thread popover
//   • long-press (touch)            → open the thread popover
//   • a hover 💬 dot / presence badge → open the thread popover
// When the value already has comments, the dot is replaced by a presence badge
// (author avatar/initials + count). Positions a floating popover via a portal.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { CommentTarget } from '@/lib/supabase/types';
import { useSummary } from '@/lib/supabase/summaries';
import type { SummaryAuthor } from '@/lib/supabase/comments';
import CommentThread from './CommentThread';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Avatar({ author, z }: { author: SummaryAuthor; z: number }) {
  // Bigger (24px) + bright amber ring so the presence badge clearly stands out
  // against dense numeric tables. White separator keeps overlapping avatars legible.
  const ring = 'ring-2 ring-amber-400 ring-offset-1 ring-offset-white shadow-sm';
  return author.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={author.avatar}
      alt={author.name}
      title={author.name}
      style={{ zIndex: z }}
      className={`-ml-2 h-6 w-6 rounded-full border-2 border-white object-cover first:ml-0 ${ring}`}
    />
  ) : (
    <span
      title={author.name}
      style={{ zIndex: z }}
      className={`-ml-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-600 text-[10px] font-bold text-white first:ml-0 ${ring}`}
    >
      {initials(author.name)}
    </span>
  );
}

function Popover({
  anchorEl,
  onClose,
  children,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();
      const W = 320;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
      const top = Math.min(r.bottom + 6, window.innerHeight - 16);
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorEl]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 320 }}
      className="z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-white p-3 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function CommentableLive({
  type,
  id,
  label,
  children,
}: {
  type: CommentTarget;
  id: string;
  label?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('collab');
  const summary = useSummary(type, id);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const longTimer = useRef<number | null>(null);

  const openPopover = (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    setOpen(true);
  };
  const startLong = () => {
    longTimer.current = window.setTimeout(() => openPopover(), 500);
  };
  const cancelLong = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const has = summary && summary.count > 0;

  return (
    <span
      ref={wrapRef}
      className="group/commentable relative inline-flex items-center gap-1"
      onContextMenu={openPopover}
      onTouchStart={startLong}
      onTouchEnd={cancelLong}
      onTouchMove={cancelLong}
    >
      {children}
      {/* Constant-width affordance slot → no layout shift between dot and badge. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={has ? t('viewComments', { n: summary!.count }) : t('addComment')}
        className={
          has
            ? 'inline-flex shrink-0 items-center'
            : 'shrink-0 text-sky-400 opacity-0 transition-opacity hover:text-sky-600 focus:opacity-100 group-hover/commentable:opacity-100'
        }
      >
        {has ? (
          <span className="ml-1 inline-flex items-center">
            <span className="flex items-center">
              {summary!.authors.slice(0, 3).map((a, i) => (
                <Avatar key={a.name} author={a} z={10 - i} />
              ))}
            </span>
            {summary!.count > 1 && (
              <span className="ml-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {summary!.count}
              </span>
            )}
          </span>
        ) : (
          <span aria-hidden className="text-sm leading-none">💬</span>
        )}
      </button>

      {open && (
        <Popover anchorEl={wrapRef.current} onClose={() => setOpen(false)}>
          <CommentThread anchor={{ type, id }} title={label} />
        </Popover>
      )}
    </span>
  );
}
