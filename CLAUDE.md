# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repo.

## What this is

An **open, interactive, online MACC** (Marginal Abatement Cost Curve) tool for **Kazakhstan**, built
from an existing Excel model (`MACC_KZ_29052026_rev.xlsx`). Anonymous users view a modern MACC chart,
drill into projects, and **live-recalculate** by changing global assumptions (coal/gas/electricity price,
WACC). Signed-in experts (LinkedIn / Google / email) leave **anchored review comments**. Bilingual
**RU (primary) + EN**.

**Status:** Concept/architecture plan **approved 2026-06-13**; implementation **just starting** (the ETL is
the first deliverable). The full approved plan is the source of truth for scope & design:
`~/.claude/plans/macc-twinkly-dove.md` (i.e. `C:\Users\NP\.claude\plans\macc-twinkly-dove.md`).

## Core principles (do not violate)

1. **Openness as architecture.** A **static core with zero backend dependency** (chart + recalc +
   drill-down + URL scenarios + exports) + an **optional, self-hostable collaboration layer**. If the
   backend is down/absent, the tool still fully works (comments just hidden). **The static core must never
   import the Supabase client** — collaboration is lazy-loaded and feature-flagged via env.
2. **Publish the trust anchor.** The curve is now baked from the **measure-notation graph**
   (`data/kz/library/{graph,measures}.seed.json`, mirrored in Supabase) via `scripts/bake-from-supabase.ts`,
   and every measure is pinned bit-for-bit against the original Excel by `measure-golden`. Ship the seed
   JSON, the bake script, `data/kz/*.json`, and both golden tests publicly so the curve is third-party
   verifiable, not a black box. The Excel workbook + `scripts/etl.py` stay as the **provenance artifact**
   the seed was derived from (not in the build path; `npm run etl` regenerates the Excel-sourced JSON for cross-checking).
3. **Honest framing.** It's a **scenario explorer, not a forecast** (prominent banner); every view is tied
   to a **dated, fingerprinted model version**.

See `~/.claude/plans/macc-twinkly-dove.md` for the detailed rationale; design philosophy is also mirrored
in Claude's project memory (`MEMORY.md`).

## Architecture & stack

