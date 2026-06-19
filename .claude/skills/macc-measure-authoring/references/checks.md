# Checks — the advisory guardrails

> Mechanically extracted (verbatim) from the `checks` block of
> `data/kz/library/measure-notation.json` during the notation/skill split (step 1).
> Describes what `validate_measure` does; the `[rule, not yet automated]` items are
> authoring rules, not code — candidates to surface in the skill workflow.

**Principle.** Automatic checks on predicates (`lte`/`gte`/`between`), surfaced by
`validate()`: ✓ pass, ⚠ warn. They are ADVISORY — they do NOT block publishing (publishing
is direct). They inform the author and drive `eligibleForModel` (= all checks ✓ and panels
complete), shown as a badge. IMPLEMENTED checks: factor, economics, pool, sector. The rest
below are rules the author follows but are NOT yet automated.

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

## serviceUnitMatch — [rule, not yet automated]

`type=comparison` only: `flows.baseline` and `flows.project` products should match on
`serviceUnit`; a mismatch should be a ⚠.

## provenance — [rule, not yet automated]

Every number should have `source_type ≠ placeholder` and (for an assumption)
`binding ≠ new`; surfaced as the §3/§6 notation gap (untagged / no-formula), not yet a
predicate check.

## doubleCountReduction — [rule, not yet automated]

Reduction is set by exactly one method per maturity: raw — baseline × share;
computed — activity × factor; comparison — Δflow × EF. Mixing methods on one
measure should be a ⚠.
