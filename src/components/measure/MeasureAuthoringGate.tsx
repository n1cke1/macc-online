'use client';
// Bundle-hygiene gate for the authoring layer. `authoringEnabled` is a build-time
// constant, so when it's off this returns null and the dynamic import is never
// referenced — the editor chunk (schema + AST calc core) tree-shakes away and the
// anonymous static core stays lean. Mandatory feature, optional payload.
//
// A SECOND gate — «visible to logged-in users only» — lives INSIDE MeasureEditor
// (the lazy chunk), not here: the auth check needs the Supabase client, which the
// static core must never import eagerly (principle #1). So the editor renders its own
// section only when there is a session; anonymous visitors see nothing.
import dynamic from 'next/dynamic';
import { authoringEnabled } from '@/lib/config';

const MeasureEditor = dynamic(() => import('./MeasureEditor'), { ssr: false });
// «Connect the MCP to your chat» helper — also logged-in-gated, in the lazy chunk.
const McpConnectPanel = dynamic(() => import('./McpConnectPanel'), { ssr: false });

export default function MeasureAuthoringGate() {
  if (!authoringEnabled) return null;
  return (
    <div className="space-y-4">
      <MeasureEditor />
      <McpConnectPanel />
    </div>
  );
}
