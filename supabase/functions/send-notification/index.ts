type Json = Record<string, any>;
type WebhookPayload = { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; record: Json; old_record?: Json };
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') || 'https://boomrider.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-webhook-secret',
};
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const rest = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const base64Url = (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const loadServiceAccount = (): ServiceAccount => {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  let account: ServiceAccount;
  try { account = JSON.parse(raw); } catch { account = JSON.parse(atob(raw)); }
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error('Firebase service account is missing required fields');
  }
  return account;
};

const importPrivateKey = async (pem: string) => {
  const clean = pem.replace(/-----[^-]+-----|\s/g, '');
  const der = Uint8Array.from(atob(clean), char => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
};

const getGoogleAccessToken = async (account: ServiceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    await importPrivateKey(account.private_key), new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(`Google OAuth failed (${response.status})`);
  return result.access_token as string;
};

const rowData = (row: Json) => row?.data || row || {};

const buildNotification = async (payload: WebhookPayload) => {
  const record = payload.record || {};
  const data = rowData(record);
  const users = new Set<string>();
  let title = '', body = '', channel = 'orders', kind = 'order_status';
  let orderId = String(record.order_id || data.id || record.id || '');

  if (payload.table === 'job_offers' && payload.type === 'INSERT') {
    if (record.rider_user_id) users.add(String(record.rider_user_id));
    title = '🛵 งานใหม่เข้ามา!';
    body = `คุณมีออเดอร์ใหม่ #${String(record.order_id || '').slice(-6)} รอรับงาน`;
    channel = 'new_jobs'; kind = 'new_job'; orderId = String(record.order_id || '');
  } else if (payload.table === 'orders' && payload.type === 'INSERT') {
    [data.customerId, data.restaurantOwnerId].filter(Boolean).forEach(id => users.add(String(id)));
    title = '🛎️ ออเดอร์ใหม่'; body = `ออเดอร์ #${orderId.slice(-6)} ถูกสร้างเรียบร้อยแล้ว`;
    channel = 'merchant_orders'; kind = 'new_order';
  } else if (payload.table === 'orders' && payload.type === 'UPDATE') {
    const oldData = rowData(payload.old_record || {});
    if (!data.status || data.status === oldData.status) return null;
    [data.customerId, data.restaurantOwnerId, data.riderUserId]
      .filter(Boolean).forEach(id => users.add(String(id)));
    const labels: Json = {
      preparing: 'ร้านกำลังเตรียมอาหาร', ready_to_pickup: 'อาหารพร้อมรับแล้ว',
      rider_accepted: 'ไรเดอร์รับงานแล้ว', picking_up: 'ไรเดอร์ถึงจุดรับแล้ว',
      delivering: 'กำลังเดินทางไปส่ง', delivered: 'สินค้าเดินทางถึงแล้ว',
      completed: 'จัดส่งสำเร็จ', cancelled: 'ออเดอร์ถูกยกเลิก',
    };
    title = `📦 อัปเดตออเดอร์ #${orderId.slice(-6)}`;
    body = labels[data.status] || `สถานะเปลี่ยนเป็น ${data.status}`;
  } else if (payload.table === 'admin_notifs' && payload.type === 'INSERT') {
    const roles = await rest('user_roles?select=user_id&role=eq.admin');
    roles?.forEach((row: Json) => users.add(String(row.user_id)));
    title = String(record.title || 'BoomRider Admin');
    body = String(record.message || 'มีเหตุการณ์ใหม่ที่ต้องตรวจสอบ');
    channel = 'admin_alerts'; kind = 'admin_alert';
  } else return null;

  return { users: [...users], title, body, channel, kind, orderId, status: String(data.status || '') };
};

const eventKey = (payload: WebhookPayload) => {
  const record = payload.record || {};
  const data = rowData(record);
  const id = record.id || record.order_id || data.id || 'unknown';
  const version = data.status || record.status || record.updated_at || record.created_at || 'event';
  return `${payload.table}:${payload.type}:${id}:${version}`;
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const expectedSecret = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');
    if (!expectedSecret || req.headers.get('x-webhook-secret') !== expectedSecret) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase service configuration is missing');

    const payload: WebhookPayload = await req.json();
    const notification = await buildNotification(payload);
    if (!notification?.users.length) return Response.json({ ok: true, skipped: true }, { headers: corsHeaders });

    const key = eventKey(payload);
    const encodedKey = encodeURIComponent(key);
    const previous = await rest(`notification_deliveries?select=status&event_key=eq.${encodedKey}`);
    if (previous?.[0] && ['processing', 'sent', 'partial'].includes(previous[0].status)) {
      return Response.json({ ok: true, duplicate: true }, { headers: corsHeaders });
    }
    if (previous?.[0]) {
      await rest(`notification_deliveries?event_key=eq.${encodedKey}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'processing', last_error: null }),
      });
    } else {
      await rest('notification_deliveries', {
        method: 'POST', body: JSON.stringify({ event_key: key, event_type: notification.kind }),
      });
    }

    const orFilter = notification.users.map(id => `user_id.eq.${id}`).join(',');
    const devices = await rest(`push_devices?select=id,token&enabled=eq.true&or=(${encodeURIComponent(orFilter)})`);
    if (!devices?.length) {
      await rest(`notification_deliveries?event_key=eq.${encodedKey}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'skipped', completed_at: new Date().toISOString() }),
      });
      return Response.json({ ok: true, skipped: true, reason: 'no_devices' }, { headers: corsHeaders });
    }

    const account = loadServiceAccount();
    const accessToken = await getGoogleAccessToken(account);
    let success = 0, failure = 0;
    for (const device of devices) {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: device.token,
          notification: { title: notification.title, body: notification.body },
          data: { type: notification.kind, orderId: notification.orderId, status: notification.status },
          android: { priority: 'high', notification: {
            channel_id: notification.channel, sound: 'default',
            default_vibrate_timings: true, visibility: 'PRIVATE',
          } },
        } }),
      });
      if (response.ok) success += 1;
      else {
        failure += 1;
        const detail = await response.text();
        if (/UNREGISTERED|registration-token-not-registered/.test(detail)) {
          await rest(`push_devices?id=eq.${device.id}`, {
            method: 'PATCH', body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
          });
        }
      }
    }

    const status = success === devices.length ? 'sent' : success ? 'partial' : 'failed';
    await rest(`notification_deliveries?event_key=eq.${encodedKey}`, {
      method: 'PATCH', body: JSON.stringify({
        status, target_count: devices.length, success_count: success, failure_count: failure,
        last_error: failure ? `${failure} FCM delivery attempt(s) failed` : null,
        completed_at: new Date().toISOString(),
      }),
    });
    return Response.json({ ok: failure === 0, status, targets: devices.length, success, failure }, {
      status: success ? 200 : 502, headers: corsHeaders,
    });
  } catch (error) {
    console.error('[send-notification]', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ ok: false, error: 'Notification dispatch failed' }, { status: 500, headers: corsHeaders });
  }
});
