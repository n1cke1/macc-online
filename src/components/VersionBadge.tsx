'use client';
import { dataset } from '@/lib/data';

export default function VersionBadge() {
  const { modelVersion, meta } = dataset;
  return (
    <span
      className="rounded-md border border-line bg-white px-2 py-1 font-mono text-[11px] text-muted"
      title={`${meta.sourceFile}`}
    >
      {modelVersion} · {meta.sourceDate}
    </span>
  );
}
