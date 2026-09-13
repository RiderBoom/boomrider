-- Server-authoritative non-financial order status transitions.
-- Acceptance, cancellation, and settlement keep using their dedicated atomic RPCs.

CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id text,
  p_new_status text,
  p_extra_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor text := auth.uid()::text;
  v_current_status text;
  v_merchant_id text;
  v_rider_user_id text;
  v_is_admin boolean;
  v_safe_extra jsonb;
  v_updated_data jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  v_is_admin := public.is_admin(auth.uid());
  v_current_status := COALESCE(NULLIF(v_order.data->>'status', ''), v_order.status);

  SELECT COALESCE(NULLIF(v_order.data->>'restaurantOwnerId', ''), NULLIF(r.owner_id, ''), NULLIF(r.data->>'ownerId', ''))
  INTO v_merchant_id
  FROM public.restaurants r
  WHERE r.id = v_order.data->>'restaurantId'
  LIMIT 1;

  SELECT COALESCE(NULLIF(v_order.data->>'riderUserId', ''), NULLIF(r.user_id, ''), NULLIF(r.data->>'userId', ''))
  INTO v_rider_user_id
  FROM public.riders r
  WHERE r.id = v_order.data->>'riderId'
  LIMIT 1;

  IF p_new_status NOT IN ('preparing', 'ready_to_pickup', 'picking_up', 'delivering', 'delivered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_status_transition');
  END IF;

  IF NOT v_is_admin THEN
    IF p_new_status IN ('preparing', 'ready_to_pickup') THEN
      IF v_merchant_id IS DISTINCT FROM v_actor THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'merchant_required');
      END IF;
    ELSIF v_rider_user_id IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'assigned_rider_required');
    END IF;
  END IF;

  IF NOT v_is_admin AND NOT (
    (v_current_status = 'pending' AND p_new_status = 'preparing') OR
    (v_current_status = 'preparing' AND p_new_status = 'ready_to_pickup') OR
    (v_current_status = 'rider_accepted' AND p_new_status = 'picking_up') OR
    (v_current_status = 'picking_up' AND p_new_status = 'delivering') OR
    (v_current_status = 'delivering' AND p_new_status = 'delivered')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status_transition');
  END IF;

  v_safe_extra := COALESCE(p_extra_data, '{}'::jsonb)
    - ARRAY[
      'id', 'status', 'customerId', 'customerName', 'customerPhone',
      'restaurantId', 'restaurantOwnerId', 'riderId', 'riderUserId',
      'paymentMethod', 'grandTotal', 'deliveryFee', 'foodTotal', 'items',
      'settlementStatus', 'adminGP', 'merchantIncome', 'riderIncome'
    ];

  v_updated_data := v_order.data || v_safe_extra || jsonb_build_object('status', p_new_status);

  UPDATE public.orders
  SET status = p_new_status,
      data = v_updated_data
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'order_data', v_updated_data);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(text, text, jsonb) TO authenticated;
