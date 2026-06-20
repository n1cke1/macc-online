# Changelog

Notable changes that aren't obvious from a single commit subject. Source of truth
is `git log`; this file just catches the cases where the headline commit doesn't
reflect the full payload, so the history stays searchable.

## Unreleased

### MCP

- `get_measure` now inlines the formula template body for measures whose
  `abatement.computed.formula_ref` names an engine template (e.g. `delta_ef`).
  The response gains `abatement.computed.formula` (full template — `expr` AST +
  `slots`), `resolved_ast` (slot→ref/const symbolic substitution, NOT evaluated;
  use `compute_measure` for numeric results) and a `human` rendering. Closes the
  §3/§6 audit gap: one response is enough to trace any `formula_ref` measure
  down to its leaf inputs without reading engine code.
  Storage is unchanged — read-time enrichment, no migration, no drift.
  Code landed in `76c082d`; notation/TODO update in `8159759`.

### Validate

- **Phase A — reuse-drift detector.** `validate()` now walks every
  `binding.mode='reuse'` on `inputs[]` and `sources[]`, resolves the bound
  source, and reports a `DriftEntry { path, ref, local, bound }` whenever the
  local number disagrees with what its `binding.ref` claims to mirror. Drift
  entries land on `missing[]` and on a new `drift[]` field, and gate
  `eligibleForModel` (a drift can't be silently promoted). Phase A understands
  `in:<key>` / bare-key (measure input) and JS-path refs into the measure
  itself; `res:<id>#<key>` indicator refs are silently skipped pending Phase B
  (resolver extension for the `#` syntax). One existing drift in the seed
  corpus surfaces immediately — `kz-16.materials[0].qty` (9791) vs
  `created_technologies[0].capacity` (9.79), a 1000× scale mismatch that
  should be re-tagged `mode='alt'` with a unit-scaling `divergence_reason`.

### Resolver

- **Phase B — unified resolver + registry-wide `#` syntax.** The shared
  `makeResolver` (compute.ts) now understands every namespace a measure can
  legitimately point at: `res:<id>#<key>` (resource indicators — price, lhv,
  comb_factor, …), `obj:<id>#<key>` (technology — capex_ud, eff, …),
  `prd:<id>#<key>` (product — carbon_footprint), `sub:<id>#<key>` (subsector
  ceilings), `glb:<key>` (`library.globals`), `in:<key>` (measure input,
  explicit form). `res:<id>` keeps its year-series EF fast path as the
  shortcut for `res:<id>#ef`. Unknown indicators throw a descriptive error
  pointing at `(owner_kind, owner_ref, key)`. Indicator lookup is the §1
  Indicator-hub, so a registry edit reaches every formula that names the
  indicator — `binding.reuse` becomes a live link instead of just provenance.
- The duplicated `makeResolver` in `guardrails.ts` is gone; both `compute()`
  and the guardrails import the same definition. The drift detector's helper
  (`resolveBindingRef`) delegates everything to it and only keeps the JS-path
  fallback (`created_technologies[0].capacity`) the resolver doesn't know.
- No new drift surfaces in the seed corpus — all `res:<id>#price` bindings on
  kz-2/kz-20 happen to match the registry value, so kz-16's existing 1000×
  scale mismatch is still the only drift after Phase B.

### Schema

- **Phase C — eliminate dual storage on line-item scalars.** The numeric fields
  on `created_technologies[]`, `retired_technologies[]` and `materials[]` are
  now `NumberOrRef = number | { ref: string }`. A measure can replace
  `capacity: 5000` with `capacity: { ref: 'in:cap_mw' }` — the engine
  dereferences through the unified resolver at rollup time, so the line item
  and the bound source can no longer drift apart (single physical quantity,
  single number on disk). `taggablePaths` treats a `{ref}` as already
  tagged (notation rule §3/§6: the ref *is* the binding), and the drift
  detector skips paths that no longer hold a literal number. JSON Schema gains
  a `$defs/numberOrRef` union, applied to the 9 affected scalars. The MCP web
  editor (`MeasureEditor.tsx`) renders ref-form fields as a read-only chip
  (`→ ref:key`) instead of a NumberField — UI authoring stays literal-only
  for now; ref-form authoring goes through the MCP/JSON path.
- Migrated 7 paths in the seed (kz-2: 2× capacity + 2× material.price;
  kz-20: 1× capacity + 1× material.qty + 1× material.price). MAC/abatement/
  CAPEX/OPEX are bit-for-bit identical to pre-migration (measure-golden 24/24).
  kz-16's `materials[0].qty` vs `created_technologies[0].capacity` drift is
  left in place — it's a real value disagreement (1000× scale), needs to be
  re-tagged `mode='alt'` with a divergence_reason, not auto-migrated.
