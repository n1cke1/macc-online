# Potential — the two ceilings on a measure's volume

A measure's annual abatement is the *unit measure* (one installation / one batch, computed
bottom-up in §3/§6) **times its scale** — and the scale is not free. Two independent ceilings
bound it. Both live under `potential`; neither touches the MAC (the MAC is set by the unit
economics, §0). They cap **volume only**.

```jsonc
"potential": {
  "ceiling_dim": "n_objects",          // which dimension caps this measure
  "pool_ref": "sub:1.A.1.coal_power#max_emissions", // shared ceiling = the subsector emissions baseline; measures COMBINE
  "limit": {                            // per-measure ceiling — THIS measure's own scale
    "indicator_ref": "ind_coal_power_capacity",
    "consumption_ref": "cap_mw"
  }
}
```

## `ceiling_dim` — what is being counted

The physical dimension the ceiling is expressed in: `cut_resource` (a feedstock/fuel freed or
consumed), `output_product` (product delivered), `n_objects` (installed units / capacity), or
`activity` (an activity level). It names the axis both ceilings below measure against — keep the
indicator's unit and the consumed value in *that same* dimension.

## The pool — a **shared** ceiling (measures combine)

`pool_ref` points at the subsector **emissions baseline indicator** (`sub:<subsector>#max_emissions`)
— the shared emissions volume measures compete for; its value is the ceiling. (R3: the standalone
`pool` library entity was dissolved into this indicator — one value type, one owner, one provenance.)
Measures that share a pool **compete for the same headroom**: `validate` sorts the group ascending by MAC, the
cheapest claims the pool first, and the rest are **clipped** to what remains (`stackPools` in
`validate.ts`). The `pool` check ⚠ flags any measure whose share is clipped. A measure with **no
pool is `incomplete`** on the potential panel — the pool is required.

This is about *not double-counting across measures*. It is the engine's job (auto-clip), not the
author's.

## The limit — a **per-measure** ceiling (this measure's own scale)

The pool stops measures from collectively overcounting; the limit stops **one** measure from
claiming more of the industry than physically exists. It is the **limiting factor**: the resource
available, the product the market absorbs, the max capacity, the number of installations — the
thing that runs out first as you scale this measure up.

How to declare it (workflow step 4):

1. **Find what bounds the measure.** What is the most you could deploy before you run out of the
   scarce thing? That scarce thing, in the `ceiling_dim` dimension, is the limit.
2. **Record it as a library indicator** for the *industry* — typically `owner_kind: "subsector"`,
   a `max_capacity`/availability `key`, a `value` + `unit`, and a real `provenance` (a guess keeps
   the measure a draft). Reuse an existing indicator if one already states this ceiling.
3. **Point the measure at it:** `limit.indicator_ref` → that indicator; `limit.consumption_ref` →
   the measure's own input/computed key whose value is *how much of that dimension the unit measure
   consumes at its declared scale* (e.g. the capacity input `cap_mw`).

What the engine does (`limit` check, `checks.json`): resolves `consumption = resolve(consumption_ref)`
bottom-up, reads `ceiling = indicator.value`, and asserts `consumption ≤ ceiling`.

- **It does NOT enter the bottom-up formulas and does NOT change the MAC.** It is a guardrail on a
  number you already computed.
- **It does NOT auto-clip** (unlike the pool). On overflow the check ⚠ and the potential panel
  warns. The fix is the author's: **lower the scale input** (an input feeding `consumption_ref`)
  until the measure fits. The limit bounds the volume; nothing else moves.
- A warn folds into `eligibleForModel` (a measure over its own limit is not curve-ready).

## Worked example — kz-2 (coal CHP/boilers → gas)

The limiting factor is the coal-fired capacity there is to convert. Indicator
`ind_coal_power_capacity` (`subsector` `1.A.1.coal_power`, `max_capacity` = {{indicator:ind_coal_power_capacity}}). The
measure's scale is `cap_mw` = 5000 МВт. So `limit = {indicator_ref: ind_coal_power_capacity,
consumption_ref: cap_mw}`; the check reads `cap_mw ≤ the ceiling` → ✓. Raise `cap_mw` past the ceiling and the
check ⚠, the potential panel warns, and the measure drops out of `eligibleForModel` until the
scale is lowered. The MAC is unchanged either way — the limit never touches it.

## Status

A `limit` is **required** for model eligibility: a measure without one has its potential panel
marked `incomplete` and stays `draft`. Declare the limiting factor for every measure.
