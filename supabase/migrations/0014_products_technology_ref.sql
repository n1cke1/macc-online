-- 0014 — rename products.object_ref → technology_ref.
--
-- The object→technology rename landed in all code (graph.seed.json, load-supabase.ts,
-- seed-library.ts, supabase-apply.ts) but not in the 0007 schema, so the hosted loader
-- selected a non-existent `technology_ref` (silently undefined) and re-seeding products
-- failed. Rename the column (the FK to objects follows). Idempotent.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'object_ref'
  ) then
    alter table public.products rename column object_ref to technology_ref;
  end if;
end $$;
