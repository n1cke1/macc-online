# Formula AST — the closed expression language

**Principle.** A formula is data, not code: stored as an AST over named keys (`ref`), not
cell references. Keys survive row insertion; the AST compiles to HyperFormula, so Excel
parity is bit-for-bit.

## Operators

Allowed arithmetic operators: `add`, `sub`, `mul`, `div`, `sum`, `pv` (present value),
`lookup`. The set is closed for auditability — no other functions.

## Predicates

Predicate operators for the checks (return true/false): `lte` (≤), `gte` (≥), `between`
(in corridor). Used by the factor/economics/pool/sector checks.

## Signatures

Operator arity: `add`/`sub`/`mul`/`div` are variadic (≥2 args, folded left-to-right;
`sub`/`div` as a running difference/quotient); `sum(…)` sums its args; `pv(rate, nper,
payment)` is the Excel present value of a constant stream; `lookup(table, key)` selects
from a table (reserved). Predicates: `lte(a,b)`/`gte(a,b)` binary;
`between(x,min,max)` ternary.

## Leaves

Tree leaves: `{ref:<key>}`, `{slot:<name>}`, `{const:<number>}`, or a bare number literal.
A `{slot}` is a template slot bound per-measure via bindings before evaluation.

## Namespace

How a `{ref:<key>}` resolves. All prefixed forms hit the registry directly — editing the
indicator there propagates to every measure that names it:

| Prefix             | Resolves to                                                                  |
|--------------------|------------------------------------------------------------------------------|
| `res:<id>`         | resource's EF (shortcut for `res:<id>#ef`; honors year-series EFs)            |
| `res:<id>#<key>`   | resource indicator (`price`, `lhv`, `comb_factor`, …) from `library.indicators` |
| `obj:<id>#<key>`   | object/technology indicator (`capex_ud`, `eff`, `maintenance_capex_ud`, …)    |
| `prd:<id>#<key>`   | product indicator (`carbon_footprint`, …)                                    |
| `sub:<id>#<key>`   | subsector indicator (`max_emissions`, `max_capacity`, …)                     |
| `glb:<key>`        | `library.globals[<key>]` (`discountRate`, `year`, …)                          |
| `in:<key>`         | measure input `measure.inputs[<key>].value` (explicit form)                  |
| bare `<key>`       | `measure.computed[<key>]` if present (recurses), else `measure.inputs[<key>]` |

Literals are `{const:<n>}` or a bare number — both allowed.

## Example

Example (coal→gas conversion): `mul(ref:cap_mw, ref:kium, 8760, sub(ref:res:coal,
ref:res:gas), 1e-3)` = installed capacity × capacity factor × hours/yr × (EF coal − EF gas)
× 10⁻³. EF leaves use the `res:` namespace; `8760` and `1e-3` are literals. A formula
that needs a non-EF resource indicator (say gas LHV) writes `ref:res:gas#lhv` — same
shape, different indicator key.
