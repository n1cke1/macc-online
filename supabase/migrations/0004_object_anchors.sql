-- ─────────────────────────────────────────────────────────────────────────────
-- Fine-grained "comment on any value" anchoring.
--
-- Adds a generic `object` target type so a comment can attach to an individual
-- value in the UI (a KPI, a drill-down indicator, a CAPEX/OPEX line item), not
-- just a whole curve/project/assumption/scenario. The client builds a structured
-- target_id for these, e.g.:
--    'kpi:weightedMac'
--    'project:11:mac'
--    'project:11:item:Расчёты!C511'
-- target_id stays a plain text column, so no schema change beyond the new enum
-- value — existing RLS, RPCs and triggers apply unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

alter type comment_target add value if not exists 'object';
