'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { authProviders, type OAuthProvider } from '@/lib/config';
import { useAuth, signInWithProvider, signInWithEmail, signOut } from '@/lib/supabase/auth';

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  linkedin_oidc: 'LinkedIn',
  google: 'Google',
};

export default function AuthButton() {
  const t = useTranslations('collab.auth');
  const { session, profile, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <span className="text-xs text-muted">…</span>;

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-600">
          {profile?.display_name ?? session.user.email}
          {profile && profile.role !== 'user' && (
            <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold uppercase text-sky-700">
              {profile.role}
            </span>
          )}
        </span>
        <button
          onClick={() => void signOut()}
          className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-slate-50"
        >
          {t('signOut')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {t('signIn')}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-line bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs text-muted">{t('signInPrompt')}</p>
          <div className="space-y-1.5">
            {authProviders.map((p) => (
              <button
                key={p}
                onClick={() => void signInWithProvider(p)}
                className="w-full rounded-md border border-line px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                {t('continueWith', { provider: PROVIDER_LABEL[p] })}
              </button>
            ))}
          </div>
          <div className="my-2 text-center text-[10px] uppercase text-slate-400">{t('or')}</div>
          {sent ? (
            <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">{t('linkSent')}</p>
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
                className="w-full rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              >
                {t('sendLink')}
              </button>
              {err && <p className="text-xs text-red-600">{err}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
