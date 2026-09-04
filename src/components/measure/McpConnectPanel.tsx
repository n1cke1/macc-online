'use client';
// «Add your own measure with AI» helper. The hosted MCP is an OAuth remote server (the
// Cloudflare Worker), so connecting is just adding ONE URL as a custom connector — the
// app does the OAuth sign-in itself; no token to copy, nothing that expires.
//
// How it works is public — the steps tell people what they are signing up for. Only the URL
// itself is masked until sign-in. Not a security boundary: the Worker answers 401 without a
// token, and the URL is inlined in this bundle at build time either way. It buys the email
// address of someone who wants the connector.
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { mcpConnectorUrl } from '@/lib/config';
import { OPEN_CONNECT_PANEL, openConnectDialog } from '@/lib/connect-panel';
import AuthGate from '@/components/collab/AuthGate';

export default function McpConnectPanel() {
  const locale = useLocale() as 'ru' | 'en';
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // The header CTA sends people here — expand and bring the panel into view.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(OPEN_CONNECT_PANEL, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_PANEL, onOpen);
  }, []);

  // Hidden until the connector URL is configured (NEXT_PUBLIC_MCP_URL).
  if (!mcpConnectorUrl) return null;

  // Same shape and width as the real thing, so the row does not jump on sign-in.
  const masked = mcpConnectorUrl.replace(/./g, '*');

  const copy = () => {
    void navigator.clipboard?.writeText(mcpConnectorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section ref={ref} className="scroll-mt-4 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-bold"
      >
        <span>{tr('Добавить свою меру вместе с AI', 'Add your own measure with AI')}</span>
        <span className="text-xs font-normal text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-muted">
            {tr(
              'Подключите этот MCP-коннектор к Claude или ChatGPT — и AI сможет проверять ключевые показатели, исходные предпосылки и источники данных, формулы, использованные в мерах декарбонизации, предлагать свои корректировки и новые проекты, которых пока нет на MACC.',
              'Connect this MCP connector to Claude or ChatGPT — the AI can then check the key indicators, the source assumptions and data sources, and the formulas behind each decarbonization measure, propose its own corrections, and add new projects not yet on the MACC.',
            )}
          </p>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{tr('Адрес коннектора', 'Connector URL')}</p>
            <AuthGate
              fallback={
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 select-none break-all rounded border border-line bg-white px-2 py-1 text-xs text-slate-400">{masked}</code>
                  <button
                    onClick={openConnectDialog}
                    className="shrink-0 rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-violet-700"
                  >
                    {tr('Войти и получить', 'Sign in to get it')}
                  </button>
                </div>
              }
            >
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded border border-line bg-white px-2 py-1 text-xs">{mcpConnectorUrl}</code>
                <button
                  onClick={copy}
                  className="shrink-0 rounded border border-line bg-white px-2 py-1 text-[11px] transition hover:bg-violet-50"
                >
                  {copied ? tr('Скопировано ✓', 'Copied ✓') : tr('Копировать', 'Copy')}
                </button>
              </div>
            </AuthGate>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold">{tr('В Claude', 'In Claude')}</p>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
              <li>{tr('Settings → Connectors → Add custom connector', 'Settings → Connectors → Add custom connector')}</li>
              <li>{tr('вставьте адрес выше', 'paste the URL above')}</li>
              <li>{tr('войдите под своим аккаунтом — инструменты меры станут доступны', 'sign in with your account — the measure tools become available')}</li>
            </ol>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold">{tr('В ChatGPT', 'In ChatGPT')}</p>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
              <li>{tr('Settings → Connectors (включите режим разработчика, если потребуется)', 'Settings → Connectors (enable developer mode if prompted)')}</li>
              <li>{tr('создайте custom connector (MCP) и вставьте адрес выше', 'create a custom connector (MCP) and paste the URL above')}</li>
              <li>{tr('авторизуйтесь — инструменты меры появятся в чате', 'sign in — the measure tools appear in the chat')}</li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
