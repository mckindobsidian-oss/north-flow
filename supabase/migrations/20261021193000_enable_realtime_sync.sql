-- Realtime is an invalidation signal only; clients still re-read through RLS.
-- Keep this idempotent so it is safe to apply to an existing project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.profiles';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'usage_records'
  ) then
    execute 'alter publication supabase_realtime add table public.usage_records';
  end if;
end
$$;
