-- PropertyFinder Gh (Ghana) — paste into Supabase SQL editor (one shot).
-- Safe to re-run. Creates listings + scrape_runs + Ghana cluster_id.

create extension if not exists "pgcrypto";

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  source_url text not null default '',
  transaction_type text not null check (transaction_type in ('rent', 'sale', 'off_plan')),
  property_type text default 'apartment',
  beds numeric,
  baths numeric,
  emirate text not null,
  community text default '',
  sub_community text default '',
  building text default '',
  price_aed numeric not null,
  price_period text default 'yearly',
  handover_date text,
  payment_plan text default '',
  developer text default '',
  furnished boolean,
  amenities jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  description text default '',
  agent_name text default '',
  agent_phone text default '',
  agency_name text default '',
  rera_permit text default '',
  lat numeric,
  lng numeric,
  fingerprint text not null,
  scraped_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (source, external_id)
);

alter table public.listings add column if not exists listing_status text not null default 'available';
alter table public.listings add column if not exists last_verified_at timestamptz;
alter table public.listings add column if not exists size_sqft numeric;
alter table public.listings add column if not exists cluster_id text;

create index if not exists idx_listings_search
  on public.listings (is_active, transaction_type, emirate, beds, price_aed);
create index if not exists idx_listings_status
  on public.listings (is_active, listing_status, emirate);
create index if not exists idx_listings_cluster
  on public.listings (cluster_id)
  where cluster_id is not null and is_active = true;

create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  emirate text default '',
  transaction_type text default '',
  listings_found int not null default 0,
  listings_upserted int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.consumer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_phone text default '',
  criteria jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consumer_leads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.consumer_sessions(id),
  listing_id uuid references public.listings(id),
  renter_name text default '',
  renter_phone text not null,
  renter_email text default '',
  criteria jsonb not null default '{}'::jsonb,
  qualification_score int not null default 0,
  consent_at timestamptz,
  ops_status text not null default 'new',
  telegram_chat_id text default '',
  telegram_message_id text default '',
  sent_to_agent_phone text default '',
  sent_at timestamptz,
  notes text default '',
  draft_message text default '',
  listing_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consumer_leads add column if not exists channel text default 'pwa';

alter table public.listings enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.consumer_sessions enable row level security;
alter table public.consumer_leads enable row level security;

drop policy if exists "Public read active listings" on public.listings;
create policy "Public read active listings" on public.listings
  for select using (is_active = true);

drop policy if exists "Server upsert listings" on public.listings;
create policy "Server upsert listings" on public.listings
  for all using (true) with check (true);

drop policy if exists "Server manage scrape_runs" on public.scrape_runs;
create policy "Server manage scrape_runs" on public.scrape_runs
  for all using (true) with check (true);

drop policy if exists "Server manage sessions" on public.consumer_sessions;
create policy "Server manage sessions" on public.consumer_sessions
  for all using (true) with check (true);

drop policy if exists "Server manage leads" on public.consumer_leads;
create policy "Server manage leads" on public.consumer_leads
  for all using (true) with check (true);
