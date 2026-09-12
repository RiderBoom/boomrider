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

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = p_user_id
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;


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
  status text,
  data jsonb not null,
  created_at timestamptz default now()
);
alter table public.orders enable row level security;
create policy "orders_all" on public.orders for all using (auth.role() = 'authenticated');

-- ── Restaurants ───────────────────────────────────────────────────────────────
create table if not exists public.restaurants (
  id text primary key,
  owner_id text,
  data jsonb not null
);
alter table public.restaurants enable row level security;
create policy "restaurants_select" on public.restaurants for select using (true);
create policy "restaurants_write" on public.restaurants for all using (auth.role() = 'authenticated');

-- ── Menu Items (one JSONB array per restaurant) ───────────────────────────────
create table if not exists public.menu_items (
  restaurant_id text primary key,
  items jsonb default '[]'::jsonb
);
alter table public.menu_items enable row level security;
create policy "menu_items_select" on public.menu_items for select using (true);
create policy "menu_items_write" on public.menu_items for all using (auth.role() = 'authenticated');

-- ── Riders ────────────────────────────────────────────────────────────────────
create table if not exists public.riders (
  id text primary key,
  user_id text,
  data jsonb not null
);
alter table public.riders enable row level security;
create policy "riders_all" on public.riders for all using (auth.role() = 'authenticated');

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
create policy "promo_codes_write" on public.promo_codes for all using (auth.role() = 'authenticated');

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
create policy "app_config_write" on public.app_config for all using (auth.role() = 'authenticated');

