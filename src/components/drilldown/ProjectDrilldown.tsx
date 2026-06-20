'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { dataset, sectorLabel, pick, itemAnchorKey } from '@/lib/data';
import type { CostItem, PhysicalItem, LocalInput } from '@data/schema';
import { fmt, fmtMac, fmtInt, fmtMt, fmtPct, formatUnit } from '@/lib/format';
import { useUi, useScenario } from '@/store';
import AnchorComments from '@/components/collab/AnchorComments';
import Commentable from '@/components/collab/Commentable';

export default function ProjectDrilldown() {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('drilldown');
  const { selectedId, rightOpen, closeRight } = useUi();
  const projects = useScenario((s) => s.projects);
  const p = projects.find((x) => x.id === selectedId);
  if (!p || !rightOpen) return null;

  const totalEmissionsKt = dataset.meta.totalEmissionsMt * 1000;
  const rows: { key: string; label: string; value: string }[] = [
    { key: 'sector', label: t('sector'), value: sectorLabel(p.sector, locale) },
    { key: 'abatement', label: t('abatement'), value: `${fmtMt(p.abatementKt, locale)} Mt/${locale === 'en' ? 'yr' : 'год'}` },
    { key: 'shareNational', label: t('shareNational'), value: fmtPct(p.abatementKt / totalEmissionsKt, locale) },
    { key: 'mac', label: t('mac'), value: `${fmtMac(p.mac, locale)} USD/${locale === 'en' ? 't' : 'т'}` },
    { key: 'capex', label: t('capex'), value: `${fmtInt(p.capex, locale)} mUSD` },
    { key: 'opex', label: t('opex'), value: `${fmtInt(p.opex, locale)} mUSD/${locale === 'en' ? 'yr' : 'год'}` },
    { key: 'duration', label: t('duration'), value: `${p.durationYrs} ${locale === 'en' ? 'yr' : 'лет'}` },
    { key: 'npv', label: t('npv'), value: `${fmtInt(p.npv, locale)} mUSD` },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l border-line bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug">{pick(p.name, locale)}</h2>
        <button
          onClick={() => closeRight()}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-slate-50"
        >
          {t('close')} ✕
        </button>
      </div>
      <dl className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-muted">{r.label}</dt>
            <dd className="text-right font-medium tabular-nums">
              <Commentable id={`project:${p.id}:${r.key}`} label={`${pick(p.name, locale)} · ${r.label}`}>
                {r.value}
              </Commentable>
            </dd>
          </div>
        ))}
      </dl>

      <Assumptions
        title={t('assumptions')}
        hint={t('assumptionsHint')}
        items={p.localInputs}
        locale={locale}
        projectId={p.id}
      />

      <PhysicalScale title={t('physicalScale')} items={p.physicalItems} locale={locale} projectId={p.id} />

      <CostBreakdown
        title={`${t('capex')}, mUSD`}
        items={p.capexItems}
        total={p.capex}
        locale={locale}
        projectId={p.id}
      />
      <CostBreakdown
        title={`${t('opex')}, mUSD/${locale === 'en' ? 'yr' : 'год'}`}
        items={p.opexItems}
        total={p.opex}
        locale={locale}
        projectId={p.id}
      />

      <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">{t('provenance')}</p>

      <AnchorComments type="project" id={String(p.id)} />
    </div>
  );
}

function CostBreakdown({
  title,
  items,
  total,
  locale,
  projectId,
}: {
  title: string;
  items?: CostItem[];
  total: number;
  locale: 'ru' | 'en';
  projectId: number;
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
            <Commentable id={`project:${projectId}:item:${itemAnchorKey(it.label)}`} label={pick(it.label, locale)}>
              <span className={`tabular-nums ${it.value < 0 ? 'text-green-600' : ''}`}>{num(it.value)}</span>
            </Commentable>
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

/** Editable per-measure assumptions (IN-L rows) — the premises behind the result. */
function Assumptions({
  title,
  hint,
  items,
  locale,
  projectId,
}: {
  title: string;
  hint: string;
  items?: LocalInput[];
  locale: 'ru' | 'en';
  projectId: number;
}) {
  const t = useTranslations('drilldown');
  const overrides = useScenario((s) => s.overrides);
  const clearOverrides = useScenario((s) => s.clearOverrides);
  if (!items || items.length === 0) return null;
  const overriddenCells = items.filter((it) => it.cell in overrides).map((it) => it.cell);
  const anyOverridden = overriddenCells.length > 0;
  return (
    <section className="mt-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {anyOverridden && (
          <button
            onClick={() => clearOverrides(overriddenCells)}
            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition hover:bg-slate-50"
            title={t('resetProjectHint')}
          >
            {t('resetProject')}
          </button>
        )}
      </div>
      <p className="mb-1 text-xs text-muted">{hint}</p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((it) => (
          <AssumptionRow key={it.cell} it={it} locale={locale} projectId={projectId} />
        ))}
      </ul>
    </section>
  );
}

