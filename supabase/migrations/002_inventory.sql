-- Live search RAG inventory (SearXNG → Jina → Gemini → n8n)
-- Run in Supabase SQL editor after 001_real_estate.sql

create table if not exists public.inventory (
  id bigint generated always as identity primary key,
  url text unique not null,
  title text,
  description text,
  price text,
  location text,
  developer text,
  unit_types jsonb default '[]'::jsonb,
  amenities jsonb default '[]'::jsonb,
  images jsonb default '[]'::jsonb,
  payment_plan text,
  source text default 'live_search',
  last_updated timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_inventory_source on public.inventory (source);
create index if not exists idx_inventory_updated on public.inventory (last_updated desc);
create index if not exists idx_inventory_location on public.inventory (location);

alter table public.inventory enable row level security;

drop policy if exists "Public read inventory" on public.inventory;
create policy "Public read inventory" on public.inventory
  for select using (true);

drop policy if exists "Server manage inventory" on public.inventory;
create policy "Server manage inventory" on public.inventory
  for all using (true) with check (true);
