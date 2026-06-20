# Checks — the advisory guardrails

How to read `validate_measure`'s output.

**Principle.** `validate()` runs two kinds of check, all driving `eligibleForModel` (the
"готово" badge = all checks ✓ and panels complete). **Predicate checks** (`lte`/`gte`/`between`)
are advisory: ✓ pass / ⚠ warn — a ⚠ does not block publishing (publishing is direct) but holds
a measure back from eligibility. **Gating checks** — the §3/§6 notation rule and the `dimension`
fold — are stricter: a failure marks the holding panel incomplete, so the measure stays `draft`.
Implemented: the predicate checks factor, economics, pool, sector, limit; the notation rule;
and the dimension/carrier fold. `serviceUnitMatch` and `doubleCountReduction` are rules you
apply yourself — keep them in mind while authoring.

## factor — [implemented]

`between(factor, reference.min, reference.max)` — the per-unit factor named by
`abatement.factor_ref` (= reduction / activity) vs its input's `reference_ref` corridor. The
quality signal for the raw→computed ladder; ⚠ when out of corridor → stays `draft`.

## economics — [implemented]

`between(implied unit CAPEX, capex_ud.min, capex_ud.max)` per object. ⚠ out of corridor
(add a `divergence_reason` if `binding=alt`).

## pool — [implemented]

`lte(sum of pool annual allocations, pool.ceiling)`. On oversubscription the cheaper
(lower-MAC) claim first, the rest are clipped; a ⚠ on any measure whose share is clipped.

## sector — [implemented]

`lte(sum of sector reductions, the sector backstop)`. A coarse double-count check for the
sector; a ⚠.

## limit — [implemented]

`lte(consumption, ceiling)` — the unit measure's own consumption in its limiting dimension
(`potential.limit.consumption_ref`, an input/computed value resolved bottom-up) vs an industry
ceiling stored as a library indicator (`potential.limit.indicator_ref`). Per-measure and
independent of the pool; bounds the **volume**, never the MAC. ⚠ on overflow → lower the scale
input until it fits (the engine does **not** auto-clip here). See `references/potential.md`.

## dimension — [implemented, gating]

The abatement formula is folded over the unit vocabulary and must reduce to **CO₂/year**
(`mass_co2·time⁻¹`, or `mass_co2` if the year is inside). A missing/unknown unit, an
`add`/`sub` of incompatible dimensions, a result that is not CO₂, a product that crosses two
resource carriers, or an output-EF priced per the wrong product → the **reduction panel goes
incomplete** and the measure stays `draft` (a hard gate, not a soft ⚠). The carrier layer
(resource identity from `res:R#…` refs) catches a wrong-resource EF the bare units cannot see.
Full discipline: `references/dimension-bridges.md`.

## serviceUnitMatch — [author-applied rule]

`type=comparison` only: `flows.baseline` and `flows.project` products should match on
`serviceUnit`; a mismatch should be a ⚠.

## provenance — [implemented]

The §3/§6 notation rule: every number must be an `input` (in `sources`) or `computed`
(a formula) — never a bare literal. `validate()` surfaces the gaps as `untagged` /
`computedNoFormula` and folds them into `missing`, so they hold a measure back from
`eligibleForModel`. Source *quality* is a separate, non-automated judgment for the publish
gate: before a number joins the shared curve it should rest on `source_type ≠ placeholder`
and (for an assumption) `binding ≠ new` — see the publish gate in the workflow (SKILL.md, step 6).

## doubleCountReduction — [author-applied rule]

Reduction is set by exactly one method per maturity: raw — baseline × share;
computed — activity × factor; comparison — Δflow × EF. Mixing methods on one
measure should be a ⚠.
