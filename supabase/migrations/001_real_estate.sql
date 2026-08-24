-- UAE Real Estate concierge — Supabase schema
-- Run in Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

create table if not exists listings (
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

create index if not exists idx_listings_search
  on listings (is_active, transaction_type, emirate, beds, price_aed);

create table if not exists consumer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_phone text default '',
  criteria jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists consumer_leads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references consumer_sessions(id),
  listing_id uuid references listings(id),
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

create index if not exists idx_consumer_leads_ops on consumer_leads (ops_status);

create table if not exists scrape_runs (
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

alter table scrape_runs enable row level security;

drop policy if exists "Server manage scrape_runs" on scrape_runs;
create policy "Server manage scrape_runs" on scrape_runs
  for all using (true) with check (true);

-- RLS: public read active listings; server sync uses publishable/secret key from VPS
alter table listings enable row level security;
alter table consumer_leads enable row level security;
alter table consumer_sessions enable row level security;

drop policy if exists "Public read active listings" on listings;
create policy "Public read active listings" on listings
  for select using (is_active = true);

drop policy if exists "Server upsert listings" on listings;
create policy "Server upsert listings" on listings
  for all using (true) with check (true);

drop policy if exists "Server manage leads" on consumer_leads;
create policy "Server manage leads" on consumer_leads
  for all using (true) with check (true);

drop policy if exists "Server manage sessions" on consumer_sessions;
create policy "Server manage sessions" on consumer_sessions
  for all using (true) with check (true);
