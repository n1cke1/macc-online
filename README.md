# MACC KZ — открытая интерактивная кривая затрат на декарбонизацию

> **🇷🇺 Русский** · [🇬🇧 English below](#macc-kz--open-interactive-marginal-abatement-cost-curve)

Открытый веб-инструмент, который превращает Excel-модель MACC (Marginal Abatement Cost Curve)
для Казахстана в **интерактивную кривую**: меняйте глобальные допущения (цена угля, газа,
электроэнергии, WACC) — и кривая **пересчитывается в браузере** в реальном времени.

> ⚠️ **Это сценарный конструктор, а не прогноз.** Каждый вид привязан к датированной,
> «отпечатанной» версии модели. Цифры показывают, *что было бы при заданных допущениях* —
> не предсказание будущего.

**Текущая версия модели:** `kz-53ba0d602773` · источник `MACC_KZ_2026-05-29.xlsx`
Сводно: суммарное сокращение ≈ **214 353 кт CO₂-экв/год**, средневзвешенный MAC ≈ **95.6 USD/т**.

## Что умеет

- 📊 **Современная MACC-кривая** (26 проектов по 5 секторам IPCC), сортировка по MAC.
- 🎚️ **Живой пересчёт**: ползунки цен угля/газа/электроэнергии и WACC — бары пересортируются
  при отпускании ползунка.
- 🔍 **Drill-down** по каждому проекту: CAPEX/OPEX, NPV, физические индикаторы масштаба,
  раздел «Допущения».
- 🔗 **Сценарии в URL** — поделитесь ссылкой, и собеседник увидит ровно ваш набор допущений.
- 📤 **Экспорт**: сценарий → JSON, кривая → SVG/CSV, меры → CSV.
- 🌐 **Двуязычность** RU (основной) / EN.
- 💬 **Опциональный слой совместной работы** (вход через LinkedIn / Google / e-mail,
  комментарии-«якоря» к кривой / проекту / сценарию / конкретному допущению) — *выключается
  одним флагом*, ядро работает и без него.

## Почему «открытая» — это архитектура, а не лозунг

1. **Статичное ядро без бэкенда.** Кривая, пересчёт, drill-down, URL-сценарии и экспорт
   работают как чистый статический бандл. Если сервер совместной работы выключен — инструмент
   полностью функционален (скрыты только комментарии). Ядро **никогда** не импортирует
   Supabase-клиент.
2. **Опубликованный «якорь доверия».** Кривую можно проверить третьей стороной — мы публикуем
   исходные данные, ETL и golden-тест (см. ниже).
3. **Честная рамка.** Сценарный конструктор, а не прогноз; каждый вид привязан к версии модели.

## Проверка кривой (trust anchor)

Кривая — не «чёрный ящик». Опубликованы:

- [`MACC_KZ_29052026_rev.xlsx`](MACC_KZ_29052026_rev.xlsx) — исходная Excel-модель;
- [`scripts/etl.py`](scripts/etl.py) — ETL: `xlsx → data/kz/{workbook.engine.json, model.data.json, fingerprint.json}`;
- [`data/kz/*.json`](data/kz/) — опубликованный датасет;
- [`scripts/golden.ts`](scripts/golden.ts) — golden-тест: пересчёт через HyperFormula
  сверяется с кэшированными значениями Excel.

```bash
# воспроизвести датасет из Excel (нужен Python 3 + openpyxl 3.1.5)
py scripts/etl.py            # перегенерировать data/kz/*.json
py scripts/etl.py --check    # сверить с кэшем Excel, ничего не записывая

# проверить, что движок пересчёта точно повторяет Excel
npm run golden               # → PASS, 188/188 проверок
```

Формулы модели предельно простые — только `IF`, `PV`, `SUM` (+ `^` и арифметика):
`I = E − PV(C2, G, F)` · `J = −PV(C2, G, H)` · `K = IF(J=0, 0, I/J·1000)`.

## Стек

- **Расчёт (гибрид):** v1 — формулы Excel исполняются **в браузере** через
  [HyperFormula](https://hyperformula.handsontable.com/) (точная совместимость; GPLv3).
- **Фронтенд:** Next.js 15 (App Router, **static export**) + React 18.3 + TypeScript +
  Tailwind + [Visx](https://airbnb.io/visx/) (график) + [Zustand](https://github.com/pmndrs/zustand)
  (состояние) + [next-intl](https://next-intl-docs.vercel.app/) (`/[locale]`, ru/en).
- **Совместная работа (опционально):** [Supabase](https://supabase.com/) (Postgres + Auth + RLS),
  OSS и self-hostable.
- **Хостинг:** Cloudflare Pages (статическое ядро). Работает на бесплатных тарифах за **$0/мес**.

## Запуск локально

```bash
npm install
npm run dev        # http://localhost:3000  → редирект на /ru/
npm run build      # статический сайт в out/
```

Слой совместной работы по умолчанию выключен. Чтобы включить — скопируйте `.env.example`
в `.env.local` и заполните `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(оба значения публичные, защищены RLS). См. [`supabase/README.md`](supabase/README.md).

## Деплой

Статическое ядро разворачивается на Cloudflare Pages (build: `npm run build`, output: `out`).
Пошагово — [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Лицензия

[GNU GPL v3](LICENSE). Инструмент поставляет HyperFormula (GPLv3) в клиентском бандле, поэтому
производная работа также распространяется под GPLv3 — что соответствует принципу открытости проекта.

---

# MACC KZ — Open interactive Marginal Abatement Cost Curve

> [🇷🇺 Русский выше](#macc-kz--открытая-интерактивная-кривая-затрат-на-декарбонизацию) · **🇬🇧 English**

An open web tool that turns an Excel MACC (Marginal Abatement Cost Curve) model for Kazakhstan
into an **interactive curve**: change global assumptions (coal / gas / electricity price, WACC)
and the curve **recalculates in the browser** in real time.

> ⚠️ **This is a scenario explorer, not a forecast.** Every view is tied to a dated, fingerprinted
> model version. The numbers show *what it would look like under the given assumptions* — not a
> prediction of the future.

**Current model version:** `kz-53ba0d602773` · source `MACC_KZ_2026-05-29.xlsx`
Totals: total abatement ≈ **214,353 kt CO₂eq/yr**, weighted-avg MAC ≈ **95.6 USD/t**.

## Features

- 📊 **Modern MACC chart** (26 projects across 5 IPCC sectors), sorted by MAC.
- 🎚️ **Live recalc**: coal/gas/electricity price + WACC sliders; bars re-sort on slider release.
- 🔍 **Per-project drill-down**: CAPEX/OPEX, NPV, physical-scale indicators, an "Assumptions" section.
- 🔗 **URL-encoded scenarios** — share a link and the other person sees exactly your assumption set.
- 📤 **Exports**: scenario → JSON, curve → SVG/CSV, measures → CSV.
- 🌐 **Bilingual** RU (primary) / EN.
- 💬 **Optional collaboration layer** (LinkedIn / Google / e-mail sign-in; anchored review comments
  on the curve / project / scenario / a specific assumption) — feature-flagged off; the core works
  without it.

## Openness as architecture

1. **Static core, zero backend.** Chart, recalc, drill-down, URL scenarios and exports run as a pure
   static bundle. If the collaboration backend is absent, the tool still fully works (comments just
   hidden). The core **never** imports the Supabase client.
2. **Published trust anchor.** The curve is third-party verifiable — we ship the source data, the ETL
   and the golden test (below).
3. **Honest framing.** A scenario explorer, not a forecast; every view tied to a model version.

## Verifying the curve (trust anchor)

The curve is not a black box. Published:

- [`MACC_KZ_29052026_rev.xlsx`](MACC_KZ_29052026_rev.xlsx) — the source Excel model;
- [`scripts/etl.py`](scripts/etl.py) — ETL producing `data/kz/*.json` + a fingerprint;
- [`data/kz/*.json`](data/kz/) — the published dataset;
- [`scripts/golden.ts`](scripts/golden.ts) — golden test: HyperFormula recalc vs Excel's cached values.

```bash
py scripts/etl.py --check    # verify against Excel's cached values, no writes
npm run golden               # → PASS, 188/188 checks
```

The model uses only `IF`, `PV`, `SUM` (+ `^` and arithmetic):
`I = E − PV(C2, G, F)` · `J = −PV(C2, G, H)` · `K = IF(J=0, 0, I/J·1000)`.

## Stack

- **Calc (hybrid):** v1 runs the Excel formulas **client-side** via [HyperFormula](https://hyperformula.handsontable.com/) (exact fidelity; GPLv3).
- **Frontend:** Next.js 15 (App Router, static export) + React 18.3 + TypeScript + Tailwind +
  [Visx](https://airbnb.io/visx/) + [Zustand](https://github.com/pmndrs/zustand) +
  [next-intl](https://next-intl-docs.vercel.app/) (`/[locale]`, ru/en).
- **Collaboration (optional):** [Supabase](https://supabase.com/) (Postgres + Auth + RLS), OSS / self-hostable.
- **Hosting:** Cloudflare Pages for the static core. Runs at **$0/month** on free tiers.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000  → redirects to /ru/
npm run build      # static site in out/
```

The collaboration layer is off by default. To enable it, copy `.env.example` to `.env.local`
and fill in `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both public, RLS-guarded).
See [`supabase/README.md`](supabase/README.md).

## Deploy

The static core deploys to Cloudflare Pages (build: `npm run build`, output: `out`).
Step by step in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## License

[GNU GPL v3](LICENSE). The tool ships HyperFormula (GPLv3) in the client bundle, so the combined
work is distributed under GPLv3 too — consistent with the project's openness principle.
