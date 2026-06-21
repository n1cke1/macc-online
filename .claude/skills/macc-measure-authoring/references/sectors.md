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

Map each measure to the subsector id under its sector code (e.g. `1.A.1.coal_power`,
`1.B.coal_methane`, `2.cement`, `3.enteric`).

## Pools and ceilings

A measure's **pool** is the subsector **emissions baseline indicator**
(`sub:<subsector>#max_emissions`) — there is no separate `pool` entity (R3 dissolved it into the
indicator hub). When a measure sets `potential.pool_ref` to that indicator, its contribution
counts against the indicator's value as the ceiling, checked by `checks.pool`. Measures abating
the same subsector's emissions MUST share the same `pool_ref`, or the model will double-count
their potential. Note the simplification: pools do not model deployment-order interactions
between measures.

## Registry hygiene (anti-duplication)

Before `upsert_library_entity`, search `list_library` for an existing match.

- Reuse an `id` when unit + cost structure + lifetime match.
- A new entity needs a descriptive `id`, plus `description` and `rules` filled in.
- Indicators (`capex_ud`, `eff`, `ef`, `price`, …) attach to an owner via
  `owner_kind` + `owner_ref`; reuse the owner rather than cloning it.
- Prefer a canonical entity per common concept — one "Renewables" object, one shared
  "O&M" resource pattern — rather than minting a near-duplicate.
