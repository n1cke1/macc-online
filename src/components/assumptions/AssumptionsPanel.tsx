'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { pick } from '@/lib/data';
import { fmt } from '@/lib/format';
import { LEVER_META, type LeverKey, type LeverMeta } from '@/lib/scenario';
import { useScenario } from '@/store';
import AnchorComments from '@/components/collab/AnchorComments';

/** Format a lever value with its unit (WACC shown as a percentage). */
function formatValue(m: LeverMeta, value: number, locale: string): string {
  if (m.key === 'discountRate') {
    return fmt(value * 100, locale, { maximumFractionDigits: 1 }) + '%';
  }
  const n = fmt(value, locale, { maximumFractionDigits: m.step < 1 ? 1 : 0 });
  return m.unit ? `${n} ${m.unit}` : n;
}

function LeverSlider({ meta }: { meta: LeverMeta }) {
  const locale = useLocale();
  const committed = useScenario((s) => s.levers[meta.key]);
  const setLever = useScenario((s) => s.setLever);

  // Local draft tracks the thumb during a drag; the curve only recomputes (and
  // re-sorts) on release — per the UX rule "bars re-sort on slider release".
  const [draft, setDraft] = useState(committed);
  useEffect(() => setDraft(committed), [committed]);

  const isOff = Math.abs(committed - meta.value) > 1e-9;
  const commit = (v: number) => {
    if (Math.abs(v - committed) > 1e-9) setLever(meta.key, v);
  };

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={`lever-${meta.key}`} className="text-sm text-slate-700">
          {pick(meta.label, locale as 'ru' | 'en')}
        </label>
        <span className={`text-sm font-semibold tabular-nums ${isOff ? 'text-sky-700' : ''}`}>
          {formatValue(meta, draft, locale)}
        </span>
      </div>
      <input
        id={`lever-${meta.key}`}
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-sky-600"
      />
      <div className="flex justify-between text-[10px] text-muted">
        <span>{formatValue(meta, meta.min, locale)}</span>
        <span className="text-slate-400">
          {locale === 'en' ? 'base' : 'база'} {formatValue(meta, meta.value, locale)}
        </span>
        <span>{formatValue(meta, meta.max, locale)}</span>
      </div>
      {/* Assumption-anchored review thread (collab layer; null when backend off). */}
      <AnchorComments type="assumption" id={meta.key} collapsible className="mt-1.5" />
    </div>
  );
}

export default function AssumptionsPanel() {
  const locale = useLocale();
  const t = useTranslations('assumptions');
  const atBaseline = useScenario((s) => s.atBaseline);
  const computing = useScenario((s) => s.computing);
  const reset = useScenario((s) => s.reset);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <div className="flex items-center gap-2">
          {computing && <span className="text-xs text-sky-600">{t('computing')}</span>}
          <button
            onClick={reset}
            disabled={atBaseline}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:bg-slate-50 disabled:opacity-40"
          >
            {t('reset')}
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">{t('hint')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LEVER_META.map((m: LeverMeta & { key: LeverKey }) => (
          <LeverSlider key={m.key} meta={m} />
        ))}
      </div>
    </section>
  );
}
