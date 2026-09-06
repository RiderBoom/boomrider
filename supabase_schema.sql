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

-- ── User Roles ────────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  user_id uuid not null,
  role text not null,
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;

-- ── Wallets (user_id TEXT to support admin email keying) ─────────────────────
create table if not exists public.wallets (
  user_id text primary key,
  balance numeric default 0,
  history jsonb default '[]'::jsonb
);
alter table public.wallets enable row level security;

-- ── Orders ────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id text primary key,
  status text,
  data jsonb not null,
  created_at timestamptz default now()
);
alter table public.orders enable row level security;

-- ── Restaurants ───────────────────────────────────────────────────────────────
create table if not exists public.restaurants (
  id text primary key,
  owner_id text,
  data jsonb not null
);
alter table public.restaurants enable row level security;

-- ── Menu Items (one JSONB array per restaurant) ───────────────────────────────
create table if not exists public.menu_items (
  restaurant_id text primary key,
  items jsonb default '[]'::jsonb
);
alter table public.menu_items enable row level security;

-- ── Riders ────────────────────────────────────────────────────────────────────
create table if not exists public.riders (
  id text primary key,
  user_id text,
  data jsonb not null,
  is_available boolean default true,
  current_lat float,
  current_lng float
);
alter table public.riders enable row level security;

-- ── Pending Requests ──────────────────────────────────────────────────────────
create table if not exists public.pending_requests (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
alter table public.pending_requests enable row level security;

-- ── Chats ─────────────────────────────────────────────────────────────────────
create table if not exists public.chats (
  order_id text primary key,
  messages jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table public.chats enable row level security;

-- ── Promo Codes ───────────────────────────────────────────────────────────────
create table if not exists public.promo_codes (
  id text primary key,
  data jsonb not null
);
alter table public.promo_codes enable row level security;

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

-- ── App Config (single row) ───────────────────────────────────────────────────
create table if not exists public.app_config (
  id integer primary key default 1,
  data jsonb not null,
  constraint app_config_single_row check (id = 1)
);
alter table public.app_config enable row level security;

-- ── Job Offers ────────────────────────────────────────────────────────────────
create table if not exists public.job_offers (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  rider_id text not null,
  rider_user_id text,
  attempt_no int default 1,
  status text default 'pending',
  distance_km numeric,
  offered_at timestamptz default now(),
  responded_at timestamptz,
  expires_at timestamptz default (now() + interval '30 seconds')
);
alter table public.job_offers enable row level security;

-- ── Push Devices ──────────────────────────────────────────────────────────────
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_devices_user_token_key unique (user_id, token)
);
alter table public.push_devices enable row level security;

-- ── Notification Deliveries ───────────────────────────────────────────────────
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  user_id text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  delivered_at timestamptz not null default now()
);
alter table public.notification_deliveries enable row level security;

-- ── Enable Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.admin_notifs;
alter publication supabase_realtime add table public.chats;
alter publication supabase_realtime add table public.pending_requests;
alter publication supabase_realtime add table public.wallets;
alter publication supabase_realtime add table public.job_offers;

-- ── Helper RPC: is_admin ──────────────────────────────────────────────────────
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return false; end if;
  return exists (
    select 1 from public.user_roles where user_id = p_user_id and role = 'admin'
  );
