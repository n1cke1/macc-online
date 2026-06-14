#!/usr/bin/env python3
"""
Stage 3a: create the `Допущения` sheet and migrate all 155 IN-L literals from
Расчёты onto it. Cells on Расчёты become `='Допущения'!$F$N` formulas pointing
at the new sheet; the cached <v> is preserved bit-for-bit (so etl.py --check
stays green without re-running an Excel engine).

Done entirely via XML zip surgery: openpyxl would strip every formula cell's
cached <v> on save, breaking the trust-anchor cross-check. Manifest files
([Content_Types].xml, xl/_rels/workbook.xml.rels, xl/workbook.xml) get the
new sheet entries; xl/worksheets/sheet4.xml is generated from scratch.

Допущения sheet columns:
  A project_id  B tag  C key  D label_ru  E label_en  F value  G unit  H source  I review_status

label_ru / unit / source columns reuse existing shared-string indices from
sharedStrings.xml (no need to grow it). Header row + tag + key are inline
strings.

Sanity gate:
  * etl.py --check must remain green (cached values intact, math identical).
  * golden test must remain green (HyperFormula sees the new formulas resolving
    to the literals' original values via the Допущения lookup).
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
CALC_XML = "xl/worksheets/sheet3.xml"  # Расчёты
NEW_SHEET_XML = "xl/worksheets/sheet4.xml"  # Допущения (new)
WORKBOOK_XML = "xl/workbook.xml"
WORKBOOK_RELS = "xl/_rels/workbook.xml.rels"
CONTENT_TYPES = "[Content_Types].xml"
SHEET_NAME = "Допущения"


def cell_ref_re(addr: str) -> re.Pattern:
    return re.compile(
        rf'<c r="{re.escape(addr)}"([^>]*)>(.*?)</c>',
        re.DOTALL,
    )


def extract_block_starts(xml: str) -> list[tuple[int, str]]:
    """Find Расчёты project block starts via col-A markers '[1.A.1-1]...'.

    Col A is rendered via shared strings (t="s"), so we need to dereference
    each row's A cell against sharedStrings.xml. To stay self-contained we
    pass already-resolved markers in from outside; here we just return the
    list extracted via the caller's helper.
    """
    raise NotImplementedError  # caller resolves via shared strings


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    """Return shared strings list. Each entry is the raw <si>...</si> body's
    visible text — concatenated <t> children, ignoring formatting <r> runs.
    Indices line up with t="s" cell references."""
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
    si_re = re.compile(r"<si>(.*?)</si>", re.DOTALL)
    t_re = re.compile(r"<t[^>]*>([^<]*)</t>")
    out = []
    for m in si_re.finditer(xml):
        parts = [m2.group(1) for m2 in t_re.finditer(m.group(1))]
        out.append("".join(parts))
    return out


def parse_calc_rows(xml: str) -> dict[int, dict[str, str]]:
    """For each row of Расчёты, return {col_letter: cell_xml}. Used to read
    structural data without modifying the doc."""
    row_re = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.DOTALL)
    cell_re = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)</c>', re.DOTALL)
    self_re = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*)/>')
    rows = {}
    for rm in row_re.finditer(xml):
        r = int(rm.group(1))
        cells = {}
        for cm in cell_re.finditer(rm.group(2)):
            cells[cm.group(1)] = (cm.group(3), cm.group(4))  # (attrs, inner)
        for cm in self_re.finditer(rm.group(2)):
            cells[cm.group(1)] = (cm.group(3), None)
        rows[r] = cells
    return rows


def get_cell_value(cell: tuple[str, str | None]) -> str | None:
    """For a <c ...><v>X</v></c> cell, return X. None otherwise."""
    if cell is None:
        return None
    attrs, inner = cell
    if inner is None:
        return None
    m = re.search(r"<v>([^<]*)</v>", inner)
    return m.group(1) if m else None


def get_cell_str_idx(cell: tuple[str, str | None]) -> int | None:
    """For a cell with t="s", return the shared string index."""
    if cell is None:
        return None
    attrs, inner = cell
    if 't="s"' not in attrs or inner is None:
        return None
    m = re.search(r"<v>(\d+)</v>", inner)
    return int(m.group(1)) if m else None


def get_cell_style(cell: tuple[str, str | None]) -> str | None:
    """Return the s="..." style id of a cell, if present."""
    if cell is None:
        return None
    attrs, _ = cell
    m = re.search(r's="(\d+)"', attrs)
    return m.group(1) if m else None


def find_inl_rows(rows: dict[int, dict[str, str]]) -> list[int]:
    """Rows whose col D inlineStr is exactly 'IN-L'."""
    out = []
    for r, cells in rows.items():
        d = cells.get("D")
        if d is None:
            continue
        attrs, inner = d
        if inner and '<is><t>IN-L</t></is>' in inner:
            out.append(r)
    return sorted(out)


def find_project_blocks(
    rows: dict[int, dict[str, str]], shared: list[str]
) -> list[tuple[int, int, str]]:
    """Return [(start_row, end_row_exclusive, code)] from col-A markers."""
    starts = []
    last_row = max(rows.keys())
    for r in sorted(rows.keys()):
        a = rows[r].get("A")
        if a is None:
            continue
        idx = get_cell_str_idx(a)
        if idx is None or idx >= len(shared):
            continue
        text = shared[idx].strip()
        m = re.match(r"^\[([^\]]+)\]", text)
        if m:
            starts.append((r, m.group(1)))
    out = []
    for i, (s, code) in enumerate(starts):
        e = starts[i + 1][0] if i + 1 < len(starts) else last_row + 1
        out.append((s, e, code))
    return out


def pid_for_block(code: str, project_map: dict[str, int]) -> int | None:
    return project_map.get(code)


def build_project_map(macc_xml: str, shared: list[str]) -> dict[str, int]:
    """Map block code (e.g. '1.A.1-1') -> project_id. The MACC rows are NOT a
    direct source; we use the Расчёты block code -> capex source row, then
    look up which MACC row's E formula points there. For Stage 3a we need a
    code->pid map; the simplest approach is to align by extracting all 26
    capex source rows from MACC then walking back, but that's circular. So
    we use a stable convention: each block code's first OUT_CAPEX_<id> tag
    on that block IS the id. Implemented in caller via Расчёты's OUT tags.
    """
    raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────────
# XML emit helpers
# ─────────────────────────────────────────────────────────────────────────────

def inline_str_cell(ref: str, text: str, style: str | None = None) -> str:
    s = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}"{s} t="inlineStr"><is><t>{text}</t></is></c>'


def shared_str_cell(ref: str, idx: int, style: str | None = None) -> str:
    s = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}"{s} t="s"><v>{idx}</v></c>'


def num_cell(ref: str, val: str, style: str | None = None) -> str:
    s = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}"{s}><v>{val}</v></c>'


def emit_dop_row(
    n: int,  # 1-indexed row on Допущения
    pid: int,
    tag: str,
    key: str,
    label_idx: int | None,
    value: str,
    unit_idx: int | None,
    source_idx: int | None,
) -> str:
    parts = [num_cell(f"A{n}", str(pid))]
    parts.append(inline_str_cell(f"B{n}", tag))
    parts.append(inline_str_cell(f"C{n}", key))
    if label_idx is not None:
        parts.append(shared_str_cell(f"D{n}", label_idx))
    # E (label_en) left empty for the EN review pass.
    parts.append(num_cell(f"F{n}", value))
    if unit_idx is not None:
        parts.append(shared_str_cell(f"G{n}", unit_idx))
    if source_idx is not None:
        parts.append(shared_str_cell(f"H{n}", source_idx))
    # I (review_status) left empty.
    return f'<row r="{n}" spans="1:9">{"".join(parts)}</row>'


HEADERS = [
    "project_id", "tag", "key", "label_ru", "label_en",
    "value", "unit", "source", "review_status",
]


def emit_dop_sheet(dop_rows: list[str]) -> str:
    header_cells = "".join(
        inline_str_cell(f"{c}1", HEADERS[i])
        for i, c in enumerate("ABCDEFGHI")
    )
    header_row = f'<row r="1" spans="1:9">{header_cells}</row>'
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="A1:I{len(dop_rows) + 1}"/>'
        '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        '<cols>'
        '<col min="1" max="1" width="11"/>'
        '<col min="2" max="2" width="14"/>'
        '<col min="3" max="3" width="18"/>'
        '<col min="4" max="4" width="48"/>'
        '<col min="5" max="5" width="48"/>'
        '<col min="6" max="6" width="12"/>'
        '<col min="7" max="7" width="14"/>'
        '<col min="8" max="8" width="32"/>'
        '<col min="9" max="9" width="14"/>'
        '</cols>'
        '<sheetData>'
        + header_row
        + "".join(dop_rows)
        + '</sheetData>'
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        '</worksheet>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# Manifest patchers
# ─────────────────────────────────────────────────────────────────────────────

def patch_content_types(xml: str) -> str:
    """Append Override for the new sheet4.xml."""
    insert = (
        '<Override PartName="/xl/worksheets/sheet4.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument'
        '.spreadsheetml.worksheet+xml"/>'
    )
    if insert in xml:
        return xml
    return xml.replace("</Types>", insert + "</Types>", 1)


def patch_workbook_rels(xml: str, rid: str) -> str:
    """Append a Relationship for the new sheet."""
    insert = (
        f'<Relationship Id="{rid}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet4.xml"/>'
    )
    if f'Id="{rid}"' in xml:
        raise RuntimeError(f"rels already has {rid}")
    return xml.replace("</Relationships>", insert + "</Relationships>", 1)


def patch_workbook_xml(xml: str, rid: str, sheet_id: int, sheet_name: str) -> str:
    """Append a <sheet> entry in <sheets>."""
    insert = (
        f'<sheet name="{sheet_name}" sheetId="{sheet_id}" r:id="{rid}"/>'
    )
    if sheet_name in xml:
        # Defensive: check it's not already registered as a sheet (could be
        # a substring elsewhere).
        if re.search(rf'<sheet [^>]*name="{re.escape(sheet_name)}"', xml):
            raise RuntimeError(f"sheet {sheet_name} already in workbook.xml")
    return xml.replace("</sheets>", insert + "</sheets>", 1)


def used_rids(rels_xml: str) -> set[str]:
    return set(re.findall(r'Id="(rId\d+)"', rels_xml))


def next_rid(rels_xml: str) -> str:
    used = used_rids(rels_xml)
    n = 1
    while f"rId{n}" in used:
        n += 1
    return f"rId{n}"


# ─────────────────────────────────────────────────────────────────────────────
# Расчёты cell rewrite
# ─────────────────────────────────────────────────────────────────────────────

def rewrite_calc_inl_cells(
    calc_xml: str, inl_to_dop_row: dict[int, int]
) -> str:
    """For each IN-L row in Расчёты, rewrite C{row} so its <v>X</v> is
    preceded by <f>'Допущения'!$F${dop_row}</f>. Style and cached value
    untouched."""
    for calc_row, dop_row in inl_to_dop_row.items():
        ref = f"C{calc_row}"
        cell_re = re.compile(
            rf'<c r="{ref}"([^>]*)>(\s*<v>[^<]*</v>\s*)</c>',
            re.DOTALL,
        )
        m = cell_re.search(calc_xml)
        if not m:
            raise RuntimeError(
                f"Расчёты {ref}: literal <v>X</v> cell not found for rewrite"
            )
        attrs, inner = m.group(1), m.group(2)
        # Pull out the cached value.
        vm = re.search(r"<v>([^<]*)</v>", inner)
        cached = vm.group(1) if vm else ""
        formula = f"'{SHEET_NAME}'!$F${dop_row}"
        new = f'<c r="{ref}"{attrs}><f>{formula}</f><v>{cached}</v></c>'
        calc_xml = calc_xml.replace(m.group(0), new, 1)
    return calc_xml


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    if not XLSX.exists():
        print(f"ERROR: {XLSX} not found", file=sys.stderr)
        return 2

    with zipfile.ZipFile(XLSX, "r") as zf:
        calc_xml = zf.read(CALC_XML).decode("utf-8")
        wb_xml = zf.read(WORKBOOK_XML).decode("utf-8")
        rels_xml = zf.read(WORKBOOK_RELS).decode("utf-8")
        ct_xml = zf.read(CONTENT_TYPES).decode("utf-8")
        shared = read_shared_strings(zf)

    # 1. Discover IN-L rows + their value/label/unit/source.
    calc_rows = parse_calc_rows(calc_xml)
    inl_rows = find_inl_rows(calc_rows)
    print(f"IN-L rows found in Расчёты: {len(inl_rows)} (expected 155)")
    if len(inl_rows) != 155:
        print(f"ERROR: expected 155 IN-L rows, got {len(inl_rows)}", file=sys.stderr)
        return 1

    # 2. Map block code -> project_id via OUT_CAPEX_<id> tags in col D.
    code_to_pid: dict[str, int] = {}
    blocks = find_project_blocks(calc_rows, shared)
    for start, end, code in blocks:
        for r in range(start, end):
            d = calc_rows.get(r, {}).get("D")
            if d is None:
                continue
            attrs, inner = d
            if not inner:
                continue
            m = re.search(r"<t>OUT_CAPEX_(\d+)</t>", inner)
            if m:
                code_to_pid[code] = int(m.group(1))
                break
    print(f"Project blocks mapped: {len(code_to_pid)} (expected 26)")
    if len(code_to_pid) != 26:
        print("ERROR: expected 26 project blocks", file=sys.stderr)
        return 1

    def pid_for_row(r: int) -> int | None:
        for start, end, code in blocks:
            if start <= r < end:
                return code_to_pid.get(code)
        return None

    # 3. Build Допущения rows.
    dop_rows_xml = []
    inl_to_dop_row: dict[int, int] = {}
    for n, calc_row in enumerate(inl_rows, start=2):  # row 1 = header, data from 2
        pid = pid_for_row(calc_row)
        if pid is None:
            print(f"ERROR: no pid for row {calc_row}", file=sys.stderr)
            return 1
        cells = calc_rows[calc_row]
        value_str = get_cell_value(cells.get("C"))
        if value_str is None:
            print(f"ERROR: IN-L row {calc_row} has no numeric value", file=sys.stderr)
            return 1
        label_idx = get_cell_str_idx(cells.get("B"))
        unit_idx = get_cell_str_idx(cells.get("E"))
        source_idx = get_cell_str_idx(cells.get("F"))
        key = f"in_{pid}_{calc_row}"
        dop_rows_xml.append(
            emit_dop_row(n, pid, "IN-L", key, label_idx, value_str, unit_idx, source_idx)
        )
        inl_to_dop_row[calc_row] = n

    sheet4_xml = emit_dop_sheet(dop_rows_xml)
    print(f"Generated sheet4.xml: {len(sheet4_xml):,} bytes, "
          f"{len(dop_rows_xml)} data rows.")

    # 4. Rewrite Расчёты IN-L cells: literals -> formulas to Допущения.
    new_calc_xml = rewrite_calc_inl_cells(calc_xml, inl_to_dop_row)
    print(f"Patched Расчёты XML: {len(new_calc_xml):,} bytes "
          f"(Δ={len(new_calc_xml)-len(calc_xml):+,}).")

    # 5. Patch manifests.
    rid = next_rid(rels_xml)
    print(f"Assigned new sheet rId: {rid}")
    new_rels = patch_workbook_rels(rels_xml, rid)
    new_wb = patch_workbook_xml(wb_xml, rid, 4, SHEET_NAME)
    new_ct = patch_content_types(ct_xml)

    # 6. Write zip.
    tmp = XLSX.with_suffix(".xlsx.tmp")
    with zipfile.ZipFile(XLSX, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        names = set(zin.namelist())
        replacements = {
            CALC_XML: new_calc_xml.encode("utf-8"),
            WORKBOOK_XML: new_wb.encode("utf-8"),
            WORKBOOK_RELS: new_rels.encode("utf-8"),
            CONTENT_TYPES: new_ct.encode("utf-8"),
        }
        for item in zin.infolist():
            payload = replacements.get(item.filename, zin.read(item.filename))
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)
        # Add the new sheet4.xml.
        new_info = zipfile.ZipInfo(filename=NEW_SHEET_XML)
        new_info.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(new_info, sheet4_xml.encode("utf-8"))

    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
