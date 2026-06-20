# Conventions — units, signs, time, MAC

**Principle.** Shared conventions for units, signs, time and the MAC definition. The
numbers themselves live elsewhere — here are the rules for reading them. All unit
conversions are explicit (like `capexUdFactor`); no implicit multipliers.

## Units

Canonical units: reduction — kt CO₂e/yr; MAC — USD/t CO₂e; CAPEX — m USD; OPEX —
m USD/yr (signed); material price — USD per resource unit; emission factor — t CO₂e per
resource unit; unit CAPEX — in the library's own unit ($/kW, $/head…). A field in another
unit is converted by an explicit factor (e.g. `capexUdFactor`).

## Signs

One sign rule: cost +, avoided cost / saving / revenue −. By panel: build — CAPEX/OPEX +;
project (closed) — maintenance CAPEX and OPEX −. By flow: `materialSide` new +, retired −.
Emissions reduction is always positive.

## Time

Lifetime and the discount rate are model parameters, not measure fields: the discount
rate is a global (`library.globals.discountRate`); lifetime comes from the object's
`technology.lifetimeYrs` (or measure `inputs.lifetime`). CAPEX is incurred in year 0;
OPEX and reduction are annual streams over the lifetime; `pv` discounts a stream to year 0
at the rate.

## MAC

MAC (USD/t CO₂e) = NPV / discounted-reduction × 1000, where NPV = CAPEX −
PV(rate, lifetime, OPEX) and discounted-reduction = −PV(rate, lifetime, annual reduction),
in kt (×1000 converts kt→t). Evaluated by the same HyperFormula PV as the Excel model, so
the result is parity-exact.

## Footprint unit

`carbonFootprint` — t CO₂e per unit of the `produce` product (the same unit as the service
unit for comparison). Keep consistent with the `produce` unit.

## Language

The notation is English-base (single language); a separate translations layer adds other
locales later. Free-text measure fields (name, citation, divergence_reason) may be in any
language. Numeric format: dot as the decimal separator; dates ISO 8601 (YYYY-MM-DD).
