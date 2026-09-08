BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_order_atomic(
  p_order_id TEXT,
  p_reason TEXT DEFAULT 'ยกเลิกออเดอร์'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order JSONB;
  v_customer_id TEXT;
  v_total NUMERIC;
  v_method TEXT;
  v_rider_id TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT data INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  v_customer_id := COALESCE(v_order->>'customerId', v_order->>'userId');
  IF NOT public.is_admin(auth.uid()) AND auth.uid()::TEXT <> v_customer_id THEN
    RAISE EXCEPTION 'cancel_access_denied' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_order->>'settlementStatus', '') = 'settled'
     OR COALESCE(v_order->>'status', '') = 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_completed');
  END IF;

  IF COALESCE(v_order->>'status', '') = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_cancelled',
      'refunded', COALESCE(v_order->>'refundStatus', '') = 'refunded');
  END IF;

  v_method := COALESCE(v_order->>'paymentMethod', 'cash');
  v_total := COALESCE((v_order->>'grandTotal')::NUMERIC, 0);
  v_rider_id := v_order->>'riderId';

  IF v_method = 'wallet' AND v_total > 0 THEN
    PERFORM public._wallet_credit(v_customer_id, v_total, p_order_id, 'คืนเงิน: ยกเลิกออเดอร์');
    v_order := v_order || jsonb_build_object('refundStatus', 'refunded', 'refundAmount', v_total);
  END IF;

  v_order := v_order || jsonb_build_object(
    'status', 'cancelled',
    'cancelReason', LEFT(COALESCE(p_reason, 'ยกเลิกออเดอร์'), 300),
    'cancelledAtMs', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );

  UPDATE public.orders SET status = 'cancelled', data = v_order WHERE id = p_order_id;
  IF v_rider_id IS NOT NULL THEN
    UPDATE public.riders SET is_available = TRUE WHERE id = v_rider_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order', v_order,
    'refunded', v_method = 'wallet' AND v_total > 0, 'refundAmount', CASE WHEN v_method = 'wallet' THEN v_total ELSE 0 END);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_atomic(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_atomic(TEXT, TEXT) TO authenticated;

COMMIT;
