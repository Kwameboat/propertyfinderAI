-- Listing availability tracking (additive — safe on existing DB)

alter table listings add column if not exists listing_status text not null default 'available';
alter table listings add column if not exists last_verified_at timestamptz;
alter table listings add column if not exists size_sqft numeric;

create index if not exists idx_listings_status
  on listings (is_active, listing_status, emirate);

comment on column listings.listing_status is 'available | rented | sold | withdrawn | unavailable | under_offer | unknown';
