-- ══════════════════════════════════════════════════════════════════════════════
-- Fix FCFS accept_job_offer bug and 42501 RLS Policies
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Fix accept_job_offer RPC (FCFS Bug) ────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_job_offer(p_offer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
BEGIN
  -- 1. Read the offer first without lock
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id;

  -- Verify offer exists and is still pending
  IF v_offer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_found');
  END IF;

  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  IF v_offer.expires_at < now() THEN
     RETURN jsonb_build_object('ok', false, 'reason', 'offer_expired');
  END IF;

  -- 2. Lock the parent order to serialize all concurrent accept attempts globally
  PERFORM 1 FROM orders WHERE id = v_offer.order_id FOR UPDATE;

  -- 3. Lock the specific offer
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  -- Verify offer is still pending after acquiring lock
  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  -- Double check that no one else has accepted THIS ORDER yet
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = v_offer.order_id AND status = 'accepted' AND id != p_offer_id
  ) THEN
    -- Someone else beat them to it. Mark this one as missed.
    UPDATE job_offers
    SET status = 'missed', responded_at = now()
    WHERE id = p_offer_id;

    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted_by_other');
  END IF;

  -- ── All good! Accept this offer ──────────────────────────────────────────
  UPDATE job_offers
  SET status = 'accepted', responded_at = now()
  WHERE id = p_offer_id;

  -- Mark all OTHER pending offers for this order as 'missed'
  UPDATE job_offers
  SET status = 'missed', responded_at = now()
  WHERE order_id = v_offer.order_id
    AND id != p_offer_id
    AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'order_id', v_offer.order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION accept_job_offer(UUID) TO authenticated;

-- ── 2. Fix restaurants RLS (Error 42501) ──────────────────────────────────────
DROP POLICY IF EXISTS "restaurants_all" ON public.restaurants;

CREATE POLICY "restaurants_all" ON public.restaurants FOR ALL TO authenticated
USING (
  owner_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  owner_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── 3. Fix menu_items RLS (Error 42501) ───────────────────────────────────────
-- Ensure merchants can create menu items even if restaurant is created in same txn
DROP POLICY IF EXISTS "menu_items_all" ON public.menu_items;

CREATE POLICY "menu_items_all" ON public.menu_items FOR ALL TO authenticated
USING (
  (EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  )) OR
  (menu_items.restaurant_id = auth.uid()::text) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  (EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  )) OR
  (menu_items.restaurant_id = auth.uid()::text) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── 4. Fix app_config RLS (Error 42501) ───────────────────────────────────────
DROP POLICY IF EXISTS "app_config_all" ON public.app_config;

-- Admins can do anything
CREATE POLICY "app_config_all" ON public.app_config FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── 5. Ensure Orders table RLS allows proper UPDATE ───────────────────────────
DROP POLICY IF EXISTS "orders_all" ON public.orders;

CREATE POLICY "orders_all" ON public.orders FOR ALL TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
