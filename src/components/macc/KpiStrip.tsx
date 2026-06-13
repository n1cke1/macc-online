'use client';
import { useLocale, useTranslations } from 'next-intl';
import { fmtMt, fmtMac, fmtPct } from '@/lib/format';
import { useScenario } from '@/store';

export default function KpiStrip() {
  const locale = useLocale();
  const t = useTranslations('kpi');
  const totals = useScenario((s) => s.totals);
  const projects = useScenario((s) => s.projects);
  const noRegretsShare = totals.noRegretsAbatementKt / totals.abatementKt;

  const items = [
    { label: t('totalAbatement'), value: `${fmtMt(totals.abatementKt, locale)} Mt` },
    { label: t('noRegrets'), value: fmtPct(noRegretsShare, locale) },
    { label: t('weightedMac'), value: `${fmtMac(totals.weightedAvgMac, locale)} USD/${locale === 'en' ? 't' : 'т'}` },
    { label: t('projects'), value: String(projects.length) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-line bg-white px-4 py-3">
          <div className="text-xs text-muted">{it.label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
