#!/usr/bin/env python3
"""
Stage 7: migrate the 16 *global* assumptions from the MACC sheet onto the
`Допущения` sheet as shared, project-agnostic rows (project_id=0, tag=GLOBAL).

Scope — the non-lever globals on MACC col E:
  * emission factors  E39..E42  (EF coal/gas power, EF coal heat, C content)
  * unit CAPEX        E45..E57  ($/kW, $/m², $/ha, $/vehicle, …)

The 4 live levers (E36/E37/E38 + C2) are deliberately LEFT on MACC — they are
the slider anchors the engine writes to directly; migrating them buys no UI and
adds risk.

Each migrated MACC!E cell turns from a literal into a tag-based lookup, exactly
like Stage 2/4:
    BEFORE: <c r="E47"><v>500</v></c>
    AFTER : <c r="E47"><f>INDEX('Допущения'!$F:$F,
                       MATCH("capexSolar",'Допущения'!$C:$C,0))</f><v>500</v></c>

Numerically identical (cached <v> copied bit-for-bit onto the new Допущения row
and kept on MACC), so etl.py --check and the golden test stay green; only the
modelVersion fingerprint shifts. The 20 downstream Расчёты formulas keep
referencing MACC!$E$.. — now a forwarding facade into Допущения. Расчёты is not
touched.

Same XML-zip-surgery strategy as Stages 1–6: openpyxl would strip every formula
cell's cached <v> on save, breaking the trust-anchor cross-check.

Sanity gate (run after this script):
  * npm run etl                 — regenerate the published JSON (new fingerprint)
  * py scripts/etl.py --check   — cached values intact, math identical
  * npm run golden              — HyperFormula bit-for-bit vs the Excel cache
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
XLSX = REPO / "MACC_KZ_29052026_rev.xlsx"
MACC_XML = "xl/worksheets/sheet1.xml"   # MACC
DOP_XML = "xl/worksheets/sheet4.xml"    # Допущения (created in Stage 3a)
SHEET_NAME = "Допущения"

# MACC col-E row -> stable assumption key (mirrors scripts/etl.py ASSUMPTION_MAP).
# These keys become the Допущения!C lookup literals and the MATCH() arguments.
GLOBALS: list[tuple[int, str]] = [
    (39, "efCoalPower"),
    (40, "efGasPower"),
    (41, "efCoalHeat"),
    (42, "coalCarbonContent"),
    (45, "capexCoalChpEfficiency"),
    (46, "capexCoalToGas"),
    (47, "capexSolar"),
    (48, "capexWind"),
    (49, "capexGasPeaker"),
    (50, "capexNuclear"),
    (51, "capexHeatPump"),
    (52, "capexElectricBoiler"),
    (53, "capexWasteHeat"),
    (54, "capexEv"),
    (55, "capexThermalRetrofit"),
    (56, "capexCcus"),
    (57, "capexAfforestation"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Reading helpers
# ─────────────────────────────────────────────────────────────────────────────

def read_shared_strings_raw(zf: zipfile.ZipFile) -> list[str]:
    """Shared strings as RAW <t> body text (entities like &amp; preserved, so
    re-embedding into a new inlineStr stays valid XML)."""
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
    si_re = re.compile(r"<si>(.*?)</si>", re.DOTALL)
    t_re = re.compile(r"<t[^>]*>(.*?)</t>", re.DOTALL)
    return ["".join(t.group(1) for t in t_re.finditer(m.group(1)))
            for m in si_re.finditer(xml)]


def find_cell(xml: str, ref: str) -> tuple[str, str] | None:
    """Return (attrs, inner) for <c r="ref" attrs>inner</c>, or None."""
    m = re.search(rf'<c r="{re.escape(ref)}"([^>]*)>(.*?)</c>', xml, re.DOTALL)
    if not m:
        return None
    return m.group(1), m.group(2)


def cell_num(inner: str) -> str | None:
    m = re.search(r"<v>([^<]*)</v>", inner)
    return m.group(1) if m else None


def cell_shared_text(cell: tuple[str, str] | None, shared: list[str]) -> str | None:
    """Resolve a t="s" cell to its raw shared-string text."""
    if cell is None:
        return None
    attrs, inner = cell
    if 't="s"' not in attrs:
        return None
    m = re.search(r"<v>(\d+)</v>", inner)
    if not m:
        return None
    idx = int(m.group(1))
    return shared[idx] if idx < len(shared) else None


# ─────────────────────────────────────────────────────────────────────────────
# Emit helpers (inline strings — self-contained, no sharedStrings bookkeeping)
# ─────────────────────────────────────────────────────────────────────────────

def inl(ref: str, text: str) -> str:
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def num(ref: str, val: str) -> str:
    return f'<c r="{ref}"><v>{val}</v></c>'


def emit_global_row(n: int, key: str, label_ru: str | None,
                    value: str, unit: str | None, source: str | None) -> str:
    """One Допущения row: A pid=0 · B GLOBAL · C key · D label_ru · E label_en(∅)
    · F value · G unit · H source · I review_status(∅)."""
    parts = [num(f"A{n}", "0"), inl(f"B{n}", "GLOBAL"), inl(f"C{n}", key)]
    if label_ru:
        parts.append(inl(f"D{n}", label_ru))
    parts.append(num(f"F{n}", value))
    if unit:
        parts.append(inl(f"G{n}", unit))
    if source:
        parts.append(inl(f"H{n}", source))
    return f'<row r="{n}" spans="1:9">{"".join(parts)}</row>'


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    if not XLSX.exists():
        print(f"ERROR: {XLSX} not found", file=sys.stderr)
        return 2

    with zipfile.ZipFile(XLSX, "r") as zf:
        macc_xml = zf.read(MACC_XML).decode("utf-8")
        dop_xml = zf.read(DOP_XML).decode("utf-8")
        shared = read_shared_strings_raw(zf)

    # 1. Read the 16 globals from MACC (label D · value E · unit F · source G).
    records = []  # (row, key, label, value, unit, source)
    for row, key in GLOBALS:
        e = find_cell(macc_xml, f"E{row}")
        if e is None:
            print(f"ERROR: MACC!E{row} not found", file=sys.stderr)
            return 1
        e_attrs, e_inner = e
        if "<f>" in e_inner:
            print(f"ERROR: MACC!E{row} is already a formula — already migrated?",
                  file=sys.stderr)
            return 1
        value = cell_num(e_inner)
        if value is None:
            print(f"ERROR: MACC!E{row} has no numeric <v>", file=sys.stderr)
            return 1
        label = cell_shared_text(find_cell(macc_xml, f"D{row}"), shared)
        unit = cell_shared_text(find_cell(macc_xml, f"F{row}"), shared)
        source = cell_shared_text(find_cell(macc_xml, f"G{row}"), shared)
        records.append((row, key, label, value, unit, source))
    print(f"Read {len(records)} globals from MACC (expected {len(GLOBALS)}).")

    # 2. Find the current last data row on Допущения; append from max+1.
    existing_rows = [int(m.group(1)) for m in re.finditer(r'<row r="(\d+)"', dop_xml)]
    if not existing_rows:
        print("ERROR: Допущения sheet has no rows", file=sys.stderr)
        return 1
    start_n = max(existing_rows) + 1
    print(f"Допущения currently ends at row {max(existing_rows)}; "
          f"appending globals at rows {start_n}..{start_n + len(records) - 1}.")

    new_rows_xml = []
    keymap = []  # (macc_row, key, dop_row)
    for i, (row, key, label, value, unit, source) in enumerate(records):
        n = start_n + i
        new_rows_xml.append(emit_global_row(n, key, label, value, unit, source))
        keymap.append((row, key, n))

    # 3. Splice new rows in before </sheetData> and bump the dimension.
    if "</sheetData>" not in dop_xml:
        print("ERROR: Допущения sheet has no </sheetData>", file=sys.stderr)
        return 1
    new_dop = dop_xml.replace("</sheetData>", "".join(new_rows_xml) + "</sheetData>", 1)
    last_n = start_n + len(records) - 1
    new_dop, ndim = re.subn(r'<dimension ref="A1:I\d+"/>',
                            f'<dimension ref="A1:I{last_n}"/>', new_dop, count=1)
    if ndim != 1:
        print("WARNING: Допущения <dimension> not found/updated "
              "(harmless for openpyxl/HyperFormula, but unexpected).",
              file=sys.stderr)

    # 4. Rewrite the 16 MACC literals into tag-based INDEX/MATCH lookups.
    new_macc = macc_xml
    for row, key, dop_row in keymap:
        ref = f"E{row}"
        m = re.search(rf'<c r="{ref}"([^>]*)>(\s*<v>[^<]*</v>\s*)</c>',
                      new_macc, re.DOTALL)
        if not m:
            print(f"ERROR: MACC!{ref} literal cell vanished before rewrite",
                  file=sys.stderr)
            return 1
        attrs = m.group(1)
        cached = re.search(r"<v>([^<]*)</v>", m.group(2)).group(1)
        formula = (f"INDEX('{SHEET_NAME}'!$F:$F,"
                   f"MATCH(&quot;{key}&quot;,'{SHEET_NAME}'!$C:$C,0))")
        new_cell = f'<c r="{ref}"{attrs}><f>{formula}</f><v>{cached}</v></c>'
        new_macc = new_macc.replace(m.group(0), new_cell, 1)
    print(f"Rewrote {len(keymap)} MACC literals into Допущения lookups.")

    # 5. Backup + write zip (replace MACC + Допущения parts, copy the rest).
    bak = XLSX.with_suffix(".xlsx.bak")
    shutil.copy2(XLSX, bak)
    print(f"Backup: {bak.name}")

    tmp = XLSX.with_suffix(".xlsx.tmp")
    replacements = {
        MACC_XML: new_macc.encode("utf-8"),
        DOP_XML: new_dop.encode("utf-8"),
    }
    with zipfile.ZipFile(XLSX, "r") as zin, \
            zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            payload = replacements.get(item.filename, zin.read(item.filename))
            zinfo = zipfile.ZipInfo(filename=item.filename, date_time=item.date_time)
            zinfo.compress_type = zipfile.ZIP_DEFLATED
            zinfo.external_attr = item.external_attr
            zout.writestr(zinfo, payload)
    shutil.move(tmp, XLSX)
    print(f"Saved {XLSX.name}")
    print("\nNext: npm run etl  &&  py scripts/etl.py --check  &&  npm run golden")
    return 0


if __name__ == "__main__":
    sys.exit(main())
