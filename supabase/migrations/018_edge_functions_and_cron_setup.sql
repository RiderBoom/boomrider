-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Migration 018: Edge Functions & Cron Integration Setup
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable pg_net and pg_cron extensions if available on Supabase plan
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 1. Scheduled Cron Job: Cleanup Expired Job Offers ─────────────────────────
-- Calls process_expired_offers() every 30 seconds to clean up timed out offers
-- and re-dispatch pending orders even if client devices are offline.

SELECT cron.schedule(
  'process-expired-job-offers',
  '30 seconds',
  $$ SELECT process_expired_offers(); $$
);

-- ── 2. Helper to Invoke process-expired-offers Edge Function via pg_net ───────
CREATE OR REPLACE FUNCTION trigger_process_expired_offers_edge_function()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Perform HTTP POST to Edge Function endpoint using pg_net
  PERFORM net.http_post(
    url := (SELECT current_setting('app.settings.supabase_url', true) || '/functions/v1/process-expired-offers'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT current_setting('app.settings.supabase_anon_key', true))
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  -- Fallback: execute local stored procedure if HTTP trigger fails
  PERFORM process_expired_offers();
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION trigger_process_expired_offers_edge_function() TO service_role;
