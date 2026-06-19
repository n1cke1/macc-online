# Choosing the abatement mode

Read this when deciding `maturity_stage` and the shape of the `abatement` block.

## Decision tree

1. Is there a credible bottom-up chain — known capacity/activity, emission factors, and
   costs — that derives abatement from `inputs`?
   - **Yes →** `computed`. Either a `formula_ref` (e.g. `delta_ef`) with explicit `bindings`,
     or an inline `abatement.formula` AST over the measure's inputs.
   - **No, but a credible top-down total (kt/yr) exists →** still `computed`: write it as
     `activity × factor` where the per-unit `factor` is an input whose value back-fills the
     total. Tag that input with a `reference_ref` corridor and point `abatement.factor_ref`
     at it, so the `factor` guardrail sanity-checks it (⚠ if implausible → keep `draft`).
   - **Neither →** the measure is not ready; keep it a `draft` and record what's missing.

2. How is the baseline constructed — against a displaced service (`comparison`) or as an
   absolute project footprint (`standalone`)?
   - Set `baseline_basis` accordingly; for `comparison`, also set `comparison.service_unit_ref`.
   - `comparison` measures are scored project vs. a moving baseline — say so in provenance.

## `computed` shape (reference: kz-2)

- `abatement.computed.bindings` map roles to refs: `cf`, `ef_in`, `ef_out`, `capacity`.
- `abatement.computed.formula_ref` names the engine formula (e.g. `delta_ef`).
- Intensities and quantities live in `computed{}` as formulas over `inputs`.

## Top-down total via a checked factor (reference: kz-20, kz-16)

When the credible figure is a total rather than a full bottom-up chain, still author a
`computed` measure with `abatement.formula = activity × factor`:

- Make the per-unit `factor` a measure input and tag it with a `reference_ref` corridor
  (e.g. `ref_enteric_factor`, `ref_degas_factor`); point `abatement.factor_ref` at it.
- The `checks.factor` guardrail confirms that factor sits inside the ref range; ⚠ (out of
  corridor) blocks promotion and the measure stays `draft` (see kz-16).
- Provenance must state plainly that the factor is an anchor/assumption, not a derivation.

> The legacy `back_calc` maturity stage (baseline × share, with an *implied* factor) is
> **retired** — express the same thing bottom-up as `activity × factor` instead.

> TODO (expert): enumerate the available `formula_ref`s and their required bindings;
> document each `factor:*` ref type and its accepted range source.
