'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { collabEnabled } from '@/lib/config';

const KEY = 'macc-howto-dismissed';

export default function HowToRead() {
  const t = useTranslations('howToRead');
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(localStorage.getItem(KEY) !== '1');
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(KEY, '1');
    setShow(false);
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700">
      <div className="mb-1.5 font-semibold text-slate-900">{t('title')}</div>
      <ul className="list-inside list-disc space-y-0.5">
        <li>{t('width')}</li>
        <li>{t('height')}</li>
        <li>{t('below')}</li>
        <li>{t('sorted')}</li>
      </ul>
      {collabEnabled && (
        <p className="mt-2 border-t border-sky-200/70 pt-2 text-slate-700">
          {t.rich('contribute', {
            link: (chunks) => (
              <Link href="/connect" className="font-medium text-sky-700 underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      <button
        onClick={dismiss}
        className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white"
      >
        {t('dismiss')}
      </button>
    </div>
  );
}
