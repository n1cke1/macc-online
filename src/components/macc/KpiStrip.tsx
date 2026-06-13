'use client';
import { useLocale, useTranslations } from 'next-intl';
import { fmtMt, fmtMac, fmtPct } from '@/lib/format';
import { useScenario } from '@/store';
import Commentable from '@/components/collab/Commentable';

export default function KpiStrip() {
  const locale = useLocale();
  const t = useTranslations('kpi');
  const totals = useScenario((s) => s.totals);
  const projects = useScenario((s) => s.projects);
  const noRegretsShare = totals.noRegretsAbatementKt / totals.abatementKt;

  const items = [
    { key: 'totalAbatement', label: t('totalAbatement'), value: `${fmtMt(totals.abatementKt, locale)} Mt` },
    { key: 'noRegrets', label: t('noRegrets'), value: fmtPct(noRegretsShare, locale) },
    { key: 'weightedMac', label: t('weightedMac'), value: `${fmtMac(totals.weightedAvgMac, locale)} USD/${locale === 'en' ? 't' : 'т'}` },
    { key: 'projects', label: t('projects'), value: String(projects.length) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.key} className="rounded-lg border border-line bg-white px-4 py-3">
          <div className="text-xs text-muted">{it.label}</div>
          <Commentable id={`kpi:${it.key}`} label={it.label}>
            <div className="mt-1 text-lg font-semibold tabular-nums">{it.value}</div>
          </Commentable>
        </div>
      ))}
    </div>
  );
}
