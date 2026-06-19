# RAW STAGING — procedure + requirements (NOT FINAL)

> ⚠️ Mechanically extracted (verbatim) from the `procedure` and `requirements` blocks of
> `data/kz/library/measure-notation.json` during the notation/skill split (step 1).
>
> **This file is staging, not the skill.** These two blocks overlap heavily with the
> existing `SKILL.md` workflow (§1–6) and the `requirements`-by-axis idea. They are parked
> here verbatim only so step 2 can safely slim the JSON without losing content. The
> collaborative skill pass (step 3) reconciles them into `SKILL.md` and then this file is
> deleted. Do NOT cite this file as the source of truth; do NOT wire it into the MCP bundle.

---

## procedure

**principle.** Fill in order: classify first (this decides which panels apply), then data,
then sources. Do not hand-enter inferred fields (the type badge from composition, scope).
Every number carries a source; every object/resource comes from a registry, not invented.

**classifyType.** Pick type first. `comparison` — the measure delivers the same product a
different way, comparable on a service unit (power, transport): needs `serviceUnit` + flows
base/project. `substitution` — displacement/capture/practice with no comparable product
(CCS/CCUS, agro): no comparison and no serviceUnit check.

**chooseMaturity.** Start at `raw` (reduction = baseline × share). Advance to `back_calc` by
adding activity → the implied factor is checked vs the reference corridor. Advance to
`computed` only when reduction is expanded by a formula and the implied factor is in-corridor
and sourced. The maturity ladder is an authoring-quality discipline (the factor check is
advisory, not enforced at publish).

**order.** Recommended panel order: overview (name, sector) → baseline (what we displace) →
build (created objects) → project (closed objects) → reduction (reduction by maturity) →
economics (CAPEX/OPEX → NPV/MAC, derived) → potential (ceiling, pool, combination).

**publish.** Publishing is DIRECT: any signed-in user creates or corrects a measure and it
goes straight to the trusted curve (`scope=published`) — there is no server-side review gate.
Every change is versioned and attributed to its author; co-authors = the distinct authors of
the version history. `validate()` still runs but is ADVISORY (shown, never blocking). Use
`draft` for personal work-in-progress and `scenario` for what-ifs to keep them out of the
curve.

---

## requirements

**principle.** A field's necessity depends on three axes: type, maturity, scope. Below is
what each axis value requires; requirements are cumulative (a measure should satisfy all that
apply). Under direct publish these are quality expectations, surfaced by `validate()`, not
hard gates.

### byType

- **comparison.** Requires: `serviceUnit`; `flows.baseline` and `flows.project` per the same
  service unit; baseline and project products matching on that unit. `carbonFootprint` not
  required (emissions from Δflow × EF).
- **substitution.** Requires: sector(s); for product displacement — `produce` +
  `carbonFootprint` with a source. `serviceUnit` and flows not needed. CCS/CCUS may list
  several sectors.

### byMaturity

- **raw.** Minimum: sector, subsector, share. activity, a formula and the factor check are
  not required.
- **back_calc.** Additionally: activity and the factor corridor's `reference_ref`. The
  implied factor must be computable (reduction / activity).
- **computed.** Additionally: a reduction formula (AST) with every `ref` leaf resolvable; the
  implied factor in-corridor and sourced.

### byScope

- **draft.** Minimum to save: name, sector, type. Allows placeholders and `binding=new`.
- **published.** In the trusted curve. Quality bar (advisory, surfaced by `validate()`, not
  enforced): every number sourced (no placeholders); every assumption `binding=reuse` or
  `alt` (with `divergence_reason`); the advisory checks ✓. Publishing is direct and versioned.
- **scenario.** Same fields as a measure of its maturity, but checks may be ⚠ — a scenario
  stays out of the trusted curve.

### conditional

- **explicitCapex.** `capexMusd` (explicit CAPEX) should carry a source; otherwise treated as
  a placeholder (low confidence).
- **altBinding.** `binding=alt` requires `divergence_reason`. `binding=new` is flagged for
  review (no library analogue yet).
- **objectResolves.** `objectRef` and `materialResource` must resolve to an existing registry
  entry. If missing, create it in the library/resource registry first — do not type a name
  into the measure.
