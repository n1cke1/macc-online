'use client';
import { useLocale, useTranslations } from 'next-intl';
import { dataset, sectorLabel, pick } from '@/lib/data';
import type { CostItem, PhysicalItem } from '@data/schema';
import { fmt, fmtMac, fmtInt, fmtMt, fmtPct, formatUnit } from '@/lib/format';
import { useUi, useScenario } from '@/store';

export default function ProjectDrilldown() {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('drilldown');
  const { selectedId, select } = useUi();
  const projects = useScenario((s) => s.projects);
  const p = projects.find((x) => x.id === selectedId);
  if (!p) return null;

  const totalEmissionsKt = dataset.meta.totalEmissionsMt * 1000;
  const rows: [string, string][] = [
    [t('sector'), sectorLabel(p.sector, locale)],
    [t('abatement'), `${fmtMt(p.abatementKt, locale)} Mt/${locale === 'en' ? 'yr' : 'год'}`],
    [t('shareNational'), fmtPct(p.abatementKt / totalEmissionsKt, locale)],
    [t('mac'), `${fmtMac(p.mac, locale)} USD/${locale === 'en' ? 't' : 'т'}`],
    [t('capex'), `${fmtInt(p.capex, locale)} mUSD`],
    [t('opex'), `${fmtInt(p.opex, locale)} mUSD/${locale === 'en' ? 'yr' : 'год'}`],
    [t('duration'), `${p.durationYrs} ${locale === 'en' ? 'yr' : 'лет'}`],
    [t('npv'), `${fmtInt(p.npv, locale)} mUSD`],
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l border-line bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug">{pick(p.name, locale)}</h2>
        <button
          onClick={() => select(null)}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-slate-50"
        >
          {t('close')} ✕
        </button>
      </div>
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <PhysicalScale title={t('physicalScale')} items={p.physicalItems} locale={locale} />

      <CostBreakdown
        title={`${t('capex')}, mUSD`}
        items={p.capexItems}
        total={p.capex}
        locale={locale}
      />
      <CostBreakdown
        title={`${t('opex')}, mUSD/${locale === 'en' ? 'yr' : 'год'}`}
        items={p.opexItems}
        total={p.opex}
        locale={locale}
      />

      <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">{t('provenance')}</p>
    </div>
  );
}

function CostBreakdown({
  title,
  items,
  total,
  locale,
}: {
  title: string;
  items?: CostItem[];
  total: number;
  locale: 'ru' | 'en';
}) {
  if (!items || items.length === 0) return null;
  const num = (v: number) => fmt(v, locale, { maximumFractionDigits: 1 });
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((it) => (
          <li key={it.cell} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="text-slate-700">{pick(it.label, locale)}</span>
            <span className={`tabular-nums ${it.value < 0 ? 'text-green-600' : ''}`}>{num(it.value)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 bg-slate-50 px-3 py-1.5 text-sm font-semibold">
          <span>{locale === 'en' ? 'Total' : 'Итого'}</span>
          <span className="tabular-nums">{num(total)}</span>
        </li>
      </ul>
    </section>
  );
}

/** Tangible non-monetary scale behind the CAPEX (MW, ha, km, head, …). */
function PhysicalScale({
  title,
  items,
  locale,
}: {
  title: string;
  items?: PhysicalItem[];
  locale: 'ru' | 'en';
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((it) => (
          <li key={it.cell} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="text-slate-700">{pick(it.label, locale)}</span>
            <span className="shrink-0 tabular-nums">
              {fmt(it.value, locale, { maximumFractionDigits: Math.abs(it.value) < 100 ? 1 : 0 })}{' '}
              <span className="text-muted">{formatUnit(it.unit, locale)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
