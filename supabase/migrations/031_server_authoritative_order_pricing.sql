-- ══════════════════════════════════════════════════════════════════════════════
-- 031_server_authoritative_order_pricing.sql
-- 1. Hardens Customer Order Placement with Server-Authoritative Pricing & Validation
-- 2. Prevents Price, Fee, GP, Status, Promo, Option, and Identity Tampering from Malicious Clients
-- 3. Implements Idempotent Order Creation & Idempotency Safeguards
-- 4. Fixes approve_pending_request Edge Cases for Unsupported Request Types
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Server-Authoritative Customer Order Placement RPC ──────────────────────

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
  -- If caller is admin, allow customerId override from client payload if provided, otherwise lock to auth.uid()
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
    -- Check if existing order belongs to the same user
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

  -- Server-authoritative initial status
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

    -- Fetch DB Menu Items for Restaurant
    SELECT items INTO v_menu_items_json
    FROM public.menu_items
    WHERE restaurant_id = v_restaurant_id;

    IF v_menu_items_json IS NULL OR jsonb_array_length(v_menu_items_json) = 0 THEN
      -- Fallback to restaurants table data JSONB
      SELECT data->'menu' INTO v_menu_items_json
      FROM public.restaurants
      WHERE id = v_restaurant_id;
    END IF;

    v_req_items := p_order->'items';
    IF v_req_items IS NULL OR jsonb_array_length(v_req_items) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'EMPTY_FOOD_ORDER');
    END IF;

    -- Iterate and validate each food item against DB menu
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

      -- Find item in DB menu_items array
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

      -- Check item availability
      IF COALESCE((v_db_item->>'available')::BOOLEAN, true) = false THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ITEM_UNAVAILABLE', 'itemName', v_db_item->>'name');
      END IF;

      v_db_base_price := COALESCE((v_db_item->>'price')::NUMERIC, 0);
      v_db_opts_extra := 0;
      v_sel_opts := v_req_item->'selectedOptions';

      -- Strict option validation against DB menu item options
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

          -- Reject options not found in DB menu item options list to prevent price manipulation
          IF NOT v_matched_opt THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_OPTION', 'optionName', v_opt_elem->>'name');
          END IF;
        END LOOP;
      END IF;

      v_item_unit_price := ROUND(v_db_base_price + v_db_opts_extra, 2);
      v_item_subtotal   := ROUND(v_item_unit_price * v_qty, 2);
      v_calc_food_total := v_calc_food_total + v_item_subtotal;

      -- Build authoritative item entry
      v_auth_items := v_auth_items || jsonb_build_object(
        'id', v_item_id,
        'originalId', v_orig_id,
        'name', COALESCE(v_db_item->>'name', v_req_item->>'name'),
        'price', v_item_unit_price,
        'qty', v_qty,
        'selectedOptions', COALESCE(v_sel_opts, '[]'::jsonb)
      );
    END LOOP;

    -- Authoritative Promo Code Validation
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
    v_calc_deliv_fee := 350; -- Default base service price
    v_matched_service := false;

    -- Look up service price in DB extraServices config array
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
    -- Ensure customer wallet row exists
    INSERT INTO public.wallets (user_id, balance, history)
    VALUES (v_cust_uid, 0, '[]'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    -- Lock wallet row FOR UPDATE
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


-- ── 2. Hardened Admin Pending Request Approval RPC ────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_pending_request(p_request_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_req_data JSONB;
  v_req_type TEXT;
  v_user_id TEXT;
  v_amt NUMERIC;
  v_wallet RECORD;
  v_bal NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- Lock request FOR UPDATE
  SELECT * INTO v_req
  FROM public.pending_requests
  WHERE id = p_request_id
  FOR UPDATE NOWAIT;

  IF v_req IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  v_req_data := v_req.data;
  v_req_type := LOWER(COALESCE(v_req.type, v_req_data->>'type', ''));
  v_user_id  := COALESCE(v_req.user_id, v_req_data->>'userId');

  -- Ensure request type is supported
  IF v_req_type NOT IN ('topup', 'withdraw') THEN
    -- Leave pending request untouched in database and return structured error
    RETURN jsonb_build_object('ok', false, 'reason', 'UNSUPPORTED_REQUEST_TYPE', 'type', v_req_type);
  END IF;

  IF v_user_id IS NULL OR v_user_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_USER_ID');
  END IF;

  IF v_req_type = 'topup' THEN
    v_amt := COALESCE((v_req_data->'data'->>'amount')::NUMERIC, (v_req_data->>'amount')::NUMERIC, 0);
    IF v_amt <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_topup_amount');
    END IF;

    PERFORM public._wallet_credit(
      v_user_id, v_amt, NULL,
      'เติมเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );

  ELSIF v_req_type = 'withdraw' THEN
    v_amt := COALESCE((v_req_data->'data'->>'amount')::NUMERIC, (v_req_data->>'amount')::NUMERIC, 0);
    IF v_amt <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_withdraw_amount');
    END IF;

    -- Ensure wallet exists
    INSERT INTO public.wallets (user_id, balance, history)
    VALUES (v_user_id, 0, '[]'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_user_id
    FOR UPDATE;

    v_bal := COALESCE(v_wallet.balance, 0);
    IF v_bal < v_amt THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_WALLET_BALANCE',
        'currentBalance', v_bal,
        'requestedAmount', v_amt
      );
    END IF;

    PERFORM public._wallet_credit(
      v_user_id, -v_amt, NULL,
      'ถอนเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );
  END IF;

  -- Remove processed request
  DELETE FROM public.pending_requests WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'type', v_req_type);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'concurrent_approval_in_progress');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_request(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pending_request(TEXT) TO authenticated;

COMMIT;
