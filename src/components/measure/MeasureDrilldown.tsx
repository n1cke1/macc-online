'use client';
// Read-only «разбор меры» under the table — the trust-anchor twin of MeasureEditor.
// Logged-in-gated (collab layer); opens for the bar selected on the chart. Same
// panels and the SAME formula engine (compute/validate/renderAst) as the editor,
// but every value is plain text — no inputs, no draft, no save. Reads the bundled
// static library + seed measures, so it needs no Supabase data round-trip; auth only
// controls visibility. Lazy-loaded via MeasureDrilldownGate so the static core never
// eagerly bundles the calc core or the Supabase client (principle #1).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { pick, sectorLabel } from '@/lib/data';
import { fmt, fmtMac, fmtInt } from '@/lib/format';
import { renderAst, evalAst } from '@/lib/measure/eval';
import { makeResolver, compute } from '@/lib/measure/compute';
import { validate, type CheckId, type CheckStatus, type PanelKey, type PanelStatus } from '@/lib/measure/validate';
import { type Ast, isLeafRef, isNode } from '@/lib/measure/ast';
import { library, getSeedMeasure } from '@/lib/measure/library';
import type { Localized, NumberOrRef } from '@/lib/measure/schema';
import { useUi } from '@/store';
import { useAuth } from '@/lib/supabase/auth';

const SLOT_LABEL: Record<string, Localized> = {
  abatement: { ru: 'снижение', en: 'reduction' }, activity: { ru: 'активность', en: 'activity' },
  capex: { ru: 'CAPEX×10⁶', en: 'CAPEX×10⁶' }, denominator: { ru: 'знаменатель', en: 'denominator' },
  sum_pool: { ru: 'Σ по пулу', en: 'Σ pool' }, ceiling: { ru: 'потолок', en: 'ceiling' },
  baseline: { ru: 'базовые выбросы', en: 'baseline' }, min: { ru: 'мин', en: 'min' }, max: { ru: 'макс', en: 'max' },
};

function glyph(s: PanelStatus | CheckStatus): { ch: string; cls: string } {
  switch (s) {
    case 'ok': return { ch: '✓', cls: 'text-green-600' };
    case 'warn': return { ch: '⚠', cls: 'text-amber-600' };
    case 'incomplete': return { ch: '○', cls: 'text-slate-400' };
    default: return { ch: '–', cls: 'text-slate-300' };
  }
}

