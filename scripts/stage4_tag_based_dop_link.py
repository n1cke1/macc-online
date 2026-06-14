#!/usr/bin/env python3
"""
Stage 4: switch Расчёты↔Допущения linkage from direct row references to
tag-based INDEX/MATCH lookups — same robustness contract as Stage 2's
MACC↔Расчёты, geometry-free in both sheets.

Hybrid scheme (signed off):
  * 155 IN-L rows get a new column `ref` (col I) that holds the assumption
    key (e.g. `in_1_8`). Their col-C formula becomes
        =INDEX('Допущения'!$F:$F, MATCH(I{row}, 'Допущения'!$C:$C, 0))
  * 46 magic-coefficient occurrences in CALC rows (some cells reference 2
    coefficients) have the key inlined in the MATCH literal:
        =C16 * INDEX('Допущения'!$F:$F, MATCH("magic_1_R17_1", 'Допущения'!$C:$C, 0))

Numerically equivalent to Stage 3b: every replacement substring resolves to
the same Допущения!F value the previous direct ref did, so cached <v> stays
intact and etl --check + golden remain bit-for-bit identical.

Same XML-zip-surgery as the prior stages; no openpyxl save.
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
CALC_XML = "xl/worksheets/sheet3.xml"
DOP_XML = "xl/worksheets/sheet4.xml"
SHEET = "Допущения"

# New "ref" column letter on Расчёты — places the per-row assumption key
# right after `review_status` (col H, Stage 1).
REF_COL = "I"


def xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def read_dop_keys(dop_xml: str) -> dict[int, str]:
    """Map Допущения row -> key (col C inline string). Used both for IN-L
    column-I population and for inlining the key into magic-coefficient
    formulas."""
    keys = {}
    row_re = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.DOTALL)
    key_re = re.compile(
        r'<c r="C(\d+)" t="inlineStr"><is><t>([^<]+)</t></is></c>'
    )
    for rm in row_re.finditer(dop_xml):
        body = rm.group(2)
        for km in key_re.finditer(body):
            keys[int(km.group(1))] = km.group(2)
    return keys


def parse_calc_rows(xml: str):
    row_re = re.compile(r'(<row r="(\d+)"[^>]*>)(.*?)(</row>)', re.DOTALL)
    return list(row_re.finditer(xml))


def get_cell_attr(body: str, ref: str) -> tuple[str, str | None] | None:
    """Return (attrs, inner) for the named cell, or None if absent."""
    m = re.search(
        rf'<c r="{ref}"([^>]*)>(.*?)</c>',
        body,
        re.DOTALL,
    )
    if m:
        return m.group(1), m.group(2)
    m = re.search(rf'<c r="{ref}"([^>]*)/>', body)
    if m:
        return m.group(1), None
    return None


def is_inl_tag(body: str, row_n: int) -> bool:
    """True iff col D for this row is the inline string 'IN-L'."""
    c = get_cell_attr(body, f"D{row_n}")
    if c is None:
        return False
    _, inner = c
    return bool(inner and "<is><t>IN-L</t></is>" in inner)


def col_c_formula(body: str, row_n: int) -> str | None:
    """Return the formula inside col-C cell of `row_n`, or None if not a
    formula cell."""
    c = get_cell_attr(body, f"C{row_n}")
    if c is None:
        return None
    _, inner = c
    if inner is None:
        return None
    m = re.search(r"<f>([^<]+)</f>", inner)
    return m.group(1) if m else None


# Matches a direct Допущения ref: `'Допущения'!$F$123` (1+ digits).
DOP_REF_RE = re.compile(r"'Допущения'!\$F\$(\d+)")


def index_match_by_cell(ref_cell: str) -> str:
    """`=INDEX('Допущения'!$F:$F, MATCH(<ref_cell>, 'Допущения'!$C:$C, 0))`."""
    return (
        f"INDEX('{SHEET}'!$F:$F,MATCH({ref_cell},'{SHEET}'!$C:$C,0))"
    )


def index_match_by_key(key: str) -> str:
    """`INDEX('Допущения'!$F:$F, MATCH(\"<key>\", 'Допущения'!$C:$C, 0))`."""
    return (
        f"INDEX('{SHEET}'!$F:$F,MATCH(\"{key}\",'{SHEET}'!$C:$C,0))"
    )


def upsert_ref_cell(body: str, row_n: int, key: str) -> str:
    """Insert (or replace) `<c r="I{row}" t="inlineStr"><is><t>{key}</t></is></c>`
    into the row body, before </row> if no existing I cell, otherwise replace
    in place."""
    new = (
        f'<c r="{REF_COL}{row_n}" t="inlineStr">'
        f'<is><t>{xml_escape(key)}</t></is></c>'
    )
    existing = re.search(
        rf'<c r="{REF_COL}{row_n}"[^>]*>.*?</c>',
        body,
        re.DOTALL,
    )
    if existing:
        return body.replace(existing.group(0), new, 1)
    self_closed = re.search(rf'<c r="{REF_COL}{row_n}"[^>]*/>', body)
    if self_closed:
        return body.replace(self_closed.group(0), new, 1)
    return body + new


def patch_row_span(open_tag: str, new_spec: str) -> str:
    """Set spans="<new_spec>" on the row opening tag (insert if missing)."""
    if 'spans="' in open_tag:
        return re.sub(r'spans="[^"]*"', f'spans="{new_spec}"', open_tag, count=1)
    return open_tag.replace(">", f' spans="{new_spec}">', 1)


def patch_col_c_formula(body: str, row_n: int, new_formula: str) -> str:
    """Replace the <f>...</f> body of cell C{row_n}."""
    cell_re = re.compile(
        rf'(<c r="C{row_n}"[^>]*>)<f>([^<]+)</f>(<v>[^<]*</v>)?(</c>)',
        re.DOTALL,
    )
    m = cell_re.search(body)
    if not m:
        raise RuntimeError(f"C{row_n}: cell-with-formula not matched")
    new_cell = f'{m.group(1)}<f>{new_formula}</f>{m.group(3) or ""}{m.group(4)}'
    return body.replace(m.group(0), new_cell, 1)


def main() -> int:
    with zipfile.ZipFile(XLSX, "r") as zf:
        calc_xml = zf.read(CALC_XML).decode("utf-8")
        dop_xml = zf.read(DOP_XML).decode("utf-8")

    dop_keys = read_dop_keys(dop_xml)
    print(f"Допущения keys loaded: {len(dop_keys)}")

    matches = parse_calc_rows(calc_xml)

    inl_rewrites = 0
    magic_rewrites = 0
    out_parts = []
    cursor = 0
    for m in matches:
        out_parts.append(calc_xml[cursor:m.start()])
        cursor = m.end()
        row_open = m.group(1)
        row_n = int(m.group(2))
        body = m.group(3)
        row_close = m.group(4)

        formula = col_c_formula(body, row_n)
        if not formula or "'Допущения'!$F$" not in formula:
            out_parts.append(row_open + body + row_close)
            continue

        refs = DOP_REF_RE.findall(formula)
        if is_inl_tag(body, row_n) and len(refs) == 1:
            # IN-L path: column I holds the key, formula reads it.
            key = dop_keys.get(int(refs[0]))
            if key is None:
                raise RuntimeError(
                    f"row {row_n}: Допущения!F${refs[0]} has no key in col C"
                )
            new_formula = index_match_by_cell(f"{REF_COL}{row_n}")
            body = patch_col_c_formula(body, row_n, new_formula)
            body = upsert_ref_cell(body, row_n, key)
            row_open = patch_row_span(row_open, "1:9")
            inl_rewrites += 1
        else:
            # Magic-coefficient path: inline each MATCH key.
            new_formula = formula
            # Iterate in reverse position so earlier indices stay stable.
            for occ in reversed(list(DOP_REF_RE.finditer(new_formula))):
                key = dop_keys.get(int(occ.group(1)))
                if key is None:
                    raise RuntimeError(
                        f"row {row_n}: Допущения!F${occ.group(1)} has no key"
                    )
                new_formula = (
                    new_formula[:occ.start()]
                    + index_match_by_key(key)
                    + new_formula[occ.end():]
                )
            body = patch_col_c_formula(body, row_n, new_formula)
            magic_rewrites += 1

        out_parts.append(row_open + body + row_close)
    out_parts.append(calc_xml[cursor:])
    new_calc_xml = "".join(out_parts)

    # Add the col-I header on row 1, bump its spans 1:8 -> 1:9.
    if 'r="I1"' not in new_calc_xml:
        header = (
            f'<c r="{REF_COL}1" t="inlineStr"><is><t>ref</t></is></c>'
        )
        new_calc_xml = re.sub(
            r'(<row r="1"[^>]*>)(.*?)(</row>)',
            lambda mm: (
                patch_row_span(mm.group(1), "1:9") + mm.group(2) + header + mm.group(3)
            ),
            new_calc_xml,
            count=1,
            flags=re.DOTALL,
        )

    print(f"IN-L formulas rewritten:    {inl_rewrites}")
    print(f"Magic-coeff formulas rewritten: {magic_rewrites}")
    print(f"New Расчёты XML size: {len(new_calc_xml):,} bytes "
          f"(Δ={len(new_calc_xml)-len(calc_xml):+,}).")

    tmp = XLSX.with_suffix(".xlsx.tmp")
    with zipfile.ZipFile(XLSX, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            payload = (
                new_calc_xml.encode("utf-8")
                if item.filename == CALC_XML
                else zin.read(item.filename)
            )
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)

    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
