#!/usr/bin/env python3
"""
Stage 5: integrate the expert v2 review.

Input state: MACC_KZ_29052026_rev.xlsx == the v2 the expert sent back, with:
  * 24 EXPERT rows marked review_status='ok'  (no action needed)
  * 2 EXPERT rows marked 'to be deleted'      (drop from Допущения)
  * 9 rows in Расчёты tagged ref='new'        (process per row type)

What this script does:
  1. Process every Расчёты row whose col-I value is 'new':
       * literal C-value rows  -> add a new IN-L row to Допущения (auto-keyed
         `in_<pid>_<row>`), replace the literal with the standard
         INDEX/MATCH(I{row}, ...) formula, set tag=IN-L, fill col-I with the key.
       * CALC-formula rows     -> set tag=CALC if missing, just clear the
         'new' marker (no Допущения entry — those are derived, not inputs).
       * the one direct-ref cell R486 `=Допущения!F174` -> normalised into an
         INDEX/MATCH on a fresh key `in_15_486` so Stage 4's contract holds.
  2. Drop the two 'to be deleted' rows from Допущения (rows 178 magic_15_R484_1
     and 188 magic_18_R566_1) — confirmed by grep that no formula references
     them anymore (the expert rewrote the host formulas).
  3. Renumber every Допущения row that lived below a deleted row.
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
REF_COL = "I"

# Hardcoded per the expert's review:
DOP_ROWS_TO_DELETE = {178, 188}
# Cells in Расчёты that need a non-IN-L treatment (CALC tags only):
CALC_NEW_ROWS = {229, 269}


def xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── Низкоуровневые helpers (re-used pattern from earlier stages) ───────────────

def read_shared_strings(zf):
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
    si_re = re.compile(r"<si>(.*?)</si>", re.DOTALL)
    t_re = re.compile(r"<t[^>/]*>([^<]*)</t>")
    out = []
    for m in si_re.finditer(xml):
        parts = [m2.group(1) for m2 in t_re.finditer(m.group(1))]
        out.append("".join(parts))
    return out


def parse_calc_rows(xml):
    row_re = re.compile(r'(<row r="(\d+)"[^>/]*>)(.*?)(</row>)', re.DOTALL)
    return list(row_re.finditer(xml))


def get_cell(body: str, ref: str):
    m = re.search(rf'<c r="{ref}"([^>/]*)>(.*?)</c>', body, re.DOTALL)
    if m:
        return m.group(0), m.group(1), m.group(2)
    m = re.search(rf'<c r="{ref}"([^>/]*)/>', body)
    if m:
        return m.group(0), m.group(1), None
    return None, None, None


def cell_str_idx(attrs, inner):
    if attrs is None or 't="s"' not in attrs or inner is None:
        return None
    m = re.search(r"<v>(\d+)</v>", inner)
    return int(m.group(1)) if m else None


def cell_inline_text(attrs, inner):
    if inner is None or 't="inlineStr"' not in attrs:
        return None
    m = re.search(r"<t[^>/]*>([^<]*)</t>", inner)
    return m.group(1) if m else None


def cell_text(attrs, inner, shared):
    """Resolve a cell's text whether inline or shared-string (v2 after openpyxl
    round-trip converts all our inline tags into shared-string refs)."""
    if inner is None or attrs is None:
        return None
    if 't="s"' in attrs:
        idx = cell_str_idx(attrs, inner)
        if idx is None or idx >= len(shared):
            return None
        return shared[idx]
    if 't="inlineStr"' in attrs:
        return cell_inline_text(attrs, inner)
    return None


def cell_literal_or_formula(attrs, inner):
    """For col-C: return ('literal', value_str) or ('formula', formula_text)
    or (None, None) if empty."""
    if inner is None:
        return None, None
    fm = re.search(r"<f>([^<]+)</f>", inner)
    vm = re.search(r"<v>([^<]*)</v>", inner)
    if fm:
        return "formula", fm.group(1)
    if vm:
        return "literal", vm.group(1)
    return None, None


def find_project_blocks(rows, shared):
    starts = []
    last_row = max(rows.keys())
    for r in sorted(rows.keys()):
        cells = rows[r]
        a_cell = cells.get("A")
        if a_cell is None:
            continue
        attrs, inner = a_cell
        text = cell_text(attrs, inner, shared)
        if not text:
            continue
        text = text.strip()
        m = re.match(r"^\[([^\]]+)\]", text)
        if m:
            starts.append((r, m.group(1).strip()))
    out = []
    for i, (s, code) in enumerate(starts):
        e = starts[i + 1][0] if i + 1 < len(starts) else last_row + 1
        out.append((s, e, code))
    return out


def map_code_to_pid(rows, blocks, shared):
    code_to_pid = {}
    for start, end, code in blocks:
        for r in range(start, end):
            cells = rows.get(r, {})
            d = cells.get("D")
            if d is None:
                continue
            attrs, inner = d
            text = cell_text(attrs, inner, shared)
            if not text:
                continue
            m = re.match(r"^OUT_CAPEX_(\d+)$", text.strip())
            if m:
                code_to_pid[code] = int(m.group(1))
                break
    return code_to_pid


_CELL_RE = re.compile(
    # `[^>/]*` for attrs so the regex doesn't swallow `<c .../>` self-closers as
    # if they were `<c ...>` openers — that bug caused every cell after a
    # self-closing one to be consumed inside the preceding cell's `(.*?)</c>`.
    r'<c r="([A-Z]+)(\d+)"([^>/]*)(?:>(.*?)</c>|/>)',
    re.DOTALL,
)


def parse_calc_cells(calc_xml):
    """Returns {row -> {col_letter: (attrs, inner_or_None)}} for every row in
    Расчёты. `inner` is None for self-closing cells."""
    rows = {}
    for m in parse_calc_rows(calc_xml):
        r = int(m.group(2))
        body = m.group(3)
        cells = {}
        for cm in _CELL_RE.finditer(body):
            cells[cm.group(1)] = (cm.group(3), cm.group(4))
        rows[r] = cells
    return rows


# ── Допущения row delete + renumber ────────────────────────────────────────────

def delete_dop_rows(dop_xml: str, drop: set[int]) -> tuple[str, int]:
    """Drop the named rows from Допущения and renumber every following row.
    Returns (new_xml, new_last_row)."""
    rows = list(re.finditer(r'<row r="(\d+)"[^>/]*>(.*?)</row>', dop_xml, re.DOTALL))
    kept = [(int(m.group(1)), m.group(0)) for m in rows if int(m.group(1)) not in drop]
    # Sort by original row to preserve order; renumber 1..N.
    kept.sort(key=lambda x: x[0])
    new_rows = []
    for new_n, (orig_n, body) in enumerate(kept, start=1):
        body = re.sub(r'<row r="\d+"', f'<row r="{new_n}"', body, count=1)
        # Renumber cell refs A{n}, B{n}, ... -> A{new_n}, ...
        body = re.sub(
            rf'<c r="([A-Z]+){orig_n}"',
            lambda mm: f'<c r="{mm.group(1)}{new_n}"',
            body,
        )
        new_rows.append(body)
    new_sheet_data = "<sheetData>" + "".join(new_rows) + "</sheetData>"
    new_xml = re.sub(
        r'<sheetData>.*?</sheetData>',
        new_sheet_data,
        dop_xml,
        count=1,
        flags=re.DOTALL,
    )
    last = len(kept)
    new_xml = re.sub(
        r'<dimension ref="A1:I\d+"/>',
        f'<dimension ref="A1:I{last}"/>',
        new_xml,
        count=1,
    )
    return new_xml, last


def emit_inl_dop_row(n, pid, key, label_ru, value, unit, source, review="ok"):
    parts = [
        f'<c r="A{n}"><v>{pid}</v></c>',
        f'<c r="B{n}" t="inlineStr"><is><t>IN-L</t></is></c>',
        f'<c r="C{n}" t="inlineStr"><is><t>{xml_escape(key)}</t></is></c>',
        f'<c r="D{n}" t="inlineStr"><is><t>{xml_escape(label_ru or "")}</t></is></c>',
        f'<c r="F{n}"><v>{value}</v></c>',
    ]
    if unit:
        parts.append(f'<c r="G{n}" t="inlineStr"><is><t>{xml_escape(unit)}</t></is></c>')
    if source:
        parts.append(f'<c r="H{n}" t="inlineStr"><is><t>{xml_escape(source)}</t></is></c>')
    if review:
        parts.append(f'<c r="I{n}" t="inlineStr"><is><t>{review}</t></is></c>')
    return f'<row r="{n}" spans="1:9">{"".join(parts)}</row>'


def append_dop_rows(dop_xml: str, last_row: int, new_rows: list[str]) -> tuple[str, int]:
    insertion = "".join(new_rows)
    new_xml = dop_xml.replace("</sheetData>", insertion + "</sheetData>", 1)
    new_last = last_row + len(new_rows)
    new_xml = re.sub(
        r'<dimension ref="A1:I\d+"/>',
        f'<dimension ref="A1:I{new_last}"/>',
        new_xml,
        count=1,
    )
    return new_xml, new_last


# ── Расчёты edits ──────────────────────────────────────────────────────────────

def rewrite_calc_c_cell(body: str, row_n: int, new_inner: str) -> str:
    """Replace col-C cell's INNER content with the given XML fragment."""
    cell_re = re.compile(rf'(<c r="C{row_n}"[^>/]*>)(.*?)(</c>)', re.DOTALL)
    return cell_re.sub(lambda mm: f"{mm.group(1)}{new_inner}{mm.group(3)}", body, count=1)


