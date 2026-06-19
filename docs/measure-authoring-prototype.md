# Measure-authoring prototype — contract

Scope contract for the first authoring iteration. Implements the §11 acceptance slice of
`macc-ui-concept.md` (v0.4): three real measures exercised end-to-end through a new measure
schema, an AST→HyperFormula calc path, `validate()` guardrails, an accordion UI, and a stdio
MCP server. This file is the source of truth for *what the prototype guarantees* and *what it
deliberately defers*. (Section refs below point at `macc-ui-concept.md`.)

## Decisions (locked)

- **Slice, not full migration.** Only 3 measures move to the new format now; the same AST→HF
  mechanism scales to all 26 later (the §10 target — Excel cell refs → named AST). During the
  transition **two calc paths coexist**: the 3 prototype measures via `src/lib/measure` (AST→HF),
  the other 23 via the existing Excel grid in `src/lib/calc/engine.ts`.
- **One engine.** No second engine — HyperFormula stays. Measure formulas are stored as AST (§3)
  and compiled to HF formula strings on the fly. `etl.py --check` bit-for-bit parity remains the
  proof the translation lost nothing (§10).
- **Authoring UI + MCP are in scope** (not deferred). The `NEXT_PUBLIC_AUTHORING` flag and lazy
  loading are **bundle hygiene only** — the anonymous static core must still load and render the
  published curve with the authoring layer absent (core principle #1).
- **Architecture B.** Real Supabase persistence (tables + RLS + `owner_ref` via Supabase Auth),
  **server-side `validate()` / promotion** to published (Edge Function), MCP over **stdio**
  (identity from the Supabase session). stdio write needs no OAuth.
- **Deferred (explicitly planned next phase):** remote HTTP-MCP + OAuth 2.1 + DCR/CIMD for external
  vendor clients (ChatGPT/Claude Pro). Per §9 OAuth gates *remote* clients; it is not a condition
  for write to function. Also deferred: baking promoted measures back into the published
  `data/kz/*.json`, and migrating measures 4..26.

## The §11 test measures (= existing dataset rows)

| §11 | Measure | id | sector | abat (kt) | MAC ($/t) | Role |
|---|---|---|---|---|---|---|
| A. Feed additives | id 20 | `3` | 1780 | 99.9 | computed; activity × factor, factor in-corridor → ✓ |
| B. Coal CHP → gas | id 2 | `1.A.1` | 12045 | 193.76 | flow-based; `delta_ef` template binding |
| C. Mine degassing | id 16 | `1.B` | 1900 | 26.68 | INTENTIONALLY BROKEN: implied factor ~10× → ⚠, stays draft |

A and B's current Excel-derived outputs are the **golden-parity targets** for the new AST→HF path.
C must produce `validate().checks.factor = ⚠` and never auto-promote to published.

§11 reference corridor for A: raw `17.8 Mt × 0.10 = 1780 kt`; activity scalar `2550 thousand head`
→ implied `698 kg/head/yr`; reference −30% band = `600–840` → ✓.
§11 for C: raw `9.5 Mt × 0.2 = 1900 kt`; methane in the measure block ≈ `184 kt` → ~10× divergence.

## Risks / mismatches (the gate)

1. **Core ↔ Supabase boundary.** Static core never imports Supabase. Authoring UI + MCP live in
   the collaboration layer; mandatory but lazy/flagged so the anonymous curve loads without them.
   Published curve stays in `data/kz/*.json`; prototype-promoted measures live in Supabase and
   overlay when the layer is active. Baking into the published dataset is a separate publish step.
2. **Isomorphic calc core.** `compute()` / `validate()` / AST→HF must run in three runtimes:
   browser (UI), Node (stdio MCP), Deno (Edge Function for server-side promotion). So
   `src/lib/measure/*` carries **no Next/React/Supabase imports**; HyperFormula (pure JS) runs in
   all three.
3. **Two calc paths coexist** (see Decisions) — neither `recalc()` nor the AST path applies to the
   other's measures; keep them isolated until the §10 convergence.
4. **No published references/pools exist yet.** §7 guardrails need factor ranges, unit-cost ranges,
   pools (`caps_ref`, annual flow) and sub-category emissions (A: 17.8 Mt, C: 9.5 Mt). Seed the
   minimum under `data/kz/library/` for the 3 cases only.
5. **Two schemas, not one.** `MaccPoint` (`data/schema.ts`) is the *output* (a bar). The new
   *input* measure schema (§2) is separate and is the single JSON Schema for UI form + MCP + 
   `validate()`. `compute(measure) → MaccPoint`-compatible output for plotting.
6. **Server-authoritative promotion.** Clients/MCP must not set `scope=published` (gameable). RLS
   forbids writing `published`; only the Edge Function (service role), after running `validate()`
   server-side, raises scope.
7. **Schema versioning.** `schema_version` on the measure from day one; on `upsert` an outdated
   blob is migrated or cleanly rejected (§7, §10).
8. **i18n.** Panel/field labels → RU/EN in `messages/*.json`; measure domain text → `{ru,en}` on
   the object (as elsewhere).

## Review-pass refinements (after the first kz-2 UI review)

These remarks are reflected in both the UI and the data model:

- **No "canon" jargon.** `scope` enum is `published | draft | scenario`; the UI shows
  model-eligibility as a green automatic-check badge ("Проверки модели пройдены" /
  "Есть замечания"), not the word "canon".
- **"Stacking" → "combination".** Field `combination_group`; the UI calls it «сочетание
  мер (общий пул)» — several measures drawing on one limited pool; on oversubscription the
  cheaper (lower-MAC) ones claim it first, the rest are clipped.
- **Technology has descriptive rules.** `Technology.kind ∈ {capital_asset, modernization,
  practice, infrastructure}` + `description` + `rules`; the kind drives the economics
  expectation (asset → unit CAPEX; practice → ~0 CAPEX).
- **Fuels, not emission factors.** Resources are real fuels («Уголь»/«Газ» with their EF),
  not "EF угля…". The Baseline/Project panels ask «Что производим?» (product from
  `comparison.service_unit_ref`) and «Потребление чего снижаем / Чем замещаем?» (the flow
  resource).
- **Panel rename.** «Снижение» → «Выбросы CO₂e»; «Потенциал» → «Потенциал меры».
- **Formulas are data, shown in plain language.** `FormulaTemplate` carries `label`/
  `description`/slot labels; the reduction formula and the four guardrails are rendered from
  their stored AST (the §7 checks live in `data/kz/library/checks.json`, evaluated via the same
  AST→HF path — `compile.ts` gained the `lte`/`gte`/`between` predicate ops).
- **Provenance chips removed from the prototype UI.** `provenance` stays in the data model
  (§6) but is not shown until there is a real data source with a defined assignment rule.

## Iteration 2 — measure-creation structure (design, not yet built)

Agreed in the second review pass. The measure becomes a **composition of objects** (from a
shared library) + **sector/product** context, with economics **derived** from those objects
and their material flows — moving the prototype toward the concept's full §1 entity model.

### Sequencing decisions (locked)

- **Object library writes go to Supabase ⇒ Phase 2 precedes this editor redesign.** The "add
  object" (+) creates a `technology` (library object) with `owner_ref`; that needs the backend
  (tables + RLS) first. Order: **Phase 2 (Supabase) → iteration-2 editor**.
- **Sector/subsector taxonomy: base extracted from the «Выбросы» sheet via the ETL, and
  extendable** (users/agents can add a sector/subsector).
- **Parity stays a hard gate.** The 3 §11 measures are re-encoded into the object/flow
  structure and must still reproduce the Excel MAC/abatement bit-for-bit (`measure-golden`).
- **Structure-first:** this section is the contract; code follows once it's confirmed.

### Panel structure (renamed/restructured)

| # | Panel | Content (UI) | Data |
|---|---|---|---|
| 1 | **Обзор** | Measure name full-width (left-aligned, was clipped). Inferred tags (maturity / type / …) with a **hover tooltip** from the agent instructions: what the tag means, how it's assigned, what other values exist. | Per-enum descriptions (RU/EN) as one source for the tooltip **and** `schema://measure`. |
| 2 | **Что создаём** (was «Что строим») | A **list of objects** + an **"+"** to add/pick from the library. Per object: unit CAPEX, OPEX, efficiency, individual indicators. | `created_objects[]` referencing library `technology` records (writable). |
| 3 | **Отрасль и продукт** (was «База») | Pick sector/**subsector** (e.g. Agriculture/Orchards; Energy/Coal power). Pick or **create a product** + its **carbon footprint**. CCS → several sectors, product optional; CCUS → sectors + product (EOR / green ammonia); feed-additives → sector only. | `sectors[]` (multi) with subsector refs; `Product` + `carbon_footprint`. |
| 4 | **Что закрываем** (was «Проект (что взамен)») | List of **retired** objects («−»). Per object: maintenance unit CAPEX, OPEX, efficiency, indicators. | `retired_objects[]` from the same library. |
| 5 | **Выбросы CO₂e** | Show the reduction formula in **bracketed named-indicator form**: `[показатель] × [показатель 2] × [ … ]` (nested ops preserved, e.g. `[EF замещ.] − [EF нов.]`), each bracket a named indicator with its value; the per-cell "?" reveals each indicator's source (input) or formula (computed). | Rendered from the reduction AST (renderAst); brackets wrap each leaf/factor. |
| 6 | **Проект** (was «Экономика») | **CAPEX**: a row per new object («+»: capacity/size, unit, CAPEX m$) and per retired object («−»: maintenance CAPEX). **OPEX**: a row per object OPEX (±) + key raw materials (± with qty / price / cost). | Economics **derived** from objects (capex_ud × capacity) and material flows (qty × price) — not free-form line items. |
| 7 | **Потенциал меры** | (unchanged) | — |

### Data-model additions

- **Measure:** `created_objects[]`, `retired_objects[]` (each `{ object_ref, capacity, unit, … }`);
  `materials[]` (`{ resource_ref, side: new|retired, qty, price }`, cost = qty×price);
  `sectors[]` (multi, each with optional `subsector_ref`); `product_ref?`. Economics becomes a
  computed roll-up of objects + materials.
- **Technology (library object):** add `opex_ud`, efficiency, `indicators[]` (individual
  metrics), `maintenance_capex_ud`. Library is writable (Phase 2).
- **Product:** add `carbon_footprint { value, unit }`.
- **Subsectors:** `Canon.subsectors` (sector → subsectors), seeded from «Выбросы», extendable.
- **Enum descriptions** (maturity / type / scope / tech-kind) RU/EN — agent-instruction text,
  one source for tooltips + MCP.

### The "?" affordance (replaces the removed chips)

Each value cell gets a **"?" circle**; inputs are visually highlighted with a fill.
- "?" on an **input** → its reference source(s) / link.
- "?" on a **computed** value → its formula (rendered from the stored AST).

So every value is tagged `input` (carrying `sources[]`) or `computed` (carrying a formula AST).

### Single instruction source

The operational "how to fill a measure" instruction is consolidated into ONE runtime
source: `data/kz/library/measure-notation.json` (the *measure-notation framework*, bilingual).
It mirrors the editor — `panels` → `fields` (EVERY authored field) → `enums` — and adds two
cross-cutting blocks: **`sourcing`** (the §6 provenance/binding/reference discipline — what
references to accompany every number with) and **`formulas`** (the §3 AST notation — allowed
operators, predicate ops, leaf forms, and a worked example — the requirements for writing
measure formulas). It is the single source for the UI tooltips / "?" help, the MCP
`schema://measure` resource and the agent prompt; the design *rationale* stays in
`macc-ui-concept.md`, structural validation in `data/measure.schema.json`. In code the type is
`MeasureNotation` (`schema.ts`) and the loaded object is `library.notation` (the old
`Glossary`/`library.glossary`/`glossary.json` names were retired; the duplicated
`measure.tagInfo` block was already removed from the i18n catalogs).

### Open points to refine (before/while coding)

- Curve color when a measure spans multiple sectors (primary = `sectors[0]`?).
- How pipeline-type co-CAPEX (kz-2's 0.4×turbine) re-encodes as an object vs a derived add-on.
- Whether retired-object "maintenance CAPEX" is a true CAPEX line or an avoided-cost OPEX.

## Iteration 3 — normalized entity graph + English-base i18n (target; not built)

A re-architecture of the authoring **data layer** into a connected, normalized graph stored in
Supabase, with the **Indicator** as the hub and **English as the single base language** (translation
as a separate layer). Decisions below are locked with the owner.

### Decisions (locked)

- **Storage = Supabase normalized tables** (not files) for the authoring library. The published curve
  (`data/kz/model.data.json`) is untouched — the anonymous static core keeps working file-based.
- **Indicator is the hub.** Every library number (`capex_ud`, `opex_ud`, `maintenance_capex_ud`,
  `ef`, `price`, carbon footprint, efficiency …) leaves the object/resource/product and becomes an
  `indicator { id, key, owner_kind(object|resource|product|global), owner_ref, value, unit,
  provenance, reference_ref? }`. Objects/resources/products store only metadata.
- **Separate entity types:** `sectors · subsectors · objects · resources · products · references ·
  indicators · pools · checks · globals`. FKs: `indicator.owner_ref`, `indicator.reference_ref`,
  `product.sector_ref`, `product.object_ref`, `subsector.sector_ref`, `pool.sector_ref`.
- **Guardrails generalize via the hub:** the economics check compares the measure's implied unit
  cost to the **object's `capex_ud` indicator's reference**; the factor check stays measure-local
  (its corridor depends on the measure's activity); pool/sector stay aggregate.
- **Measure** (JSONB doc) references library objects (`created_objects`/`retired_objects`/
  `materials`, `sectors[]`, `product_ref`); **local inputs stay in the measure** (`measure.inputs`:
  share, activity, capacity, КИУМ) — only library/shared numbers are indicators.
- **Runtime = Supabase only.** The editor/calc require the migrations applied + seeded; no offline
  file fallback. (The static curve is unaffected.)
- **English single base language; translation a separate layer.** Every entity stores English text
  directly (name/description/rules). A `translations` table `{ entity_kind, entity_ref, field,
  locale, text }` holds non-English overlays; the UI resolves base(en) + overlay(locale) → fallback
  to en. This replaces inline `{ru,en}` for the authoring graph. (The legacy `model.data.json` stays
  RU-primary for now; flipping it is a separate, later step — see open scope question.)
- **Parity stays a hard gate.** Indicator values are the same numbers as today → `compute`/golden
  match bit-for-bit. A normalized **English seed** feeds the DB and the `measure-golden` fixture
  (translations aren't needed for the numeric tests).

### Build order

1. Migration `0007` — graph tables + RLS (writable: objects/resources/products/indicators with
   owner; authority read-only: references/pools/checks/sectors/subsectors/globals) + `translations`.
2. Seed (script or `0008`) — populate the graph from the normalized English seed.
3. Calc refactor — a library loader that assembles the in-memory `Canon` from Supabase (and from the
   seed for tests); `compute`/`guardrails` resolve numbers via indicators; economics check via the
   object's `capex_ud` indicator reference. Keep `measure-golden` green.
4. UI — load library from Supabase; new i18n resolver `tr(entity, field)` (base en + overlay).
5. Re-encode the 3 §11 measures against the graph; parity verified.

### Open scope question

Does English-base + translation-layer apply **only to the new authoring graph**, or **also to the
published curve** (`model.data.json`, currently RU-sourced from the Excel)? Default assumption:
authoring graph now; the published curve migrates later.

## Acceptance (§11 criteria)

The prototype passes when the engine: (1) computes MAC from one economic core (§0); (2) validates
the service unit for B; (3) marks ✓ (A) / ⚠ (C) on **both** physics and economics; (4) clips
potential by MAC-order stacking (order-independent) on pool oversubscription; (5) accepts writes
only with `owner_ref` (identity), reads anonymous; (6) blocks no publication but admits to published
only what passes the validator. See `## Verification` in `~/.claude/plans/macc-ui-stateful-hoare.md`.
