'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { assumptions, pick } from '@/lib/data';
import type { Assumption } from '@data/schema';
import { fmt, formatUnit } from '@/lib/format';
import { useScenario } from '@/store';
import AnchorComments from '@/components/collab/AnchorComments';

/** The shared, globally-editable assumptions surfaced here: unit CAPEX
 * (MACC!E45..E57). Centralized on the «Допущения» sheet; an edit shifts the
 * value for EVERY project that uses it (vs the per-measure overrides in the
 * drill-down, which are local). Emission factors are intentionally excluded —
 * they are physical constants, not user-tunable scenario knobs. */
const GLOBALS: Assumption[] = assumptions.filter(
  (a) => !a.isLever && a.group !== 'emission_factor',
);

const GROUP_ORDER: Assumption['group'][] = ['capex_unit'];

function numFmt(v: number, locale: string): string {
  const a = Math.abs(v);
  return fmt(v, locale, { maximumFractionDigits: a < 1 ? 3 : a < 100 ? 1 : 0 });
}

/** One globally-editable assumption: number input committed on Enter / blur.
 * Mirrors the drill-down's AssumptionRow but writes a GLOBAL override (amber)
 * to distinguish it from local per-measure edits (sky). */
function GlobalRow({ a }: { a: Assumption }) {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('assumptions');
  const override = useScenario((s) => s.overrides[a.cell]);
  const setOverride = useScenario((s) => s.setOverride);
  const clearOverride = useScenario((s) => s.clearOverride);

  const baseline = a.value;
  const current = override ?? baseline;
  const isOverridden = override !== undefined;

  // Local draft so the user can type freely; push to the store only on commit.
  const [draft, setDraft] = useState<string>(String(current));
  useEffect(() => setDraft(String(current)), [current]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(current));
      return;
    }
    // Snapping back to baseline drops the override (keeps the empty-overrides
    // baseline contract the golden test pins).
    if (Math.abs(parsed - baseline) < 1e-12) {
      if (isOverridden) clearOverride(a.cell);
      else setDraft(String(baseline));
      return;
    }
    if (!isOverridden || Math.abs(parsed - override!) > 1e-12) {
      setOverride(a.cell, parsed);
    }
  };

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
      <span className="min-w-0 text-slate-700">{pick(a.label, locale)}</span>
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
            aria-label={pick(a.label, locale)}
            className={`w-20 rounded border px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-400 ${
              isOverridden
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-line bg-white text-slate-800'
            }`}
          />
          {a.unit && <span className="text-xs text-muted">{formatUnit(a.unit, locale)}</span>}
        </div>
        {isOverridden && (
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted">
            <span className="tabular-nums">
              {t('baselineLabel')} {numFmt(baseline, locale)}
            </span>
            <button
              onClick={() => clearOverride(a.cell)}
              aria-label={t('resetItem')}
              title={t('resetItem')}
              className="rounded px-1 text-amber-600 transition hover:bg-amber-50"
            >
              ↺
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export default function GlobalAssumptionsPanel() {
  const t = useTranslations('assumptions');
  const overrides = useScenario((s) => s.overrides);
  const clearOverrides = useScenario((s) => s.clearOverrides);
  const [open, setOpen] = useState(false);

  // Active global overrides = override cells that belong to a global assumption.
  const globalCells = useMemo(() => GLOBALS.map((a) => a.cell), []);
  const activeCount = globalCells.filter((c) => c in overrides).length;

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: GLOBALS.filter((a) => a.group === g),
  })).filter((x) => x.items.length > 0);

  const groupLabel = (g: Assumption['group']) =>
    g === 'emission_factor' ? t('groupEmissionFactor') : t('groupCapexUnit');

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('globalTitle')}</h2>
          {activeCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-xs text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="text-xs text-muted">{t('globalHint')}</p>
            {activeCount > 0 && (
              <button
                onClick={() => clearOverrides(globalCells)}
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition hover:bg-slate-50"
              >
                {t('globalReset')}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {groupLabel(group)}
                </h3>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {items.map((a) => (
                    <GlobalRow key={a.cell} a={a} />
                  ))}
                </ul>
                {/* One assumption-anchored review thread per global (collab off → null). */}
              </div>
            ))}
          </div>
          {/* Group-level comment anchor keeps the panel commentable without 17 threads. */}
          <AnchorComments type="assumption" id="globals" collapsible className="mt-3" />
        </div>
      )}
    </section>
  );
}
