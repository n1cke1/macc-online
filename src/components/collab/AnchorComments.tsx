'use client';
// Gated entry-point the static core mounts wherever a comment thread can attach
// (project drill-down, an assumption lever, the curve, a scenario). It imports
// NOTHING from `@/lib/supabase` at module scope — only a dynamic import that
// Next splits into a lazy chunk. When `collabEnabled` is false (no Supabase env)
// it renders null and that chunk is never fetched, so the static core bundle
// stays Supabase-free and fully functional with zero backend.
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { collabEnabled } from '@/lib/config';
import type { CommentTarget } from '@/lib/supabase/types'; // type-only — erased at build

const CommentThread = dynamic(() => import('./CommentThread'), { ssr: false });

export default function AnchorComments({
  type,
  id,
  className,
  collapsible,
  label,
}: {
  type: CommentTarget;
  id: string;
  className?: string;
  /** When true, render a toggle that mounts the thread (and loads its chunk) on demand. */
  collapsible?: boolean;
  /** Toggle label for collapsible mode. */
  label?: string;
}) {
  if (!collabEnabled) return null;
  return (
    <section className={className ?? 'mt-4 border-t border-line pt-3'}>
      {collapsible ? (
        <CollapsibleThread type={type} id={id} label={label} />
      ) : (
        <CommentThread anchor={{ type, id }} />
      )}
    </section>
  );
}

function CollapsibleThread({
  type,
  id,
  label,
}: {
  type: CommentTarget;
  id: string;
  label?: string;
}) {
  const t = useTranslations('collab');
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-sky-600 hover:underline"
      >
        💬 {label ?? t('discuss')}
      </button>
    );
  }
  return <CommentThread anchor={{ type, id }} />;
}