function Badge({ children, tone = 'slate', title }: { children: ReactNode; tone?: 'slate' | 'sky' | 'amber' | 'green'; title?: string }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', sky: 'bg-sky-100 text-sky-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700' };
  return <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]} ${title ? 'cursor-help' : ''}`}>{children}</span>;
}

/** Read-only collapsible panel (open by default, like the editor's panels). */
function Panel({ pkey, title, status, children }: { pkey: PanelKey; title: string; status?: PanelStatus; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const g = status ? glyph(status) : null;
  return (
    <section className="rounded-lg border border-line bg-white" data-panel={pkey}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {g && <span className={g.cls} aria-hidden>{g.ch}</span>}{title}
        </span>
        <span className="text-xs text-muted" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-line px-3 py-3 text-sm">{children}</div>}
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </div>
  );
}

function ProvLink({ url }: { url?: string }) {
  if (!url) return null;
  return <> <a href={url} target="_blank" rel="noreferrer" className="text-sky-600 underline">↗</a></>;
}

export default function MeasureDrilldown() {
  const t = useTranslations('measure');
  const td = useTranslations('drilldown');
  const tm = useTranslations('measureDrill');
  const locale = useLocale() as 'ru' | 'en';
  const { session, loading: authLoading } = useAuth();
  const selectedId = useUi((s) => s.selectedId);

  const measure = useMemo(() => (selectedId != null ? getSeedMeasure(`kz-${selectedId}`) : undefined), [selectedId]);
  const result = useMemo(() => {
    if (!measure) return null;
    try {
      return { computed: compute(measure, library), validation: validate(measure, library) };
    } catch {
      return null;
    }
  }, [measure]);

  // Accordion: collapsed by default; selecting a bar opens it and scrolls into view.
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  useEffect(() => {
    if (selectedId == null) return;
    setOpen(true);
    setExpanded(new Set());
    const id = window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => window.clearTimeout(id);
  }, [selectedId]);

  // Logged-in only. Wait out the initial auth probe to avoid a flash, then require a session.
  if (authLoading || !session) return null;

  return (
    <section ref={ref} className="scroll-mt-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-sm font-bold">
          {tm('title')}
          {measure && <span className="ml-2 font-normal text-muted">· {pick(measure.name, locale)}</span>}
        </span>
        <span className="text-xs font-normal text-muted" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3">
          {!measure || !result ? (
            <p className="rounded-md border border-dashed border-line bg-white px-3 py-6 text-center text-sm text-muted">{tm('hint')}</p>
          ) : (
            <MeasureBody measure={measure} computed={result.computed} validation={result.validation}
              locale={locale} t={t} td={td} tm={tm} expanded={expanded} toggle={toggle} />
          )}
        </div>
      )}
    </section>
  );
}

type Computed = ReturnType<typeof compute>;
type Validation = ReturnType<typeof validate>;
type Measure = NonNullable<ReturnType<typeof getSeedMeasure>>;
type Tx = ReturnType<typeof useTranslations>;

function MeasureBody({
  measure, computed, validation, locale, t, td, tm, expanded, toggle,
}: {
  measure: Measure; computed: Computed; validation: Validation; locale: 'ru' | 'en';
  t: Tx; td: Tx; tm: Tx; expanded: Set<string>; toggle: (id: string) => void;
}) {
  const v = validation;
  const ab = measure.abatement;
  const basis = measure.baseline_basis;
  const product = measure.product_ref ? library.products[measure.product_ref] : undefined;
  const pool = measure.potential?.pool_ref ? library.pools[measure.potential.pool_ref] : undefined;
  const num = (n: number, d = 2) => fmt(n, locale, { maximumFractionDigits: d });
  const tech = (ref: string) => library.technologies[ref];

  const numOf = (x: NumberOrRef | undefined): number | undefined => (typeof x === 'number' ? x : undefined);
  const resolve = makeResolver(measure, library);
  const safeResolve = (key: string): number | undefined => { try { return resolve(key); } catch { return undefined; } };
  const cval = (path: string): number | undefined => {
    const c = measure.computed?.[path];
    return c ? evalAst(c.formula, resolve) : undefined;
  };
  const refName = (key: string): string => {
    const ind = key.match(/^(res|obj|prd|sub):([^#]+)(?:#(.+))?$/);
    if (ind) {
      const [, prefix, id, k] = ind;
      const owner =
        prefix === 'res' ? library.resources[id]?.name
        : prefix === 'obj' ? library.technologies[id]?.name
        : prefix === 'prd' ? library.products[id]?.name
        : undefined;
      const base = owner ? pick(owner, locale) : id;
      return k && k !== 'ef' ? `${base} · ${k}` : base;
    }
    const c = measure.computed?.[key];
    return c?.label ? pick(c.label, locale) : key;
  };
  const refLabel = (key: string): string => `[${refName(key)}]`;
  const collectRefs = (ast: Ast, acc: string[] = []): string[] => {
    if (isLeafRef(ast)) { if (!acc.includes(ast.ref)) acc.push(ast.ref); }
    else if (isNode(ast)) ast.args.forEach((a) => collectRefs(a, acc));
    return acc;
  };
  const formulaLine = (formula: Ast, depth: number) => (
    <div className="border-t border-line/60 py-0.5 text-xs italic text-slate-400" style={{ paddingLeft: 10 + depth * 14 }}>ƒ {renderAst(formula, refLabel)}</div>
  );
  const renderLeaf = (refKey: string, nodeId: string, depth: number): ReactNode => {
    const c = measure.computed?.[refKey];
    const inp = measure.inputs?.[refKey];
    const res = refKey.startsWith('res:') ? library.resources[refKey.slice(4)] : undefined;
    const val = safeResolve(refKey);
    const unit = inp?.unit ?? '';
    const isOpen = expanded.has(nodeId);
    return (
      <div key={nodeId}>
        <div className="flex items-center justify-between gap-2 border-t border-line/60 py-0.5 text-xs" style={{ paddingLeft: 10 + depth * 14 }}>
          <span className="flex items-center gap-1 text-slate-500">
            {c
              ? <button onClick={() => toggle(nodeId)} className="w-3 text-slate-400 hover:text-slate-700" aria-label="expand">{isOpen ? '▾' : '▸'}</button>
              : <span className="inline-block w-3 text-center text-slate-300">·</span>}
            <span>{refName(refKey)}</span>
            {c && <span className="text-slate-300" title={locale === 'en' ? 'computed' : 'вычислено'}>ƒ</span>}
            {inp && <span className="text-slate-400">{inp.provenance.source_type}/{inp.provenance.confidence}{inp.provenance.citation ? ` — ${inp.provenance.citation}` : ''}<ProvLink url={inp.provenance.url} /></span>}
            {res && <span className="text-slate-400">{locale === 'en' ? 'resource EF' : 'EF ресурса'}</span>}
          </span>
          <span className="tabular-nums text-slate-600">{val != null ? num(val, 4) : '—'}{unit ? ` ${unit}` : ''}</span>
        </div>
        {c && isOpen && (
          <>
            {formulaLine(c.formula, depth + 1)}
            {collectRefs(c.formula).map((r) => renderLeaf(r, `${nodeId}/${r}`, depth + 1))}
          </>
        )}
      </div>
    );
  };
  const breakdown = (path: string): ReactNode => {
    const c = measure.computed?.[path];
    if (!c || !expanded.has(path)) return null;
    return (
      <div className="rounded-b bg-slate-50/60">
        {formulaLine(c.formula, 1)}
        {collectRefs(c.formula).map((r) => renderLeaf(r, `${path}/${r}`, 1))}
      </div>
    );
  };
  const resolveNum = (x: NumberOrRef | undefined): number | undefined =>
    numOf(x) ?? (x != null && typeof x === 'object' && 'ref' in x ? safeResolve((x as { ref: string }).ref) : undefined);
  // Mirror of guardrails.economicsRollup: a computed formula wins, then the inline
  // scalar, then capacity × capex_ud × factor (capacity/factor may be {ref}s).
  const objCapex = (o: { technology_ref: string; capacity?: NumberOrRef; capex_ud_factor?: NumberOrRef; capex_musd?: NumberOrRef }, i: number) =>
    cval(`created_technologies[${i}].capex_musd`)
    ?? numOf(o.capex_musd)
    ?? (resolveNum(o.capacity) ?? 0) * (tech(o.technology_ref)?.capex_ud ?? 0) * (resolveNum(o.capex_ud_factor) ?? 1) / 1e6;
  const matCost = (m: { qty?: NumberOrRef; price?: NumberOrRef; cost_musd?: NumberOrRef; side: string }, i: number) => {
    const qty = cval(`materials[${i}].qty`) ?? numOf(m.qty) ?? 0;
    const price = cval(`materials[${i}].price`) ?? numOf(m.price) ?? 0;
    return (numOf(m.cost_musd) ?? qty * price / 1e6) * (m.side === 'retired' ? -1 : 1);
  };

  // A labelled value that, when a computed formula lives at `path`, gets a ƒ toggle
  // expanding the full derivation (formula + leaves) — the same affordance as materials.
  function FLine({ label, path, value, unit }: { label: ReactNode; path?: string; value: string; unit?: string }) {
    const hasF = path != null && cval(path) != null;
    const isOpen = path != null && expanded.has(path);
    return (
      <>
        <Row label={label}>
          {hasF ? (
            <button
              onClick={() => toggle(path!)}
              title={locale === 'en' ? 'show calculation' : 'показать расчёт'}
              className="flex items-center gap-1.5 rounded border border-line bg-slate-50 px-2 py-0.5 text-sm tabular-nums text-slate-600 hover:bg-slate-100"
            >
              <span className="text-slate-400">{isOpen ? '▾' : '▸'} ƒ</span> {value}
            </button>
          ) : (
            <span className="tabular-nums">{value}</span>
          )}
          {unit ? <span className="text-slate-500">{unit}</span> : null}
        </Row>
        {path != null && breakdown(path)}
      </>
    );
  }

  function ReductionFormula() {
    if (ab.computed) {
      const tmpl = library.formulaTemplates[ab.computed.formula_ref];
      if (!tmpl) return null;
      const slotLabel = (s: string) => { const d = tmpl.slots.find((x) => x.name === s); return `[${d?.label ? pick(d.label, locale) : s}]`; };
      return (
        <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed">
          <div className="font-medium text-slate-700">{pick(tmpl.label, locale)}</div>
          {tmpl.description && <div className="mt-0.5 text-slate-500">{pick(tmpl.description, locale)}</div>}
          <div className="mt-1 tabular-nums text-slate-600">{renderAst(tmpl.expr, slotLabel)} = <b>{fmtInt(computed.abatementKt, locale)} kt</b></div>
        </div>
      );
    }
    if (ab.formula) {
      return (
        <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed">
          {ab.formula_label && <div className="font-medium text-slate-700">{pick(ab.formula_label, locale)}</div>}
          <div className="mt-1 tabular-nums text-slate-600">ƒ {renderAst(ab.formula, refLabel)} = <b>{fmtInt(computed.abatementKt, locale)} kt</b></div>
          {collectRefs(ab.formula).map((r) => renderLeaf(r, `ab/${r}`, 0))}
        </div>
      );
    }
    if (ab.raw) {
      return (
        <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">
          {locale === 'en' ? 'share of baseline' : 'доля от базовых выбросов'}: <b className="tabular-nums">{num(ab.raw.share * 100, 1)}%</b> = <b>{fmtInt(computed.abatementKt, locale)} kt</b>
          {ab.raw.justification && <div className="mt-0.5 italic text-slate-500">{ab.raw.justification}</div>}
        </div>
      );
    }
    return null;
  }

  function CheckFormula({ id }: { id: CheckId }) {
    const def = library.checks[id]; const d = v.details[id] ?? null; const g = glyph(d?.status ?? 'na');
    if (!def) return null;
    if (!d) return <span className="text-xs text-slate-400">{g.ch} {pick(def.label, locale)} — {t('noData')}</span>;
    const nm = (k: string) => `[${SLOT_LABEL[k] ? pick(SLOT_LABEL[k], locale) : k}]`;
    const vl = (k: string) => (k === 'value' ? num(d.value ?? 0) : (d.slots[k] != null ? num(d.slots[k]) : k));
    const factorInput = ab.factor_ref ? measure.inputs?.[ab.factor_ref] : undefined;
    const ref = id === 'factor' && factorInput?.reference_ref ? library.references[factorInput.reference_ref] : undefined;
    return (
      <div className="text-xs leading-relaxed">
        <div><span className={`font-semibold ${g.cls}`}>{g.ch}</span> <span className="text-slate-600">{pick(def.label, locale)}</span></div>
        <div className="mt-0.5 tabular-nums text-slate-500">{renderAst(def.quantity, nm)} = {renderAst(def.quantity, vl)} = <b>{num(d.value ?? 0)}</b></div>
        <div className="tabular-nums text-slate-500">{renderAst(def.predicate, vl)}</div>
        {ref && (
          <div className="mt-0.5 text-slate-500">{t('field.reference')}: <span className="rounded bg-slate-100 px-1 font-medium">{ref.id}</span> [{ref.range.join(' – ')}] {ref.unit}{ref.source?.citation ? ` · ${ref.source.citation}` : ''}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Обзор */}
      <Panel pkey="overview" title={t('panel.overview')} status={v.panels.overview}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge title={measure.sector_ref}>{sectorLabel(measure.sector_ref, locale)}</Badge>
          <Badge tone="sky">{t(`maturity.${measure.maturity_stage}`)}</Badge>
          <Badge>{tm(`mechanism.${measure.mechanism}`)}</Badge>
          {measure.mechanism_subtype && <Badge>{measure.mechanism_subtype}</Badge>}
          {measure.permanence && <Badge>{measure.permanence}</Badge>}
          {basis && <Badge>{t(`type.${basis}`)}</Badge>}
          {measure.provenance_rollup && <Badge tone="amber" title={tm('confidence')}>{measure.provenance_rollup}</Badge>}
          <Badge tone={v.eligibleForModel ? 'green' : 'amber'}>{v.eligibleForModel ? `✓ ${t('autoCheck.passed')}` : `⚠ ${t('autoCheck.failed')}`}</Badge>
        </div>
        <hr className="my-2 border-line" />
        <Row label={t('field.mac')}><b className={computed.mac < 0 ? 'text-green-600' : ''}>{fmtMac(computed.mac, locale)} USD/{locale === 'en' ? 't' : 'т'}</b></Row>
        <Row label={t('field.abatement')}><span className="tabular-nums">{fmtInt(computed.abatementKt, locale)} kt/{locale === 'en' ? 'yr' : 'год'}</span></Row>
        <Row label="CAPEX"><span className="tabular-nums">{num(computed.capex)} mUSD</span></Row>
        <Row label="OPEX"><span className="tabular-nums">{num(computed.opex)} mUSD/{locale === 'en' ? 'yr' : 'год'}</span></Row>
        <Row label="NPV"><span className="tabular-nums">{num(computed.npv, 1)} mUSD</span></Row>
        <Row label={t('field.duration')}><span className="tabular-nums">{computed.durationYrs} {locale === 'en' ? 'yr' : 'лет'}</span></Row>
      </Panel>

      {/* Что создаём */}
      <Panel pkey="build" title={t('panel.build')} status={v.panels.build}>
        {(measure.created_technologies ?? []).length === 0 && <p className="text-xs text-muted">—</p>}
        {(measure.created_technologies ?? []).map((o, i) => {
          const tc = tech(o.technology_ref);
          return (
            <div key={i} className="mb-2 rounded border border-line p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 font-medium text-slate-700">{tc ? pick(tc.name, locale) : o.technology_ref}</span>
                {tc && <Badge>{t(`techKind.${tc.kind}`)}</Badge>}
              </div>
              {tc?.description && <p className="mt-0.5 text-xs text-muted">{pick(tc.description, locale)}</p>}
              <FLine label={`${t('field.capacity')}${o.unit ? `, ${o.unit}` : ''}`} path={`created_technologies[${i}].capacity`} value={o.capacity != null ? num(resolveNum(o.capacity) ?? 0, 2) : '—'} />
              <Row label={t('field.capexUd')}><span className="tabular-nums">{tc?.capex_ud != null ? `${num(tc.capex_ud, 0)} ${tc.capex_ud_unit ?? ''}` : '—'}</span></Row>
              {tc?.indicators?.map((ind) => <Row key={ind.key} label={pick(ind.label, locale)}><span className="tabular-nums">{num(ind.value, 3)} {ind.unit ?? ''}</span></Row>)}
            </div>
          );
        })}
      </Panel>

      {/* Отрасль и продукт */}
      <Panel pkey="baseline" title={t('panel.baseline')} status={v.panels.baseline}>
        {(measure.sectors ?? [{ sector_ref: measure.sector_ref }]).map((s, i) => {
          const subs = library.subsectors[s.sector_ref] ?? [];
          const sub = subs.find((x) => x.id === s.subsector_ref);
          return <Row key={i} label={t('field.sector')}><span>{sectorLabel(s.sector_ref, locale)}{sub ? ` · ${pick(sub.label, locale)}` : ''}</span></Row>;
        })}
        <Row label={t('field.produce')}><span>{product ? pick(product.name, locale) : t('field.sectorOnly')}</span></Row>
        {product?.carbon_footprint && <Row label={t('field.carbonFootprint')}><span className="tabular-nums">{num(product.carbon_footprint.value, 3)} {product.carbon_footprint.unit}</span></Row>}
      </Panel>

      {/* Что закрываем */}
      {(measure.retired_technologies ?? []).length > 0 && (
        <Panel pkey="project" title={t('panel.project')} status={v.panels.project}>
          {(measure.retired_technologies ?? []).map((o, i) => {
            const tc = tech(o.technology_ref);
            return (
              <div key={i} className="mb-2 rounded border border-line p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium text-slate-700">{tc ? pick(tc.name, locale) : o.technology_ref}</span>
                  {tc && <Badge>{t(`techKind.${tc.kind}`)}</Badge>}
                </div>
                {tc?.description && <p className="mt-0.5 text-xs text-muted">{pick(tc.description, locale)}</p>}
                <Row label={t('field.maintCapexUd')}><span className="tabular-nums">{tc?.maintenance_capex_ud != null ? num(tc.maintenance_capex_ud, 0) : '—'}</span></Row>
              </div>
            );
          })}
        </Panel>
      )}

      {/* Выбросы CO₂e */}
      <Panel pkey="reduction" title={t('panel.reduction')} status={v.panels.reduction}>
        <ReductionFormula />
        {ab.factor_ref && measure.inputs?.[ab.factor_ref] && (
          <div className="mt-2">
            <Row label={`${t('field.factor')}${measure.inputs[ab.factor_ref].unit ? ` (${measure.inputs[ab.factor_ref].unit})` : ''}`}><span className="tabular-nums">{num(measure.inputs[ab.factor_ref].value, 4)}</span></Row>
            <div className="mt-2"><CheckFormula id="factor" /></div>
          </div>
        )}
      </Panel>

      {/* Проект (economics) */}
      <Panel pkey="economics" title={t('panel.economics')} status={v.panels.economics}>
        <div className="mb-1 text-xs font-semibold text-slate-500">CAPEX</div>
        {(measure.created_technologies ?? []).map((o, i) => {
          const tc = tech(o.technology_ref);
          return <FLine key={`c${i}`} label={`+ ${tc ? pick(tc.name, locale) : o.technology_ref}`} path={`created_technologies[${i}].capex_musd`} value={`${num(objCapex(o, i))} mUSD`} />;
        })}
        {(measure.retired_technologies ?? []).map((o, i) => {
          const path = `retired_technologies[${i}].maintenance_capex_musd`;
          return <FLine key={`rc${i}`} label={`− ${tech(o.technology_ref) ? pick(tech(o.technology_ref).name, locale) : o.technology_ref}`} path={path} value={`${num(cval(path) ?? resolveNum(o.maintenance_capex_musd) ?? 0)} mUSD`} />;
        })}
        <Row label="Σ CAPEX"><b className="tabular-nums">{num(computed.capex)} mUSD</b></Row>

        <div className="mb-1 mt-3 text-xs font-semibold text-slate-500">OPEX</div>
        {(measure.created_technologies ?? []).map((o, i) => {
          const path = `created_technologies[${i}].opex_musd`;
          const val = cval(path) ?? resolveNum(o.opex_musd);
          if (val == null) return null;
          return <FLine key={`co${i}`} label={`${tech(o.technology_ref) ? pick(tech(o.technology_ref).name, locale) : o.technology_ref} · OPEX`} path={path} value={`${num(val)} mUSD`} />;
        })}
        {(measure.materials ?? []).map((mat, i) => {
          const r = library.resources[mat.resource_ref];
          const qtyPath = `materials[${i}].qty`;
          const qtyComputed = cval(qtyPath);
          const isOpen = expanded.has(qtyPath);
          return (
            <div key={`m${i}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span className="text-slate-600">{mat.side === 'retired' ? '− ' : '+ '}{r ? pick(r.name, locale) : mat.resource_ref}</span>
                <span className="flex items-center gap-1.5">
                  {qtyComputed != null && (
                    <button onClick={() => toggle(qtyPath)} title={locale === 'en' ? 'show calculation' : 'показать расчёт'}
                      className="flex items-center justify-end gap-1 rounded border border-line bg-slate-50 px-2 py-1 text-right text-sm tabular-nums text-slate-600 hover:bg-slate-100">
                      <span className="text-slate-400">{isOpen ? '▾' : '▸'} ƒ</span> {num(qtyComputed, 0)}
                    </button>
                  )}
                  <span className="tabular-nums text-slate-500">= {num(matCost(mat, i))} mUSD</span>
                </span>
              </div>
              {breakdown(qtyPath)}
            </div>
          );
        })}
        <Row label="Σ OPEX"><b className="tabular-nums">{num(computed.opex)} mUSD/{locale === 'en' ? 'yr' : 'год'}</b></Row>
        <Row label="NPV"><span className="tabular-nums">{num(computed.npv, 1)} mUSD</span></Row>
        <div className="mt-2"><CheckFormula id="economics" /></div>
      </Panel>

      {/* Потенциал меры */}
      <Panel pkey="potential" title={t('panel.potential')} status={v.panels.potential}>
        <Row label={t('field.ceilingDim')}><Badge>{measure.potential?.ceiling_dim ?? '—'}</Badge></Row>
        {pool && <Row label={t('field.poolCeiling')}><span className="tabular-nums">{fmtInt(pool.annual_flow, locale)} {pool.unit}</span></Row>}
        <Row label={t('field.potentialAfter')}><b className="tabular-nums">{fmtInt(v.potential, locale)} kt/{locale === 'en' ? 'yr' : 'год'}</b></Row>
        <div className="mt-2 space-y-1.5"><CheckFormula id="pool" /><CheckFormula id="sector" /></div>
      </Panel>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">{td('provenance')}</p>
    </div>
  );
}