- **Calc (hybrid):** v1 = the Excel formulas run **client-side** via **HyperFormula** (exact fidelity,
  GPLv3 — fine, we're open); v2 = port to native typed TS, validated against v1's golden snapshot.
- **Frontend:** Vite + React + TS (or Next.js *static export*) — must build to a **static bundle** (no
  server runtime). **Visx** for the chart, **Zustand** for state, URL-encoded scenarios, **i18n** RU/EN.
- **Collaboration (optional):** **Supabase** (Postgres + Auth + RLS) — LinkedIn + Google + email magic-link;
  comments anchored to curve / project / scenario / **assumption**; thread status open/accepted/rejected/wontfix;
  **email** notifications (not Realtime). Supabase is OSS/self-hostable.
- **Hosting:** **Cloudflare Pages** for the static core (free, unlimited bandwidth); GitHub Pages for the
  published artifacts. Runs at **$0/month** on free tiers; only optional cost is a custom domain (~$12/yr).

## The data model (the crux) — `MACC_KZ_29052026_rev.xlsx`, 3 sheets

- **MACC** — curve table `A5:K32`: header row 5, **26 projects rows 6–31**, totals row 32. Columns:
  A sector(IPCC) · B id(1–26) · C variant · D name(RU) · E CAPEX(mUSD) · F OPEX(mUSD/yr, signed) ·
  G duration(yr) · H abatement(kt CO₂eq/yr) · I NPV · J discounted CO₂(kt) · K **MAC**(USD/tCO₂).
  Global-assumptions block rows 36–57; discount rate `C2`=0.12.
- **Выбросы** (Emissions) — UNFCCC BTR1 baseline GHG by sector (~353 Mt CO₂eq), static constants.
- **Расчёты** (Calculations) — ~800 rows, 26 per-project blocks; reference globals (`=MACC!$E$..`) and
  emissions (`=Выбросы!C..`), output to MACC E/F/G/H.

Formulas: `I = E − PV($C$2,G,F)` · `J = −PV($C$2,G,H)` · `K = IF(J=0,0, I/J*1000)`.
**The whole workbook uses only `IF`, `PV`, `SUM`** (+ `^` and arithmetic) — no macros/named-ranges/array/lookup.

**Live levers (verified cells & baselines):** coal `MACC!E36`=15 $/t · gas `E37`=250 $/1000 m³ ·
electricity `E38`=50 $/MWh · WACC `C2`=0.12. No carbon price (not in the model).

**ETL gotchas:** (1) I/J/K rows 7–31 are **shared formulas with empty `<f>` nodes** — re-materialize from
the row-6 masters and cross-check vs the cached `<v>`. (2) Abatement (bar width) is always positive; only
MAC (height) can be negative. (3) Rows are NOT pre-sorted — the curve sorts ascending by K.
Sanity totals: total abatement ≈ 214,353 kt, weighted-avg MAC ≈ 95.6 USD/t (since the
2026-06-13 fix linking agriculture measures 3-2/3-3/3-4 to their sub-category baselines).

## Planned layout (greenfield — most of this is not created yet)

```
scripts/etl.py                 # xlsx → data/<country>/{workbook.engine.json, model.data.json} + fingerprint
data/kz/*.json                 # first dataset; PUBLISHED for verification. Country-agnostic: data/<country>/
src/lib/calc/                  # ONLY module importing HyperFormula: types, recalc(), modelVersion, golden test
src/lib/export/                # scenario→JSON, curve→SVG/CSV, measures→CSV
src/components/{macc,assumptions,drilldown,collab}/
src/lib/supabase/              # imported ONLY by the collaboration layer
supabase/{migrations,functions}/
```

## Commands

- **Toolchain present:** Node 18 + npm; Python 3.13 with **openpyxl 3.1.5** (for the ETL artifact).
- **Bake (curve source of truth):** `npm run bake` → `scripts/bake-from-supabase.ts` loads the measure
  graph from Supabase, runs every measure through the shared TS calc core (`compute()`), and writes
  `data/kz/model.data.json` (27 bars: 24 published + drafts kz-2/kz-16/kz-27 — the whole canonical set).
  `npm run bake -- --check` reports the curve diff vs the committed snapshot without writing. Needs
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (drafts are anon-invisible per RLS); with no creds it
  **skips** and keeps the committed snapshot, so builds never depend on backend reachability. `npm run build`
  runs this automatically via the `prebuild` hook ⇒ an MCP/editor measure edit shows on the curve after a rebuild.
- **ETL (provenance artifact, NOT in the build path):** `py scripts/etl.py` → regenerates the
  Excel-sourced `data/kz/{workbook.engine.json, model.data.json, fingerprint.json}` for cross-checking
  the bake against the original workbook; `--check` verifies vs the Excel cached values without writing.
  EN labels live in the editable overlay `scripts/translations.en.json`.
- **App:** Next.js 15 (App Router, **static export** `output: 'export'`) + Tailwind + next-intl `/[locale]`
  (ru/en) + Visx + Zustand. `npm install`; dev `npm run dev`; build `npm run build` → bakes the curve then
  emits the static site in `out/` (deployable to Cloudflare Pages / GitHub Pages / any static host).
  `public/_redirects` sends `/` → `/ru/`. React is pinned to **18.3.1** (Visx peer deps don't yet allow React 19).

## Conventions

- Keep the **core ↔ collaboration boundary** clean (core never touches Supabase).
- **Validate every calc change against the golden test** (HyperFormula output vs the Excel's cached values).
- Bilingual: **domain text (project/sector names, assumption labels) lives in `model.data.json` as `{ru,en}`**;
  UI strings in i18n catalogs; missing `en` falls back to `ru`.
- UX: bars **re-sort on slider release** (not mid-drag); **mobile = measures list first**; include a
  "how to read a MACC" onboarding.
