// §3 — formula-template library + slot binding.
//
// The 26 Excel formulas cluster into a few shapes; the prototype ships the two the
// §11 cases need (`delta_ef` for B, `share` for A's raw/back_calc magnitude). A
// measure at maturity `computed` references a template by id and binds its slots
// to measure inputs / resource properties; `bindTemplate` substitutes the bound
// values so `compileAst` sees a slot-free tree.
import { type Ast, isLeafSlot, isNode } from './ast';
import type { FormulaBinding, FormulaTemplate } from './schema';
import type { RefResolver } from './compile';

/** Built-in templates. Real deployments would load these from the library. */
export const BUILTIN_TEMPLATES: Record<string, FormulaTemplate> = {
  // abatement = capacity × 8760 h × cf × (ef_in − ef_out) × 10⁻³  (was Excel =C43*8760*C39*(…)*10^-3)
  delta_ef: {
    id: 'delta_ef',
    label: { ru: 'Разница факторов выбросов при замене топлива', en: 'Emission-factor delta on fuel switch' },
    description: {
      ru: 'Снижение = установленная мощность × часы в году × КИУМ × (EF замещаемого − EF нового топлива) × 10⁻³.',
      en: 'Reduction = capacity × hours/yr × capacity factor × (displaced EF − new EF) × 10⁻³.',
    },
    output: 'abatement',
    expr: {
      op: 'mul',
      args: [
        { slot: 'capacity' },
        8760,
        { slot: 'cf' },
        { op: 'sub', args: [{ slot: 'ef_in' }, { slot: 'ef_out' }] },
        1e-3,
      ],
    },
    slots: [
      { name: 'capacity', accepts: 'input', label: { ru: 'мощность', en: 'capacity' } },
      { name: 'cf', accepts: 'input', label: { ru: 'КИУМ', en: 'capacity factor' } },
      { name: 'ef_in', accepts: 'resource.ef', label: { ru: 'EF замещаемого', en: 'displaced EF' } },
      { name: 'ef_out', accepts: 'resource.ef', label: { ru: 'EF нового', en: 'new EF' } },
    ],
  },
  // abatement = baseline × share  (sector/sub-category baseline times coverage share)
  share: {
    id: 'share',
    label: { ru: 'Доля от базовых выбросов подкатегории', en: 'Share of the sub-category baseline' },
    description: {
      ru: 'Снижение = базовые выбросы подкатегории × охват (доля).',
      en: 'Reduction = sub-category baseline emissions × coverage share.',
    },
    output: 'abatement',
    expr: { op: 'mul', args: [{ slot: 'baseline' }, { slot: 'share' }] },
    slots: [
      { name: 'baseline', accepts: 'input', label: { ru: 'базовые выбросы', en: 'baseline' } },
      { name: 'share', accepts: 'input', label: { ru: 'доля', en: 'share' } },
    ],
  },
};

export function getTemplate(id: string): FormulaTemplate | undefined {
  return BUILTIN_TEMPLATES[id];
}

/**
 * Replace each `{slot}` in a template's AST with the bound value, yielding a
 * slot-free AST ready for `compileAst`. `bindings` maps slot name → `{ref}` (a
 * measure-input / resource key resolved via `resolve`) or `{const}` (a literal).
 */
export function bindTemplate(
  template: FormulaTemplate,
  bindings: Record<string, FormulaBinding>,
  resolve: RefResolver,
): Ast {
  const valueFor = (slot: string): number => {
    const b = bindings[slot];
    if (!b) throw new Error(`Template '${template.id}': slot '${slot}' is not bound`);
    return 'const' in b ? b.const : resolve(b.ref);
  };
  const walk = (node: Ast): Ast => {
    if (isLeafSlot(node)) return { const: valueFor(node.slot) };
    if (isNode(node)) return { op: node.op, args: node.args.map(walk) };
    return node;
  };
  return walk(template.expr);
}
