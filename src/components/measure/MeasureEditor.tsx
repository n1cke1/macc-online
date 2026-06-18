'use client';
// §4 + iteration-2 — the measure «accordion». Panels: Обзор · Что создаём ·
// Отрасль и продукт · Что закрываем · Выбросы CO₂e · Проект (economics) ·
// Потенциал меры. Economics derives from the built/retired objects + materials.
// Each value carries a "?" — input → source, computed → formula; inputs are
// fill-highlighted. Same compute()/validate() the MCP server drives.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { pick } from '@/lib/data';
import { fmt, fmtMac, fmtInt } from '@/lib/format';
import { renderAst, evalAst } from '@/lib/measure/eval';
import { makeResolver } from '@/lib/measure/compute';
import { type Ast, isLeafRef, isNode } from '@/lib/measure/ast';
import type { BuiltObject, Library, Localized, MeasureNotation, Provenance, RetiredObject, ValueSource } from '@/lib/measure/schema';
import type { CheckId, CheckStatus, PanelKey, PanelStatus } from '@/lib/measure/validate';
import { useMeasureDraft } from './useMeasureDraft';
import { useDraftOverlay } from '@/store';
import { useAuth } from '@/lib/supabase/auth';
import AuthButtonGate from '@/components/collab/AuthButtonGate';

const SEEDS = ['kz-20', 'kz-2', 'kz-16'];

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

/** The "?" affordance: click to reveal an input's source or a computed value's formula. */
function QHelp({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="grid h-4 w-4 place-items-center rounded-full border border-slate-300 text-[10px] text-slate-500 hover:bg-slate-100" aria-label="info">?</button>
      {open && (
        <span className="absolute right-0 z-10 mt-1 w-64 rounded border border-line bg-white p-2 text-[11px] leading-snug text-slate-600 shadow-lg">{children}</span>
      )}
    </span>
  );
}

function NumberField({ value, onCommit, input }: { value: number; onCommit: (v: number) => void; input?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const v = Number(draft); if (Number.isFinite(v) && v !== value) onCommit(v); else setDraft(String(value)); };
  return (
    <input type="number" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`w-24 rounded border px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none ${input ? 'border-sky-300 bg-sky-50/70' : 'border-line'}`} />
  );
}

