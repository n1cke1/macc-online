'use client';
// Bundle-hygiene gate for the authoring layer. `authoringEnabled` is a build-time
// constant, so when it's off this returns null and the dynamic import is never
// referenced — the editor chunk (schema + AST→HF + HyperFormula) tree-shakes away
// and the anonymous static core stays lean. Mandatory feature, optional payload.
import dynamic from 'next/dynamic';
import { authoringEnabled } from '@/lib/config';

const MeasureEditor = dynamic(() => import('./MeasureEditor'), { ssr: false });

export default function MeasureAuthoringGate() {
  if (!authoringEnabled) return null;
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <MeasureEditor />
    </section>
  );
}
