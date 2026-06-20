---
name: macc-measure-authoring
description: >-
  Author, correct, and quality-check MACC measures in the macc-online notation —
  the measure-document JSON consumed by compute_measure / validate_measure and the
  shared library (technologies, products, resources, indicators, refs, pools, subsectors). Use this
  whenever the user wants to create, edit, back-calculate, validate, or publish a
  Kazakhstan MACC measure; add or reuse a library entity; move a measure between the
  Excel model and the notation; or asks why a measure fails validation or its MAC /
  potential looks wrong — even if they don't say "skill" or "notation". Consult it
  BEFORE calling create_measure / update_measure or upsert_library_entity.
license: CC-BY-4.0
---

# MACC measure authoring

This skill is the **judgment layer (L3)**: how to author a *good* measure. Two other
layers carry the rest, and this file never restates them:

- **L1 — the shape (contract).** The measure-document JSON and the library entity
  shapes. Read them from the MCP resource `schema://measure` and a live example via
  `get_measure('kz-2')`. Do not paraphrase field lists here.
- **L2 — the machine checks.** `validate_measure` runs the §7 guardrails and the §3/§6
  notation rule. It is **advisory** — it informs, it never blocks.

This file is the part neither encodes: the **model** of what a measure is, the **quality
bar**, and the **workflow** — choosing the right modeling stance, reusing the registry
instead of duplicating it, and being honest about data quality before publishing.

A measure is **data, not code**: processed by the engine but licensed CC-BY-4.0 and
reviewed by domain experts. Author it so a reviewer can audit every number.

These are the **requirements a measure must meet**. Because `validate_measure` is advisory,
meeting them is the author's responsibility, not the engine's.

## The one rule that defines the notation (§3/§6)

**Every number is either an input or computed from inputs — never a bare literal.**
Each quantity is either:
- an entry in `inputs` (a leaf value with a unit and provenance), or
- a `computed` node whose `formula` derives it from `ref`s to inputs / other computed
  nodes, with `const` only for genuine mathematical constants (e.g. `3.6`, `8760`).

A number just pasted in — neither an input nor derived by a formula — breaks this rule;
`validate_measure` lists it as `untagged`. Fix it: make it an input, or compute it in a
formula. That traceability is what lets a reviewer audit every number.

---

# A. The measure model

What a measure *is*, before you author it.

## Terms

- **Technology** — the entity a measure builds on: a capital **structure**, an
  **infrastructure** system, an asset **retrofit**, or an operational **practice** (its
  **class**). A measure reuses one from the library or creates it — never invents one inline.
- **Indicator** — one number (capex, EF, price, lifetime, a limiting factor…) owned by a
  technology / product / resource / industry, with units and provenance.
- **Library entity** — a registry row: technology · product · resource · indicator ·
  reference · pool · subsector.

## Mechanism & baseline — two axes

Two independent axes classify a measure (sector is a separate third dimension, already in the
model — not folded in here).

**Axis 1 — mechanism** (what it does to emissions):
- **reduction** — cuts or avoids GHG at source, against a baseline that still emits. Nearly
  every Kazakhstan measure: efficiency, coal→gas/RES switch, electrification, industrial
  process change, methane leak/flaring reduction, demand reduction — **and fossil-CO₂ capture
  (CCS/CCU)**. *(Optional subtype tag: efficiency · fuel/feedstock switch · electrification ·
  process change · demand reduction · non-CO₂.)*
- **removal** (CDR) — deliberately takes CO₂ out of the atmosphere and stores it durably:
  afforestation, soil carbon, wetland restoration, biochar (nature-based); BECCS, DACCS,
  enhanced weathering (engineered). Removal *counterbalances* residual emissions — it is not a
  substitute for reduction. *(Optional attribute: permanence — short-lived nature-based vs
  durable geological.)*

> **The line that trips people up:** capturing **fossil** CO₂ (CCS/CCU on a coal plant or a
> gas-processing flue) is **reduction**, not removal — it only prevents fossil emissions. Only
> **biogenic** (BECCS) or **ambient-air** (DACCS) capture is removal.

**Axis 2 — baseline basis** (how abatement is measured — the modeling-decisive choice):
- **comparison** — the same product delivered a different way; abatement = (baseline-technology
  emissions − measure emissions) × activity, per the product's service unit (MWh, t steel,
  tonne-km). The baseline is the displaced technology.
- **standalone** — no displaced product; abatement = tonnes removed or avoided vs an
  activity-scenario baseline. Use for all removals, agricultural practices, methane
  leak/flaring reduction, waste capture.

Author rules: every measure declares **(mechanism, baseline basis)**; every **removal is
standalone**; **fossil-CO₂ capture is reduction**. Define the baseline *before* computing
anything. Grounding: IPCC AR6 WGIII (mechanism) · World Bank MACC & GHG Protocol (baseline
basis) — see `references/measure-types.md`.

## Calculation basis

- **The product** — every measure except a pure removal has exactly one: what it produces or
  operates on (electricity, steel, gas, a crop), invariant across the before/after variants.
  In a **comparison** measure it is also the comparison basis — baseline and project are
  compared per unit of it (its **service unit**, e.g. MWh). In a **standalone** measure it
  just anchors the measure and may limit it. A pure removal has no product.
- **New technologies** the measure creates — with their products and feedstock. Build
  CAPEX/OPEX arise here (sign **+**).
- **Closed technologies** the measure retires — their maintenance CAPEX and OPEX become
  **avoided cost** (sign **−**).

