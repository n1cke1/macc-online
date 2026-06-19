# Choosing the abatement mode

Read this when deciding `maturity_stage` and the shape of the `abatement` block.

## Decision tree

1. Is there a credible bottom-up chain — known capacity/activity, emission factors, and
   costs — that derives abatement from `inputs`?
   - **Yes →** `computed`. Use a `formula_ref` (e.g. `delta_ef`) with explicit `bindings`.
   - **No, but a credible top-down total (kt/yr) exists →** `back_calc`, anchored to that
     total via a `factor` ref whose `range_min/range_max` bound the per-unit factor.
   - **Neither →** the measure is not ready; keep it a `draft` and record what's missing.

2. Is the measure a substitution (replaces an existing service) or additive?
   - Set `comparison.is_substitution` accordingly and pick the right `service_unit_ref`.
   - Substitution measures compare project vs. a moving baseline — say so in provenance.

## `computed` shape (reference: kz-2)

- `abatement.computed.bindings` map roles to refs: `cf`, `ef_in`, `ef_out`, `capacity`.
- `abatement.computed.formula_ref` names the engine formula (e.g. `delta_ef`).
- Intensities and quantities live in `computed{}` as formulas over `inputs`.

## `back_calc` shape (reference: kz-20)

- Anchor on a `factor:*` `ref` (e.g. `ref_enteric_factor`, `ref_degas_factor`).
- The `checks.factor` guardrail confirms the implied factor sits inside the ref range.
- Provenance must state plainly that the figure is an anchor, not a derivation.

> TODO (expert): enumerate the available `formula_ref`s and their required bindings;
> document each `factor:*` ref type and its accepted range source.
