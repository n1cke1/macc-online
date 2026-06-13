'use client';
// Gated wrapper that makes any inline value commentable. Like AnchorComments it
// imports NOTHING from @/lib/supabase at module scope — when the collab layer is
// off it just renders its children (zero overhead, no Supabase in the bundle).
// When on, it lazy-loads the interactive CommentableLive layer (one shared chunk
// across all call sites).
import dynamic from 'next/dynamic';
import { collabEnabled } from '@/lib/config';
import type { CommentTarget } from '@/lib/supabase/types'; // type-only — erased at build

const CommentableLive = dynamic(() => import('./CommentableLive'), { ssr: false });

export default function Commentable({
  type = 'object',
  id,
  label,
  children,
}: {
  /** Anchor type; defaults to the generic `object` for value-level comments. */
  type?: CommentTarget;
  id: string;
  /** Human label for the value, shown as the popover heading. */
  label?: string;
  children: React.ReactNode;
}) {
  if (!collabEnabled) return <>{children}</>;
  return (
    <CommentableLive type={type} id={id} label={label}>
      {children}
    </CommentableLive>
  );
}
