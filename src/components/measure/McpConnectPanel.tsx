'use client';
// «Connect the MCP to your chat» helper. The hosted MCP is an OAuth remote server (the
// Cloudflare Worker), so connecting is just adding ONE URL as a custom connector — the
// app does the OAuth sign-in itself; no token to copy, nothing that expires. The URL is
// public (the connector address), so this is shown to everyone (no auth gate).
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { mcpConnectorUrl } from '@/lib/config';

export default function McpConnectPanel() {
  const locale = useLocale() as 'ru' | 'en';
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Hidden until the connector URL is configured (NEXT_PUBLIC_MCP_URL).
  if (!mcpConnectorUrl) return null;

  const copy = () => {
    void navigator.clipboard?.writeText(mcpConnectorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-bold"
      >
        <span>{tr('Подключить MCP к своему чату', 'Connect the MCP to your chat')}</span>
        <span className="text-xs font-normal text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-muted">
            {tr(
              'Добавьте этот адрес как «custom connector» в Claude (приложение или Claude Code). Вход под вашим аккаунтом произойдёт автоматически — копировать токен не нужно, ничего не протухает.',
              'Add this URL as a custom connector in Claude (the app or Claude Code). Sign-in under your account happens automatically — no token to copy, nothing expires.',
            )}
          </p>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{tr('Адрес коннектора', 'Connector URL')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded border border-line bg-white px-2 py-1 text-xs">{mcpConnectorUrl}</code>
              <button
                onClick={copy}
                className="shrink-0 rounded border border-line bg-white px-2 py-1 text-[11px] transition hover:bg-violet-50"
              >
                {copied ? tr('Скопировано ✓', 'Copied ✓') : tr('Копировать', 'Copy')}
              </button>
            </div>
          </div>

          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>{tr('Claude → Settings → Connectors → Add custom connector', 'Claude → Settings → Connectors → Add custom connector')}</li>
            <li>{tr('вставьте адрес выше', 'paste the URL above')}</li>
            <li>{tr('войдите под своим аккаунтом — инструменты меры станут доступны', 'sign in with your account — the measure tools become available')}</li>
          </ol>
        </div>
      )}
    </section>
  );
}
