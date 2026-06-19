-- 0013 — extend indicators.owner_kind with 'subsector'.
--
-- The §7 limiting-factor constraint (`potential.limit`) records an industry ceiling as a
-- library indicator owned by a *subsector* (e.g. coal-power max capacity, road-transport
-- emissions). The 0007 CHECK only allowed object/resource/product/global, so seeding those
-- indicators would fail. Idempotent: drop + re-add the named constraint.
alter table public.indicators drop constraint if exists indicators_owner_kind_check;
alter table public.indicators
  add constraint indicators_owner_kind_check
  check (owner_kind in ('object', 'resource', 'product', 'subsector', 'global'));
