-- Production Health & Schema-Drift Safety Check (SELECT-only)
-- Returns aggregate health metrics and system row counts. Zero PII exposed.

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
) AS health_summary
FROM order_health o, wallet_health w, ledger_health l, variance_health v, entity_counts e;
