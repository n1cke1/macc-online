'use client';
// Sign-up dialog behind the header's "Connect AI" button. Mounted only once the button is
// pressed, so the Supabase auth helpers stay out of the first load and out of the static
// core. Registering here is just a magic link — the site has no passwords anywhere.
//
// Someone already signed in has nothing to register: send them straight to the connector
// panel and close.
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { authProviders, type OAuthProvider } from '@/lib/config';
import { useAuth, signInWithProvider, signInWithEmail } from '@/lib/supabase/auth';
import { openConnectPanel } from '@/lib/connect-panel';

const PROVIDER_LABEL: Record<OAuthProvider, string> = { linkedin_oidc: 'LinkedIn', google: 'Google' };

export default function ConnectAiDialog({ onClose }: { onClose: () => void }) {
  const locale = useLocale() as 'ru' | 'en';
  const tr = (ru: string, en: string) => (locale === 'en' ? en : ru);
  const t = useTranslations('collab.auth');
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Esc closes, like any modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Already signed in — skip the dialog entirely.
  useEffect(() => {
    if (!loading && session) { openConnectPanel(); onClose(); }
  }, [loading, session, onClose]);

  if (loading || session) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold">{tr('Подключить AI', 'Connect AI')}</h2>
          <button
            onClick={() => onClose()}
            aria-label={tr('Закрыть', 'Close')}
            className="-mr-1 -mt-1 rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-50 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-slate-700">
          {tr(
            'Подключите коннектор к Claude или ChatGPT — и AI разберёт формулы, предпосылки и источники любой меры, предложит правки и добавит проект, которого на кривой ещё нет.',
            'Connect the connector to Claude or ChatGPT — the AI can then walk the formulas, assumptions and sources behind any measure, propose corrections, and add a project the curve does not have yet.',
          )}
        </p>
        <p className="mt-2 text-xs text-muted">
          {tr(
            'Нужна учётная запись: вход по ссылке на почту, пароль придумывать не надо.',
            'It needs an account — you sign in by a link sent to your email; there is no password to invent.',
          )}
        </p>

        <div className="mt-4 space-y-1.5">
          {authProviders.map((p) => (
            <button
              key={p}
              onClick={() => void signInWithProvider(p)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm hover:bg-slate-50"
            >
              {t('continueWith', { provider: PROVIDER_LABEL[p] })}
            </button>
          ))}
        </div>

        <div className="my-3 text-center text-[10px] uppercase text-slate-400">{t('or')}</div>

        {sent ? (
          <div className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
            <p>{t('linkSent')}</p>
            <p className="mt-1">
              {tr(
                'После входа адрес коннектора и инструкция ждут в блоке «Добавить свою меру вместе с AI».',
                'Once you are in, the connector URL and the steps are in the “Add your own measure with AI” panel.',
              )}
            </p>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              const { error } = await signInWithEmail(email);
              if (error) setErr(error);
              else setSent(true);
            }}
            className="space-y-1.5"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="w-full rounded-md border border-line px-2 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              {t('sendLink')}
            </button>
            {err && <p className="text-xs text-red-600">{err}</p>}
          </form>
        )}

        <button
          onClick={() => { onClose(); openConnectPanel(); }}
          className="mt-3 w-full text-center text-xs text-muted underline underline-offset-2 hover:text-slate-700"
        >
          {tr('Сначала посмотреть, что это такое', 'Show me what this is first')}
        </button>
      </div>
    </div>
  );
}
