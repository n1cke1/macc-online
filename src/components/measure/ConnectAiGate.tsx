'use client';
// Header call-to-action for the MCP connector. The connector panel further down the page
// already carries the URL and the steps, but it is a collapsed accordion below the fold —
// people scroll past it. This is the visible entry point, shown to everyone (the connector
// URL is public, same as the panel).
//
// The button itself is plain: no Supabase import, so it server-renders with the rest of the
// header instead of popping in after hydration. The sign-up dialog — the only part that
// needs auth — is pulled in on click, which keeps the static core backend-free.
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { collabEnabled, mcpConnectorUrl } from '@/lib/config';
import { openConnectPanel } from '@/lib/connect-panel';

const ConnectAiDialog = dynamic(() => import('./ConnectAiDialog'), { ssr: false });

export default function ConnectAiGate() {
  const locale = useLocale() as 'ru' | 'en';
  const [asking, setAsking] = useState(false);

  if (!mcpConnectorUrl) return null;

  // Backend off → nobody to register with; the CTA is then just a jump to the panel.
  const onClick = () => (collabEnabled ? setAsking(true) : openConnectPanel());

  return (
    <>
      <button
        onClick={onClick}
        className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700"
      >
        {locale === 'en' ? 'Connect AI' : 'Подключить AI'}
      </button>
      {asking && <ConnectAiDialog onClose={() => setAsking(false)} />}
    </>
  );
}