def rewrite_or_insert_cell(body, ref, new_cell):
    # `[^>/]*` for attrs so a non-self-closing match doesn't accidentally swallow
    # adjacent self-closing cells (the same bug parse_calc_cells hit).
    existing_pair = re.search(rf'<c r="{ref}"[^>/]*>.*?</c>', body, re.DOTALL)
    if existing_pair:
        return body.replace(existing_pair.group(0), new_cell, 1)
    self_closed = re.search(rf'<c r="{ref}"[^>/]*/>', body)
    if self_closed:
        return body.replace(self_closed.group(0), new_cell, 1)
    return body + new_cell


def index_match_by_cell(row):
    return f"INDEX('{SHEET}'!$F:$F,MATCH({REF_COL}{row},'{SHEET}'!$C:$C,0))"


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    with zipfile.ZipFile(XLSX, "r") as zf:
        calc_xml = zf.read(CALC_XML).decode("utf-8")
        dop_xml = zf.read(DOP_XML).decode("utf-8")
        shared = read_shared_strings(zf)

    cells_by_row = parse_calc_cells(calc_xml)
    blocks = find_project_blocks(cells_by_row, shared)
    code_to_pid = map_code_to_pid(cells_by_row, blocks, shared)

    def pid_for(row_n: int):
        for s, e, code in blocks:
            if s <= row_n < e:
                return code_to_pid.get(code)
        return None

    # Discover all rows tagged ref='new' (col I contains "new").
    new_rows = []
    for r, cells in cells_by_row.items():
        i_cell = cells.get("I")
        if not i_cell:
            continue
        attrs, inner = i_cell
        text = cell_text(attrs, inner, shared)
        if text and text.strip().lower() == "new":
            new_rows.append(r)
    new_rows.sort()
    print(f"Rows tagged ref='new' in Расчёты: {sorted(new_rows)}")

    # Process each row.
    inl_new_dop_rows = []   # XML fragments to append on Допущения
    inl_to_key = {}         # calc_row -> key
    calc_rows_to_clean = [] # rows where we just clear "new" + ensure CALC tag
    last_dop_row = max(
        int(m.group(1))
        for m in re.finditer(r'<row r="(\d+)"', dop_xml)
    )
    print(f"Допущения last row before integration: {last_dop_row}")

    # Determine the next Допущения row AFTER planned deletes — easier to delete
    # first, then append. So compute new_last after delete:
    next_dop_row = last_dop_row - len(DOP_ROWS_TO_DELETE) + 1

    for r in new_rows:
        cells = cells_by_row[r]
        if r in CALC_NEW_ROWS:
            calc_rows_to_clean.append(r)
            continue
        # IN-L candidate: read literal value or direct-ref formula
        c_attrs, c_inner = cells["C"]
        kind, content = cell_literal_or_formula(c_attrs, c_inner)
        if kind == "literal":
            value = content
        elif kind == "formula":
            # The R486 case: =Допущения!F174  ->  capture 8180 from <v>.
            vm = re.search(r"<v>([^<]*)</v>", c_inner)
            if not vm:
                print(f"ERROR: row {r} formula has no cached <v>", file=sys.stderr)
                return 1
            value = vm.group(1)
        else:
            print(f"ERROR: row {r} has no C value", file=sys.stderr)
            return 1

        pid = pid_for(r)
        if pid is None:
            print(f"ERROR: row {r} has no project block", file=sys.stderr)
            return 1

        # Pull label / unit / source from row's B / E / F (whether inline or
        # shared-string — v2 went through openpyxl and now stores everything
        # in sharedStrings.xml).
        def col_text(letter):
            cell = cells.get(letter)
            if not cell:
                return ""
            attrs, inner = cell
            return cell_text(attrs, inner, shared) or ""

        label_ru = col_text("B")
        unit = col_text("E")
        source = col_text("F")
        # Suffix '_v2' so a new IN-L at, say, Расчёты R213 doesn't collide with
        # Stage 3a's `in_6_213` for the cell that used to live at row 213 before
        # the expert inserted rows above it. MATCH only returns the first hit,
        # so any duplicate key silently routes lookups to the older row.
        key = f"in_{pid}_{r}_v2"
        inl_new_dop_rows.append(emit_inl_dop_row(
            next_dop_row, pid, key, label_ru, value, unit, source, review="ok"
        ))
        inl_to_key[r] = (next_dop_row, key)
        next_dop_row += 1

    print(f"IN-L rows to add on Допущения: {len(inl_new_dop_rows)}")
    print(f"CALC rows to clean (just clear ref='new'): {calc_rows_to_clean}")

    # 1) Delete rows 178, 188 from Допущения + renumber.
    new_dop_xml, after_delete_last = delete_dop_rows(dop_xml, DOP_ROWS_TO_DELETE)
    print(f"Допущения rows after delete: {after_delete_last}")

    # 2) Append the new IN-L rows.
    if next_dop_row != after_delete_last + 1:
        print(
            f"WARN: append cursor (next_dop_row={next_dop_row}) != "
            f"after_delete_last+1 ({after_delete_last+1})",
            file=sys.stderr,
        )
    new_dop_xml, final_dop_last = append_dop_rows(
        new_dop_xml, after_delete_last, inl_new_dop_rows
    )
    print(f"Допущения rows final: {final_dop_last}")

    # 3) Now rewrite Расчёты for every 'new' row.
    out_parts = []
    cursor = 0
    for m in parse_calc_rows(calc_xml):
        out_parts.append(calc_xml[cursor:m.start()])
        cursor = m.end()
        row_open = m.group(1)
        row_n = int(m.group(2))
        body = m.group(3)
        row_close = m.group(4)

        if row_n in inl_to_key:
            dop_row, key = inl_to_key[row_n]
            # Preserve C cell's style attrs.
            cell_match = re.search(
                rf'<c r="C{row_n}"([^>/]*)>(.*?)</c>',
                body,
                re.DOTALL,
            )
            if cell_match:
                c_attrs = cell_match.group(1)
                # Strip any existing t="..." (literal becomes a formula cell).
                c_attrs = re.sub(r' t="[^"]*"', '', c_attrs)
                # Use the cached <v> from the original (literal or formula).
                old_inner = cell_match.group(2)
                vm = re.search(r"<v>([^<]*)</v>", old_inner)
                if not vm:
                    # was a literal like '0.1' as inline-str (no <v>); check raw
                    # For our case literals are stored as <v>...</v> already.
                    return 99
                cached = vm.group(1)
                new_c = (
                    f'<c r="C{row_n}"{c_attrs}>'
                    f'<f>{index_match_by_cell(row_n)}</f><v>{cached}</v></c>'
                )
                body = body.replace(cell_match.group(0), new_c, 1)
            # Replace col-I with the key.
            new_i = (
                f'<c r="{REF_COL}{row_n}" t="inlineStr">'
                f'<is><t>{xml_escape(key)}</t></is></c>'
            )
            body = rewrite_or_insert_cell(body, f"{REF_COL}{row_n}", new_i)
            # Set col-D tag to IN-L.
            new_d = f'<c r="D{row_n}" t="inlineStr"><is><t>IN-L</t></is></c>'
            body = rewrite_or_insert_cell(body, f"D{row_n}", new_d)

        elif row_n in CALC_NEW_ROWS:
            # Just clear the "new" marker; ensure CALC tag.
            i_match = re.search(rf'<c r="{REF_COL}{row_n}"[^>/]*>.*?</c>', body, re.DOTALL)
            if i_match:
                body = body.replace(i_match.group(0), "", 1)
            i_match2 = re.search(rf'<c r="{REF_COL}{row_n}"[^>/]*/>', body)
            if i_match2:
                body = body.replace(i_match2.group(0), "", 1)
            # D = CALC
            new_d = f'<c r="D{row_n}" t="inlineStr"><is><t>CALC</t></is></c>'
            existing_d = re.search(rf'<c r="D{row_n}"[^>/]*>.*?</c>', body, re.DOTALL)
            if existing_d:
                body = body.replace(existing_d.group(0), new_d, 1)
            else:
                # Insert before </row>
                body = body + new_d

        out_parts.append(row_open + body + row_close)
    out_parts.append(calc_xml[cursor:])
    new_calc_xml = "".join(out_parts)

    print(f"New Расчёты XML: {len(new_calc_xml):,} bytes "
          f"(Δ={len(new_calc_xml)-len(calc_xml):+,}).")

    tmp = XLSX.with_suffix(".xlsx.tmp")
    with zipfile.ZipFile(XLSX, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        replacements = {
            CALC_XML: new_calc_xml.encode("utf-8"),
            DOP_XML: new_dop_xml.encode("utf-8"),
        }
        for item in zin.infolist():
            payload = replacements.get(item.filename, zin.read(item.filename))
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)
    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
