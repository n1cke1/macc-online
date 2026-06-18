'use client';
// OAuth login bridge for the Cloudflare MCP Worker. The Worker's /authorize sends the
// browser here with ?txn & ?cb; the user signs in with Supabase (the existing
// providers), then we hand the identity back to the Worker's /callback to complete the
// OAuth grant. txn+cb are persisted across the provider round-trip (which strips the
// query) via sessionStorage.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { collabEnabled, authProviders } from '@/lib/config';
import { useAuth, signInWithProvider, signInWithEmail } from '@/lib/supabase/auth';

const PROVIDER_LABEL: Record<string, string> = { linkedin_oidc: 'LinkedIn', google: 'Google' };

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-line bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

export default function ConnectClient() {
  const locale = useLocale() as 'ru' | 'en';
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru);
  const { session, loading } = useAuth();
  const [params, setParams] = useState<{ txn?: string; cb?: string }>({});
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // Capture txn+cb (persist across the provider redirect, which drops the query string).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const txn = sp.get('txn') ?? undefined;
    const cb = sp.get('cb') ?? undefined;
    if (txn && cb) {
      sessionStorage.setItem('mcp_oauth', JSON.stringify({ txn, cb }));
      setParams({ txn, cb });
    } else {
      const saved = sessionStorage.getItem('mcp_oauth');
      if (saved) setParams(JSON.parse(saved) as { txn: string; cb: string });
    }
  }, []);

  // Once signed in (and we have the OAuth params), return the identity to the Worker.
  useEffect(() => {
    if (!session || !params.txn || !params.cb || redirecting) return;
    setRedirecting(true);
    sessionStorage.removeItem('mcp_oauth');
    const u = new URL(params.cb);
    u.searchParams.set('txn', params.txn);
    u.searchParams.set('sb', session.access_token);
    window.location.href = u.toString();
  }, [session, params, redirecting]);

  if (!collabEnabled) {
    return <Shell>{tr('Коллаборация выключена (нет Supabase).', 'Collaboration is disabled (no Supabase).')}</Shell>;
  }
  if (!params.txn || !params.cb) {
    return (
      <Shell>
        <h1 className="mb-2 text-base font-bold">{tr('Подключение MCP', 'Connect the MCP')}</h1>
        <p className="text-sm text-muted">
          {tr('Нет параметров авторизации. Откройте эту страницу из мастера подключения коннектора в приложении Claude.',
            'No authorization parameters. Open this page from the connector setup flow in your Claude app.')}
        </p>
      </Shell>
    );
  }
  if (session || redirecting) {
    return <Shell>{tr('Вход выполнен — возвращаемся в приложение…', 'Signed in — returning to your app…')}</Shell>;
  }
  if (loading) return <Shell>…</Shell>;

  return (
    <Shell>
      <h1 className="mb-1 text-base font-bold">{tr('Подключить MCP к Claude', 'Connect the MCP to Claude')}</h1>
      <p className="mb-4 text-sm text-muted">
        {tr('Войдите — после этого приложение получит доступ к инструментам меры под вашей учётной записью.',
          'Sign in — your app will then access the measure tools under your account.')}
      </p>
      <div className="space-y-2">
        {authProviders.map((p) => (
          <button
            key={p}
            onClick={() => void signInWithProvider(p)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
          >
            {tr('Продолжить с', 'Continue with')} {PROVIDER_LABEL[p] ?? p}
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        {sent ? (
          <p className="text-sm text-emerald-700">{tr('Ссылка отправлена — проверьте почту.', 'Link sent — check your email.')}</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await signInWithEmail(email);
              if (!error) setSent(true);
            }}
            className="flex gap-2"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={tr('почта', 'email')}
              className="min-w-0 flex-1 rounded-md border border-line px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
            <button className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-slate-50">
              {tr('Ссылка', 'Link')}
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}