function Panel({ pkey, title, status, help, children }: { pkey: PanelKey; title: string; status?: PanelStatus; help?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const g = status ? glyph(status) : null;
  return (
    <section className="rounded-lg border border-line bg-white" data-panel={pkey}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-left text-sm font-semibold">
          {g && <span className={g.cls} aria-hidden>{g.ch}</span>}{title}
        </button>
        <span className="flex items-center gap-2">
          {help && <QHelp>{help}</QHelp>}
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-muted" aria-label="toggle">{open ? '▲' : '▼'}</button>
        </span>
      </div>
      {open && <div className="border-t border-line px-3 py-3 text-sm">{children}</div>}
    </section>
  );
}

function Row({ label, children, help }: { label: ReactNode; children: ReactNode; help?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2">{children}{help && <QHelp>{help}</QHelp>}</span>
    </div>
  );
}

function ProvLink({ url }: { url?: string }) {
  if (!url) return null;
  return <> <a href={url} target="_blank" rel="noreferrer" className="text-sky-600 underline">↗</a></>;
}

function ProvText({ p }: { p?: Provenance }) {
  if (!p) return <>—</>;
  return <>{p.source_type} · {p.confidence}{p.citation ? ` — ${p.citation}` : ''}<ProvLink url={p.url} /></>;
}

/**
 * Full §6 source of a measure's bare number (from `measure.sources[path]`): the
 * provenance line + the binding discipline (reuse/alt/new + ref / divergence reason).
 * This is the «sourcing» half of the measure-notation surfaced at each value's "?".
 */
function SourceText({ s, nt }: { s?: ValueSource; nt: MeasureNotation }) {
  if (!s) return <span className="text-slate-400">—</span>;
  const b = s.binding;
  const e = b ? nt.enums.bindingMode[b.mode] : undefined;
  return (
    <>
      <div>{s.provenance.source_type} · {s.provenance.confidence}{s.provenance.citation ? ` — ${s.provenance.citation}` : ''}<ProvLink url={s.provenance.url} /></div>
      {b && (
        <div className="mt-1">
          <span className="rounded bg-slate-100 px-1 font-medium" title={e?.help}>binding: {b.mode}</span>
          {b.ref ? ` → ${b.ref}` : ''}{b.divergence_reason ? ` — ${b.divergence_reason}` : ''}
        </div>
      )}
    </>
  );
}

export default function MeasureEditor() {
  const t = useTranslations('measure');
  const locale = useLocale() as 'ru' | 'en';
  const { ready, source, initError, library: libraryMaybe, activeId, measure, computed, validation, error, init, reloadMeasures, load, update, clear } = useMeasureDraft();
  const { session, loading: authLoading } = useAuth();
  // Inline drill-down: which computed nodes are expanded (keyed by node path in the tree).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Stage C: load the library + measures from Supabase, then open the first measure.
  useEffect(() => { void init(); return () => useDraftOverlay.getState().setBar(null); }, [init]);
  useEffect(() => { if (ready && !activeId) load(SEEDS[0]); }, [ready, activeId, load]);
  // Auth: when the session changes (sign in/out), re-fetch measures so the user's own drafts appear.
  const uid = session?.user?.id;
  useEffect(() => { if (ready) void reloadMeasures(); }, [uid, ready, reloadMeasures]);

  // «Visible to logged-in users only» — the editor is hidden for anonymous visitors
  // (writes are auth+RLS-gated anyway; this hides the UI too). Wait out the initial
  // auth probe to avoid a flash, then require a session.
  if (authLoading || !session) return null;
  if (!ready || !libraryMaybe) {
    return <p className="text-sm text-muted">{locale === 'en' ? 'Loading library…' : 'Загрузка библиотеки…'}</p>;
  }
  const library: Library = libraryMaybe; // non-null past the guard; closures capture this typed const
  if (!measure) return null;
  const v = validation;
  const ab = measure.abatement;
  const isSub = measure.comparison?.is_substitution === true;
  const product = measure.product_ref ? library.products[measure.product_ref] : undefined;
  const pool = measure.potential?.pool_ref ? library.pools[measure.potential.pool_ref] : undefined;
  const num = (n: number, d = 2) => fmt(n, locale, { maximumFractionDigits: d });
  const tech = (ref: string) => library.technologies[ref];
  // Single instruction source (measure-notation.json) → tooltips / «?» help.
  const nt = library.notation;
  const gh = (e?: { help: string }) => e?.help; // notation is English-base (single string)
  // §6 source (provenance + binding) for a bare number, by its path key in measure.sources.
  const srcNode = (path: string) => (measure!.sources?.[path] ? <div className="mt-1">{t('help.source')}: <SourceText s={measure!.sources![path]} nt={nt} /></div> : null);
  // §3 computed value: evaluate its stored formula live (parity-equal to the engine).
  const resolve = makeResolver(measure, library);
  const cval = (path: string): number | undefined => {
    const c = measure!.computed?.[path];
    return c ? evalAst(c.formula, resolve) : undefined;
  };
  const refName = (key: string): string => {
    if (key.startsWith('res:')) { const r = library.resources[key.slice(4)]; return r ? pick(r.name, locale) : key.slice(4); }
    const c = measure!.computed?.[key];
    return c?.label ? pick(c.label, locale) : key;
  };
  const refLabel = (key: string): string => `[${refName(key)}]`;
  const collectRefs = (ast: Ast, acc: string[] = []): string[] => {
    if (isLeafRef(ast)) { if (!acc.includes(ast.ref)) acc.push(ast.ref); }
    else if (isNode(ast)) ast.args.forEach((a) => collectRefs(a, acc));
    return acc;
  };
  /** The formula expression line shown above a computed node's leaves. */
  const formulaLine = (formula: Ast, depth: number) => (
    <div className="border-t border-line/60 py-0.5 text-xs italic text-slate-400" style={{ paddingLeft: 10 + depth * 14 }}>ƒ {renderAst(formula, refLabel)}</div>
  );
  const safeResolve = (key: string): number | undefined => { try { return resolve(key); } catch { return undefined; } };
  /**
   * One drill-down row for a formula leaf, rendered INLINE under the project sheet.
   * A computed leaf gets a ▸ toggle and expands its own sub-leaves recursively; an
   * input leaf shows its value + source (provenance + ↗link). `nodeId` is unique per
   * position in the tree so sibling expansions are independent.
   */
  const renderLeaf = (refKey: string, nodeId: string, depth: number): ReactNode => {
    const c = measure!.computed?.[refKey];
    const inp = measure!.inputs?.[refKey];
    const res = refKey.startsWith('res:') ? library.resources[refKey.slice(4)] : undefined;
    const val = safeResolve(refKey);
    const unit = inp?.unit ?? '';
    const open = expanded.has(nodeId);
    return (
      <div key={nodeId}>
        <div className="flex items-center justify-between gap-2 border-t border-line/60 py-0.5 text-xs" style={{ paddingLeft: 10 + depth * 14 }}>
          <span className="flex items-center gap-1 text-slate-500">
            {c
              ? <button onClick={() => toggle(nodeId)} className="w-3 text-slate-400 hover:text-slate-700" aria-label="expand">{open ? '▾' : '▸'}</button>
              : <span className="inline-block w-3 text-center text-slate-300">·</span>}
            <span>{refName(refKey)}</span>
            {c && <span className="text-slate-300" title="вычислено">ƒ</span>}
            {inp && <span className="text-slate-400">{inp.provenance.source_type}/{inp.provenance.confidence}{inp.provenance.citation ? ` — ${inp.provenance.citation}` : ''}<ProvLink url={inp.provenance.url} /></span>}
            {res && <span className="text-slate-400">{locale === 'en' ? 'resource EF' : 'EF ресурса'}</span>}
          </span>
          <span className="tabular-nums text-slate-600">{val != null ? num(val, 4) : '—'}{unit ? ` ${unit}` : ''}</span>
        </div>
        {c && open && (
          <>
            {formulaLine(c.formula, depth + 1)}
            {collectRefs(c.formula).map((r) => renderLeaf(r, `${nodeId}/${r}`, depth + 1))}
          </>
        )}
      </div>
    );
  };
  /** Inline expandable breakdown of a computed value at `path`: its formula, then its leaves. */
  const breakdown = (path: string): ReactNode => {
    const c = measure!.computed?.[path];
    if (!c || !expanded.has(path)) return null;
    return (
      <div className="rounded-b bg-slate-50/60">
        {formulaLine(c.formula, 1)}
        {collectRefs(c.formula).map((r) => renderLeaf(r, `${path}/${r}`, 1))}
      </div>
    );
  };
  const objCapex = (o: { object_ref: string; capacity?: number; capex_ud_factor?: number; capex_musd?: number }) =>
    o.capex_musd ?? (o.capacity ?? 0) * (tech(o.object_ref)?.capex_ud ?? 0) * (o.capex_ud_factor ?? 1) / 1e6;
  const matCost = (m: { price?: number; cost_musd?: number; side: string }, i: number) => {
    const qty = cval(`materials[${i}].qty`) ?? (m as { qty?: number }).qty ?? 0;
    const price = cval(`materials[${i}].price`) ?? m.price ?? 0;
    return (m.cost_musd ?? qty * price / 1e6) * (m.side === 'retired' ? -1 : 1);
  };

  function ReductionFormula() {
    if (ab.computed) {
      const tmpl = library.formulaTemplates[ab.computed.formula_ref];
      if (!tmpl) return null;
      // bracketed-indicator formula: each named leaf wrapped in [ … ]
      const slotLabel = (s: string) => { const d = tmpl.slots.find((x) => x.name === s); return `[${d?.label ? pick(d.label, locale) : s}]`; };
      return (
        <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed">
          <div className="font-medium text-slate-700">{pick(tmpl.label, locale)}</div>
          {tmpl.description && <div className="mt-0.5 text-slate-500">{pick(tmpl.description, locale)}</div>}
          <div className="mt-1 tabular-nums text-slate-600">{renderAst(tmpl.expr, slotLabel)} = <b>{computed ? fmtInt(computed.abatementKt, locale) : '—'} kt</b></div>
        </div>
      );
    }
    if (ab.back_calc && pool?.baselineEmissionsKt != null) {
      return (
        <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">
          <div className="font-medium text-slate-700">{pick(library.formulaTemplates.share.label, locale)}</div>
          <div className="mt-1 tabular-nums">[{t('field.baselineEmissions')}] × [{t('field.share').toLowerCase()}] = {fmtInt(pool.baselineEmissionsKt, locale)} × {num(ab.back_calc.share)} = <b>{computed ? fmtInt(computed.abatementKt, locale) : '—'} kt</b></div>
        </div>
      );
    }
    return null;
  }

  function CheckFormula({ id }: { id: CheckId }) {
    const def = library.checks[id]; const d = v?.details[id] ?? null; const g = glyph(d?.status ?? 'na');
    if (!def) return null;
    if (!d) return <span className="text-xs text-slate-400">{g.ch} {pick(def.label, locale)} — {t('noData')}</span>;
    // names bracketed like the reduction formula: [снижение] / [активность]
    const nm = (k: string) => `[${SLOT_LABEL[k] ? pick(SLOT_LABEL[k], locale) : k}]`;
    const vl = (k: string) => (k === 'value' ? num(d.value ?? 0) : (d.slots[k] != null ? num(d.slots[k]) : k));
    const ref = id === 'factor' && measure!.abatement.back_calc ? library.references[measure!.abatement.back_calc.reference_ref] : undefined;
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

  const techOptions = Object.keys(library.technologies);
  const addCreated = () => update((m) => { (m.created_objects ??= []).push({ object_ref: techOptions[0], capacity: 0, unit: '' }); });
  const addRetired = () => update((m) => { (m.retired_objects ??= []).push({ object_ref: techOptions[0], capacity: 0, unit: '' }); });

  /** Editable list of library objects (created or retired): pick · capacity · delete. */
  function ObjectList({ kind }: { kind: 'created' | 'retired' }) {
    const items: Array<BuiltObject | RetiredObject> = (kind === 'created' ? measure!.created_objects : measure!.retired_objects) ?? [];
    const mutate = (i: number, fn: (o: BuiltObject | RetiredObject) => void) => update((m) => {
      const list = kind === 'created' ? (m.created_objects ??= []) : (m.retired_objects ??= []);
      fn(list[i]);
    });
    const remove = (i: number) => update((m) => { (kind === 'created' ? m.created_objects : m.retired_objects)?.splice(i, 1); });
    return (
      <>
        {items.length === 0 && kind === 'retired' && <p className="mb-1 text-xs text-muted">{t('field.noRetired')}</p>}
        {items.map((o, i) => {
          const tc = tech(o.object_ref);
          const ud = kind === 'created' ? tc?.capex_ud : tc?.maintenance_capex_ud;
          return (
            <div key={i} className="mb-2 rounded border border-line p-2">
              <div className="flex items-center gap-2">
                <select value={o.object_ref} onChange={(e) => mutate(i, (x) => { x.object_ref = e.target.value; })}
                  className="min-w-0 flex-1 rounded border border-line px-1.5 py-1 text-sm">
                  {techOptions.map((id) => <option key={id} value={id}>{pick(library.technologies[id].name, locale)}</option>)}
                </select>
                {tc && <Badge title={gh(nt.enums.techKind[tc.kind])}>{t(`techKind.${tc.kind}`)}</Badge>}
                <QHelp>{gh(nt.fields.objectRef)}</QHelp>
                <button onClick={() => remove(i)} title={t('field.delete')} aria-label="delete" className="px-1 text-slate-400 hover:text-red-500">✕</button>
              </div>
              {tc?.description && <p className="mt-0.5 text-xs text-muted">{pick(tc.description, locale)}</p>}
              <Row label={`${t('field.capacity')}${o.unit ? `, ${o.unit}` : ''}`} help={<><div>{gh(nt.fields.capacity)}</div>{srcNode(`${kind}_objects[${i}].capacity`)}</>}>
                <NumberField input value={o.capacity ?? 0} onCommit={(val) => mutate(i, (x) => { x.capacity = val; })} />
              </Row>
              <Row label={kind === 'created' ? t('field.capexUd') : t('field.maintCapexUd')} help={<><div>{gh(nt.fields.capexUd)}</div><div className="mt-1">{t('help.objectSource')}: <ProvText p={tc?.provenance} /></div></>}>
                <span className="tabular-nums">{ud != null ? `${num(ud, 0)} ${tc?.capex_ud_unit ?? ''}` : '—'}</span>
              </Row>
              {tc?.indicators?.map((ind) => <Row key={ind.key} label={pick(ind.label, locale)}><span className="tabular-nums">{num(ind.value, 3)} {ind.unit ?? ''}</span></Row>)}
            </div>
          );
        })}
        <button onClick={kind === 'created' ? addCreated : addRetired}
          className={`rounded-md border border-dashed px-2 py-1 text-xs ${kind === 'created' ? 'border-sky-300 text-sky-700 hover:bg-sky-50' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
          + {kind === 'created' ? t('field.addObject') : t('field.addRetired')}
        </button>
      </>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-bold">{t('title')}<QHelp>{gh(nt.sourcing.principle)}</QHelp></h2>
        <div className="flex items-center gap-2">
          <Badge tone={source === 'supabase' ? 'green' : 'amber'} title={initError ?? undefined}>{source === 'supabase' ? 'Supabase' : (locale === 'en' ? 'local fallback' : 'локальный фоллбэк')}</Badge>
          <div className="flex gap-1">
            {SEEDS.map((id) => (
              <button key={id} onClick={() => load(id)} className={`rounded-md border px-2 py-1 text-xs ${id === activeId ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-line text-muted hover:bg-slate-50'}`}>{id}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>}
      {source === 'file-fallback' && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{locale === 'en' ? 'Library loaded from the bundled seed (Supabase unavailable): ' : 'Библиотека из встроенного сида (Supabase недоступен): '}{initError}</p>}
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-slate-50/60 px-3 py-1.5 text-xs">
        <span className="text-slate-600">
          {session
            ? `✓ ${locale === 'en' ? 'signed in' : 'вы вошли'}: ${session.user.email ?? session.user.id.slice(0, 8)} — ${locale === 'en' ? 'your drafts load from your account' : 'ваши черновики грузятся из вашего аккаунта'}`
            : (locale === 'en' ? 'Sign in to load and save your own drafts (published measures are visible to everyone).' : 'Войдите, чтобы видеть и сохранять свои черновики (опубликованные меры видны всем).')}
        </span>
        <AuthButtonGate />
      </div>

      {/* Обзор */}
      <Panel pkey="overview" title={t('panel.overview')} status={v?.panels.overview} help={gh(nt.panels.overview)}>
        <span className="mb-1 flex items-center gap-1 text-xs text-slate-500">{t('field.name')}<QHelp>{gh(nt.fields.name)}</QHelp></span>
        <input value={measure.name.ru} onChange={(e) => update((m) => { m.name.ru = e.target.value; })}
          className="w-full rounded border border-line px-2 py-1 text-sm focus:border-sky-500 focus:outline-none" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge title={gh(nt.fields.sector)}>{measure.sector_ref}</Badge>
          <Badge tone="sky" title={gh(nt.enums.maturity[measure.maturity_stage])}>{t(`maturity.${measure.maturity_stage}`)}</Badge>
          <Badge title={gh(nt.enums.type[isSub ? 'substitution' : 'comparison'])}>{isSub ? t('type.substitution') : t('type.comparison')}</Badge>
          <Badge tone={v?.eligibleForModel ? 'green' : 'amber'}>{v?.eligibleForModel ? `✓ ${t('autoCheck.passed')}` : `⚠ ${t('autoCheck.failed')}`}</Badge>
        </div>
        <hr className="my-2 border-line" />
        <Row label={t('field.mac')}><b className={(computed?.mac ?? 0) < 0 ? 'text-green-600' : ''}>{computed ? `${fmtMac(computed.mac, locale)} USD/${locale === 'en' ? 't' : 'т'}` : '—'}</b></Row>
        <Row label={t('field.abatement')}><span>{computed ? `${fmtInt(computed.abatementKt, locale)} kt/${locale === 'en' ? 'yr' : 'год'}` : '—'}</span></Row>
      </Panel>

      {/* Что создаём */}
      <Panel pkey="build" title={t('panel.build')} status={v?.panels.build} help={gh(nt.panels.build)}>
        <ObjectList kind="created" />
      </Panel>

      {/* Отрасль и продукт */}
      <Panel pkey="baseline" title={t('panel.baseline')} status={v?.panels.baseline} help={gh(nt.panels.baseline)}>
        {(measure.sectors ?? [{ sector_ref: measure.sector_ref }]).map((s, i) => {
          const subs = library.subsectors[s.sector_ref] ?? [];
          const sub = subs.find((x) => x.id === s.subsector_ref);
          return <Row key={i} label={t('field.sector')}><span>{s.sector_ref}{sub ? ` · ${pick(sub.label, locale)}` : ''}</span></Row>;
        })}
        <Row label={t('field.produce')} help={gh(nt.fields.produce)}><span>{product ? pick(product.name, locale) : t('field.sectorOnly')}</span></Row>
        {product?.carbon_footprint && <Row label={t('field.carbonFootprint')} help={gh(nt.fields.carbonFootprint)}><span className="tabular-nums">{num(product.carbon_footprint.value, 3)} {product.carbon_footprint.unit}</span></Row>}
      </Panel>

      {/* Что закрываем */}
      <Panel pkey="project" title={t('panel.project')} status={v?.panels.project} help={gh(nt.panels.project)}>
        <ObjectList kind="retired" />
      </Panel>

      {/* Выбросы CO₂e */}
      <Panel pkey="reduction" title={t('panel.reduction')} status={v?.panels.reduction} help={gh(nt.panels.reduction)}>
        <div className="mb-1 flex justify-end">
          <QHelp><>
            <div className="font-medium">{gh(nt.formulas.principle)}</div>
            <div className="mt-1">{gh(nt.formulas.operators)}</div>
            <div className="mt-1">{gh(nt.formulas.predicates)}</div>
            <div className="mt-1">{gh(nt.formulas.leaves)}</div>
            <div className="mt-1 italic">{gh(nt.formulas.example)}</div>
          </></QHelp>
        </div>
        <ReductionFormula />
        {ab.back_calc && (
          <div className="mt-2">
            <Row label={t('field.share')} help={<><div>{gh(nt.fields.share)}</div>{srcNode('abatement.back_calc.share')}</>}><NumberField input value={ab.back_calc.share} onCommit={(val) => update((m) => { m.abatement.back_calc!.share = val; })} /></Row>
            <Row label={`${t('field.activity')} (${ab.back_calc.activity_scalar.unit})`} help={<><div>{gh(nt.fields.activity)}</div>{srcNode('abatement.back_calc.activity_scalar.qty')}</>}><NumberField input value={ab.back_calc.activity_scalar.qty} onCommit={(val) => update((m) => { m.abatement.back_calc!.activity_scalar.qty = val; })} /></Row>
            <div className="mt-2"><CheckFormula id="factor" /></div>
          </div>
        )}
        {ab.computed && (
          <div className="mt-2 space-y-1">
            {Object.entries(ab.computed.bindings).map(([slot, b]) => {
              if (!('ref' in b) || b.ref.startsWith('res:')) return null;
              const inp = measure.inputs?.[b.ref];
              return inp ? <Row key={slot} label={slot} help={<ProvText p={inp.provenance} />}><NumberField input value={inp.value} onCommit={(val) => update((m) => { m.inputs![b.ref]!.value = val; })} /></Row> : null;
            })}
          </div>
        )}
      </Panel>

      {/* Проект (economics) */}
      <Panel pkey="economics" title={t('panel.economics')} status={v?.panels.economics} help={gh(nt.panels.economics)}>
        <div className="mb-1 text-xs font-semibold text-slate-500">CAPEX</div>
        {(measure.created_objects ?? []).map((o, i) => {
          const tc = tech(o.object_ref);
          return (
            <Row key={`c${i}`} label={`+ ${tc ? pick(tc.name, locale) : o.object_ref}`}
              help={o.capex_musd != null ? srcNode(`created_objects[${i}].capex_musd`) ?? <ProvText p={tc?.provenance} /> : <>{t('help.formula')}: [{t('field.capacity').toLowerCase()}] × [{t('field.capexUd').toLowerCase()}]{o.capex_ud_factor ? ` × ${o.capex_ud_factor}` : ''} / 10⁶</>}>
              {o.capex_musd != null
                ? <NumberField input value={o.capex_musd} onCommit={(val) => update((m) => { m.created_objects![i].capex_musd = val; })} />
                : <span className="tabular-nums">{num(objCapex(o))} mUSD</span>}
            </Row>
          );
        })}
        {(measure.retired_objects ?? []).map((o, i) => (
          <Row key={`rc${i}`} label={`− ${tech(o.object_ref) ? pick(tech(o.object_ref).name, locale) : o.object_ref}`}><span className="tabular-nums">{num(o.maintenance_capex_musd ?? 0)} mUSD</span></Row>
        ))}
        <Row label="Σ CAPEX"><b className="tabular-nums">{computed ? num(computed.capex) : '—'} mUSD</b></Row>

        <div className="mb-1 mt-3 text-xs font-semibold text-slate-500">OPEX</div>
        {(measure.created_objects ?? []).map((o, i) => o.opex_musd == null ? null : (
          <Row key={`co${i}`} label={`${tech(o.object_ref) ? pick(tech(o.object_ref).name, locale) : o.object_ref} · OPEX`} help={srcNode(`created_objects[${i}].opex_musd`)}>
            <NumberField input value={o.opex_musd ?? 0} onCommit={(val) => update((m) => { m.created_objects![i].opex_musd = val; })} />
          </Row>
        ))}
        {(measure.materials ?? []).map((mat, i) => {
          const r = library.resources[mat.resource_ref];
          const qtyPath = `materials[${i}].qty`;
          const qtyComputed = cval(qtyPath);
          const open = expanded.has(qtyPath);
          return (
            <div key={`m${i}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span className="text-slate-600">{mat.side === 'retired' ? '− ' : '+ '}{r ? pick(r.name, locale) : mat.resource_ref}</span>
                <span className="flex items-center gap-1.5">
                  {qtyComputed != null
                    ? <button onClick={() => toggle(qtyPath)} title={locale === 'en' ? 'show calculation' : 'показать расчёт'}
                        className="flex w-24 items-center justify-end gap-1 rounded border border-line bg-slate-50 px-2 py-1 text-right text-sm tabular-nums text-slate-600 hover:bg-slate-100">
                        <span className="text-slate-400">{open ? '▾' : '▸'} ƒ</span> {num(qtyComputed, 0)}
                      </button>
                    : (mat.qty != null && <NumberField input value={mat.qty} onCommit={(val) => update((m) => { m.materials![i].qty = val; })} />)}
                  {mat.price != null && <>× <NumberField input value={mat.price} onCommit={(val) => update((m) => { m.materials![i].price = val; })} /></>}
                  <span className="tabular-nums text-slate-500">= {num(matCost(mat, i))} mUSD</span>
                  <QHelp><><div>{gh(nt.fields.materialSide)}</div><div className="mt-1">{gh(nt.fields.qty)}</div>{qtyComputed == null && srcNode(qtyPath)}{mat.price != null && <div className="mt-1">{gh(nt.fields.price)}</div>}{srcNode(`materials[${i}].price`)}</></QHelp>
                </span>
              </div>
              {breakdown(qtyPath)}
            </div>
          );
        })}
        <Row label="Σ OPEX"><b className="tabular-nums">{computed ? num(computed.opex) : '—'} mUSD/{locale === 'en' ? 'yr' : 'год'}</b></Row>
        <Row label="NPV"><span className="tabular-nums">{computed ? num(computed.npv, 1) : '—'} mUSD</span></Row>
        <div className="mt-2"><CheckFormula id="economics" /></div>
      </Panel>

      {/* Потенциал меры */}
      <Panel pkey="potential" title={t('panel.potential')} status={v?.panels.potential} help={gh(nt.panels.potential)}>
        <Row label={t('field.ceilingDim')} help={gh(nt.fields.ceilingDim)}><Badge title={measure.potential?.ceiling_dim ? gh(nt.enums.ceilingDim[measure.potential.ceiling_dim]) : undefined}>{measure.potential?.ceiling_dim ?? '—'}</Badge></Row>
        {pool && <Row label={t('field.poolCeiling')} help={gh(nt.fields.pool)}><span className="tabular-nums">{fmtInt(pool.annual_flow, locale)} {pool.unit}</span></Row>}
        <Row label={t('field.potentialAfter')}><b className="tabular-nums">{v ? fmtInt(v.potential, locale) : '—'} kt/{locale === 'en' ? 'yr' : 'год'}</b></Row>
        <div className="mt-2 space-y-1.5"><CheckFormula id="pool" /><CheckFormula id="sector" /></div>
      </Panel>

      {v && (v.untagged.length > 0 || v.computedNoFormula.length > 0) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {locale === 'en'
            ? 'Numbers without a declared origin (every number must be an input source or a formula): '
            : 'Числа без указанного происхождения (каждое число — либо вход с источником, либо формула): '}
          <span className="font-mono">{[...v.untagged, ...v.computedNoFormula].join(', ')}</span>
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted">{t('eligibilityHint')}</p>
        <Badge tone={v?.eligibleForModel ? 'green' : 'amber'}>{v?.eligibleForModel ? `✓ ${t('eligible')}` : `⚠ ${t('notEligible')}`}</Badge>
      </div>
      <button onClick={clear} className="text-xs text-muted underline hover:text-slate-700">{t('clear')}</button>
    </section>
  );
}