-- ── Service Quotes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_quotes (
  id                      TEXT PRIMARY KEY,
  customer_id             TEXT NOT NULL,
  service_type            TEXT NOT NULL,
  pickup_lat              NUMERIC,
  pickup_lng              NUMERIC,
  dropoff_lat             NUMERIC,
  dropoff_lng             NUMERIC,
  restaurant_id           TEXT,
  address_id              TEXT,
  vehicle_type            TEXT,
  service_category        TEXT,
  distance_meters         NUMERIC NOT NULL DEFAULT 1000,
  billable_km             INT NOT NULL DEFAULT 1,
  distance_source         TEXT NOT NULL DEFAULT 'haversine_estimate',
  pricing_config_version  INT NOT NULL DEFAULT 1,
  base_fee                NUMERIC NOT NULL DEFAULT 20,
  per_km_fee              NUMERIC NOT NULL DEFAULT 10,
  subtotal                NUMERIC NOT NULL DEFAULT 0,
  discount                NUMERIC NOT NULL DEFAULT 0,
  grand_total             NUMERIC NOT NULL DEFAULT 0,
  admin_gp                NUMERIC NOT NULL DEFAULT 0,
  rider_income            NUMERIC NOT NULL DEFAULT 0,
  expires_at              TIMESTAMPTZ NOT NULL,
  used_at                 TIMESTAMPTZ DEFAULT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_quotes_cust_exp ON public.service_quotes (customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_service_quotes_used_at ON public.service_quotes (used_at);

ALTER TABLE public.service_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_quotes_select_own_or_admin" ON public.service_quotes;
CREATE POLICY "service_quotes_select_own_or_admin" ON public.service_quotes
  FOR SELECT
  USING (
    customer_id = auth.uid()::text OR public.is_admin(auth.uid())
  );

-- ── AI Agent Logs Table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_agent_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_source      TEXT NOT NULL DEFAULT 'cron_scheduled',
  health_status       TEXT NOT NULL DEFAULT 'healthy',
  reasoning_thought   TEXT,
  action_taken        TEXT,
  execution_result    JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_agent_logs_admin_all" ON public.ai_agent_logs;
CREATE POLICY "ai_agent_logs_admin_all" ON public.ai_agent_logs
  FOR ALL
  USING (
    auth.role() = 'service_role' OR
    (SELECT current_setting('role', true)) = 'service_role' OR
    public.is_admin((SELECT auth.uid()))
  );

-- ── AI Suggested Actions Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_suggested_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'pending',
  action_type         TEXT NOT NULL,
  target_id           TEXT,
  title               TEXT NOT NULL,
  reasoning           TEXT,
  payload             JSONB DEFAULT '{}'::jsonb,
  executed_at         TIMESTAMPTZ,
  executed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.ai_suggested_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_suggested_actions_admin_all" ON public.ai_suggested_actions;
CREATE POLICY "ai_suggested_actions_admin_all" ON public.ai_suggested_actions
  FOR ALL
  USING (
    auth.role() = 'service_role' OR
    (SELECT current_setting('role', true)) = 'service_role' OR
    public.is_admin((SELECT auth.uid()))
  );


-- ── Enable Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.admin_notifs;
alter publication supabase_realtime add table public.chats;
alter publication supabase_realtime add table public.pending_requests;
alter publication supabase_realtime add table public.wallets;
alter publication supabase_realtime add table public.ai_agent_logs;
alter publication supabase_realtime add table public.ai_suggested_actions;

-- ── Haversine Distance Calculation Function ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_haversine_distance(
  lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r NUMERIC := 6371; -- Earth radius in km
  dlat NUMERIC;
  dlon NUMERIC;
  a NUMERIC;
  c NUMERIC;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
    RETURN 1;
  END IF;

  dlat := radians((lat2 - lat1)::DOUBLE PRECISION);
  dlon := radians((lon2 - lon1)::DOUBLE PRECISION);

  a := (sin(dlat / 2.0) ^ 2) + cos(radians(lat1::DOUBLE PRECISION)) * cos(radians(lat2::DOUBLE PRECISION)) * (sin(dlon / 2.0) ^ 2);
  c := 2.0 * atan2(sqrt(a), sqrt(greatest(0.0, 1.0 - a)));

  RETURN ROUND((r * c)::NUMERIC, 2);
END;
$$;

-- ── Server-Authoritative Order Placement RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_service_quote(
  p_service_type        TEXT,
  p_pickup_lat          NUMERIC DEFAULT NULL,
  p_pickup_lng          NUMERIC DEFAULT NULL,
  p_dropoff_lat         NUMERIC DEFAULT NULL,
  p_dropoff_lng         NUMERIC DEFAULT NULL,
  p_restaurant_id       TEXT DEFAULT NULL,
  p_address_id          TEXT DEFAULT NULL,
  p_service_category    TEXT DEFAULT NULL,
  p_promo_code          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid        TEXT;
  v_quote_id          TEXT;
  v_service_type      TEXT;

  -- Coordinates
  v_plat              NUMERIC := p_pickup_lat;
  v_plng              NUMERIC := p_pickup_lng;
  v_dlat              NUMERIC := p_dropoff_lat;
  v_dlng              NUMERIC := p_dropoff_lng;

  -- Address / Restaurant Lookup Records
  v_rest_data         JSONB;
  v_addr_data         JSONB;

  -- Config Parameters
  v_config_data       JSONB;
  v_base_fee          NUMERIC := 20;
  v_per_km_fee        NUMERIC := 10;
  v_ride_base_fee     NUMERIC := 20;
  v_ride_per_km_fee    NUMERIC := 10;
  v_gp_food_rate      NUMERIC := 0.30;
  v_gp_deliv_rate     NUMERIC := 0.15;
  v_gp_ride_rate      NUMERIC := 0.15;
  v_gp_service_rate   NUMERIC := 0.15;
  v_extra_services    JSONB;

  -- Distance & Pricing Calculations
  v_dist_meters       NUMERIC := 1000;
  v_billable_km       INT := 1;
  v_dist_source       TEXT := 'haversine_estimate';
  v_subtotal          NUMERIC := 0;
  v_discount          NUMERIC := 0;
  v_grand_total       NUMERIC := 0;
  v_admin_gp          NUMERIC := 0;
  v_rider_income      NUMERIC := 0;

  -- Service Category Matching
  v_service_elem      JSONB;
  v_matched_service   BOOLEAN := false;

  -- Promo Code Row
  v_promo_row         RECORD;
  v_promo_data        JSONB;
  v_promo_active      BOOLEAN;
  v_promo_type        TEXT;
  v_promo_val         NUMERIC;
  v_promo_min_order   NUMERIC;
  v_promo_max_disc    NUMERIC;
  v_promo_max_uses    INT;
  v_promo_used_cnt    INT;

  i                   INT;
BEGIN
  -- 1. Authentication Check
  v_caller_uid := auth.uid()::text;
  IF v_caller_uid IS NULL OR v_caller_uid = '' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Service Type
  v_service_type := LOWER(COALESCE(p_service_type, 'food'));
  IF v_service_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_SERVICE_TYPE');
  END IF;

  -- 3. Resolve Coordinates from Canonical DB Records
  IF v_service_type = 'food' THEN
    IF p_restaurant_id IS NOT NULL AND p_restaurant_id <> '' THEN
      SELECT data INTO v_rest_data FROM public.restaurants WHERE id = p_restaurant_id;
      IF v_rest_data IS NOT NULL AND v_rest_data->'location' IS NOT NULL THEN
        v_plat := (v_rest_data->'location'->>'lat')::NUMERIC;
        v_plng := (v_rest_data->'location'->>'lng')::NUMERIC;
      END IF;
    END IF;

    IF p_address_id IS NOT NULL AND p_address_id <> '' THEN
      SELECT address_item INTO v_addr_data
      FROM public.profiles p
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.addresses, '[]'::JSONB)) AS address_item
      WHERE p.id::TEXT = v_caller_uid
        AND address_item->>'id' = p_address_id
      LIMIT 1;
      IF v_addr_data IS NOT NULL AND v_addr_data->'location' IS NOT NULL THEN
        v_dlat := (v_addr_data->'location'->>'lat')::NUMERIC;
        v_dlng := (v_addr_data->'location'->>'lng')::NUMERIC;
      END IF;
    END IF;
  END IF;

  -- 4. Coordinate Bounds Validation (-90 to 90 lat, -180 to 180 lng)
  IF v_plat IS NULL OR v_plng IS NULL OR v_dlat IS NULL OR v_dlng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_COORDINATES');
  END IF;

  IF v_plat < -90 OR v_plat > 90 OR v_dlat < -90 OR v_dlat > 90 OR
     v_plng < -180 OR v_plng > 180 OR v_dlng < -180 OR v_dlng > 180 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_COORDINATES_OUT_OF_BOUNDS');
  END IF;

  -- Reject default Bangkok fallback coordinates for quote creation
  IF (ABS(v_plat - 13.7563) < 0.0001 AND ABS(v_plng - 100.5018) < 0.0001) OR
     (ABS(v_dlat - 13.7563) < 0.0001 AND ABS(v_dlng - 100.5018) < 0.0001) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'DEFAULT_FALLBACK_COORDINATES_REJECTED');
  END IF;

  -- 5. Calculate Distance Server-Side (Haversine calculation)
  v_dist_meters := public.calculate_haversine_distance(v_plat, v_plng, v_dlat, v_dlng) * 1000.0;
  v_dist_source := 'haversine_estimate';
  v_billable_km := GREATEST(1, CEIL(v_dist_meters / 1000.0)::INT);

  -- 6. Load DB Config
  SELECT data INTO v_config_data FROM public.app_config WHERE id = 1;

  IF v_config_data IS NOT NULL THEN
    v_base_fee        := COALESCE((v_config_data->>'baseFee')::NUMERIC, 20);
    v_per_km_fee      := COALESCE((v_config_data->>'perKmFee')::NUMERIC, 10);
    v_ride_base_fee   := COALESCE((v_config_data->>'rideBaseFee')::NUMERIC, v_base_fee);
    v_ride_per_km_fee  := COALESCE((v_config_data->>'ridePerKmFee')::NUMERIC, v_per_km_fee);

    v_gp_food_rate    := COALESCE((v_config_data->>'gpFood')::NUMERIC, 30) / 100.0;
    v_gp_deliv_rate   := COALESCE((v_config_data->>'gpDelivery')::NUMERIC, 15) / 100.0;
    v_gp_ride_rate    := COALESCE((v_config_data->>'gpRide')::NUMERIC, 15) / 100.0;
    v_gp_service_rate := COALESCE((v_config_data->>'gpService')::NUMERIC, 15) / 100.0;
    v_extra_services  := v_config_data->'extraServices';
  END IF;

  -- 7. Pricing Breakdown by Service Type
  IF v_service_type = 'food' THEN
    v_subtotal := v_base_fee + (v_billable_km * v_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_subtotal * v_gp_deliv_rate, 2);
    v_rider_income := v_subtotal;

  ELSIF v_service_type = 'parcel' THEN
    v_subtotal := v_base_fee + (v_billable_km * v_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_deliv_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);

  ELSIF v_service_type = 'ride' THEN
    v_subtotal := v_ride_base_fee + (v_billable_km * v_ride_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_ride_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);

  ELSIF v_service_type = 'service' THEN
    v_subtotal := 350;
    IF v_extra_services IS NOT NULL AND jsonb_array_length(v_extra_services) > 0 THEN
      FOR i IN 0..jsonb_array_length(v_extra_services) - 1 LOOP
        v_service_elem := v_extra_services->i;
        IF (v_service_elem->>'id') = p_service_category OR (v_service_elem->>'name') = p_service_category THEN
          v_subtotal := COALESCE((v_service_elem->>'price')::NUMERIC, 350);
          v_matched_service := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_service_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);
  END IF;

  -- 8. Promo Validation
  IF p_promo_code IS NOT NULL AND TRIM(p_promo_code) <> '' THEN
    SELECT * INTO v_promo_row FROM public.promo_codes WHERE UPPER(data->>'code') = UPPER(TRIM(p_promo_code));
    IF v_promo_row.id IS NOT NULL THEN
      v_promo_data      := v_promo_row.data;
      v_promo_active    := COALESCE((v_promo_data->>'active')::BOOLEAN, true);
      v_promo_type      := LOWER(COALESCE(v_promo_data->>'type', 'percent'));
      v_promo_val       := COALESCE((v_promo_data->>'value')::NUMERIC, 0);
      v_promo_min_order  := COALESCE((v_promo_data->>'minOrder')::NUMERIC, 0);
      v_promo_max_disc   := COALESCE((v_promo_data->>'maxDiscount')::NUMERIC, 9999);
      v_promo_max_uses   := COALESCE((v_promo_data->>'maxUses')::INT, 100);
      v_promo_used_cnt   := COALESCE((v_promo_data->>'usedCount')::INT, 0);

      IF v_promo_active AND v_promo_used_cnt < v_promo_max_uses AND v_subtotal >= v_promo_min_order THEN
        IF v_promo_type = 'percent' THEN
          v_discount := LEAST(ROUND(v_subtotal * (v_promo_val / 100.0), 2), v_promo_max_disc);
        ELSE
          v_discount := LEAST(v_promo_val, v_subtotal);
        END IF;
      END IF;
    END IF;
  END IF;

  v_grand_total := GREATEST(0, v_subtotal - v_discount);

  -- 9. Insert Quote
  v_quote_id := 'quote_' || gen_random_uuid()::text;

  INSERT INTO public.service_quotes (
    id, customer_id, service_type,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    restaurant_id, address_id, vehicle_type, service_category,
    distance_meters, billable_km, distance_source, pricing_config_version,
    base_fee, per_km_fee, subtotal, discount, grand_total,
    admin_gp, rider_income, expires_at, created_at
  ) VALUES (
    v_quote_id, v_caller_uid, v_service_type,
    v_plat, v_plng, v_dlat, v_dlng,
    p_restaurant_id, p_address_id, NULL, p_service_category,
    v_dist_meters, v_billable_km, v_dist_source, 1,
    v_base_fee, v_per_km_fee, v_subtotal, v_discount, v_grand_total,
    v_admin_gp, v_rider_income, NOW() + INTERVAL '5 minutes', NOW()
  );

  -- 10. Return Response
  RETURN jsonb_build_object(
    'ok', true,
    'quoteId', v_quote_id,
    'customerId', v_caller_uid,
    'serviceType', v_service_type,
    'distanceMeters', v_dist_meters,
    'billableKm', v_billable_km,
    'distanceSource', v_dist_source,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'grandTotal', v_grand_total,
    'adminGP', v_admin_gp,
    'riderIncome', v_rider_income,
    'expiresAt', (NOW() + INTERVAL '5 minutes')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── Server-Authoritative Order Placement RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_customer_order(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid        TEXT;
  v_cust_uid          TEXT;
  v_order_id          TEXT;
  v_existing_order    RECORD;
  v_type              TEXT;
  v_method            TEXT;
  v_status            TEXT;

  -- Quote Verification
  v_quote_id          TEXT;
  v_quote_rec         RECORD;

  -- DB Config & Pricing Parameters
  v_config_data       JSONB;
  v_base_fee          NUMERIC := 20;
  v_per_km_fee        NUMERIC := 10;
  v_gp_food_rate      NUMERIC := 0.30;
  v_gp_deliv_rate     NUMERIC := 0.15;
  v_gp_ride_rate      NUMERIC := 0.15;
  v_gp_service_rate   NUMERIC := 0.15;

  -- Item / Food Calculation Variables
  v_restaurant_id     TEXT;
  v_menu_items_json   JSONB;
  v_req_items         JSONB;
  v_req_item          JSONB;
  v_item_id           TEXT;
  v_orig_id           TEXT;
  v_qty               INT;
  v_db_item           JSONB := NULL;
  v_db_base_price     NUMERIC := 0;
  v_db_opts_extra     NUMERIC := 0;
  v_item_unit_price   NUMERIC := 0;
  v_item_subtotal     NUMERIC := 0;
  v_sel_opts          JSONB;
  v_opt_elem          JSONB;
  v_db_opt            JSONB;
  v_db_opt_price      NUMERIC := 0;
  v_auth_items        JSONB := '[]'::jsonb;

  -- Financial Calculations
  v_calc_food_total   NUMERIC := 0;
  v_calc_deliv_fee    NUMERIC := 0;
  v_promo_discount    NUMERIC := 0;
  v_calc_grand_total  NUMERIC := 0;
  v_admin_gp          NUMERIC := 0;
  v_rider_income      NUMERIC := 0;
  v_distance          NUMERIC := 1;

  -- Wallet Record & History
  v_wallet            RECORD;
  v_bal               NUMERIC := 0;
  v_entry             JSONB;
  v_final_order       JSONB;
  v_now_bangkok       TEXT;
  v_now_epoch_ms      BIGINT;

  i                   INT;
  j                   INT;
  k                   INT;
  v_matched_opt       BOOLEAN;
BEGIN
  -- 1. Authentication Check
  v_caller_uid := auth.uid()::text;
  IF v_caller_uid IS NULL OR v_caller_uid = '' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 2. Customer Identity Enforcement
  IF public.is_admin(auth.uid()) THEN
    v_cust_uid := COALESCE(NULLIF(p_order->>'customerId', ''), NULLIF(p_order->>'userId', ''), v_caller_uid);
  ELSE
    v_cust_uid := v_caller_uid;
  END IF;

  -- 3. Order ID & Idempotency Check
  v_order_id := NULLIF(p_order->>'id', '');
  IF v_order_id IS NULL THEN
    v_order_id := gen_random_uuid()::text;
  END IF;

  SELECT * INTO v_existing_order
  FROM public.orders
  WHERE id = v_order_id;

  IF v_existing_order.id IS NOT NULL THEN
    IF v_existing_order.data->>'customerId' = v_cust_uid OR public.is_admin(auth.uid()) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order', v_existing_order.data,
        'idempotent', true
      );
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'DUPLICATE_ORDER');
    END IF;
  END IF;

  -- 4. Payment Method & Type Validation
  v_method := LOWER(COALESCE(p_order->>'paymentMethod', 'cash'));
  IF v_method NOT IN ('cash', 'wallet', 'online') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_PAYMENT_METHOD');
  END IF;

  v_type := LOWER(COALESCE(p_order->>'type', 'food'));
  IF v_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ORDER_TYPE');
  END IF;

  IF v_type = 'food' THEN
    v_status := 'pending';
  ELSE
    v_status := 'ready_to_pickup';
  END IF;

  -- 5. Quote Verification (Mandatory Server-Authoritative Quote)
  v_quote_id := p_order->>'quoteId';
  IF v_quote_id IS NULL OR v_quote_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_REQUIRED');
  END IF;

  SELECT * INTO v_quote_rec
  FROM public.service_quotes
  WHERE id = v_quote_id
  FOR UPDATE;

  IF v_quote_rec.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_NOT_FOUND');
  END IF;

  IF v_quote_rec.customer_id <> v_cust_uid AND NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_ACCESS_DENIED');
  END IF;

  IF v_quote_rec.service_type <> v_type THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_SERVICE_MISMATCH');
  END IF;

  IF v_quote_rec.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_ALREADY_USED');
  END IF;

  IF v_quote_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_EXPIRED');
  END IF;

  -- Extract delivery fee, promo discount, grand total, admin GP, rider income from quote
  v_calc_deliv_fee := v_quote_rec.subtotal;
  v_promo_discount := v_quote_rec.discount;
  v_distance       := v_quote_rec.billable_km;
  v_admin_gp       := v_quote_rec.admin_gp;
  v_rider_income   := v_quote_rec.rider_income;

  -- 6. Load DB Config for Base Rates
  SELECT data INTO v_config_data FROM public.app_config WHERE id = 1;

  IF v_config_data IS NOT NULL THEN
    v_base_fee     := COALESCE((v_config_data->>'baseFee')::NUMERIC, 20);
    v_per_km_fee   := COALESCE((v_config_data->>'perKmFee')::NUMERIC, 10);
    v_gp_food_rate := COALESCE((v_config_data->>'gpFood')::NUMERIC, 30) / 100.0;
  END IF;

  -- 7. Calculate Food Subtotal strictly from DB menu items
  IF v_type = 'food' THEN
    v_restaurant_id := p_order->>'restaurantId';
    IF v_restaurant_id IS NULL OR v_restaurant_id = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_RESTAURANT_ID');
    END IF;

    SELECT items INTO v_menu_items_json
    FROM public.menu_items
    WHERE restaurant_id = v_restaurant_id;

    IF v_menu_items_json IS NULL OR jsonb_array_length(v_menu_items_json) = 0 THEN
      SELECT data->'menu' INTO v_menu_items_json
      FROM public.restaurants
      WHERE id = v_restaurant_id;
    END IF;

    v_req_items := p_order->'items';
    IF v_req_items IS NULL OR jsonb_array_length(v_req_items) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'EMPTY_FOOD_ORDER');
    END IF;

    FOR i IN 0..jsonb_array_length(v_req_items) - 1 LOOP
      v_req_item := v_req_items->i;
      v_item_id  := v_req_item->>'id';
      v_orig_id  := COALESCE(v_req_item->>'originalId', v_item_id);
      v_qty      := COALESCE((v_req_item->>'qty')::INT, 0);

      IF v_qty <= 0 OR v_qty > 100 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_QUANTITY');
      END IF;

      v_db_item := NULL;
      IF v_menu_items_json IS NOT NULL AND jsonb_array_length(v_menu_items_json) > 0 THEN
        FOR j IN 0..jsonb_array_length(v_menu_items_json) - 1 LOOP
          IF (v_menu_items_json->j->>'id') = v_orig_id OR (v_menu_items_json->j->>'id') = v_item_id THEN
            v_db_item := v_menu_items_json->j;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_db_item IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ITEM', 'itemId', v_orig_id);
      END IF;

      IF COALESCE((v_db_item->>'available')::BOOLEAN, true) = false THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ITEM_UNAVAILABLE', 'itemName', v_db_item->>'name');
      END IF;

      v_db_base_price := COALESCE((v_db_item->>'price')::NUMERIC, 0);
      v_db_opts_extra := 0;
      v_sel_opts := v_req_item->'selectedOptions';

      IF v_sel_opts IS NOT NULL AND jsonb_array_length(v_sel_opts) > 0 THEN
        FOR k IN 0..jsonb_array_length(v_sel_opts) - 1 LOOP
          v_opt_elem := v_sel_opts->k;
          v_matched_opt := false;

          IF v_db_item->'options' IS NOT NULL AND jsonb_array_length(v_db_item->'options') > 0 THEN
            FOR j IN 0..jsonb_array_length(v_db_item->'options') - 1 LOOP
              v_db_opt := v_db_item->'options'->j;
              IF (v_db_opt->>'name') = (v_opt_elem->>'name') THEN
                v_db_opt_price := COALESCE((v_db_opt->>'price')::NUMERIC, 0);
                v_db_opts_extra := v_db_opts_extra + v_db_opt_price;
                v_matched_opt := true;
                EXIT;
              END IF;
            END LOOP;
          END IF;

          IF NOT v_matched_opt THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_OPTION', 'optionName', v_opt_elem->>'name');
          END IF;
        END LOOP;
      END IF;

      v_item_unit_price := ROUND(v_db_base_price + v_db_opts_extra, 2);
      v_item_subtotal   := ROUND(v_item_unit_price * v_qty, 2);
      v_calc_food_total := v_calc_food_total + v_item_subtotal;

      v_auth_items := v_auth_items || jsonb_build_object(
        'id', v_item_id,
        'originalId', v_orig_id,
        'name', COALESCE(v_db_item->>'name', v_req_item->>'name'),
        'price', v_item_unit_price,
        'qty', v_qty,
        'selectedOptions', COALESCE(v_sel_opts, '[]'::jsonb)
      );
    END LOOP;

    v_calc_grand_total := GREATEST(0, v_calc_food_total + v_calc_deliv_fee - v_promo_discount);

  ELSE
    v_calc_food_total := 0;
    v_calc_grand_total := GREATEST(0, v_calc_deliv_fee - v_promo_discount);
  END IF;

  -- 8. Wallet Deduction (Atomic Row Lock)
  IF v_method = 'wallet' AND v_calc_grand_total > 0 THEN
    INSERT INTO public.wallets (user_id, balance, history)
    VALUES (v_cust_uid, 0, '[]'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_cust_uid
    FOR UPDATE;

    v_bal := COALESCE(v_wallet.balance, 0);

    IF v_bal < v_calc_grand_total THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_CUSTOMER_WALLET',
        'requiredBalance', v_calc_grand_total,
        'currentBalance', v_bal
      );
    END IF;

    v_now_bangkok  := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS');
    v_now_epoch_ms := (extract(epoch FROM now()) * 1000)::BIGINT;

    v_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'withdraw',
      'amount', -v_calc_grand_total,
      'date', v_now_bangkok,
      'desc', 'ชำระค่าสินค้า/บริการ ออเดอร์ #' || right(v_order_id, 6),
      'refOrderId', v_order_id,
      'createdAtMs', v_now_epoch_ms,
      'actorUserId', v_caller_uid
    );

    UPDATE public.wallets
    SET balance = balance - v_calc_grand_total,
        history = jsonb_build_array(v_entry) || COALESCE(history, '[]'::jsonb)
    WHERE user_id = v_cust_uid;
  END IF;

  -- 9. Construct Final Authoritative Payload
  v_final_order := p_order || jsonb_build_object(
    'id', v_order_id,
    'quoteId', v_quote_id,
    'type', v_type,
    'status', v_status,
    'customerId', v_cust_uid,
    'paymentMethod', v_method,
    'distance', v_distance,
    'foodTotal', v_calc_food_total,
    'deliveryFee', v_calc_deliv_fee,
    'promoDiscount', v_promo_discount,
    'grandTotal', v_calc_grand_total,
    'adminGP', v_admin_gp,
    'riderIncome', v_rider_income,
    'createdAt', COALESCE(p_order->>'createdAt', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'))
  );

  IF v_type = 'food' THEN
    v_final_order := v_final_order || jsonb_build_object('items', v_auth_items);
  END IF;

  -- 10. Consume the quote only after all validation and wallet checks succeed.
  UPDATE public.service_quotes
  SET used_at = NOW()
  WHERE id = v_quote_id;

  -- 11. Persist Order
  INSERT INTO public.orders (id, status, data)
  VALUES (v_order_id, v_status, v_final_order);

  -- 12. Return Authoritative Pricing Result
  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'quoteId', v_quote_id,
    'order', v_final_order,
    'pricing', jsonb_build_object(
      'foodTotal', v_calc_food_total,
      'deliveryFee', v_calc_deliv_fee,
      'promoDiscount', v_promo_discount,
      'grandTotal', v_calc_grand_total
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_customer_order(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_customer_order(JSONB) TO authenticated;

-- ── Helper function to calculate cash liability for a single order ─────────────
CREATE OR REPLACE FUNCTION public.calculate_rider_order_cash_liability(
  v_order JSONB,
  p_gp_food_rate NUMERIC DEFAULT 0.30,
  p_gp_delivery_rate NUMERIC DEFAULT 0.15,
  p_gp_ride_rate NUMERIC DEFAULT 0.15,
  p_gp_service_rate NUMERIC DEFAULT 0.15
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type      TEXT;
  v_method    TEXT;
  v_food      NUMERIC;
  v_deliv     NUMERIC;
  v_total     NUMERIC;
  v_gp        NUMERIC;
BEGIN
  v_method := COALESCE(v_order->>'paymentMethod', 'cash');
  IF v_method IS DISTINCT FROM 'cash' THEN
    RETURN 0;
  END IF;

  v_type  := COALESCE(v_order->>'type', 'food');
  v_food  := COALESCE((v_order->>'foodTotal')::NUMERIC, 0);
  v_deliv := COALESCE((v_order->>'deliveryFee')::NUMERIC, 0);
  v_total := COALESCE((v_order->>'grandTotal')::NUMERIC, v_deliv);

  IF v_type = 'food' THEN
    RETURN v_food;
  ELSIF v_type = 'parcel' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_deliv * p_gp_delivery_rate, 2));
    RETURN v_gp;
  ELSIF v_type = 'ride' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_total * p_gp_ride_rate, 2));
    RETURN v_gp;
  ELSIF v_type = 'service' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_total * p_gp_service_rate, 2));
    RETURN v_gp;
  END IF;

  RETURN 0;
