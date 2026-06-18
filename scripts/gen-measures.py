# One-shot generator: author the 23 not-yet-decomposed measures into
# data/kz/library/measures.seed.json (keeping the 3 hand-crafted ones), plus the
# library objects/resources they reference into data/kz/library/graph.seed.json.
#
# Economics is decomposed line-by-line from model.data.json (capexItems/opexItems,
# which sum exactly to the totals) into created/retired objects + material flows with
# explicit mUSD values (parity by construction). Abatement is the real Excel «Расчёты»
# formula ported to an inline AST over named inputs whose values are the resolved
# cell values (scripts/dump-cells.ts) — bit-for-bit with the workbook.
import json, copy

ROOT = 'data/kz/library'
model = json.load(open('data/kz/model.data.json'))
projById = {p['id']: p for p in model['projects']}

# ── abatement: inline AST + the input values its leaves need (resolved cells) ──
def mul(*a): return {"op": "mul", "args": list(a)}
def sub(*a): return {"op": "sub", "args": list(a)}
def ref(k): return {"ref": k}

# id -> (inputs{key:value}, ast, formula_label_en, formula_label_ru)
ABATE = {
 1:  ({"base_emissions":135.3,"eff_gain":0.02}, mul(ref("base_emissions"),ref("eff_gain"),1000),
     "sector baseline × efficiency gain × 1000", "выбросы сектора × прирост КПД × 1000"),
 3:  ({"cap_mw":10000,"cf":0.35,"curtailment":0.1,"ef_coal":1}, mul(ref("cap_mw"),8760,ref("cf"),sub(1,ref("curtailment")),ref("ef_coal"),1e-3),
     "capacity × 8760 × CF × (1−curtailment) × EF_coal × 10⁻³", "мощность × 8760 × КИУМ × (1−curtailment) × EF_угля × 10⁻³"),
 4:  ({"gen_displaced_gwh":33726,"ef_coal":1,"gen_gas_gwh":12264,"ef_gas":0.45}, sub(mul(ref("gen_displaced_gwh"),ref("ef_coal")),mul(ref("gen_gas_gwh"),ref("ef_gas"))),
     "displaced coal generation × EF_coal − gas generation × EF_gas", "вытесненная угольная выработка × EF_угля − газовая выработка × EF_газа"),
 5:  ({"gen_mwh":26805600,"ef_coal":1}, mul(ref("gen_mwh"),ref("ef_coal"),1e-3),
     "nuclear generation × EF_coal × 10⁻³", "выработка АЭС × EF_угля × 10⁻³"),
 6:  ({"heat_kgcal":9500,"ef_boiler":0.55}, mul(ref("heat_kgcal"),ref("ef_boiler")),
     "displaced heat × EF_coal_boiler", "замещённое тепло × EF_угольной_котельной"),
 7:  ({"heat_kgcal":51300,"ef_boiler":0.55}, mul(ref("heat_kgcal"),ref("ef_boiler")),
     "displaced heat × EF_coal_boiler", "замещённое тепло × EF_угольной_котельной"),
 8:  ({"gen_displaced_gwh":4818,"ef_coal":1,"gen_gas_gwh":1752,"ef_gas":0.45}, sub(mul(ref("gen_displaced_gwh"),ref("ef_coal")),mul(ref("gen_gas_gwh"),ref("ef_gas"))),
     "displaced coal generation × EF_coal − gas generation × EF_gas", "вытесненная угольная выработка × EF_угля − газовая выработка × EF_газа"),
 9:  ({"cap_mw":2500,"cf":0.8,"ef_coal":1}, mul(ref("cap_mw"),8760,ref("cf"),ref("ef_coal"),1e-3),
     "capacity × 8760 × CF × EF_coal × 10⁻³", "мощность × 8760 × КИУМ × EF_угля × 10⁻³"),
 10: ({"base_emissions":27.1,"share":0.15,"grid_growth_kt":1880.7224025974}, sub(mul(ref("base_emissions"),ref("share"),1000),ref("grid_growth_kt")),
     "sector baseline × share × 1000 − grid-emissions growth", "выбросы сектора × доля × 1000 − рост выбросов энергосистемы"),
 11: ({"heat_before_kgcal":41896.5517241379,"heat_after_kgcal":20948.275862069,"ef_boiler":0.55,"derating":0.2}, mul(sub(ref("heat_before_kgcal"),ref("heat_after_kgcal")),ref("ef_boiler"),sub(1,ref("derating"))),
     "(heat_before − heat_after) × EF_coal_boiler × (1−derating)", "(тепло_до − тепло_после) × EF_котельной × (1−просадка КПД ТЭЦ)"),
 12: ({"base_emissions":46.5,"share":0.15}, mul(ref("base_emissions"),ref("share"),1000),
     "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 13: ({"base_emissions":46.5,"tech_potential":0.5,"share":0.5}, mul(ref("base_emissions"),ref("tech_potential"),ref("share"),1000),
     "sector baseline × technical potential × share × 1000", "выбросы сектора × тех. потенциал × доля × 1000"),
 14: ({"base_emissions":34.2,"share":0.25}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 15: ({"base_emissions":34.2,"share":0.2}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 17: ({"base_emissions":34.2,"share":0.15}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 18: ({"base_emissions":8.6,"share":0.1}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 19: ({"base_emissions":27.0,"share":0.08}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 21: ({"base_emissions":3.3,"share":0.08}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 22: ({"base_emissions":11.6,"share":0.1}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 23: ({"base_emissions":11.6,"share":0.05}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 24: ({"area_kha":1000,"survival":0.7,"seq_rate":3}, mul(ref("area_kha"),ref("survival"),ref("seq_rate")),
     "target area × survival rate × sequestration rate", "целевая площадь × доля выживаемости × уд. секвестрация"),
 25: ({"base_emissions":3.6,"share":0.1}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
 26: ({"base_emissions":3.2,"share":0.1}, mul(ref("base_emissions"),ref("share"),1000), "sector baseline × share × 1000", "выбросы сектора × доля × 1000"),
}

# provenance for abatement leaves by key (best-effort, honest classification)
def leaf_prov(key):
    if key == 'base_emissions':
        return {"source_type":"official_stat","citation":"UNFCCC BTR1 Kazakhstan — sector/sub-category baseline (Mt CO₂eq)","confidence":"high"}
    if key in ('share','tech_potential'):
        return {"source_type":"official_stat","citation":"Лист «Мероприятия» — coverage share","confidence":"medium"}
    if key.startswith('ef_'):
        return {"source_type":"standard","citation":"Emission factor (workbook globals, MACC sheet)","confidence":"high"}
    return {"source_type":"expert_estimate","citation":"Engineering premise (workbook «Расчёты»)","confidence":"medium"}

EXISTING = {'kz-2','kz-16','kz-20'}
new_measures = []
new_objects = []
new_resources = []
seen_obj = set(); seen_res = set()

for n in sorted(projById):
    mid = f"kz-{n}"
    if mid in EXISTING: continue
    p = projById[n]
    inputs_spec, ast, flab_en, flab_ru = ABATE[n]

    created = []; retired = []; materials = []; sources = {}
    # inputs: lifetime + abatement leaves
    inputs = {"lifetime": {"value": p['durationYrs'], "unit": "лет",
              "provenance": {"source_type":"expert_estimate","citation":"Срок службы / срок проекта","confidence":"high"}}}
    for k,v in inputs_spec.items():
        inputs[k] = {"value": v, "provenance": leaf_prov(k)}

    # economics: capex items -> created (>=0) / retired (<0); opex items -> materials
    ci = 0  # created index counter
    for j, it in enumerate(p.get('capexItems', [])):
        oid = f"obj_kz{n}_{j}"
        if oid not in seen_obj:
            seen_obj.add(oid)
            new_objects.append({"id": oid, "name": it['label']['en'],
                "kind": "capital_asset" if it['value'] >= 0 else "modernization"})
        if it['value'] >= 0:
            created.append({"object_ref": oid, "capex_musd": it['value']})
            sources[f"created_objects[{len(created)-1}].capex_musd"] = {
                "provenance": {"source_type":"expert_estimate","citation":it['label']['ru'],"confidence":"medium"}}
        else:
            retired.append({"object_ref": oid, "maintenance_capex_musd": -it['value']})
            sources[f"retired_objects[{len(retired)-1}].maintenance_capex_musd"] = {
                "provenance": {"source_type":"expert_estimate","citation":it['label']['ru'],"confidence":"medium"}}

    for j, it in enumerate(p.get('opexItems', [])):
        rid = f"res_kz{n}_{j}"
        if rid not in seen_res:
            seen_res.add(rid)
            new_resources.append({"id": rid, "name": it['label']['en'], "unit": "mUSD/yr", "ef": 0})
        materials.append({"resource_ref": rid, "side": "new", "cost_musd": it['value']})
        sources[f"materials[{len(materials)-1}].cost_musd"] = {
            "provenance": {"source_type":"expert_estimate","citation":it['label']['ru'],"confidence":"medium"}}

    # sources for abatement leaves
    leafpath = {"base_emissions":"abatement.formula.base"}  # (informational; key-based sources below)
    for k in inputs_spec:
        sources[f"inputs.{k}"] = {"provenance": leaf_prov(k)}

    m = {
        "id": mid,
        "schema_version": 1,
        "name": p['name'],
        "sector_ref": p['sector'],
        "sectors": [{"sector_ref": p['sector']}],
        "scope": "published",
        "maturity_stage": "computed",
        "inputs": inputs,
        "abatement": {"formula": ast, "formula_label": {"ru": flab_ru, "en": flab_en}},
        "created_objects": created,
        "retired_objects": retired,
        "materials": materials,
        "sources": sources,
    }
    if not retired: del m['retired_objects']
    new_measures.append(m)

# ── merge into seed files ─────────────────────────────────────────────────────
seed = json.load(open(f'{ROOT}/measures.seed.json'))
kept = [m for m in seed['measures'] if m['id'] in EXISTING]
for m in kept:  # full-model migration: all 26 published (direct-publish model)
    m['scope'] = 'published'
seed['measures'] = kept + new_measures
json.dump(seed, open(f'{ROOT}/measures.seed.json','w'), ensure_ascii=False, indent=2)

graph = json.load(open(f'{ROOT}/graph.seed.json'))
graph['objects'].extend(new_objects)
graph['resources'].extend(new_resources)
json.dump(graph, open(f'{ROOT}/graph.seed.json','w'), ensure_ascii=False, indent=2)

print(f"measures: {len(seed['measures'])} (3 kept + {len(new_measures)} new)")
print(f"+objects: {len(new_objects)}  +resources: {len(new_resources)}")