end;
$$;
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ── Helper RPC: _wallet_credit ────────────────────────────────────────────────
create or replace function public._wallet_credit(
  p_user_id text,
  p_amount numeric,
  p_order_id text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_uid text;
begin
  if p_user_id is null or p_user_id = '' or p_user_id = 'null' or p_amount = 0 then
    return;
  end if;

  if p_user_id like '%@%' then
    select id::text into v_uid from public.profiles where lower(email) = lower(p_user_id) limit 1;
    if v_uid is null then v_uid := p_user_id; end if;
  else
    v_uid := p_user_id;
  end if;

  if v_uid is null or v_uid = '' or v_uid = 'null' then
    return;
  end if;

  v_entry := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', case when p_amount >= 0 then 'deposit' else 'withdraw' end,
    'amount', p_amount,
    'date', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
    'desc', coalesce(p_note, case when p_amount > 0 then 'Wallet Topup' else 'Wallet Withdrawal' end),
    'refOrderId', p_order_id,
    'createdAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  insert into public.wallets (user_id, balance, history)
  values (v_uid, p_amount, jsonb_build_array(v_entry))
  on conflict (user_id) do update
    set balance = public.wallets.balance + excluded.balance,
        history = (jsonb_build_array(v_entry) || coalesce(public.wallets.history, '[]'::jsonb));
end;
$$;
revoke all on function public._wallet_credit(text, numeric, text, text) from public;

-- ── RPC: js_credit_wallet ─────────────────────────────────────────────────────
create or replace function public.js_credit_wallet(
  p_user_id text,
  p_amount numeric,
  p_entry jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_current numeric;
  v_is_admin boolean := public.is_admin(auth.uid());
  v_entry jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_user_id is null or btrim(p_user_id) = '' or p_amount is null or p_amount = 0 then
    raise exception 'invalid_wallet_adjustment' using errcode = '22023';
  end if;

  if p_user_id like '%@%' then
    select id::text into v_uid from public.profiles where lower(email) = lower(p_user_id) limit 1;
  else
    v_uid := p_user_id;
  end if;

  if v_uid is null then
    raise exception 'wallet_owner_not_found' using errcode = 'P0002';
  end if;

  if not v_is_admin and (v_uid <> auth.uid()::text or p_amount > 0) then
    raise exception 'wallet_adjustment_not_allowed' using errcode = '42501';
  end if;

  insert into public.wallets (user_id, balance, history)
  values (v_uid, 0, '[]'::jsonb)
  on conflict (user_id) do nothing;

  select balance into v_current from public.wallets where user_id = v_uid for update;

  if coalesce(v_current, 0) + p_amount < 0 then
    raise exception 'insufficient_wallet_balance' using errcode = '22003';
  end if;

  v_entry := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', case when p_amount > 0 then 'deposit' else 'withdraw' end,
    'amount', p_amount,
    'date', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
    'desc', left(coalesce(p_entry->>'desc', 'Wallet adjustment'), 300),
    'createdAtMs', (extract(epoch from now()) * 1000)::bigint,
    'actorUserId', auth.uid()::text
  );

  update public.wallets
  set balance = balance + p_amount,
      history = jsonb_build_array(v_entry) || coalesce(history, '[]'::jsonb)
  where user_id = v_uid;
end;
$$;
revoke all on function public.js_credit_wallet(text, numeric, jsonb) from public;
grant execute on function public.js_credit_wallet(text, numeric, jsonb) to authenticated;

-- ── RPC: clear_wallet_history ─────────────────────────────────────────────────
create or replace function public.clear_wallet_history(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_user_id <> auth.uid()::text and not public.is_admin(auth.uid()) then
    raise exception 'wallet_access_denied' using errcode = '42501';
  end if;
  update public.wallets set history = '[]'::jsonb where user_id = p_user_id;
end;
$$;
revoke all on function public.clear_wallet_history(text) from public;
grant execute on function public.clear_wallet_history(text) to authenticated;

-- ── RPC: create_admin_notification ────────────────────────────────────────────
create or replace function public.create_admin_notification(
  p_title text,
  p_message text,
  p_type text default 'info'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  insert into public.admin_notifs (id, title, message, type, at)
  values (
    v_id,
    left(coalesce(p_title, ''), 160),
    left(coalesce(p_message, ''), 1000),
    case when p_type in ('info', 'success', 'warning', 'error') then p_type else 'info' end,
    to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS')
  );
  return v_id;
end;
$$;
revoke all on function public.create_admin_notification(text, text, text) from public;
grant execute on function public.create_admin_notification(text, text, text) to authenticated;

-- ── RPC: admin_set_user_role ──────────────────────────────────────────────────
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_user_id is null or p_role not in ('customer', 'merchant', 'rider', 'admin') then
    raise exception 'invalid_role_request' using errcode = '22023';
  end if;

  if p_enabled then
    insert into public.user_roles (user_id, role)
    values (p_user_id, p_role)
    on conflict (user_id, role) do nothing;
  else
    if p_user_id = auth.uid() and p_role = 'admin' then
      raise exception 'cannot_remove_own_admin_role' using errcode = '42501';
    end if;
    delete from public.user_roles
    where user_id = p_user_id and role = p_role;
  end if;
end;
$$;
revoke all on function public.admin_set_user_role(uuid, text, boolean) from public;
grant execute on function public.admin_set_user_role(uuid, text, boolean) to authenticated;

-- ── RPC: admin_purge_app_data ─────────────────────────────────────────────────
create or replace function public.admin_purge_app_data(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_scope = 'all_orders' then
    delete from public.job_offers;
    delete from public.chats;
    delete from public.orders;
    return jsonb_build_object('ok', true, 'scope', p_scope);
  elsif p_scope = 'cancelled_orders' then
    delete from public.orders where status = 'cancelled';
    return jsonb_build_object('ok', true, 'scope', p_scope);
  elsif p_scope = 'completed_orders' then
    delete from public.orders where status = 'completed';
    return jsonb_build_object('ok', true, 'scope', p_scope);
  elsif p_scope = 'all_chats' then
    delete from public.chats;
    return jsonb_build_object('ok', true, 'scope', p_scope);
  elsif p_scope = 'pending_requests' then
    delete from public.pending_requests;
    return jsonb_build_object('ok', true, 'scope', p_scope);
  elsif p_scope = 'admin_notifs' then
    delete from public.admin_notifs;
    return jsonb_build_object('ok', true, 'scope', p_scope);
  else
    raise exception 'unsupported_purge_scope' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.admin_purge_app_data(text) from public;
grant execute on function public.admin_purge_app_data(text) to authenticated;

-- ── RPC: append_chat_message ──────────────────────────────────────────────────
create or replace function public.append_chat_message(
  p_order_id text,
  p_message jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select messages into v_existing from public.chats where order_id = p_order_id;

  if v_existing is null then
    insert into public.chats (order_id, messages, updated_at)
    values (p_order_id, jsonb_build_array(p_message), now());
  else
    update public.chats
    set messages = v_existing || jsonb_build_array(p_message),
        updated_at = now()
    where order_id = p_order_id;
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end;
$$;
revoke all on function public.append_chat_message(text, jsonb) from public;
grant execute on function public.append_chat_message(text, jsonb) to authenticated;

-- ── RPC: register_push_device ─────────────────────────────────────────────────
create or replace function public.register_push_device(
  p_token text,
  p_platform text default 'android'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception 'invalid_push_token' using errcode = '22023';
  end if;

  insert into public.push_devices (user_id, token, platform, is_active, updated_at)
  values (auth.uid(), p_token, coalesce(p_platform, 'android'), true, now())
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        is_active = true,
        updated_at = now();

  return jsonb_build_object('ok', true, 'token', p_token);
end;
$$;
revoke all on function public.register_push_device(text, text) from public;
grant execute on function public.register_push_device(text, text) to authenticated;

-- ── RPC: disable_push_device ──────────────────────────────────────────────────
create or replace function public.disable_push_device(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  update public.push_devices
  set is_active = false, updated_at = now()
  where user_id = auth.uid() and token = p_token;

  return jsonb_build_object('ok', true, 'token', p_token);
end;
$$;
revoke all on function public.disable_push_device(text) from public;
grant execute on function public.disable_push_device(text) to authenticated;

-- ── Rider Cash Liability Calculations ────────────────────────────────────────
create or replace function public.calculate_rider_order_cash_liability(p_order_data jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  v_method text := coalesce(p_order_data->>'paymentMethod', 'cash');
  v_type text := coalesce(p_order_data->>'type', 'food');
  v_food_total numeric := coalesce((p_order_data->>'foodTotal')::numeric, 0);
  v_delivery_fee numeric := coalesce((p_order_data->>'deliveryFee')::numeric, 0);
  v_grand_total numeric := coalesce((p_order_data->>'grandTotal')::numeric, v_delivery_fee);
  v_gp_food_rate numeric := 0.30;
  v_gp_deliv_rate numeric := 0.15;
  v_gp_ride_rate numeric := 0.15;
  v_gp_service_rate numeric := 0.15;
begin
  if v_method <> 'cash' then return 0; end if;

  if v_type = 'food' then
    return round(v_food_total, 2);
  elsif v_type = 'parcel' then
    return round(v_delivery_fee * v_gp_deliv_rate, 2);
  elsif v_type = 'ride' then
    return round(v_grand_total * v_gp_ride_rate, 2);
  elsif v_type = 'service' then
    return round(v_grand_total * v_gp_service_rate, 2);
  end if;

  return 0;
end;
$$;

create or replace function public.get_rider_active_cash_liability(
  p_rider_id text,
  p_rider_user_id text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_total_liability numeric := 0;
begin
  if (p_rider_id is null or p_rider_id = '') and (p_rider_user_id is null or p_rider_user_id = '') then
    return 0;
  end if;

  for v_rec in
    select data
    from public.orders
    where (
            (p_rider_id is not null and p_rider_id <> '' and data->>'riderId' = p_rider_id)
            or
            (p_rider_user_id is not null and p_rider_user_id <> '' and data->>'riderUserId' = p_rider_user_id)
          )
      and status in ('rider_accepted', 'picking_up', 'delivering')
      and coalesce(data->>'paymentMethod', 'cash') = 'cash'
      and coalesce(data->>'settlementStatus', '') <> 'settled'
  loop
    v_total_liability := v_total_liability + public.calculate_rider_order_cash_liability(v_rec.data);
  end loop;

  return v_total_liability;
end;
$$;

-- ── Internal Rider Acceptance RPCs ────────────────────────────────────────────
create or replace function public.accept_job_offer_internal(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_order record;
  v_rider record;
  v_wallet record;
  v_now_str text;
  v_updated_order jsonb;
  v_wallet_bal numeric := 0;
  v_req_liability numeric := 0;
  v_active_liability numeric := 0;
  v_avail_bal numeric := 0;
begin
  select * into v_offer from job_offers where id = p_offer_id;
  if v_offer is null then return jsonb_build_object('ok', false, 'reason', 'offer_not_found'); end if;
  if v_offer.status != 'pending' then return jsonb_build_object('ok', false, 'reason', 'offer_not_pending'); end if;
  if v_offer.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'offer_expired'); end if;

  select * into v_order from orders where id = v_offer.order_id for update;
  if v_order is null then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;

  select * into v_offer from job_offers where id = p_offer_id for update;
  if v_offer.status != 'pending' then return jsonb_build_object('ok', false, 'reason', 'offer_not_pending'); end if;

  if exists (
    select 1 from job_offers where order_id = v_offer.order_id and status = 'accepted' and id != p_offer_id
  ) then
    update job_offers set status = 'missed', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('ok', false, 'reason', 'already_accepted_by_other');
  end if;

  select * into v_rider from riders where id = v_offer.rider_id;

  if v_offer.rider_user_id is not null and v_offer.rider_user_id != '' then
    select * into v_wallet from wallets where user_id = v_offer.rider_user_id for update;
    if v_wallet is not null then v_wallet_bal := coalesce(v_wallet.balance, 0); end if;
  end if;

  v_req_liability := public.calculate_rider_order_cash_liability(v_order.data);
  if v_req_liability > 0 then
    v_active_liability := public.get_rider_active_cash_liability(v_offer.rider_id::text, v_offer.rider_user_id::text);
    v_avail_bal := v_wallet_bal - v_active_liability;
    if v_avail_bal < v_req_liability then
      return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_RIDER_WALLET', 'requiredBalance', v_req_liability, 'currentBalance', v_wallet_bal, 'availableBalance', round(v_avail_bal, 2));
    end if;
  end if;

  v_now_str := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS');

  v_updated_order := v_order.data || jsonb_build_object(
    'status', 'rider_accepted',
    'riderId', v_offer.rider_id,
    'riderUserId', v_offer.rider_user_id,
    'riderName', coalesce(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', coalesce(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str
  );

  update job_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update job_offers set status = 'missed', responded_at = now() where order_id = v_offer.order_id and id != p_offer_id and status = 'pending';
  update orders set status = 'rider_accepted', data = v_updated_order where id = v_offer.order_id;

  if v_offer.rider_id is not null then
    update riders set is_available = false where id = v_offer.rider_id;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_offer.order_id, 'order_data', v_updated_order);
end;
$$;

create or replace function public.accept_order_direct_internal(
  p_order_id text,
  p_rider_id text,
  p_rider_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_rider record;
  v_wallet record;
  v_now_str text;
  v_updated_order jsonb;
  v_wallet_bal numeric := 0;
  v_req_liability numeric := 0;
  v_active_liability numeric := 0;
  v_avail_bal numeric := 0;
  v_food_total numeric := 0;
  v_deliv_fee numeric := 0;
  v_grand_total numeric := 0;
  v_type text := 'food';
  v_gp_amount numeric := 0;
  v_merch_income numeric := 0;
  v_rider_income numeric := 0;
  v_gp_food_rate numeric := 0.30;
  v_gp_deliv_rate numeric := 0.15;
  v_gp_ride_rate numeric := 0.15;
  v_gp_service_rate numeric := 0.15;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;

  if v_order.status not in ('pending', 'preparing', 'ready_to_pickup') then
    return jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  end if;

  if (v_order.data->>'riderId') is not null and (v_order.data->>'riderId') <> '' and (v_order.data->>'riderId') <> p_rider_id then
    return jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  end if;

  select * into v_rider from riders where id = p_rider_id;
  if v_rider is null then return jsonb_build_object('ok', false, 'reason', 'rider_not_found'); end if;

  if p_rider_user_id is null or p_rider_user_id = '' then p_rider_user_id := v_rider.data->>'userId'; end if;

  if p_rider_user_id is not null and p_rider_user_id <> '' then
    select * into v_wallet from wallets where user_id = p_rider_user_id for update;
    if v_wallet is not null then v_wallet_bal := coalesce(v_wallet.balance, 0); end if;
  end if;

  v_type        := coalesce(v_order.data->>'type', 'food');
  v_food_total  := coalesce((v_order.data->>'foodTotal')::numeric, 0);
  v_deliv_fee   := coalesce((v_order.data->>'deliveryFee')::numeric, 0);
  v_grand_total := coalesce((v_order.data->>'grandTotal')::numeric, v_deliv_fee);

  if v_type = 'parcel' then
    v_gp_amount    := round(v_deliv_fee * v_gp_deliv_rate, 2);
    v_merch_income := 0;
    v_rider_income := round(v_deliv_fee - v_gp_amount, 2);
  elsif v_type = 'ride' then
    v_gp_amount    := round(v_grand_total * v_gp_ride_rate, 2);
    v_merch_income := 0;
    v_rider_income := round(v_grand_total - v_gp_amount, 2);
  elsif v_type = 'service' then
    v_gp_amount    := round(v_grand_total * v_gp_service_rate, 2);
    v_merch_income := 0;
    v_rider_income := round(v_grand_total - v_gp_amount, 2);
  else
    v_gp_amount    := round(v_food_total * v_gp_food_rate, 2);
    v_merch_income := round(v_food_total - v_gp_amount, 2);
    v_rider_income := v_deliv_fee;
  end if;

  v_req_liability := public.calculate_rider_order_cash_liability(v_order.data);
  if v_req_liability > 0 then
    v_active_liability := public.get_rider_active_cash_liability(p_rider_id, p_rider_user_id);
    v_avail_bal := v_wallet_bal - v_active_liability;
    if v_avail_bal < v_req_liability then
      return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_RIDER_WALLET', 'requiredBalance', v_req_liability, 'currentBalance', v_wallet_bal, 'availableBalance', round(v_avail_bal, 2));
    end if;
  end if;

  v_now_str := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS');

  v_updated_order := v_order.data || jsonb_build_object(
    'status', 'rider_accepted',
    'riderId', p_rider_id,
    'riderUserId', p_rider_user_id,
    'riderName', coalesce(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', coalesce(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str,
    'riderIncome', v_rider_income,
    'merchantIncome', v_merch_income,
    'adminGP', v_gp_amount
  );

  update orders set status = 'rider_accepted', data = v_updated_order where id = p_order_id;
  update riders set is_available = false where id = p_rider_id;
  update job_offers set status = 'missed', responded_at = now() where order_id = p_order_id and status = 'pending';

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'order_data', v_updated_order);
end;
$$;

create or replace function public.accept_order_direct(
  p_order_id text,
  p_rider_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_user_id text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select data->>'userId' into v_rider_user_id from riders where id = p_rider_id;
  if v_rider_user_id is null or (v_rider_user_id <> auth.uid()::text and not public.is_admin(auth.uid())) then
    raise exception 'rider_access_denied' using errcode = '42501';
  end if;
  return public.accept_order_direct_internal(p_order_id, p_rider_id, v_rider_user_id);
end;
$$;
revoke all on function public.accept_order_direct(text, text) from public;
grant execute on function public.accept_order_direct(text, text) to authenticated;

create or replace function public.accept_job_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_offer from public.job_offers where id = p_offer_id;
  if v_offer is null then return jsonb_build_object('ok', false, 'reason', 'offer_not_found'); end if;
  if v_offer.rider_user_id is not null and v_offer.rider_user_id <> auth.uid()::text and not public.is_admin(auth.uid()) then
    raise exception 'offer_access_denied' using errcode = '42501';
  end if;
  return public.accept_job_offer_internal(p_offer_id);
end;
$$;
revoke all on function public.accept_job_offer(uuid) from public;
grant execute on function public.accept_job_offer(uuid) to authenticated;

create or replace function public.respond_job_offer(p_offer_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_status not in ('rejected', 'timeout') then raise exception 'invalid_offer_status' using errcode = '22023'; end if;
  select * into v_offer from public.job_offers where id = p_offer_id;
  if v_offer is null then return jsonb_build_object('ok', false, 'reason', 'offer_not_found'); end if;
  if v_offer.rider_user_id <> auth.uid()::text and not public.is_admin(auth.uid()) then
    raise exception 'offer_access_denied' using errcode = '42501';
  end if;
  update public.job_offers set status = p_status, responded_at = now() where id = p_offer_id;
  return jsonb_build_object('ok', true, 'offer_id', p_offer_id, 'status', p_status);
end;
$$;
revoke all on function public.respond_job_offer(uuid, text) from public;
grant execute on function public.respond_job_offer(uuid, text) to authenticated;

-- ── RPC: dispatch_order ───────────────────────────────────────────────────────
create or replace function public.dispatch_order(
  p_order_id text,
  p_pickup_lat float,
  p_pickup_lng float,
  p_radius_km float default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider record;
  v_attempt int;
  v_offer_id uuid;
  v_order_data jsonb;
  v_lat float := p_pickup_lat;
  v_lng float := p_pickup_lng;
begin
  select data into v_order_data from public.orders where id = p_order_id;
  if v_order_data is null then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;

  if v_order_data->>'status' not in ('pending', 'preparing', 'ready_to_pickup') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_order_status');
  end if;

  if v_lat is null or v_lng is null then
    v_lat := coalesce((v_order_data->'pickupLocation'->>'lat')::float, (v_order_data->'location'->>'lat')::float);
    v_lng := coalesce((v_order_data->'pickupLocation'->>'lng')::float, (v_order_data->'location'->>'lng')::float);
  end if;

  if v_lat is null or v_lng is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pickup_coordinates');
  end if;

  if exists (
    select 1 from public.job_offers
    where order_id = p_order_id and status = 'pending' and expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'offer_already_pending');
  end if;

  if exists (
    select 1 from public.job_offers where order_id = p_order_id and status = 'accepted'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_accepted');
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_attempt from public.job_offers where order_id = p_order_id;

  select
    r.id as rider_id,
    r.data->>'userId' as rider_user_id,
    earth_distance(
      ll_to_earth(r.current_lat, r.current_lng),
      ll_to_earth(v_lat, v_lng)
    ) / 1000.0 as dist_km
  into v_rider
  from public.riders r
  where r.is_available = true
    and r.current_lat is not null
    and r.current_lng is not null
    and not exists (
      select 1 from public.job_offers jo
      where jo.order_id = p_order_id and jo.rider_id = r.id
    )
    and earth_distance(
          ll_to_earth(r.current_lat, r.current_lng),
          ll_to_earth(v_lat, v_lng)
        ) / 1000.0 <= p_radius_km
  order by dist_km asc
  limit 1;

  if v_rider is null then
    update public.orders
    set data = data || '{"dispatchStatus":"no_rider_available"}'::jsonb
    where id = p_order_id;
    return jsonb_build_object('ok', false, 'reason', 'no_rider_available', 'attempt', v_attempt);
  end if;

  insert into public.job_offers (order_id, rider_id, rider_user_id, attempt_no)
  values (p_order_id, v_rider.rider_id, v_rider.rider_user_id, v_attempt)
  returning id into v_offer_id;

  return jsonb_build_object('ok', true, 'offer_id', v_offer_id, 'rider_id', v_rider.rider_id, 'attempt', v_attempt, 'dist_km', round(v_rider.dist_km::numeric, 2));
end;
$$;
revoke all on function public.dispatch_order(text, float, float, float) from public;
grant execute on function public.dispatch_order(text, float, float, float) to authenticated;

-- ── RPC: process_order_settlement ─────────────────────────────────────────────
create or replace function public.process_order_settlement(
  p_order_id text,
  p_gp_food_rate numeric default 0.30,
  p_gp_delivery_rate numeric default 0.15,
  p_gp_ride_rate numeric default 0.15,
  p_gp_service_rate numeric default 0.15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_type text;
  v_method text;
  v_food numeric;
  v_deliv numeric;
  v_total numeric;
  v_gp numeric;
  v_merch_inc numeric;
  v_rider_inc numeric;
  v_rider_uid text;
  v_rider_id text;
  v_merch_uid text;
  v_admin_uid text;
  v_now_ms bigint;
begin
  select id::text into v_admin_uid from public.profiles where email = 'boomzalnw2@gmail.com' limit 1;
  if v_admin_uid is null then v_admin_uid := 'boomzalnw2@gmail.com'; end if;

  select data into v_order from public.orders where id = p_order_id for update nowait;
  if v_order is null then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if v_order->>'settlementStatus' = 'settled' then return jsonb_build_object('ok', true, 'skipped', 'already_settled'); end if;

  v_type      := coalesce(v_order->>'type', 'food');
  v_method    := v_order->>'paymentMethod';
  v_food      := coalesce((v_order->>'foodTotal')::numeric, 0);
  v_deliv     := coalesce((v_order->>'deliveryFee')::numeric, 0);
  v_total     := coalesce((v_order->>'grandTotal')::numeric, v_deliv);
  v_rider_uid := v_order->>'riderUserId';
  v_rider_id  := v_order->>'riderId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  if (v_rider_uid is null or v_rider_uid = '') and v_rider_id is not null then
    select data->>'userId' into v_rider_uid from public.riders where id = v_rider_id;
  end if;

  if (v_merch_uid is null or v_merch_uid = '') and v_type = 'food' then
    select data->>'ownerId' into v_merch_uid from public.restaurants where id = v_order->>'restaurantId';
  end if;

  if v_type = 'parcel' then
    v_gp        := round(v_deliv * p_gp_delivery_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := round(v_deliv - v_gp, 2);
  elsif v_type = 'ride' then
    v_gp        := round(v_total * p_gp_ride_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := round(v_total - v_gp, 2);
  elsif v_type = 'service' then
    v_gp        := round(v_total * p_gp_service_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := round(v_total - v_gp, 2);
  else
    v_gp        := round(v_food * p_gp_food_rate, 2);
    v_merch_inc := round(v_food - v_gp, 2);
    v_rider_inc := v_deliv;
  end if;

  if v_method = 'wallet' then
    if v_type = 'food' then
      perform public._wallet_credit(v_merch_uid, v_merch_inc, p_order_id, 'รายได้ร้านค้า');
      perform public._wallet_credit(v_rider_uid, v_rider_inc, p_order_id, 'ค่าส่ง');
      perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP platform');
    elsif v_type = 'ride' then
      perform public._wallet_credit(v_rider_uid, v_rider_inc, p_order_id, 'ค่าโดยสาร');
      perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP platform');
    elsif v_type = 'service' then
      perform public._wallet_credit(v_rider_uid, v_rider_inc, p_order_id, 'ค่าบริการ');
      perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP platform');
    else
      perform public._wallet_credit(v_rider_uid, v_rider_inc, p_order_id, 'ค่าส่งพัสดุ');
      perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP platform');
    end if;
  elsif v_method = 'cash' then
    if v_type in ('parcel', 'ride', 'service') then
      if v_gp > 0 then
        if v_type = 'ride' then
          perform public._wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP เรียกรถ(สด)');
          perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP เรียกรถ(สด)');
        elsif v_type = 'service' then
          perform public._wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP บริการ(สด)');
          perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP บริการ(สด)');
        else
          perform public._wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP พัสดุ(สด)');
          perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP พัสดุ(สด)');
        end if;
      end if;
    else
      if v_food > 0 then perform public._wallet_credit(v_rider_uid, -v_food, p_order_id, 'หักค่าอาหาร(สด)'); end if;
      if v_merch_inc > 0 then perform public._wallet_credit(v_merch_uid, v_merch_inc, p_order_id, 'รายได้ร้าน(สด)'); end if;
      if v_gp > 0 then perform public._wallet_credit(v_admin_uid, v_gp, p_order_id, 'GP(สด)'); end if;
    end if;
  end if;

  v_now_ms := (extract(epoch from now()) * 1000)::bigint;

  update public.orders
  set status = 'completed',
      data   = data || jsonb_build_object(
                 'status', 'completed',
                 'settlementStatus', 'settled',
                 'riderIncome', v_rider_inc,
                 'merchantIncome', v_merch_inc,
                 'adminGP', v_gp,
                 'completedAt', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
                 'completedAtMs', v_now_ms
               )
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'riderIncome', v_rider_inc, 'merchantIncome', v_merch_inc, 'gpAmount', v_gp);
end;
$$;
revoke all on function public.process_order_settlement(text, numeric, numeric, numeric, numeric) from public;
grant execute on function public.process_order_settlement(text, numeric, numeric, numeric, numeric) to authenticated;

-- ── RPC: place_customer_order ─────────────────────────────────────────────────
create or replace function public.place_customer_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid text;
  v_cust_uid text;
  v_order_id text;
  v_existing_order record;
  v_type text;
  v_method text;
  v_status text;

  v_config_data jsonb;
  v_base_fee numeric := 20;
  v_per_km_fee numeric := 10;
  v_ride_base_fee numeric := 20;
  v_ride_per_km_fee numeric := 10;
  v_gp_food_rate numeric := 0.30;
  v_gp_deliv_rate numeric := 0.15;
  v_gp_ride_rate numeric := 0.15;
  v_gp_service_rate numeric := 0.15;
  v_extra_services jsonb;

  v_restaurant_id text;
  v_menu_items_json jsonb;
  v_req_items jsonb;
  v_req_item jsonb;
  v_item_id text;
  v_orig_id text;
  v_qty int;
  v_db_item jsonb := null;
  v_db_base_price numeric := 0;
  v_db_opts_extra numeric := 0;
  v_item_unit_price numeric := 0;
  v_item_subtotal numeric := 0;
  v_sel_opts jsonb;
  v_opt_elem jsonb;
  v_db_opt jsonb;
  v_db_opt_price numeric := 0;
  v_auth_items jsonb := '[]'::jsonb;

  v_promo_code_str text;
  v_promo_row record;
  v_promo_data jsonb;
  v_promo_active boolean;
  v_promo_type text;
  v_promo_val numeric;
  v_promo_min_order numeric;
  v_promo_max_disc numeric;
  v_promo_max_uses int;
  v_promo_used_cnt int;
  v_promo_discount numeric := 0;

  v_distance numeric := 1;
  v_calc_food_total numeric := 0;
  v_calc_deliv_fee numeric := 0;
  v_calc_grand_total numeric := 0;
  v_admin_gp numeric := 0;
  v_rider_income numeric := 0;
  v_service_cat text;
  v_matched_service boolean := false;
  v_service_elem jsonb;

  v_wallet record;
  v_bal numeric := 0;
  v_now_bangkok text;
  v_now_epoch_ms bigint;
  v_entry jsonb;
  v_final_order jsonb;
  i int;
  j int;
  k int;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_caller_uid := auth.uid()::text;
  v_cust_uid := coalesce(p_order->>'customerId', v_caller_uid);

  if v_cust_uid <> v_caller_uid and not public.is_admin(auth.uid()) then
    raise exception 'customer_identity_mismatch' using errcode = '42501';
  end if;

  v_order_id := p_order->>'id';
  if v_order_id is null or btrim(v_order_id) = '' then
    raise exception 'missing_order_id' using errcode = '22023';
  end if;

  v_type := lower(coalesce(p_order->>'type', 'food'));
  if v_type not in ('food', 'parcel', 'ride', 'service') then
    raise exception 'invalid_order_type' using errcode = '22023';
  end if;

  v_method := lower(coalesce(p_order->>'paymentMethod', 'cash'));
  if v_method not in ('cash', 'wallet', 'online') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;

  v_status := case when v_type = 'food' then 'pending' else 'ready_to_pickup' end;

  select * into v_existing_order from public.orders where id = v_order_id for update;

  if v_existing_order.id is not null then
    if (v_existing_order.data->>'customerId') <> v_cust_uid then
      raise exception 'order_id_conflict' using errcode = '42501';
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order_id,
      'order', v_existing_order.data
    );
  end if;

  select data into v_config_data from public.app_config where id = 1;
  if v_config_data is not null then
    v_base_fee        := coalesce((v_config_data->>'baseFee')::numeric, 20);
    v_per_km_fee      := coalesce((v_config_data->>'perKmFee')::numeric, 10);
    v_ride_base_fee   := coalesce((v_config_data->>'rideBaseFee')::numeric, v_base_fee);
    v_ride_per_km_fee  := coalesce((v_config_data->>'ridePerKmFee')::numeric, v_per_km_fee);
    v_gp_food_rate    := coalesce((v_config_data->>'gpFood')::numeric, 30) / 100.0;
    v_gp_deliv_rate   := coalesce((v_config_data->>'gpDelivery')::numeric, 15) / 100.0;
    v_gp_ride_rate    := coalesce((v_config_data->>'gpRide')::numeric, 15) / 100.0;
    v_gp_service_rate := coalesce((v_config_data->>'gpService')::numeric, 15) / 100.0;
    v_extra_services  := v_config_data->'extraServices';
  end if;

  if v_type = 'food' then
    v_restaurant_id := p_order->>'restaurantId';
    if v_restaurant_id is null or btrim(v_restaurant_id) = '' then
      raise exception 'missing_restaurant_id' using errcode = '22023';
    end if;

    select items into v_menu_items_json from public.menu_items where restaurant_id = v_restaurant_id;
    if v_menu_items_json is null or jsonb_array_length(v_menu_items_json) = 0 then
      raise exception 'restaurant_menu_not_found' using errcode = 'P0002';
    end if;

    v_req_items := p_order->'items';
    if v_req_items is null or jsonb_array_length(v_req_items) = 0 then
      raise exception 'empty_order_items' using errcode = '22023';
    end if;

    v_calc_food_total := 0;
    v_auth_items := '[]'::jsonb;

    for i in 0..jsonb_array_length(v_req_items) - 1 loop
      v_req_item := v_req_items->i;
      v_item_id  := v_req_item->>'id';
      v_orig_id  := coalesce(v_req_item->>'originalId', v_item_id);
      v_qty      := greatest(1, coalesce((v_req_item->>'qty')::int, 1));

      v_db_item := null;
      for j in 0..jsonb_array_length(v_menu_items_json) - 1 loop
        if (v_menu_items_json->j->>'id') = v_orig_id then
          v_db_item := v_menu_items_json->j;
          exit;
        end if;
      end loop;

      if v_db_item is null then
        raise exception 'menu_item_not_found' using errcode = 'P0002';
      end if;

      v_db_base_price := coalesce((v_db_item->>'price')::numeric, 0);
      v_db_opts_extra := 0;
      v_sel_opts := v_req_item->'selectedOptions';

      if v_sel_opts is not null and jsonb_array_length(v_sel_opts) > 0 then
        for k in 0..jsonb_array_length(v_sel_opts) - 1 loop
          v_opt_elem := v_sel_opts->k;
          v_db_opt_price := 0;

          if v_db_item->'options' is not null and jsonb_array_length(v_db_item->'options') > 0 then
            for j in 0..jsonb_array_length(v_db_item->'options') - 1 loop
              v_db_opt := v_db_item->'options'->j;
              if (v_db_opt->>'name') = (v_opt_elem->>'name') then
                v_db_opt_price := coalesce((v_db_opt->>'price')::numeric, 0);
                exit;
              end if;
            end loop;
          end if;

          v_db_opts_extra := v_db_opts_extra + v_db_opt_price;
        end loop;
      end if;

      v_item_unit_price := round(v_db_base_price + v_db_opts_extra, 2);
      v_item_subtotal   := round(v_item_unit_price * v_qty, 2);
      v_calc_food_total := v_calc_food_total + v_item_subtotal;

      v_auth_items := v_auth_items || jsonb_build_object(
        'id', v_item_id,
        'originalId', v_orig_id,
        'name', coalesce(v_db_item->>'name', v_req_item->>'name'),
        'price', v_item_unit_price,
        'qty', v_qty,
        'selectedOptions', coalesce(v_sel_opts, '[]'::jsonb)
      );
    end loop;

    v_promo_discount := 0;
    v_promo_code_str := upper(trim(coalesce(p_order->>'promoCode', '')));

    if v_promo_code_str <> '' then
      select * into v_promo_row from public.promo_codes where upper(data->>'code') = v_promo_code_str;

      if v_promo_row.id is not null then
        v_promo_data     := v_promo_row.data;
        v_promo_active   := coalesce((v_promo_data->>'active')::boolean, true);
        v_promo_type     := lower(coalesce(v_promo_data->>'type', 'percent'));
        v_promo_val      := coalesce((v_promo_data->>'value')::numeric, 0);
        v_promo_min_order := coalesce((v_promo_data->>'minOrder')::numeric, 0);
        v_promo_max_disc := coalesce((v_promo_data->>'maxDiscount')::numeric, 9999);
        v_promo_max_uses := coalesce((v_promo_data->>'maxUses')::int, 100);
        v_promo_used_cnt := coalesce((v_promo_data->>'usedCount')::int, 0);

        if v_promo_active and v_promo_used_cnt < v_promo_max_uses and v_calc_food_total >= v_promo_min_order then
          if v_promo_type = 'percent' then
            v_promo_discount := least(round(v_calc_food_total * (v_promo_val / 100.0), 2), v_promo_max_disc);
          else
            v_promo_discount := least(v_promo_val, v_calc_food_total);
          end if;
        end if;
      end if;
    end if;

    v_distance       := greatest(0, coalesce((p_order->>'distance')::numeric, 1));
    v_calc_deliv_fee := v_base_fee + (ceil(v_distance) * v_per_km_fee);
    v_calc_grand_total := greatest(0, v_calc_food_total + v_calc_deliv_fee - v_promo_discount);

    v_admin_gp     := round(v_calc_food_total * v_gp_food_rate, 2);
    v_rider_income := v_calc_deliv_fee;

  elsif v_type = 'parcel' then
    v_distance       := greatest(0, coalesce((p_order->>'distance')::numeric, (p_order->'parcelDetails'->>'distance')::numeric, 1));
    v_calc_food_total := 0;
    v_calc_deliv_fee := v_base_fee + (ceil(v_distance) * v_per_km_fee);
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := round(v_calc_grand_total * v_gp_deliv_rate, 2);
    v_rider_income   := round(v_calc_grand_total - v_admin_gp, 2);

  elsif v_type = 'ride' then
    v_distance       := greatest(0, coalesce((p_order->>'distance')::numeric, 1));
    v_calc_food_total := 0;
    v_calc_deliv_fee := v_ride_base_fee + (ceil(v_distance) * v_ride_per_km_fee);
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := round(v_calc_grand_total * v_gp_ride_rate, 2);
    v_rider_income   := round(v_calc_grand_total - v_admin_gp, 2);

  elsif v_type = 'service' then
    v_service_cat := p_order->>'serviceCategory';
    v_calc_deliv_fee := 350;
    v_matched_service := false;

    if v_extra_services is not null and jsonb_array_length(v_extra_services) > 0 then
      for i in 0..jsonb_array_length(v_extra_services) - 1 loop
        v_service_elem := v_extra_services->i;
        if (v_service_elem->>'name') = v_service_cat then
          v_calc_deliv_fee := coalesce((v_service_elem->>'price')::numeric, 350);
          v_matched_service := true;
          exit;
        end if;
      end loop;
    end if;

    v_calc_food_total := 0;
    v_calc_grand_total := v_calc_deliv_fee;
    v_admin_gp       := round(v_calc_grand_total * v_gp_service_rate, 2);
    v_rider_income   := round(v_calc_grand_total - v_admin_gp, 2);
  end if;

  if v_method = 'wallet' and v_calc_grand_total > 0 then
    insert into public.wallets (user_id, balance, history)
    values (v_cust_uid, 0, '[]'::jsonb)
    on conflict (user_id) do nothing;

    select * into v_wallet from public.wallets where user_id = v_cust_uid for update;
    v_bal := coalesce(v_wallet.balance, 0);

    if v_bal < v_calc_grand_total then
      return jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_CUSTOMER_WALLET',
        'requiredBalance', v_calc_grand_total,
        'currentBalance', v_bal
      );
    end if;

    v_now_bangkok  := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS');
    v_now_epoch_ms := (extract(epoch from now()) * 1000)::bigint;

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

    update public.wallets
    set balance = balance - v_calc_grand_total,
        history = jsonb_build_array(v_entry) || coalesce(history, '[]'::jsonb)
    where user_id = v_cust_uid;
  end if;

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
    'createdAt', coalesce(p_order->>'createdAt', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'))
  );

  if v_type = 'food' then
    v_final_order := v_final_order || jsonb_build_object('items', v_auth_items);
  end if;

  insert into public.orders (id, status, data)
  values (v_order_id, v_status, v_final_order);

  return jsonb_build_object(
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
end;
$$;

revoke all on function public.place_customer_order(jsonb) from public;
grant execute on function public.place_customer_order(jsonb) to authenticated;

-- ── RPC: approve_pending_request ──────────────────────────────────────────────
create or replace function public.approve_pending_request(p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_req_data jsonb;
  v_req_type text;
  v_user_id text;
  v_amt numeric;
  v_wallet record;
  v_bal numeric := 0;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into v_req from public.pending_requests where id = p_request_id for update nowait;

  if v_req is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  v_req_data := v_req.data;
  v_req_type := lower(coalesce(v_req.data->>'type', v_req_data->>'type', ''));
  v_user_id  := coalesce(v_req.data->>'userId', v_req_data->>'userId');

  if v_req_type not in ('topup', 'withdraw') then
    return jsonb_build_object('ok', false, 'reason', 'UNSUPPORTED_REQUEST_TYPE', 'type', v_req_type);
  end if;

  if v_user_id is null or v_user_id = '' then
    return jsonb_build_object('ok', false, 'reason', 'MISSING_USER_ID');
  end if;

  if v_req_type = 'topup' then
    v_amt := coalesce((v_req_data->'data'->>'amount')::numeric, (v_req_data->>'amount')::numeric, 0);
    if v_amt <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_topup_amount'); end if;

    perform public._wallet_credit(
      v_user_id, v_amt, null,
      'เติมเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );

  elsif v_req_type = 'withdraw' then
    v_amt := coalesce((v_req_data->'data'->>'amount')::numeric, (v_req_data->>'amount')::numeric, 0);
    if v_amt <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_withdraw_amount'); end if;

    insert into public.wallets (user_id, balance, history)
    values (v_user_id, 0, '[]'::jsonb)
    on conflict (user_id) do nothing;

    select * into v_wallet from public.wallets where user_id = v_user_id for update;

    v_bal := coalesce(v_wallet.balance, 0);
    if v_bal < v_amt then
      return jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_WALLET_BALANCE',
        'currentBalance', v_bal,
        'requestedAmount', v_amt
      );
    end if;

    perform public._wallet_credit(
      v_user_id, -v_amt, null,
      'ถอนเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );
  end if;

  delete from public.pending_requests where id = p_request_id;

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'type', v_req_type);

exception
  when lock_not_available then
    return jsonb_build_object('ok', false, 'reason', 'concurrent_approval_in_progress');
end;
$$;

revoke all on function public.approve_pending_request(text) from public;
grant execute on function public.approve_pending_request(text) to authenticated;

-- ── RLS Policies ──────────────────────────────────────────────────────────────
create policy "profiles_select_own_or_admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin(auth.uid()));
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own_or_admin" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin(auth.uid())) with check (id = auth.uid() or public.is_admin(auth.uid()));

create policy "user_roles_select_own_or_admin" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "wallets_select_own_or_admin" on public.wallets for select to authenticated using (user_id = auth.uid()::text or public.is_admin(auth.uid()));

create policy "orders_select_all" on public.orders for select to authenticated using (true);
create policy "orders_insert_authenticated" on public.orders for insert to authenticated with check (true);
create policy "orders_update_authenticated" on public.orders for update to authenticated using (true);

create policy "restaurants_select" on public.restaurants for select using (true);
create policy "restaurants_write" on public.restaurants for all to authenticated using (true);

create policy "menu_items_select" on public.menu_items for select using (true);
create policy "menu_items_write" on public.menu_items for all to authenticated using (true);

create policy "riders_select_all" on public.riders for select to authenticated using (true);
create policy "riders_write_all" on public.riders for all to authenticated using (true);

create policy "pending_requests_select_own_or_admin" on public.pending_requests for select to authenticated using (data->>'userId' = auth.uid()::text or public.is_admin(auth.uid()));
create policy "pending_requests_insert_own" on public.pending_requests for insert to authenticated with check (data->>'userId' = auth.uid()::text);
create policy "pending_requests_admin_update" on public.pending_requests for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "pending_requests_admin_delete" on public.pending_requests for delete to authenticated using (public.is_admin(auth.uid()));

create policy "chats_select_all" on public.chats for select to authenticated using (true);
create policy "chats_write_all" on public.chats for all to authenticated using (true);

create policy "promo_codes_select" on public.promo_codes for select using (true);
create policy "promo_codes_admin_write" on public.promo_codes for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "admin_notifs_admin_select" on public.admin_notifs for select to authenticated using (public.is_admin(auth.uid()));
create policy "admin_notifs_admin_delete" on public.admin_notifs for delete to authenticated using (public.is_admin(auth.uid()));

create policy "app_config_select" on public.app_config for select using (true);
create policy "app_config_admin_write" on public.app_config for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "job_offers_select_authenticated" on public.job_offers for select to authenticated using (true);
create policy "job_offers_write_authenticated" on public.job_offers for all to authenticated using (true);

create policy "push_devices_own_all" on public.push_devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notification_deliveries_admin_select" on public.notification_deliveries for select to authenticated using (public.is_admin(auth.uid()));
