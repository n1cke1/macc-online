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

To go finer, **decompose a coarse EF**: replace `res:R#ef` (tCO₂/MWh) with `res:R#lhv` (energy
per mass) and a fuel EF — `mass × LHV = energy`, `energy × EF = CO₂`. The finer the chain, the
less room for a carrier slip: dropping to fuel-level indicators, you physically cannot put an
electric output-EF onto a thermal chain.
