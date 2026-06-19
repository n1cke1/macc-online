# Sector conventions & registry hygiene

Domain conventions kept out of SKILL.md so the main file stays stable. Read when a
measure's sector, pool, or factor placement matters.

## Sector codes (IPCC-style)

| Code | Domain |
|---|---|
| `1.A.1` | Energy industries (power & heat) |
| `1.B` | Fugitive emissions (e.g. coal-mine methane) |
| `2` | Industrial processes (cement, metallurgy, CCS) |
| `3` | Agriculture / AFOLU |

> TODO (expert): complete the code list and map each measure family to its subsector id
> (e.g. `1.A.1.coal_power`, `1.B.coal_methane`, `2.cement`, `3.enteric`).

## Pools and ceilings

A `pool` caps the total abatement available to the measures that share it
(`{id, caps_ref, annual_flow, unit, sector_ref, baseline_emissions_kt?}`). When a measure
sets `potential.pool_ref`, its contribution counts against that pool's `ceiling`, checked
by `checks.pool`. Measures competing for the same physical resource MUST share a pool, or
the model will double-count their potential.

> TODO (expert): list the canonical pools, their ceilings, and which measures belong to
> each. Note the simplification: pools do not model deployment-order interactions between
> measures — state this limitation in the tool's methodology page.

## Registry hygiene (anti-duplication)

Before `upsert_library_entity`, search `list_library` for an existing match.

- Reuse an `id` when unit + cost structure + lifetime match.
- A new entity needs a descriptive `id`, plus `description` and `rules` filled in.
- Indicators (`capex_ud`, `eff`, `ef`, `price`, …) attach to an owner via
  `owner_kind` + `owner_ref`; reuse the owner rather than cloning it.

> TODO (expert): curate the "preferred entities" list — the canonical object/resource for
> each common concept (one "Renewables" object, one shared "O&M" resource pattern, etc.) —
> and fold a duplicate-id warning into validate/upsert over time (move this rule L3 → L2).