Field shapes: `schema://measure`. Sign/unit/MAC conventions: `references/conventions.md`.

## Sector & measure interaction

- Each technology maps to an **industry**, which maps to an **IPCC sector** (a measure may
  span several). This drives curve colour and the double-count backstops.
- Measures interact three ways: **complementary** (independent) · **competing** for one
  emission source (RES vs nuclear) · **potential-reducing** (RES shrinks CCUS potential).
- Today the engine computes only **shared-resource competition** (measures sharing a
  resource pool are clipped by MAC order on oversubscription). Broader competitor /
  potential-reducing links are not computed — **record them as tags on the measure**.
  See `references/sectors.md`.

## The project library

The shared registry that makes measures comparable: industries/subsectors, **technologies**
(a capital **structure**, **infrastructure**, a **retrofit**, or a **practice** — the *class*),
**products**, **feedstock/resources**, and **indicators** (every number, tied to a technology
/ product / resource / industry).

- Every measure is **built on library entities**. If a needed technology — or an
  indicator — is missing, **create it**; never type a free name into the measure.
- **Reuse before creating.** Before adding a new entry, search for an existing one that
  matches *what it is* — class, unit, cost structure, lifetime — not just its name (names
  vary, so the same thing is easily duplicated). Create a new entry only when nothing
  existing genuinely fits.

---

# B. Data quality

Each library **indicator** carries: a name, a short description, a value with units, a
**traceable source** (web link or other unambiguous citation), and optionally a realistic
range.

- **Geo-applicability** — classify each number as **global** (low geo-sensitivity) ·
  **KZ-specific** (economics, climate, construction cost & lead times) ·
  **other-country-based**, and state its **reliability for assessing the measure in
  Kazakhstan**. A number can rest on real-project benchmarks, authoritative research, or
  official sources — but its KZ-applicability must be characterised.
- **Provenance discipline** — every number declares its source type and confidence, and
  whether it reuses a library value or diverges (with a reason). Details:
  `references/sourcing.md`.
- A guess / placeholder is a visible TODO in a **draft**, never in a **published** measure
  (see the publish gate, step 6).

---

# C. Formulas

A measure carries one or more formulas in the **MACC formula AST** — a small, closed,
auditable notation that compiles to the same engine as the Excel model (parity-exact). The
operator set, the leaf kinds, and how a formula renders in the UI vs compiles for the engine
are the full spec: `references/formula-ast.md`.

- Formulas must compute the measure's **abatement** — the emissions change in **CO₂e**
  (non-CO₂ gases converted via their GWP) — and its **ΔCAPEX** / **ΔOPEX**, derived from the
  **quantities of fuel, energy and carbon-bearing feedstock/product** in scope.
- **Complexity** — nesting **≤ 2 levels** and **≤ 5 terms/factors** per node; if deeper,
  **expand** each complex value on the next level in the same notation rather than inlining it.
- Every value in a formula resolves to a library indicator, a measure input, or another
  computed value — no bare literals (§3/§6).
- **Build the reduction by units** — chain unit *bridges* (`power_to_energy`, `fuel_to_energy`,
  `energy_to_co2`, fuel switch) from what you hold to CO₂/year, taking each EF from the **right
  resource** (`res:R#…`). `validate_measure` folds the formula over the dimensions and gates it
  to `draft` if it does not reduce to CO₂ or crosses resource carriers (e.g. an electricity EF
  on a thermal chain). Give every input a `unit`. **Prefer computing from the fuel** (mass × LHV × fuel EF)
  over a coarse output-EF — it is auditable and carrier-safe. → `references/dimension-bridges.md`.

---

# D. Workflow

Follow in order. Step 2 (build on the library) and step 6 (publish gate) are the ones most
often skipped — and skipping them is what produces a messy registry and a measure that
"passes" but is wrong.

1. **Classify** — is it a *reduction* or a *removal*? Does it deliver a comparable product
   (compared on a service unit) or not? This decides what the measure needs.
2. **Build on the library** — resolve every value to a library entity *first*: reuse one that
   already fits, or create the missing one. Never inline a name.
3. **Compute the unit measure (bottom-up)** — write the formulas so every number is an input
   or computed from inputs (§3/§6), then read off the first CAPEX / OPEX / abatement and MAC.
   → `references/formula-ast.md`.
4. **Find and declare the limiting factor** — assess what bounds the measure (resource
   available, product output, max capacity, number of installations) and record it as a **library indicator**
   for the industry. Declare it on the measure as a **mandatory constraint**: it does *not*
   enter the bottom-up formulas and does *not* change the MAC. `validate_measure` checks the
   consumption you computed against it — if the measure would exceed the limit, lower the
   scale (an input) until it fits. The limit bounds the **volume**, nothing else.
   → `references/potential.md`.
5. **Validate** — run `validate_measure`; it advises, it never blocks. How to read its
   output: → `references/checks.md`.
6. **Publish gate** — make a measure part of the shared curve only when the numbers that
   matter rest on real sources. If a number that materially moves the MAC or the volume is
   still a guess/placeholder, keep it a **draft** and note what is missing.

---

## Conventions · field shapes

- Units, signs, time, the MAC definition: `references/conventions.md`.
- The measure-document shape and library entity shapes are **L1** — read them from
  `schema://measure` and a live example via `get_measure('kz-2')`. This skill does not
  restate them.

## Learn from the library and existing measures

Before authoring, browse what already exists over MCP — `list_library` for the registry
(technologies, products, resources, indicators…) and `list_measures` / `get_measure` for the
existing measures. Reuse their entities and patterns instead of inventing.
