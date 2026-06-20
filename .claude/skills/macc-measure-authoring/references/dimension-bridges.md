# Dimension bridges — build the abatement formula by units

**Principle.** Units are TYPES; bridges are typed combinators. Grow the abatement formula by
chaining bridges — at each step pick the bridge whose `from` matches the unit you already hold
— until the chain reduces to **CO₂ per year**. A formula built this way is correct by
construction: `validate_measure` folds it over the dimension vocabulary, and the reduction
stays `draft` if it does not reduce to CO₂ or if it crosses resource carriers.

## The dimensional gate

`validate_measure` folds your `abatement` formula bottom-up over the unit vocabulary:

- every leaf gets a dimension — from its `unit` (an input), from the resource (`res:R#ef` → an
  emission factor), or scalar (a literal / unit-conversion constant like `8760` or `1e-3`);
- `mul`/`div` multiply/divide dimensions; `add`/`sub`/`sum` require the operands to agree;
- the whole formula MUST reduce to `mass_co2·time⁻¹` (CO₂/year) — or `mass_co2` when the year
  is already integrated inside.

A missing/unknown unit, an `add`/`sub` of incompatible dimensions, or a result that is not a
CO₂ quantity is a **hard gate**: the reduction panel goes incomplete and the measure stays
`draft`. So give every input a `unit` drawn from the library vocabulary.

## Bridges (the atomic conversions)

| bridge | from | × via | → to |
|--------|------|-------|------|
| `power_to_energy` | power (МВт) | hours/yr × КИУМ | energy of resource R |
| `fuel_to_energy`  | mass of fuel R (т) | `res:R#lhv` (LHV) | energy of resource R |
| `energy_to_co2`   | energy of R | `res:R#ef` (EF) | CO₂ |

Composite — **fuel switch**: energy of the displaced fuel × (`res:R_old#ef` − `res:R_new#ef`) =
avoided CO₂; two chains, each of its own resource. Full registry (the trust anchor):
`data/kz/library/bridges.json`.

## Carrier — take the indicator of the RIGHT resource

Units do not distinguish resources: coal EF and gas EF are both `tCO₂/MWh`. The dimensional
fold accepts "some EF" — only YOU guarantee it is the EF of the resource the energy belongs to.

- Multiply an energy of resource R by `res:R#ef` — the **same** R. Putting a different
  resource's EF on that energy (an electricity EF on a coal/heat chain) is the kz-27 class of
  error; the carrier lock flags it as a *carrier mismatch* and the measure stays `draft`. A
  fuel switch is exempt — it *subtracts* two resources' EFs (`EF_old − EF_new`), it does not
  multiply across them.
- A coarse **output-EF** — a product's `carbon_footprint`, stated per the product's service
  unit — must be the EF of THIS measure's product. An EF per MWh-electricity cannot price a
  measure whose product is Гкал-heat (service-unit mismatch → `draft`).

## How to write the reduction

> Снижение — цепочка мостов от того, что у тебя есть (показатели/входы с их единицами) до
> CO₂/год. На каждом шаге ищи мост по единице того, что держишь («есть т топлива → нужна
> энергия» → `fuel_to_energy`). Тяни, пока не дойдёшь до CO₂/время. Бери показатели НУЖНОГО
> ресурса (`res:R#…`) — единицы проверят структуру, но «тот ли это ресурс» отвечаешь ты.
> Топливный свитч = CO₂(замещаемого) − CO₂(нового), две цепочки своих ресурсов.

## Prefer computing from the fuel

When a measure burns or displaces a fuel, **compute the abatement from the fuel, not from a
coarse output-EF.** Start at the fuel quantity and chain up:

> `mass of fuel × res:R#lhv → energy of R`, then `energy of R × res:R#ef → CO₂`.

Why the fuel chain is better than `output × (tCO₂/MWh output-EF)`:

- **Auditable** — every tonne of CO₂ traces to a physical quantity of a named fuel and that
  fuel's own LHV/EF, not to a lumped "per-MWh-of-product" number whose assumptions are hidden.
- **Carrier-safe** — the fuel chain carries the resource explicitly, so the carrier lock
  guarantees the EF belongs to the fuel you actually burn. A coarse output-EF carries only a
  product; mis-attributing it (an electricity output-EF on a heat chain) is the kz-27 error.
- **Less slip** — the finer the decomposition, the less room to put the wrong number in. If you
  only have a coarse `res:R#ef` (tCO₂/MWh), **decompose it** into `res:R#lhv` (energy per mass)
  + a fuel EF and compute from the fuel mass.

Use a coarse output-EF (`prd:P#carbon_footprint`) only when there is genuinely no fuel to
attribute to (a grid-average displacement), and then its product MUST be this measure's product.
