# Sourcing — provenance & binding discipline

**Principle.** Every number in a measure carries a source (provenance) and, if it is an
assumption, a library binding. Rule for the LLM: do not invent numbers — reuse the library,
explain divergence, or admit it is local. Attach a source via `measure.sources` keyed by the
value's path (e.g. `'created_objects[0].capacity'`, `'materials[1].price'`); a DERIVED number instead goes in `measure.computed` at the
same path (a formula) — a path is in `sources` XOR `computed`, never both, never a bare
pasted number.

## Provenance

A number's source: `source_type` (official_stat/literature/standard/expert_estimate/
assumption/placeholder), `confidence` (high/medium/low), citation/url/date. With no source
it is treated as a placeholder (low confidence, flagged).

## Binding

Assumption discipline: `reuse` (take the library value by ref), `alt` (a custom value + a
required `divergence_reason`), `new` (local, no analogue — flagged for review), `derived` (the
number is produced by a formula in `computed`, not entered). The goal is reuse and explainability.

A **trustworthy/shared** number — one that equals an existing library indicator (e.g. a subsector
emissions baseline) — must be a `{ref}`, not pasted inline: the ingest gate flags an inline value
that matches an indicator (`should-ref`) so the single source can't drift (R1/C9).

## Divergence reason

Mandatory note for `binding=alt`: why the value diverges from the library reference.

## Reference (corridor)

A `[min, max]` corridor with a unit a check anchors to: `factor` — the reduction factor,
`capex_ud` — the object unit CAPEX. Set `reference_ref` on the factor input and on the object;
the corridor's own source lives in its `source` field.
