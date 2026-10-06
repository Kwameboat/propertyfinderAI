-- Ghana PropertyFinder Gh: listing clusters (same physical unit across portals/agents)

alter table public.listings
  add column if not exists cluster_id text;

create index if not exists idx_listings_cluster
  on public.listings (cluster_id)
  where cluster_id is not null and is_active = true;
