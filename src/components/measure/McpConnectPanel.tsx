'use client';
// «Connect the hosted MCP to your own chat» helper. A collapsible panel (like the
// global-assumptions one) that hands a signed-in user a ready MCP client config for
// the deployed Edge Function — the endpoint + their own Supabase access token in the
// Authorization header. Logged-in only (the tools require a token); rendered inside
// the lazy authoring chunk (MeasureAuthoringGate) so the static core never imports
// Supabase eagerly.
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/lib/supabase/auth';
import { supabaseUrl } from '@/lib/config';

export default function McpConnectPanel() {
  const locale = useLocale() as 'ru' | 'en';
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru);

  // A token is required, so this is for signed-in users only.
  if (!session) return null;

  const endpoint = `${supabaseUrl}/functions/v1/mcp`;
  const token = session.access_token;
  const snippet = JSON.stringify(
    { mcpServers: { 'macc-measure': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
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
              'Добавьте сервер в свой MCP-клиент (Claude Code / Claude Desktop). Инструменты работают под вашей учётной записью. Токен действует ~1 час — обновите страницу, чтобы получить свежий.',
              'Add the server to your MCP client (Claude Code / Claude Desktop). The tools run under your account. The token lasts ~1 hour — reload the page to get a fresh one.',
            )}
          </p>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{tr('Эндпойнт', 'Endpoint')}</p>
            <code className="block break-all rounded border border-line bg-white px-2 py-1 text-xs">{endpoint}</code>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr('Конфиг (.mcp.json)', 'Config (.mcp.json)')}</p>
              <button
                onClick={() => copy(snippet, 'snippet')}
                className="shrink-0 rounded border border-line bg-white px-2 py-0.5 text-[11px] transition hover:bg-violet-50"
              >
                {copied === 'snippet' ? tr('Скопировано ✓', 'Copied ✓') : tr('Копировать', 'Copy')}
              </button>
            </div>
            <pre className="overflow-x-auto rounded border border-line bg-white px-2 py-2 text-[11px] leading-relaxed">{snippet}</pre>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => copy(token, 'token')}
              className="rounded border border-line bg-white px-2 py-0.5 text-[11px] transition hover:bg-violet-50"
            >
              {copied === 'token' ? tr('Токен скопирован ✓', 'Token copied ✓') : tr('Скопировать только токен', 'Copy token only')}
            </button>
            <span className="text-[11px] text-muted">
              {tr('Токен — это ваша сессия; не делитесь им.', 'The token is your session — do not share it.')}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
