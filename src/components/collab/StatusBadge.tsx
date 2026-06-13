'use client';
import { useTranslations } from 'next-intl';
import type { CommentStatus } from '@/lib/supabase/types';

const STYLES: Record<CommentStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  wontfix: 'bg-amber-100 text-amber-700',
};

export default function StatusBadge({ status }: { status: CommentStatus }) {
  const t = useTranslations('collab.status');
  if (status === 'open') return null; // open = default, no badge needed
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STYLES[status]}`}>
      {t(status)}
    </span>
  );
}
