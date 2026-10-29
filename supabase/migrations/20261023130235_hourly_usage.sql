-- Preserve existing accounts; future profile rows start unregistered.
alter table public.profiles add column if not exists onboarding_complete boolean not null default true;
alter table public.profiles alter column onboarding_complete set default false;
alter table public.usage_records add column if not exists hourly jsonb not null default '{}'::jsonb;
