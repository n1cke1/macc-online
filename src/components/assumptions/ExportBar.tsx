'use client';
import { useLocale, useTranslations } from 'next-intl';
import { modelVersion } from '@/lib/data';
import {
  buildScenarioJson,
  buildMeasuresCsv,
  buildCurveCsv,
  serializeChartSvg,
  download,
} from '@/lib/export';
import { useScenario } from '@/store';

export default function ExportBar() {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('exports');
  const projects = useScenario((s) => s.projects);
  const totals = useScenario((s) => s.totals);
  const levers = useScenario((s) => s.levers);

  const stamp = modelVersion;

  const onScenario = () => {
    const json = buildScenarioJson({
      modelVersion,
      levers,
      totals,
      projects,
      locale,
      url: window.location.href,
    });
    download(`macc-scenario_${stamp}.json`, JSON.stringify(json, null, 2), 'application/json');
  };

  const onMeasuresCsv = () =>
    download(`macc-measures_${stamp}.csv`, buildMeasuresCsv(projects, locale), 'text/csv');

  const onCurveCsv = () =>
    download(`macc-curve_${stamp}.csv`, buildCurveCsv(projects, locale), 'text/csv');

  const onSvg = () => {
    // Pick the on-screen chart (the responsive layout renders one visible svg).
    const nodes = Array.from(
      document.querySelectorAll<SVGSVGElement>('svg[data-macc-chart]'),
    );
    const svg = nodes.find((n) => n.getBoundingClientRect().width > 0) ?? nodes[0];
    if (!svg) return;
    download(`macc-curve_${stamp}.svg`, serializeChartSvg(svg), 'image/svg+xml');
  };

  const btn =
    'rounded-md border border-line px-2.5 py-1 text-xs text-slate-700 transition hover:bg-slate-50';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{t('label')}</span>
      <button className={btn} onClick={onScenario}>
        {t('scenario')}
      </button>
      <button className={btn} onClick={onMeasuresCsv}>
        {t('measuresCsv')}
      </button>
      <button className={btn} onClick={onCurveCsv}>
        {t('curveCsv')}
      </button>
      <button className={btn} onClick={onSvg}>
        {t('svg')}
      </button>
    </div>
  );
}
