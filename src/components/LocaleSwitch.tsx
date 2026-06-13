'use client';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

export default function LocaleSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex overflow-hidden rounded-md border border-line text-xs">
      {routing.locales.map((l) => (
        <button
          key={l}
          onClick={() => router.replace(pathname, { locale: l })}
          className={`px-2.5 py-1 uppercase ${
            l === locale ? 'bg-slate-900 text-white' : 'bg-white text-muted hover:bg-slate-50'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
