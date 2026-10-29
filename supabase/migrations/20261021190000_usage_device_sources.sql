-- NORTH — additive usage sources for safe multi-device aggregation.
-- Existing rows remain readable as the legacy source. No usage is deleted.

begin;

alter table public.usage_records
  add column if not exists device_id text not null default 'legacy';

alter table public.usage_records
  add column if not exists source text not null default 'legacy';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_records'::regclass
      and conname = 'usage_records_source_check'
  ) then
    alter table public.usage_records
      add constraint usage_records_source_check
      check (source in ('extension', 'desktop', 'mobile', 'legacy'));
  end if;
end $$;

-- The old account/day/kind/name key made a second device overwrite the first.
alter table public.usage_records
  drop constraint if exists usage_records_user_id_day_kind_name_key;

create unique index if not exists usage_records_user_day_kind_name_device_key
  on public.usage_records (user_id, day, kind, name, device_id);

create index if not exists usage_records_user_device_day_idx
  on public.usage_records (user_id, device_id, day desc);

comment on column public.usage_records.device_id is
  'Stable local collector id. Legacy rows use legacy; never an account identifier.';
comment on column public.usage_records.source is
  'Collector type used for diagnostics; kind remains the reporting taxonomy.';

commit;
