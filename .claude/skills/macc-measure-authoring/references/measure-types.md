# Measure types — the classification and its authoritative basis

> Grounding for the **Mechanism & baseline** section of `SKILL.md`. This file is the *why*
> behind the two classification axes — the authoritative sources, the MACC mapping, and the
> Kazakhstan picture. It is conceptual: it survives schema/field renames. Synthesized from a
> verified literature pass (IPCC AR6 WGIII, World Bank MACC methodology, GHG Protocol,
> UNFCCC CDM, peer-reviewed CDR work); see **Sources** and **Caveats** at the end.

A measure is classified on **two independent axes**, with **sector** as a separate third
dimension that already exists in the data model. Keep all three orthogonal — do not fold one
into another.

---

## Axis 1 — Mechanism: `reduction` vs `removal`

The cleanest, best-grounded top-level split. IPCC AR6 WGIII treats emission **reductions**
and **carbon dioxide removal (CDR)** as separate, complementary, **non-substitutable**
categories: net change = emissions reduced *plus* sinks enhanced, and CDR "cannot serve as a
substitute for deep emissions reductions" — it counterbalances hard-to-abate residual
emissions. [IPCC AR6 WGIII SPM / TS / Ch.12 / CDR Factsheet]

- **`reduction`** — cuts or avoids GHG **at source**, against a baseline that still emits.
- **`removal`** (CDR) — a deliberate human activity that **removes CO₂ from the atmosphere
  AND stores it durably**. Natural forest growth with no human intervention does not count.

### The boundary that matters most: fossil capture is *reduction*, not removal

IPCC AR6 WGIII Ch.12, verbatim: *"CCS and CCU applied to fossil CO₂ do not count as removal
technologies. CCS and CCU can only be part of CDR methods if the CO₂ is biogenic or directly
captured from ambient air, and stored durably."*

- CCS/CCU on a **coal plant or gas-processing flue** → **`reduction`** (baseline = the same
  plant without capture; it only prevents fossil emissions).
- Only **BECCS** (biogenic) and **DACCS** (ambient air), plus other genuine CDR, → `removal`.

This corrected the original working hypothesis, which loosely put all engineered capture
under removal. It is materially important for Kazakhstan (CCS on coal/gas is a real measure
type, and it is reduction).

### Subtypes (use as soft, optional tags — not a strict enum)

IPCC does **not** publish a single mutually-exclusive "mechanism enum"; these are recurring
cross-sector levers named in AR6 TS, packaged for practicality. Tag when useful; don't force.

- **reduction** subtypes: `efficiency` · `fuel/feedstock switch` · `electrification` ·
  `process change` · `demand reduction` · `non-CO₂` (CH₄/N₂O abatement).
- **removal** subtypes: **nature-based** (afforestation/reforestation, improved forest
  management, soil carbon, wetland/peatland restoration, biochar) vs **engineered** (BECCS,
  DACCS, enhanced weathering). Ocean methods exist but are irrelevant for landlocked
  Kazakhstan. *(Note: IPCC technically classifies BECCS as land-based biological CDR — only
  the CCS step is engineered; the nature/engineered split is a usability simplification.)*

### Permanence — an attribute of removals, not a class

Storage durability is a material, orthogonal property. A peer-reviewed result finds storage
shorter than ~1000 years is insufficient to neutralize residual fossil CO₂ under net zero;
IPCC's own CDR taxonomy carries storage-timescale as a second axis. Treat permanence as a
**flag** (short-lived nature-based vs durable geological), **not** a hard class boundary —
the exact threshold is an active research question. [Nature Comms Earth & Environment 2024;
IPCC AR6 WGIII Ch.12]

---

## Axis 2 — Baseline basis: `comparison` vs `standalone`

The **modeling-decisive** axis — it tells the author HOW to compute abatement and WHAT to
set as the baseline. Grounded in the World Bank MACC methodology (two baseline
constructions) and the GHG Protocol avoided-emissions framing.

- **`comparison`** — the measure delivers the **same product/service a different way**.
  Abatement = (baseline-technology emissions − measure emissions) × activity, measured per
  the product's **service unit** (MWh, t steel, tonne-km). The baseline is the **displaced
  technology**. Use for power, industry, transport, fuel switching.
- **`standalone`** — **no displaced product**. Abatement = tonnes **removed or avoided** vs
  an activity-scenario baseline. Use for all removals, agricultural practices, methane
  leak/flaring reduction, and waste capture.

> Renamed from the hypothesis's "substitution" to **`standalone`** — clearer, and tied to the
> World Bank "technology-specific vs sector-wide baseline" distinction. The schema carries this
> as the `baseline_basis` axis (`comparison` | `standalone`), parallel to `mechanism`.

Both cost and abatement are **always computed marginally to the baseline**, so the baseline
must be defined and documented **before** modeling. [World Bank MACC note; GHG Protocol]

---

## Sector — the third, independent dimension (already in the model)

