-- Developer & government live intel (Developer Intel agent)
-- Run after 002_inventory.sql

create table if not exists public.developer_intel (
  id bigint generated always as identity primary key,
  url text unique not null,
  source_name text,
  source_type text default 'developer',
  title text,
  summary text,
  developer text,
  project_name text,
  emirate text,
  payment_plan text,
  handover text,
  price_from text,
  unit_types jsonb default '[]'::jsonb,
  amenities jsonb default '[]'::jsonb,
  images jsonb default '[]'::jsonb,
  last_updated timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_developer_intel_type on public.developer_intel (source_type);
create index if not exists idx_developer_intel_dev on public.developer_intel (developer);
create index if not exists idx_developer_intel_updated on public.developer_intel (last_updated desc);

alter table public.developer_intel enable row level security;

drop policy if exists "Public read developer_intel" on public.developer_intel;
create policy "Public read developer_intel" on public.developer_intel
  for select using (true);

drop policy if exists "Server manage developer_intel" on public.developer_intel;
create policy "Server manage developer_intel" on public.developer_intel
  for all using (true) with check (true);
