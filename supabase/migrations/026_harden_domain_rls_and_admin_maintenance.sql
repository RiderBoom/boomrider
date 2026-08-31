-- Complete domain-table RLS hardening. No business rows are changed on apply.
BEGIN;

-- Restaurants remain publicly readable, but only their owner/admin may write.
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "restaurants_write" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_all" ON public.restaurants;
CREATE POLICY "restaurants_owner_insert" ON public.restaurants FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid()::text OR public.is_admin(auth.uid()));
CREATE POLICY "restaurants_owner_update" ON public.restaurants FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()::text OR public.is_admin(auth.uid()))
  WITH CHECK (owner_id = auth.uid()::text OR public.is_admin(auth.uid()));
CREATE POLICY "restaurants_admin_delete" ON public.restaurants FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "menu_items_write" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_all" ON public.menu_items;
CREATE POLICY "menu_items_owner_write" ON public.menu_items FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = menu_items.restaurant_id AND r.owner_id = auth.uid()::text
  ))
  WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = menu_items.restaurant_id AND r.owner_id = auth.uid()::text
  ));

-- Rider directory is available to signed-in app users. Mutations are self/admin.
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "riders_all" ON public.riders;
DROP POLICY IF EXISTS "riders_select" ON public.riders;
CREATE POLICY "riders_authenticated_select" ON public.riders FOR SELECT TO authenticated USING (true);
CREATE POLICY "riders_admin_insert" ON public.riders FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "riders_self_update" ON public.riders FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text OR data->>'userId' = auth.uid()::text OR public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid()::text OR data->>'userId' = auth.uid()::text OR public.is_admin(auth.uid()));
CREATE POLICY "riders_admin_delete" ON public.riders FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Replace every historical orders policy so permissive policies cannot combine.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='orders'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', p.policyname); END LOOP;
END $$;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_participant_select" ON public.orders FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR auth.uid()::text IN (
    COALESCE(data->>'customerId',''), COALESCE(data->>'userId',''),
    COALESCE(data->>'restaurantOwnerId',''), COALESCE(data->>'riderUserId','')
  )
  OR (status IN ('pending','preparing','ready_to_pickup') AND EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='rider'
  ))
);
CREATE POLICY "orders_customer_insert" ON public.orders FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin(auth.uid()) OR
  (COALESCE(data->>'customerId', data->>'userId') = auth.uid()::text
   AND status IN ('pending','ready_to_pickup'))
);
CREATE POLICY "orders_participant_update" ON public.orders FOR UPDATE TO authenticated
USING (
  public.is_admin(auth.uid()) OR auth.uid()::text IN (
    COALESCE(data->>'customerId',''), COALESCE(data->>'userId',''),
    COALESCE(data->>'restaurantOwnerId',''), COALESCE(data->>'riderUserId','')
  )
)
WITH CHECK (
  public.is_admin(auth.uid()) OR auth.uid()::text IN (
    COALESCE(data->>'customerId',''), COALESCE(data->>'userId',''),
    COALESCE(data->>'restaurantOwnerId',''), COALESCE(data->>'riderUserId','')
  )
);
CREATE POLICY "orders_admin_delete" ON public.orders FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- RLS determines which rows are reachable; this trigger prevents reachable rows
-- from having ownership or financial identity rewritten inside the JSON payload.
CREATE OR REPLACE FUNCTION public.protect_order_security_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role()='service_role' OR public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF (NEW.data->'customerId') IS DISTINCT FROM (OLD.data->'customerId')
     OR (NEW.data->'userId') IS DISTINCT FROM (OLD.data->'userId')
     OR (NEW.data->'restaurantId') IS DISTINCT FROM (OLD.data->'restaurantId')
     OR (NEW.data->'restaurantOwnerId') IS DISTINCT FROM (OLD.data->'restaurantOwnerId')
     OR (NEW.data->'grandTotal') IS DISTINCT FROM (OLD.data->'grandTotal')
     OR (NEW.data->'paymentMethod') IS DISTINCT FROM (OLD.data->'paymentMethod')
     OR (NEW.data->'type') IS DISTINCT FROM (OLD.data->'type')
  THEN RAISE EXCEPTION 'immutable_order_fields_changed' USING ERRCODE='42501'; END IF;
  IF ((NEW.data->'riderId') IS DISTINCT FROM (OLD.data->'riderId')
      OR (NEW.data->'riderUserId') IS DISTINCT FROM (OLD.data->'riderUserId'))
     AND NOT (
       NEW.data->>'riderUserId'=auth.uid()::text AND EXISTS (
         SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='rider'
       )
     )
  THEN RAISE EXCEPTION 'rider_assignment_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_order_security_fields_trigger ON public.orders;
CREATE TRIGGER protect_order_security_fields_trigger BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_order_security_fields();
REVOKE ALL ON FUNCTION public.protect_order_security_fields() FROM PUBLIC;

-- Only the targeted rider/admin sees offers; responses use a checked RPC.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='job_offers'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_offers', p.policyname); END LOOP;
END $$;
ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_offers_owner_select" ON public.job_offers FOR SELECT TO authenticated
  USING (rider_user_id=auth.uid()::text OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.respond_job_offer(p_offer_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_status NOT IN ('rejected','timeout') THEN RAISE EXCEPTION 'invalid_offer_status'; END IF;
  UPDATE public.job_offers
  SET status=p_status, responded_at=now()
  WHERE id=p_offer_id AND rider_user_id=auth.uid()::text AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_access_denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.respond_job_offer(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_job_offer(uuid,text) TO authenticated;

-- Chat rows follow order participation. Message writes already use guarded RPC.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='chats'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.chats', p.policyname); END LOOP;
END $$;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chats_participant_select" ON public.chats FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id=chats.order_id AND auth.uid()::text IN (
    COALESCE(o.data->>'customerId',''), COALESCE(o.data->>'userId',''),
    COALESCE(o.data->>'restaurantOwnerId',''), COALESCE(o.data->>'riderUserId','')
  )
));
CREATE POLICY "chats_participant_delete" ON public.chats FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id=chats.order_id
  AND COALESCE(o.data->>'customerId',o.data->>'userId')=auth.uid()::text
));

-- Admin maintenance keeps destructive dashboard actions authorized server-side.
CREATE OR REPLACE FUNCTION public.admin_purge_app_data(p_scope text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  CASE p_scope
    WHEN 'orders' THEN DELETE FROM public.orders;
    WHEN 'pending_requests' THEN DELETE FROM public.pending_requests;
    WHEN 'restaurants' THEN DELETE FROM public.menu_items; DELETE FROM public.restaurants;
    WHEN 'riders' THEN DELETE FROM public.riders;
    WHEN 'wallets' THEN DELETE FROM public.wallets;
    WHEN 'wallet_history' THEN UPDATE public.wallets SET history='[]'::jsonb;
    ELSE RAISE EXCEPTION 'invalid_purge_scope';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.admin_purge_app_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_app_data(text) TO authenticated;

COMMIT;

