'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

// Shown once on first visit; dismissed permanently (per browser) on "got it".
const DISMISS_KEY = 'macc.methodologyDismissed';

export default function MethodologyBanner() {
  const t = useTranslations('banner');
  const [open, setOpen] = useState(false);
  // `null` until localStorage is read — keeps SSR and the first client render in
  // sync (both render nothing), so there's no hydration mismatch and dismissers
  // never see a flash of the banner.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false); // storage blocked → just show it
    }
  }, []);

  if (dismissed !== false) return null; // unknown (null) or already dismissed

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore — best-effort persistence */
    }
    setDismissed(true);
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <div className="flex-1">
          <span className="font-medium">{t('scenario')}</span>{' '}
          <button onClick={() => setOpen((o) => !o)} className="underline underline-offset-2">
            {t('more')}
          </button>
          {open && <p className="mt-1.5 text-amber-800">{t('caveat')}</p>}
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
        >
          {t('gotIt')}
        </button>
      </div>
    </div>
  );
}
