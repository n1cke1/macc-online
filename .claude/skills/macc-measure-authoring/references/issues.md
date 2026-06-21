# Routing a problem — when to file an issue vs fix it yourself

You will hit things that are wrong but **not yours to silently change**: a shared library number
that looks off, a placeholder baseline, a missing corridor, a guardrail that fires wrongly, a
disputed classification. Do not quietly work around them — route them so they get fixed at the
source. The rule:

- **Fix it yourself** when it lives on *your* measure and reusing the library makes it right:
  your inputs, your formula/AST, your provenance, binding a number to an existing `{ref}`,
  lowering a scale that exceeds a limit. That is normal authoring — just do it.
- **File an issue** when the problem is in **shared truth** you shouldn't unilaterally rewrite,
  or in the engine itself.

## File an issue for

- **measure-data** — a library number is wrong, stale, or a **placeholder** needing a real source
  (e.g. the R3 subsector baselines seeded `source_type:"placeholder"`: coal_heat/industry_energy/
  coal_ch4/enteric/forestry; the coal reconciliation 135.3 vs 88.3 vs 130; kz-16 EF out of range).
- **library** — an indicator/ref/unit/bridge is incoherent or missing (no corridor on a number
  that materially moves a MAC; `owner-coherence` mismatch like emissions ≠ generation×EF; a unit
  or bridge the vocabulary lacks).
- **validation** — a guardrail looks wrong: a false ⚠ (plausible value flagged) or a false
  `готово` (something implausible passed), an `unchecked` rule you think should gate, a gate that
  blocks a legitimate edit.
- **classification** — a disputed sector/subsector/pool assignment, or a product that should be
  usable in a sector the model rejects (the product-applicability gap).

## How to file

Repository: **https://github.com/n1cke1/macc-online/issues**

Title: `<category>: <one-line summary>` (category = measure-data | library | validation | classification).

Body — always include:
- **id** of the measure (`kz-N`) and/or library entity (`ind_…`, `ref_…`, `sub:…#key`).
- **expected vs actual** — the value/verdict you expected and what you got.
- **model version** — the `modelVersion` from the dataset (e.g. `kz-sup-…`), so the report pins
  to a fingerprinted state.
- the relevant **`validate_measure` / `compute_measure` output** snippet (e.g. the `unchecked`
  list, a check verdict, a `classificationIssues` entry).
- if it's a data number: the **source** you believe is correct (citation/URL), so the fix is
  actionable.

Keep one problem per issue. If you can propose the corrected number + source, say so — it speeds
the fix. After filing, proceed with the best available value and note in the measure's provenance
that an issue is open.
