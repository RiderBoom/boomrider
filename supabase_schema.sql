-- BoomRider Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/mlkbrnvvdcicadvvzmev/sql

-- ── Drop existing policies (safe to re-run) ───────────────────────────────────
do $$ declare pol record;
begin
  for pol in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ── Profiles ──────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text,
  email text,
  avatar text,
  banned boolean default false,
  location jsonb default '{"lat":13.7563,"lng":100.5018}'::jsonb,
  addresses jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.role() = 'authenticated');

-- ── User Roles ────────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  user_id uuid not null,
  role text not null,
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
create policy "user_roles_select" on public.user_roles for select using (true);
create policy "user_roles_all" on public.user_roles for all using (auth.role() = 'authenticated');

-- ── Wallets (user_id TEXT to support admin email keying) ─────────────────────
create table if not exists public.wallets (
  user_id text primary key,
  balance numeric default 0,
  history jsonb default '[]'::jsonb
);
alter table public.wallets enable row level security;
create policy "wallets_all" on public.wallets for all using (auth.role() = 'authenticated');

-- ── Orders ────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id text primary key,
  status text not null default 'pending',
  data jsonb not null,
  created_at timestamptz default now()
);
alter table public.orders enable row level security;

create policy "customer_read_own_orders" on public.orders for select using (
  data->>'customerId' = auth.uid()::text or data->>'userId' = auth.uid()::text
);
create policy "rider_read_own_orders" on public.orders for select using (
  (data->>'riderId' is null or data->>'riderId' = '') or
  exists (
    select 1 from public.riders r
    where r.id = data->>'riderId' and (r.user_id = auth.uid()::text or r.data->>'userId' = auth.uid()::text)
  )
);
create policy "merchant_read_own_orders" on public.orders for select using (
  data->>'restaurantOwnerId' = auth.uid()::text
);
create policy "admin_read_orders" on public.orders for select using (
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);
create policy "authenticated_insert_orders" on public.orders for insert with check (
  auth.role() = 'authenticated'
);
create policy "customer_update_own_orders" on public.orders for update using (
  data->>'customerId' = auth.uid()::text or data->>'userId' = auth.uid()::text
) with check (
  data->>'customerId' = auth.uid()::text or data->>'userId' = auth.uid()::text
);
create policy "rider_update_assigned_orders" on public.orders for update using (
  (data->>'riderId' is null or data->>'riderId' = '') or
  exists (
    select 1 from public.riders r
    where r.id = data->>'riderId' and (r.user_id = auth.uid()::text or r.data->>'userId' = auth.uid()::text)
  )
) with check (
  exists (
    select 1 from public.riders r
    where r.id = data->>'riderId' and (r.user_id = auth.uid()::text or r.data->>'userId' = auth.uid()::text)
  ) or
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);
create policy "merchant_update_own_orders" on public.orders for update using (
  data->>'restaurantOwnerId' = auth.uid()::text
) with check (
  data->>'restaurantOwnerId' = auth.uid()::text
);
create policy "admin_update_orders" on public.orders for update using (
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
) with check (
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Restaurants ───────────────────────────────────────────────────────────────
create table if not exists public.restaurants (
  id text primary key,
  owner_id text,
  data jsonb not null
);
alter table public.restaurants enable row level security;
create policy "restaurants_select" on public.restaurants for select using (true);
create policy "restaurants_write" on public.restaurants for all using (
  owner_id = auth.uid()::text or
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Menu Items ────────────────────────────────────────────────────────────────
create table if not exists public.menu_items (
  restaurant_id text primary key,
  items jsonb default '[]'::jsonb
);
alter table public.menu_items enable row level security;
create policy "menu_items_select" on public.menu_items for select using (true);
create policy "menu_items_write" on public.menu_items for all using (
  exists (
    select 1 from public.restaurants
    where restaurants.id = menu_items.restaurant_id and restaurants.owner_id = auth.uid()::text
  ) or
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Riders ────────────────────────────────────────────────────────────────────
create table if not exists public.riders (
  id text primary key,
  user_id text,
  data jsonb not null
);
alter table public.riders enable row level security;
create policy "riders_select" on public.riders for select using (true);
create policy "riders_all" on public.riders for all using (
  user_id = auth.uid()::text or
  data->>'userId' = auth.uid()::text or
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Pending Requests ──────────────────────────────────────────────────────────
create table if not exists public.pending_requests (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
alter table public.pending_requests enable row level security;
create policy "pending_requests_all" on public.pending_requests for all using (auth.role() = 'authenticated');

-- ── Chats ─────────────────────────────────────────────────────────────────────
create table if not exists public.chats (
  order_id text primary key,
  messages jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table public.chats enable row level security;
create policy "chats_all" on public.chats for all using (auth.role() = 'authenticated');

-- ── Promo Codes ───────────────────────────────────────────────────────────────
create table if not exists public.promo_codes (
  id text primary key,
  data jsonb not null
);
alter table public.promo_codes enable row level security;
create policy "promo_codes_select" on public.promo_codes for select using (true);
create policy "promo_codes_write" on public.promo_codes for all using (
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Admin Notifications ───────────────────────────────────────────────────────
create table if not exists public.admin_notifs (
  id bigint primary key,
  title text,
  message text,
  type text,
  at text,
  created_at timestamptz default now()
);
alter table public.admin_notifs enable row level security;
create policy "admin_notifs_all" on public.admin_notifs for all using (auth.role() = 'authenticated');

-- ── App Config (single row) ───────────────────────────────────────────────────
create table if not exists public.app_config (
  id integer primary key default 1,
  data jsonb not null,
  constraint app_config_single_row check (id = 1)
);
alter table public.app_config enable row level security;
create policy "app_config_select" on public.app_config for select using (true);
create policy "app_config_write" on public.app_config for all using (
  exists (select 1 from public.user_roles where user_roles.user_id = auth.uid() and user_roles.role = 'admin')
);

-- ── Enable Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.admin_notifs;
alter publication supabase_realtime add table public.chats;
alter publication supabase_realtime add table public.pending_requests;
