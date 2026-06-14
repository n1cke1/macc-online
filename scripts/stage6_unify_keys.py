#!/usr/bin/env python3
"""
Stage 6: unify every Допущения key to a single scheme `in_<pid>_<seq>`.

After Stage 3a/3b/5, the workbook carried three coexisting naming schemes:
  * `in_<pid>_<calc_row>`            — IN-L migrated in Stage 3a
  * `magic_<pid>_R<calc_row>_<occ>`  — coefficients extracted in Stage 3b
  * `in_<pid>_<calc_row>_v2`         — expert-added rows in Stage 5

This stage flattens them into one project-scoped sequential scheme:
  `in_<pid>_1`, `in_<pid>_2`, … `in_<pid>_N`
in Допущения-row order, regardless of provenance.

Updates everywhere the old key string appears:
  * Допущения!C   — the source-of-truth key column.
  * Расчёты!I     — the ref column for IN-L rows (single key per cell).
  * Расчёты!C     — embedded MATCH("<key>", …) inside CALC formulas (the magic
    cells from Stage 3b/4) — substring rewrite of the literal `"<old>"`.
Cached <v> stays intact (mathematics is identical — only the key spelling
changes), so etl --check and golden remain bit-for-bit.
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
CALC_XML = "xl/worksheets/sheet3.xml"
DOP_XML = "xl/worksheets/sheet4.xml"


# ── XML helpers (battle-tested in Stage 5 with the [^>/]* fix baked in) ───────

def read_shared_strings(zf):
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
    si_re = re.compile(r"<si>(.*?)</si>", re.DOTALL)
    t_re = re.compile(r"<t[^>/]*>([^<]*)</t>")
    out = []
    for m in si_re.finditer(xml):
        parts = [m2.group(1) for m2 in t_re.finditer(m.group(1))]
        out.append("".join(parts))
    return out


_CELL_RE = re.compile(
    r'<c r="([A-Z]+)(\d+)"([^>/]*)(?:>(.*?)</c>|/>)',
    re.DOTALL,
)


def parse_rows(xml):
    """{row -> {col_letter: (attrs, inner_or_None)}} for every <row>."""
    row_re = re.compile(r'<row r="(\d+)"[^>/]*>(.*?)</row>', re.DOTALL)
    out = {}
    for rm in row_re.finditer(xml):
        body = rm.group(2)
        cells = {}
        for cm in _CELL_RE.finditer(body):
            cells[cm.group(1)] = (cm.group(3), cm.group(4))
        out[int(rm.group(1))] = cells
    return out


def cell_str_idx(attrs, inner):
    if attrs is None or 't="s"' not in attrs or inner is None:
        return None
    m = re.search(r"<v>(\d+)</v>", inner)
    return int(m.group(1)) if m else None


def cell_inline_text(attrs, inner):
    if inner is None or attrs is None or 't="inlineStr"' not in attrs:
        return None
    m = re.search(r"<t[^>/]*>([^<]*)</t>", inner)
    return m.group(1) if m else None


def cell_text(attrs, inner, shared):
    if 't="s"' in (attrs or ""):
        idx = cell_str_idx(attrs, inner)
        return shared[idx] if idx is not None and idx < len(shared) else None
    if 't="inlineStr"' in (attrs or ""):
        return cell_inline_text(attrs, inner)
    return None


def cell_pid_int(attrs, inner):
    """col-A of Допущения holds the project_id as a plain numeric cell."""
    if inner is None:
        return None
    m = re.search(r"<v>(\d+)</v>", inner)
    return int(m.group(1)) if m else None


# ── Main rename pass ──────────────────────────────────────────────────────────

def main() -> int:
    with zipfile.ZipFile(XLSX, "r") as zf:
        calc_xml = zf.read(CALC_XML).decode("utf-8")
        dop_xml = zf.read(DOP_XML).decode("utf-8")
        shared = read_shared_strings(zf)

    dop_rows = parse_rows(dop_xml)
    # Skip header row (row 1). Walk in Допущения-row order.
    data_rows = sorted(r for r in dop_rows if r >= 2)

    # Build (pid → counter) and old_key → new_key.
    counter = defaultdict(int)
    key_map: dict[str, str] = {}
    row_to_new_key: dict[int, str] = {}
    for r in data_rows:
        cells = dop_rows[r]
        pid_cell = cells.get("A")
        if pid_cell is None:
            print(f"ERROR: Допущения row {r} has no col A (pid)", file=sys.stderr)
            return 1
        pid = cell_pid_int(*pid_cell)
        if pid is None:
            print(f"ERROR: Допущения row {r} pid not numeric", file=sys.stderr)
            return 1
        old_key_cell = cells.get("C")
        if old_key_cell is None:
            print(f"ERROR: Допущения row {r} has no col C (key)", file=sys.stderr)
            return 1
        old_key = cell_text(*old_key_cell, shared)
        if not old_key:
            print(f"ERROR: Допущения row {r} key not resolved", file=sys.stderr)
            return 1
        counter[pid] += 1
        new_key = f"in_{pid}_{counter[pid]}"
        if old_key in key_map and key_map[old_key] != new_key:
            print(
                f"WARN: duplicate old key {old_key!r} mapping to "
                f"{key_map[old_key]!r} vs {new_key!r}",
                file=sys.stderr,
            )
        key_map[old_key] = new_key
        row_to_new_key[r] = new_key

    print(f"Keys to rename: {len(key_map)} (across {len(counter)} projects)")

    # ── Rewrite Допущения col C cells in place ────────────────────────────────
    # The cell pattern is `<c r="C{n}"... t="s"|t="inlineStr">…</c>`. Both
    # forms appear (Stage 3a wrote inlineStr; openpyxl later converted some
    # back to shared strings). For each row we know the new key, so we just
    # emit a fresh inlineStr cell. The Допущения sheet is small (207 rows)
    # so this regex-per-row pass is fine.
    new_dop_xml = dop_xml
    for r, new_key in row_to_new_key.items():
        # Match either shared-string or inlineStr forms (or self-closing —
        # shouldn't happen for col C, but defensive).
        pat = re.compile(
            rf'<c r="C{r}"[^>/]*(?:>(?:.*?)</c>|/>)',
            re.DOTALL,
        )
        new_cell = (
            f'<c r="C{r}" t="inlineStr"><is><t>{new_key}</t></is></c>'
        )
        m = pat.search(new_dop_xml)
        if not m:
            print(f"WARN: Допущения C{r} not found", file=sys.stderr)
            continue
        new_dop_xml = new_dop_xml.replace(m.group(0), new_cell, 1)

    # ── Расчёты!I (single-key IN-L pointer) ───────────────────────────────────
    # Walk every cell in col I and rewrite if its text is one of the old keys.
    calc_rows = parse_rows(calc_xml)
    calc_shared_changes = 0
    calc_inline_changes = 0
    new_calc_xml = calc_xml
    for r, cells in calc_rows.items():
        i_cell = cells.get("I")
        if not i_cell:
            continue
        attrs, inner = i_cell
        text = cell_text(attrs, inner, shared)
        if not text or text not in key_map:
            continue
        new_key = key_map[text]
        # Replace this specific I{r} cell with an inlineStr that holds new_key.
        cell_pat = re.compile(
            rf'<c r="I{r}"[^>/]*(?:>(?:.*?)</c>|/>)',
            re.DOTALL,
        )
        replacement = (
            f'<c r="I{r}" t="inlineStr"><is><t>{new_key}</t></is></c>'
        )
        m = cell_pat.search(new_calc_xml)
        if not m:
            continue
        new_calc_xml = new_calc_xml.replace(m.group(0), replacement, 1)
        if 't="s"' in attrs:
            calc_shared_changes += 1
        else:
            calc_inline_changes += 1

    print(f"Расчёты!I rewrites: shared={calc_shared_changes} "
          f"inline={calc_inline_changes}")

    # ── Расчёты!C embedded MATCH("<old_key>", …) (Stage 3b magic formulas) ────
    # The literal "<key>" appears inside <f>…</f>. A plain string replace per
    # key in the formula text is safe because no old key is a prefix of any
    # other (all schemes have distinct shapes), and the keys are unique enough
    # not to occur outside formula context. Apply longest-first to avoid
    # any prefix shadowing.
    sorted_olds = sorted(key_map.keys(), key=len, reverse=True)
    formula_rewrites = 0
    for old in sorted_olds:
        # Only rewrite the quoted form — the cell-reference form is handled
        # by the I-cell pass above.
        target = f'"{old}"'
        if target in new_calc_xml:
            new_calc_xml = new_calc_xml.replace(target, f'"{key_map[old]}"')
            formula_rewrites += 1
    print(f"Расчёты!C formula key substitutions: {formula_rewrites}")

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
