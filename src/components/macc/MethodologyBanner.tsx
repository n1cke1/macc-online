'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function MethodologyBanner() {
  const t = useTranslations('banner');
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <div>
          <span className="font-medium">{t('scenario')}</span>{' '}
          <button onClick={() => setOpen((o) => !o)} className="underline underline-offset-2">
            {t('more')}
          </button>
          {open && <p className="mt-1.5 text-amber-800">{t('caveat')}</p>}
        </div>
      </div>
    </div>
  );
}
