-- Migration 041: Ensure admin_set_user_role function permissions and RLS policies.
-- Fixes permission issues when admins approve merchant or rider registrations.

BEGIN;

-- Ensure is_admin function is defined and executable
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

-- Ensure admin_set_user_role SECURITY DEFINER function is executable by authenticated users
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_role NOT IN ('customer', 'merchant', 'rider', 'admin') THEN
    RAISE EXCEPTION 'invalid_role_request' USING ERRCODE = '22023';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF p_user_id = auth.uid() AND p_role = 'admin' THEN
      RAISE EXCEPTION 'cannot_remove_own_admin_role' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, boolean) TO authenticated;

COMMIT;