Sector is the IPCC inventory category (2006/2019 Guidelines): **Energy, IPPU, Agriculture,
AFOLU/LULUCF, Waste**. AR6 organizes mitigation assessment by sector and presents
cost-vs-potential bars — confirming sector and mechanism are orthogonal. The macc-online
workbook already carries sector (col A). **Keep sector as the existing field; add the two new
axes — do not overload sector with mechanism.** [IPCC 2006 Guidelines; IPCC AR6 WGIII SPM Fig
SPM.7]

---

## How each class maps to MACC modeling

MACC mechanics (World Bank, verbatim): bar **height** = unit cost per tonne CO₂e in
**present-value** terms, **net of benefits, marginal over the replaced technology's cost**;
bar **width** = the GHG reduction potential. This matches the macc-online engine exactly
(MAC = NPV / discounted-abatement × 1000; width = annual abatement).

| class | baseline | what is displaced | how abatement is measured |
|---|---|---|---|
| reduction · comparison | the displaced technology | the conventional product/service | (baseline EF − measure EF) × activity, per service unit |
| reduction · standalone | an activity scenario | nothing (source improvement) | tonnes avoided vs the scenario (e.g. captured/destroyed CH₄ × GWP) |
| removal · standalone | an activity scenario | nothing | tonnes CO₂ removed and durably stored |

Every removal is `standalone`. `reduction` can be either `comparison` or `standalone`.

---

## Kazakhstan relevance

The portfolio skews **heavily to `reduction` / `comparison`**, because emissions are
dominated by coal power, oil & gas, and metals/IPPU. Removal is a minor branch.

- **Coal power** → efficiency / coal→gas / RES — reduction, comparison (per MWh).
- **Oil & gas (methane)** → leak/flaring reduction — reduction, standalone, `non-CO₂` subtype.
- **Metals / mining / IPPU** → process change — reduction, mostly comparison.
- **Agriculture** → soil/livestock/nutrient practices — reduction or removal, standalone.
- **LULUCF** → afforestation/restoration — removal, standalone (nature-based).
- **Waste** → landfill-gas / methane capture — reduction, standalone.

The existing 26-measure workbook is almost entirely reduction/comparison; agriculture and any
land measures are the standalone exceptions. *(This per-sector mapping is inferred from
project context, not independently sourced per measure — treat as orientation.)*
[KZ Carbon Neutrality Strategy 2024; KZ BR4]

---

## Sources

Primary (verified, high-confidence):
- IPCC AR6 WGIII SPM — https://www.ipcc.ch/report/ar6/wg3/chapter/summary-for-policymakers/
- IPCC AR6 WGIII Technical Summary — https://www.ipcc.ch/report/ar6/wg3/chapter/technical-summary/
- IPCC AR6 WGIII Ch.12 (CDR / cross-sectoral) — https://www.ipcc.ch/report/ar6/wg3/chapter/chapter-12/
- IPCC AR6 WGIII CDR Factsheet — https://www.ipcc.ch/report/ar6/wg3/downloads/outreach/IPCC_AR6_WGIII_Factsheet_CDR.pdf
- IPCC AR6 WGIII Ch.7 (AFOLU) — https://www.ipcc.ch/report/ar6/wg3/downloads/report/IPCC_AR6_WGIII_Chapter_07.pdf
- World Bank, MACC Analysis dissemination note — https://documents1.worldbank.org/curated/en/859881468197634735/pdf/103914-WP-P145943-PUBLIC-Dissemination-Note-Marginal-Abatement-Cost-Curve-Analysis.pdf
- GHG Protocol, estimating & reporting avoided emissions — https://ghgprotocol.org/estimating-and-reporting-avoided-emissions
- Nature Comms Earth & Environment (2024), CDR permanence — https://www.nature.com/articles/s43247-024-01808-7
- UNFCCC CDM project scopes — https://cdm.unfccc.int/DOE/scopelst.pdf
- KZ Carbon Neutrality Strategy 2024 — https://unfccc.int/sites/default/files/resource/Carbon_Neutrlaity_Strategy_Kazakhstan_Eng_Oct2024.pdf
- KZ Fourth Biennial Report (BR4) — https://unfccc.int/sites/default/files/resource/Report_BR4_Updated.pdf

---

## Caveats

1. The **two-axis enum is a synthesis for tooling**, not a verbatim IPCC taxonomy. Axis 1
   (reduction vs removal) is firmly IPCC-grounded; Axis 2 (baseline basis) is firmly
   World Bank/GHG Protocol-grounded. IPCC does **not** publish the reduction-subtype enum —
   keep those as soft tags.
2. The grounding for reduction-vs-removal is the **SPM / TS / Ch.12 / CDR Factsheet**.
3. **BECCS** is technically land-based biological CDR (only the CCS step is engineered); the
   clean nature/engineered split is a usability simplification.
4. The **~1000-year permanence** figure is from a single 2024 Nature paper and is an active
   research question — a flag, not a hard boundary.
5. The **Kazakhstan per-sector mapping** is inferred from project context, not independently
   sourced per measure.
