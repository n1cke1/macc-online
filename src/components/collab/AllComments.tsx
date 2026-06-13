'use client';
// Gated entry-point for the global comments feed (bottom panel). Like the other
// collab gates, it imports nothing from @/lib/supabase at module scope and lazy-
// loads the heavy feed only when the collaboration layer is enabled; renders
// nothing when off, so the static core has no Supabase dependency.
import dynamic from 'next/dynamic';
import { collabEnabled } from '@/lib/config';

const CommentsFeed = dynamic(() => import('./CommentsFeed'), { ssr: false });

export default function AllComments({ className }: { className?: string }) {
  if (!collabEnabled) return null;
  return (
    <section className={className ?? 'rounded-lg border border-line bg-white p-4'}>
      <CommentsFeed />
    </section>
  );
}
