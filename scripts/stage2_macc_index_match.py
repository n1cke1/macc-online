#!/usr/bin/env python3
"""
Stage 2 of the Excel restructure: rewrite the 104 MACC outputs (E/F/G/H rows
6..31) from direct row references (`=Расчёты!C24`) to INDEX/MATCH lookups
keyed by the unique OUT_* tags introduced in Stage 1.

Result per cell (example for project id=1, row 31):
    BEFORE: <f>Расчёты!C24</f>
    AFTER : <f>INDEX(Расчёты!C:C,MATCH("OUT_CAPEX_1",Расчёты!D:D,0))</f>

Numerically equivalent (the cached <v> stays correct), so etl.py --check stays
green and golden test stays bit-for-bit identical. Only the modelVersion
fingerprint shifts.

Why this matters: MACC formulas no longer break when rows shift inside
Расчёты. The tag in col D is the contract; geometry is free to evolve.

Same XML-surgery strategy as Stage 1 — bypass openpyxl so cached `<v>` survives.
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
MACC_XML = "xl/worksheets/sheet1.xml"

# MACC cols 0-indexed: E=4, F=5, G=6, H=7. The 4 OUT-fields and their tag prefix.
FIELDS = [
    ("E", "OUT_CAPEX"),
    ("F", "OUT_OPEX"),
    ("G", "OUT_DURATION"),
    ("H", "OUT_ABATE"),
]
ROWS = range(6, 32)  # MACC project rows
SHEET = "Расчёты"


def read_macc_ids(xml: str) -> dict[int, int]:
    """Return {row -> project_id} by reading col B for each project row."""
    out = {}
    for r in ROWS:
        m = re.search(rf'<c r="B{r}"[^>]*><v>(\d+)</v></c>', xml)
        if not m:
            raise RuntimeError(f"MACC: B{r} project id not found")
        out[r] = int(m.group(1))
    return out


def rewrite_cell(xml: str, col: str, row: int, pid: int, tag_prefix: str) -> tuple[str, str, str]:
    """Replace `<f>Расчёты!C<row>...` in the (col, row) cell with INDEX/MATCH.
    Returns (new_xml, old_formula_text, new_formula_text)."""
    cell_pat = re.compile(
        rf'(<c r="{col}{row}"[^>]*>)(<f>)([^<]+)(</f>)(<v>[^<]*</v>)?(</c>)',
        re.DOTALL,
    )
    m = cell_pat.search(xml)
    if not m:
        raise RuntimeError(f"MACC: {col}{row} not found or not a formula cell")
    old_formula = m.group(3)
    new_formula = (
        f'INDEX({SHEET}!C:C,MATCH("{tag_prefix}_{pid}",{SHEET}!D:D,0))'
    )
    replacement = (
        m.group(1) + m.group(2) + new_formula + m.group(4) + (m.group(5) or "") + m.group(6)
    )
    return xml.replace(m.group(0), replacement, 1), old_formula, new_formula


def patch_macc_xml(xml: str) -> str:
    ids = read_macc_ids(xml)
    print(f"MACC ids by row: {min(ids.values())}..{max(ids.values())} "
          f"({len(ids)} rows mapped).")

    rewrites = 0
    for r in ROWS:
        pid = ids[r]
        for col, prefix in FIELDS:
            xml, old, new = rewrite_cell(xml, col, r, pid, prefix)
            rewrites += 1
            if r in (6, 31):  # sample log entries: first and last project rows
                print(f"  {col}{r} (id={pid}): {old} -> {new}")
    if rewrites != 104:
        raise RuntimeError(f"expected 104 rewrites, did {rewrites}")
    return xml


def update_zip(zip_in: Path, zip_out: Path, member: str, new_content: bytes) -> None:
    with zipfile.ZipFile(zip_in, "r") as zin, zipfile.ZipFile(
        zip_out, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            payload = new_content if item.filename == member else zin.read(item.filename)
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)


def main() -> int:
    if not XLSX.exists():
        print(f"ERROR: source xlsx not found: {XLSX}", file=sys.stderr)
        return 2

    with zipfile.ZipFile(XLSX, "r") as zf:
        xml = zf.read(MACC_XML).decode("utf-8")
    print(f"Loaded {MACC_XML}: {len(xml):,} bytes.")

    new_xml = patch_macc_xml(xml)
    print(f"Patched XML: {len(new_xml):,} bytes (Δ={len(new_xml)-len(xml):+,}).")

    tmp = XLSX.with_suffix(".xlsx.tmp")
    update_zip(XLSX, tmp, MACC_XML, new_xml.encode("utf-8"))
    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
