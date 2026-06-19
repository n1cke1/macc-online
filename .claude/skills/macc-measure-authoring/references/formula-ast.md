# Formula AST — the closed expression language

> Mechanically extracted (verbatim) from the `formulas` block of
> `data/kz/library/measure-notation.json` during the notation/skill split (step 1).
> Reference spec, not judgment — an author needs this in full to write a `computed` node.

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
from a table (reserved, unused in the prototype). Predicates: `lte(a,b)`/`gte(a,b)` binary;
`between(x,min,max)` ternary.

## Leaves

Tree leaves: `{ref:<key>}`, `{slot:<name>}`, `{const:<number>}`, or a bare number literal.
A `{slot}` is a template slot bound per-measure via bindings before evaluation.

## Namespace

How a `{ref:<key>}` resolves: `res:<id>` → that resource's emission factor (EF); a key that
has its own `computed` entry on the measure → that formula, evaluated recursively
(drill-down to primary sources); otherwise a local measure input (`measure.inputs[key]`).
Literals are `{const:<n>}` or a bare number — both allowed. No other namespaces.

## Example

Example (coal→gas conversion): `mul(ref:cap_mw, ref:kium, 8760, sub(ref:res:coal,
ref:res:gas), 1e-3)` = installed capacity × capacity factor × hours/yr × (EF coal − EF gas)
× 10⁻³. EF leaves use the `res:` namespace; `8760` and `1e-3` are literals.
