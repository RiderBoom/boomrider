-- Migration 045: Optimize orders REPLICA IDENTITY for Realtime & Webhook Egress Efficiency
-- Sets REPLICA IDENTITY FULL on public.orders so database webhooks and Realtime
-- receive full previous row state (old_record.status and old_record.data), allowing
-- edge functions and realtime listeners to skip redundant notifications and queries on location updates.

ALTER TABLE public.orders REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