END;
$$;

-- ── Helper function to compute active cash liabilities for a rider ──────────
CREATE OR REPLACE FUNCTION public.get_rider_active_cash_liability(
  p_rider_id TEXT,
  p_rider_user_id TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_liability NUMERIC := 0;
  v_rec RECORD;
BEGIN
  IF (p_rider_id IS NULL OR p_rider_id = '') AND (p_rider_user_id IS NULL OR p_rider_user_id = '') THEN
    RETURN 0;
  END IF;

  FOR v_rec IN
    SELECT data
    FROM public.orders
    WHERE (
            (p_rider_id IS NOT NULL AND p_rider_id <> '' AND data->>'riderId' = p_rider_id)
            OR
            (p_rider_user_id IS NOT NULL AND p_rider_user_id <> '' AND data->>'riderUserId' = p_rider_user_id)
          )
      AND status IN ('rider_accepted', 'picking_up', 'delivering')
      AND COALESCE(data->>'paymentMethod', 'cash') = 'cash'
      AND COALESCE(data->>'settlementStatus', '') <> 'settled'
  LOOP
    v_total_liability := v_total_liability + public.calculate_rider_order_cash_liability(v_rec.data);
  END LOOP;

  RETURN v_total_liability;
END;
$$;

-- ── Internal function for direct manual order acceptance with atomic wallet validation
CREATE OR REPLACE FUNCTION public.accept_order_direct_internal(
  p_order_id TEXT,
  p_rider_id TEXT,
  p_rider_user_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_rider RECORD;
  v_wallet RECORD;
  v_now_str TEXT;
  v_updated_order JSONB;
  v_wallet_bal NUMERIC := 0;
  v_req_liability NUMERIC := 0;
  v_active_liability NUMERIC := 0;
  v_avail_bal NUMERIC := 0;
  v_food_total NUMERIC := 0;
  v_deliv_fee NUMERIC := 0;
  v_grand_total NUMERIC := 0;
  v_type TEXT := 'food';
  v_gp_amount NUMERIC := 0;
  v_merch_income NUMERIC := 0;
  v_rider_income NUMERIC := 0;
  v_gp_food_rate NUMERIC := 0.30;
  v_gp_deliv_rate NUMERIC := 0.15;
  v_gp_ride_rate NUMERIC := 0.15;
  v_gp_service_rate NUMERIC := 0.15;
BEGIN
  -- Lock target order
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Check status is open for acceptance
  IF v_order.status NOT IN ('pending', 'preparing', 'ready_to_pickup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  IF (v_order.data->>'riderId') IS NOT NULL AND (v_order.data->>'riderId') <> '' AND (v_order.data->>'riderId') <> p_rider_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  -- Fetch rider row
  SELECT * INTO v_rider FROM riders WHERE id = p_rider_id;
  IF v_rider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rider_not_found');
  END IF;

  IF p_rider_user_id IS NULL OR p_rider_user_id = '' THEN
    p_rider_user_id := v_rider.data->>'userId';
  END IF;

  -- Lock rider's wallet row
  IF p_rider_user_id IS NOT NULL AND p_rider_user_id <> '' THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_rider_user_id FOR UPDATE;
    IF v_wallet IS NOT NULL THEN
      v_wallet_bal := COALESCE(v_wallet.balance, 0);
    END IF;
  END IF;

  -- Calculate income breakdown
  v_type        := COALESCE(v_order.data->>'type', 'food');
  v_food_total  := COALESCE((v_order.data->>'foodTotal')::NUMERIC, 0);
  v_deliv_fee   := COALESCE((v_order.data->>'deliveryFee')::NUMERIC, 0);
  v_grand_total := COALESCE((v_order.data->>'grandTotal')::NUMERIC, v_deliv_fee);

  IF v_type = 'parcel' THEN
    v_gp_amount    := ROUND(v_deliv_fee * v_gp_deliv_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_deliv_fee - v_gp_amount, 2);
  ELSIF v_type = 'ride' THEN
    v_gp_amount    := ROUND(v_grand_total * v_gp_ride_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_grand_total - v_gp_amount, 2);
  ELSIF v_type = 'service' THEN
    v_gp_amount    := ROUND(v_grand_total * v_gp_service_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_grand_total - v_gp_amount, 2);
  ELSE -- food
    v_gp_amount    := ROUND(v_food_total * v_gp_food_rate, 2);
    v_merch_income := ROUND(v_food_total - v_gp_amount, 2);
    v_rider_income := v_deliv_fee;
  END IF;

  -- Validate Cash Wallet Reserve if paymentMethod is cash
  v_req_liability := public.calculate_rider_order_cash_liability(v_order.data);
  IF v_req_liability > 0 THEN
    v_active_liability := public.get_rider_active_cash_liability(p_rider_id, p_rider_user_id);
    v_avail_bal := v_wallet_bal - v_active_liability;

    IF v_avail_bal < v_req_liability THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_RIDER_WALLET',
        'requiredBalance', v_req_liability,
        'currentBalance', v_wallet_bal,
        'availableBalance', ROUND(v_avail_bal, 2)
      );
    END IF;
  END IF;

  v_now_str := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS');

  v_updated_order := v_order.data || jsonb_build_object(
    'status', 'rider_accepted',
    'riderId', p_rider_id,
    'riderUserId', p_rider_user_id,
    'riderName', COALESCE(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', COALESCE(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str,
    'riderIncome', v_rider_income,
    'merchantIncome', v_merch_income,
    'adminGP', v_gp_amount
  );

  -- Update order row
  UPDATE orders
  SET status = 'rider_accepted',
      data = v_updated_order
  WHERE id = p_order_id;

  -- Mark rider as unavailable
  UPDATE riders SET is_available = false WHERE id = p_rider_id;

  -- Cancel all pending offers for this order
  UPDATE job_offers
  SET status = 'missed', responded_at = now()
  WHERE order_id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'order_data', v_updated_order);
END;
$$;

-- ── Public authorization wrapper for accept_order_direct ──────────────────────
CREATE OR REPLACE FUNCTION public.accept_order_direct(
  p_order_id TEXT,
  p_rider_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider_user_id TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT data->>'userId' INTO v_rider_user_id
  FROM riders
  WHERE id = p_rider_id;

  IF v_rider_user_id IS NULL OR (v_rider_user_id <> auth.uid()::text AND NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'rider_access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN public.accept_order_direct_internal(p_order_id, p_rider_id, v_rider_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_direct(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_order_direct(TEXT, TEXT) TO authenticated;

-- ── Helper Authorization Checker ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin_or_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.role() = 'service_role')
      OR ((SELECT current_setting('role', true)) = 'service_role')
      OR public.is_admin((SELECT auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_service_role() TO authenticated, service_role;

-- ── Admin System Health Diagnostic RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_system_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized boolean;
  v_result jsonb;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  WITH order_health AS (
    SELECT
      count(*) AS total_orders,
      count(*) FILTER (WHERE COALESCE(data->>'status', status, '') = 'completed') AS completed_orders,
      count(*) FILTER (WHERE COALESCE(data->>'status', status, '') = 'cancelled') AS cancelled_orders,
      count(*) FILTER (
        WHERE COALESCE(data->>'status', status, '') = 'completed'
          AND COALESCE(data->>'settlementStatus', '') <> 'settled'
      ) AS completed_unsettled_count,
      count(*) FILTER (
        WHERE COALESCE(data->>'status', status, '') = 'cancelled'
          AND COALESCE(data->>'paymentMethod', '') = 'wallet'
          AND COALESCE(data->>'refundStatus', '') <> 'refunded'
      ) AS cancelled_unrefunded_count
    FROM public.orders
  ),
  wallet_health AS (
    SELECT
      count(*) AS total_wallets,
      count(*) FILTER (WHERE balance < 0) AS negative_wallets_count,
      ROUND(COALESCE(sum(balance), 0), 2) AS total_wallet_balance_sum
    FROM public.wallets
  ),
  ledger_health AS (
    SELECT
      count(*) AS total_ledger_entries,
      ROUND(COALESCE(sum(amount), 0), 2) AS total_ledger_amount_sum
    FROM public.wallet_ledger_entries
  ),
  variance_health AS (
    SELECT
      count(*) AS wallet_ledger_variance_count
    FROM public.wallets w
    LEFT JOIN (
      SELECT user_id, ROUND(sum(amount), 2) AS ledger_balance
      FROM public.wallet_ledger_entries
      GROUP BY user_id
    ) l ON l.user_id = w.user_id
    WHERE ROUND(COALESCE(w.balance, 0), 2) <> COALESCE(l.ledger_balance, 0)
  ),
  entity_counts AS (
    SELECT
      (SELECT count(*) FROM public.profiles) AS total_profiles,
      (SELECT count(*) FROM public.user_roles) AS total_user_roles,
      (SELECT count(*) FROM public.restaurants) AS total_restaurants,
      (SELECT count(*) FROM public.riders) AS total_riders,
      (SELECT count(*) FROM public.pending_requests) AS total_pending_requests,
      (SELECT count(*) FROM public.service_quotes) AS total_service_quotes
    FROM (SELECT 1) AS dummy
  )
  SELECT jsonb_build_object(
    'timestamp', now(),
    'system_status', CASE
      WHEN o.completed_unsettled_count = 0
       AND o.cancelled_unrefunded_count = 0
       AND w.negative_wallets_count = 0
       AND v.wallet_ledger_variance_count = 0
      THEN 'healthy'
      ELSE 'warning_detected'
    END,
    'order_health', jsonb_build_object(
      'total_orders', o.total_orders,
      'completed_orders', o.completed_orders,
      'cancelled_orders', o.cancelled_orders,
      'completed_unsettled_count', o.completed_unsettled_count,
      'cancelled_unrefunded_count', o.cancelled_unrefunded_count
    ),
    'wallet_health', jsonb_build_object(
      'total_wallets', w.total_wallets,
      'negative_wallets_count', w.negative_wallets_count,
      'total_wallet_balance_sum', w.total_wallet_balance_sum
    ),
    'ledger_health', jsonb_build_object(
      'total_ledger_entries', l.total_ledger_entries,
      'total_ledger_amount_sum', l.total_ledger_amount_sum
    ),
    'variance_health', jsonb_build_object(
      'wallet_ledger_variance_count', v.wallet_ledger_variance_count
    ),
    'entity_counts', jsonb_build_object(
      'total_profiles', e.total_profiles,
      'total_user_roles', e.total_user_roles,
      'total_restaurants', e.total_restaurants,
      'total_riders', e.total_riders,
      'total_pending_requests', e.total_pending_requests,
      'total_service_quotes', e.total_service_quotes
    )
  ) INTO v_result
  FROM order_health o, wallet_health w, ledger_health l, variance_health v, entity_counts e;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_system_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_system_health() TO authenticated, service_role;

-- ── Admin Caretaker Repair RPCs ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reconcile_wallet_ledger(p_target_user_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_rec RECORD;
  v_reconciled_count INT := 0;
  v_details JSONB := '[]'::jsonb;
  v_ledger_sum NUMERIC;
  v_wallet_bal NUMERIC;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT w.user_id, w.balance
    FROM public.wallets w
    WHERE p_target_user_id IS NULL OR w.user_id = p_target_user_id
  LOOP
    SELECT ROUND(COALESCE(SUM(amount), 0), 2)
    INTO v_ledger_sum
    FROM public.wallet_ledger_entries
    WHERE user_id = v_rec.user_id;

    v_wallet_bal := ROUND(COALESCE(v_rec.balance, 0), 2);

    IF v_wallet_bal <> v_ledger_sum THEN
      UPDATE public.wallets
      SET balance = v_ledger_sum
      WHERE user_id = v_rec.user_id;

      v_reconciled_count := v_reconciled_count + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_rec.user_id,
        'old_balance', v_wallet_bal,
        'new_balance', v_ledger_sum,
        'difference', ROUND(v_ledger_sum - v_wallet_bal, 2)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reconciled_count', v_reconciled_count, 'details', v_details);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_wallet_ledger(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_wallet_ledger(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_retry_stuck_order_settlement(p_target_order_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_rec RECORD;
  v_settled_count INT := 0;
  v_failed_count INT := 0;
  v_settled_ids JSONB := '[]'::jsonb;
  v_res JSONB;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT id
    FROM public.orders
    WHERE COALESCE(data->>'status', status, '') = 'completed'
      AND COALESCE(data->>'settlementStatus', '') <> 'settled'
      AND (p_target_order_id IS NULL OR id = p_target_order_id)
  LOOP
    BEGIN
      v_res := public.process_order_settlement(v_rec.id);
      IF COALESCE((v_res->>'ok')::boolean, false) THEN
        v_settled_count := v_settled_count + 1;
        v_settled_ids := v_settled_ids || jsonb_build_object('order_id', v_rec.id, 'status', 'settled');
      ELSE
        v_failed_count := v_failed_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
    END BEGIN;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'settled_count', v_settled_count, 'failed_count', v_failed_count, 'details', v_settled_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retry_stuck_order_settlement(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_stuck_order_settlement(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_execute_ai_suggested_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_action RECORD;
  v_result JSONB;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_action
  FROM public.ai_suggested_actions
  WHERE id = p_action_id
  FOR UPDATE;

  IF v_action.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_not_found');
  END IF;

  IF v_action.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_already_processed', 'status', v_action.status);
  END IF;

  IF v_action.action_type = 'reconcile_wallet' OR v_action.action_type = 'audit_negative_wallets' THEN
    v_result := public.admin_reconcile_wallet_ledger(v_action.target_id);
  ELSIF v_action.action_type = 'settle_stuck_order' THEN
    v_result := public.admin_retry_stuck_order_settlement(v_action.target_id);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_action_type');
  END IF;

  UPDATE public.ai_suggested_actions
  SET status = 'executed',
      executed_at = NOW(),
      executed_by = (SELECT auth.uid())
  WHERE id = p_action_id;

  RETURN jsonb_build_object('ok', true, 'action_id', p_action_id, 'action_type', v_action.action_type, 'execution_result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_execute_ai_suggested_action(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_execute_ai_suggested_action(UUID) TO authenticated, service_role;
