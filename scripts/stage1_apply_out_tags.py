#!/usr/bin/env python3
"""
Stage 1 of the Excel restructure: make OUT-tags unique and add the
`review_status` header. Edits the xlsx in place by patching the underlying
worksheet XML directly — bypasses openpyxl's save() pipeline, which would
strip Excel's cached `<v>` values for every formula cell.

Why XML surgery instead of openpyxl:
  * openpyxl can't write cached formula results back to disk (it has no
    spreadsheet engine), so a round-trip save would leave I/J/K with no <v>
    nodes — the ETL's --check cross-check (cached values vs PV-derivation)
    would lose its reference, and the next ETL invocation would refuse to
    proceed because rows.sort(key=lambda p: p['mac']) chokes on Nones.
  * Phase A already tagged col D using `<c t="inlineStr"><is><t>...</t></is></c>`
    nodes. Rewriting them is a one-line regex per cell — no shared-strings
    bookkeeping, no schema risk.
  * H1 is a brand-new cell on a row that currently has only B1. We extend the
    row's <c> list and bump its spans attribute.

Mapping comes from data/kz/model.data.json sourceCells — the canonical OUT
cell per project field. Nothing else (formulas, styles, cached values,
sharedStrings) is touched.

After this script:
  * 104 col-D cells: 'OUT' -> 'OUT_CAPEX_<id>' / 'OUT_OPEX_<id>' /
    'OUT_DURATION_<id>' / 'OUT_ABATE_<id>'
  * H1 = 'review_status' (body empty, filled by the expert review pass)
  * `py scripts/etl.py --check` MUST stay bit-for-bit identical.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
DATASET = REPO / "data" / "kz" / "model.data.json"
SHEET_XML = "xl/worksheets/sheet3.xml"  # MACC=sheet1, Выбросы=sheet2, Расчёты=sheet3

FIELD_TO_TAG = {
    "capex": "OUT_CAPEX",
    "opex": "OUT_OPEX",
    "durationYrs": "OUT_DURATION",
    "abatementKt": "OUT_ABATE",
}


def parse_cell(ref: str) -> tuple[str, int]:
    """'Расчёты!C24' -> ('C', 24)."""
    addr = ref.split("!", 1)[1] if "!" in ref else ref
    m = re.match(r"^([A-Z]+)(\d+)$", addr)
    if not m:
        raise ValueError(f"bad cell ref: {ref}")
    return m.group(1), int(m.group(2))


def build_tag_plan() -> list[tuple[int, str]]:
    """Returns [(row, new_tag)] for every OUT cell, sorted by row."""
    data = json.loads(DATASET.read_text(encoding="utf-8"))
    plan = []
    for p in sorted(data["projects"], key=lambda x: x["id"]):
        pid = p["id"]
        for field, prefix in FIELD_TO_TAG.items():
            ref = p["sourceCells"][field]
            if not ref:
                raise RuntimeError(f"project {pid}: missing sourceCells.{field}")
            col, row = parse_cell(ref)
            if col != "C":
                raise RuntimeError(
                    f"project {pid} {field}: expected col C, got {col} ({ref})"
                )
            plan.append((row, f"{prefix}_{pid}"))
    plan.sort()
    return plan


def patch_sheet_xml(xml: str, plan: list[tuple[int, str]]) -> str:
    """Apply all Stage-1 edits to the Расчёты sheet XML. Pure string transform."""
    # 1. Rewrite each D{row} OUT-cell with its unique tag.
    rewrites = 0
    for row, new_tag in plan:
        # The Phase A pattern is exactly this (inline-string cell).
        old = f'<c r="D{row}" t="inlineStr"><is><t>OUT</t></is></c>'
        new = f'<c r="D{row}" t="inlineStr"><is><t>{new_tag}</t></is></c>'
        if old not in xml:
            raise RuntimeError(f"D{row}: expected OUT cell not found in XML")
        xml = xml.replace(old, new, 1)
        rewrites += 1
    if rewrites != 104:
        raise RuntimeError(f"expected 104 OUT rewrites, did {rewrites}")

    # 2. Make sure no bare 'OUT' tag survives (catches duplicates / dupe patterns).
    surviving = re.findall(r'<c r="D\d+" t="inlineStr"><is><t>OUT</t></is></c>', xml)
    if surviving:
        raise RuntimeError(f"{len(surviving)} bare 'OUT' tags left after rewrite")

    # 3. Insert H1 cell into row 1, bump spans 1:7 -> 1:8.
    h1_cell = '<c r="H1" t="inlineStr"><is><t>review_status</t></is></c>'
    row1_old = re.search(r'<row r="1"[^>]*>.*?</row>', xml, re.DOTALL)
    if not row1_old:
        raise RuntimeError("row 1 not found in sheet XML")
    r1 = row1_old.group(0)
    if 'r="H1"' in r1:
        raise RuntimeError("H1 already present; refusing to double-insert")
    # Insert before </row> and bump spans.
    r1_new = r1.replace("</row>", f"{h1_cell}</row>")
    r1_new = re.sub(r'spans="1:7"', 'spans="1:8"', r1_new, count=1)
    xml = xml.replace(r1, r1_new, 1)
    return xml


def update_zip(zip_in: Path, zip_out: Path, member: str, new_content: bytes) -> None:
    """Stream every entry from zip_in to zip_out, replacing `member`'s payload."""
    with zipfile.ZipFile(zip_in, "r") as zin, zipfile.ZipFile(
        zip_out, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            payload = new_content if item.filename == member else zin.read(item.filename)
            # Preserve original filename and external attrs; let zipfile choose new
            # date/CRC. xlsx readers don't validate timestamps.
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)


def main() -> int:
    if not XLSX.exists():
        print(f"ERROR: source xlsx not found: {XLSX}", file=sys.stderr)
        return 2

    plan = build_tag_plan()
    print(f"Tag plan: {len(plan)} OUT cells (expected 104).")
    if len(plan) != 104:
        print(f"ERROR: expected 104 tags, got {len(plan)}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(XLSX, "r") as zf:
        xml = zf.read(SHEET_XML).decode("utf-8")
    print(f"Loaded {SHEET_XML}: {len(xml):,} bytes.")

    new_xml = patch_sheet_xml(xml, plan)
    print(f"Patched XML: {len(new_xml):,} bytes.")

    tmp = XLSX.with_suffix(".xlsx.tmp")
    update_zip(XLSX, tmp, SHEET_XML, new_xml.encode("utf-8"))
    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
