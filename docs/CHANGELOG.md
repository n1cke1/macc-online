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