/** One editable IN-L row: number input committed on Enter or blur. */
function AssumptionRow({
  it,
  locale,
  projectId,
}: {
  it: LocalInput;
  locale: 'ru' | 'en';
  projectId: number;
}) {
  const t = useTranslations('drilldown');
  const override = useScenario((s) => s.overrides[it.cell]);
  const setOverride = useScenario((s) => s.setOverride);
  const clearOverride = useScenario((s) => s.clearOverride);

  const baseline = it.value;
  const current = override ?? baseline;
  const isOverridden = override !== undefined;

  const num = (v: number) => {
    const a = Math.abs(v);
    return fmt(v, locale, { maximumFractionDigits: a < 1 ? 3 : a < 100 ? 1 : 0 });
  };

  // Local draft lets the user type freely; we only push to the store on commit
  // (Enter / blur), matching the slider's "release to commit" feel. The effect
  // resyncs the draft whenever the committed override changes from elsewhere
  // (per-row ↺, project-wide reset, global reset).
  const [draft, setDraft] = useState<string>(String(current));
  useEffect(() => setDraft(String(current)), [current]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(current));
      return;
    }
    // Snapping back to baseline drops the override entirely so the empty-overrides
    // baseline contract (pinned by the golden test) holds.
    if (Math.abs(parsed - baseline) < 1e-12) {
      if (isOverridden) clearOverride(it.cell);
      else setDraft(String(baseline));
      return;
    }
    if (!isOverridden || Math.abs(parsed - override!) > 1e-12) {
      setOverride(it.cell, parsed);
    }
  };

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
      <span className="min-w-0 text-slate-700">
        {pick(it.label, locale)}
        {it.source && <span className="block truncate text-xs text-muted">{it.source}</span>}
      </span>
      <Commentable id={`project:${projectId}:item:${itemAnchorKey(it.label)}`} label={pick(it.label, locale)}>
        <div className="shrink-0 text-right">
          <div className="flex items-baseline justify-end gap-1">
            <input
              type="number"
              step="any"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                else if (e.key === 'Escape') setDraft(String(current));
              }}
              aria-label={pick(it.label, locale)}
              className={`w-20 rounded border px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                isOverridden
                  ? 'border-sky-300 bg-sky-50 text-sky-800'
                  : 'border-line bg-white text-slate-800'
              }`}
            />
            {it.unit && <span className="text-xs text-muted">{formatUnit(it.unit, locale)}</span>}
          </div>
          {isOverridden && (
            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted">
              <span className="tabular-nums">
                {t('baselineLabel')} {num(baseline)}
              </span>
              <button
                onClick={() => clearOverride(it.cell)}
                aria-label={t('resetItem')}
                title={t('resetItem')}
                className="rounded px-1 text-sky-600 transition hover:bg-sky-50"
              >
                ↺
              </button>
            </div>
          )}
        </div>
      </Commentable>
    </li>
  );
}

/** Tangible non-monetary scale behind the CAPEX (MW, ha, km, head, …). */
function PhysicalScale({
  title,
  items,
  locale,
  projectId,
}: {
  title: string;
  items?: PhysicalItem[];
  locale: 'ru' | 'en';
  projectId: number;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((it) => (
          <li key={it.cell} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="text-slate-700">{pick(it.label, locale)}</span>
            <Commentable id={`project:${projectId}:item:${itemAnchorKey(it.label)}`} label={pick(it.label, locale)}>
              <span className="shrink-0 tabular-nums">
                {fmt(it.value, locale, { maximumFractionDigits: Math.abs(it.value) < 100 ? 1 : 0 })}{' '}
                <span className="text-muted">{formatUnit(it.unit, locale)}</span>
              </span>
            </Commentable>
          </li>
        ))}
      </ul>
    </section>
  );
}
