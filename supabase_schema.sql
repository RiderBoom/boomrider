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

-- ── Enable Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.admin_notifs;
alter publication supabase_realtime add table public.chats;
alter publication supabase_realtime add table public.pending_requests;
alter publication supabase_realtime add table public.wallets;

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

  -- DB Config & Pricing Parameters
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

  -- Promo Validation
  v_promo_code_str    TEXT;
  v_promo_row         RECORD;
  v_promo_data        JSONB;
  v_promo_type        TEXT;
  v_promo_val         NUMERIC := 0;
  v_promo_min_order   NUMERIC := 0;
  v_promo_max_disc    NUMERIC := 9999;
  v_promo_max_uses    INT := 100;
  v_promo_used_cnt    INT := 0;
  v_promo_active      BOOLEAN := true;

  -- Financial Calculations
  v_calc_food_total   NUMERIC := 0;
  v_calc_deliv_fee    NUMERIC := 0;
  v_promo_discount    NUMERIC := 0;
  v_calc_grand_total  NUMERIC := 0;
  v_admin_gp          NUMERIC := 0;
  v_rider_income      NUMERIC := 0;
  v_distance          NUMERIC := 1;
  v_service_cat       TEXT;
  v_service_elem      JSONB;
  v_matched_service   BOOLEAN := false;

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

  -- 4. Payment Method Validation
  v_method := LOWER(COALESCE(p_order->>'paymentMethod', 'cash'));
  IF v_method NOT IN ('cash', 'wallet', 'online') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_PAYMENT_METHOD');
  END IF;

  -- 5. Order Type Validation & Status Hardening
  v_type := LOWER(COALESCE(p_order->>'type', 'food'));
  IF v_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ORDER_TYPE');
  END IF;

  IF v_type = 'food' THEN
    v_status := 'pending';
  ELSE
    v_status := 'ready_to_pickup';
  END IF;

  -- 6. Load DB App Config for Authoritative Rates & Fees
  SELECT data INTO v_config_data FROM public.app_config WHERE id = 1;

  IF v_config_data IS NOT NULL THEN
    v_base_fee       := COALESCE((v_config_data->>'baseFee')::NUMERIC, 20);
    v_per_km_fee     := COALESCE((v_config_data->>'perKmFee')::NUMERIC, 10);
    v_ride_base_fee  := COALESCE((v_config_data->>'rideBaseFee')::NUMERIC, v_base_fee);
    v_ride_per_km_fee := COALESCE((v_config_data->>'ridePerKmFee')::NUMERIC, v_per_km_fee);

    v_gp_food_rate   := COALESCE((v_config_data->>'gpFood')::NUMERIC, 30) / 100.0;
    v_gp_deliv_rate  := COALESCE((v_config_data->>'gpDelivery')::NUMERIC, 15) / 100.0;
    v_gp_ride_rate   := COALESCE((v_config_data->>'gpRide')::NUMERIC, 15) / 100.0;
    v_gp_service_rate := COALESCE((v_config_data->>'gpService')::NUMERIC, 15) / 100.0;
    v_extra_services := v_config_data->'extraServices';
  END IF;

  -- 7. Authoritative Pricing Calculation by Order Type
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

      IF v_qty <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_QUANTITY');
      END IF;
      IF v_qty > 100 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'QUANTITY_EXCEEDS_LIMIT');
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

    v_promo_discount := 0;
    v_promo_code_str := UPPER(TRIM(COALESCE(p_order->>'promoCode', '')));

    IF v_promo_code_str <> '' THEN
      SELECT * INTO v_promo_row
      FROM public.promo_codes
      WHERE UPPER(data->>'code') = v_promo_code_str;

      IF v_promo_row.id IS NOT NULL THEN
        v_promo_data     := v_promo_row.data;
        v_promo_active   := COALESCE((v_promo_data->>'active')::BOOLEAN, true);
        v_promo_type     := LOWER(COALESCE(v_promo_data->>'type', 'percent'));
        v_promo_val      := COALESCE((v_promo_data->>'value')::NUMERIC, 0);
        v_promo_min_order := COALESCE((v_promo_data->>'minOrder')::NUMERIC, 0);
        v_promo_max_disc := COALESCE((v_promo_data->>'maxDiscount')::NUMERIC, 9999);
        v_promo_max_uses := COALESCE((v_promo_data->>'maxUses')::INT, 100);
        v_promo_used_cnt := COALESCE((v_promo_data->>'usedCount')::INT, 0);

        IF v_promo_active AND v_promo_used_cnt < v_promo_max_uses AND v_calc_food_total >= v_promo_min_order THEN
          IF v_promo_type = 'percent' THEN
            v_promo_discount := LEAST(ROUND(v_calc_food_total * (v_promo_val / 100.0), 2), v_promo_max_disc);
          ELSE
            v_promo_discount := LEAST(v_promo_val, v_calc_food_total);
          END IF;
        END IF;
      END IF;
    END IF;

    v_distance       := GREATEST(0, COALESCE((p_order->>'distance')::NUMERIC, 1));
    v_calc_deliv_fee := v_base_fee + (CEIL(v_distance) * v_per_km_fee);
    v_calc_grand_total := GREATEST(0, v_calc_food_total + v_calc_deliv_fee - v_promo_discount);

    v_admin_gp     := ROUND(v_calc_food_total * v_gp_food_rate, 2);
    v_rider_income := v_calc_deliv_fee;

  ELSIF v_type = 'parcel' THEN
    v_distance       := GREATEST(0, COALESCE((p_order->>'distance')::NUMERIC, (p_order->'parcelDetails'->>'distance')::NUMERIC, 1));
    v_calc_food_total := 0;
    v_calc_deliv_fee := v_base_fee + (CEIL(v_distance) * v_per_km_fee);
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := ROUND(v_calc_grand_total * v_gp_deliv_rate, 2);
    v_rider_income   := ROUND(v_calc_grand_total - v_admin_gp, 2);

  ELSIF v_type = 'ride' THEN
    v_distance       := GREATEST(0, COALESCE((p_order->>'distance')::NUMERIC, 1));
    v_calc_food_total := 0;
    v_calc_deliv_fee := v_ride_base_fee + (CEIL(v_distance) * v_ride_per_km_fee);
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := ROUND(v_calc_grand_total * v_gp_ride_rate, 2);
    v_rider_income   := ROUND(v_calc_grand_total - v_admin_gp, 2);

  ELSIF v_type = 'service' THEN
    v_service_cat := p_order->>'serviceCategory';
    v_calc_deliv_fee := 350;
    v_matched_service := false;

    IF v_extra_services IS NOT NULL AND jsonb_array_length(v_extra_services) > 0 THEN
      FOR i IN 0..jsonb_array_length(v_extra_services) - 1 LOOP
        v_service_elem := v_extra_services->i;
        IF (v_service_elem->>'name') = v_service_cat THEN
          v_calc_deliv_fee := COALESCE((v_service_elem->>'price')::NUMERIC, 350);
          v_matched_service := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    v_calc_food_total := 0;
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := ROUND(v_calc_grand_total * v_gp_service_rate, 2);
    v_rider_income   := ROUND(v_calc_grand_total - v_admin_gp, 2);
  END IF;

  -- 8. Wallet Balance Deduction (Atomic Transaction)
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

  -- 9. Construct Authoritative Order Payload
  v_final_order := p_order || jsonb_build_object(
    'id', v_order_id,
    'type', v_type,
    'status', v_status,
    'customerId', v_cust_uid,
    'paymentMethod', v_method,
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

  -- 10. Persist Authoritative Order to Database
  INSERT INTO public.orders (id, status, data)
  VALUES (v_order_id, v_status, v_final_order);

  -- 11. Return Response
  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
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
