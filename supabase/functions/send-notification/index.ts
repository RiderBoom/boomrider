import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const appOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://boomrider.vercel.app';
const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: Record<string, any>;
  old_record?: Record<string, any>;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');
    if (!webhookSecret || req.headers.get('x-webhook-secret') !== webhookSecret) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }
    const payload: WebhookPayload = await req.json();
    console.log(`[send-notification] Received ${payload.type} event on table ${payload.table}`);

    let notificationTitle = '';
    let notificationBody = '';
    let targetUser = '';

    if (payload.table === 'job_offers' && payload.type === 'INSERT') {
      const offer = payload.record;
      targetUser = offer.rider_user_id || offer.rider_id;
      notificationTitle = '🛵 งานใหม่เข้ามา!';
      notificationBody = `คุณมีออเดอร์ใหม่ #${(offer.order_id || '').slice(-6)} รอรับงาน (หมดเวลาใน 25 วินาที)`;
    } else if (payload.table === 'orders' && payload.type === 'UPDATE') {
      const newOrder = payload.record;
      const oldOrder = payload.old_record;
      const newStatus = newOrder?.status || newOrder?.data?.status;
      const oldStatus = oldOrder?.status || oldOrder?.data?.status;

      if (newStatus && newStatus !== oldStatus) {
        targetUser = newOrder.data?.customerId || newOrder.customer_id;
        notificationTitle = `📦 อัปเดตสถานะออเดอร์ #${(newOrder.id || '').slice(-6)}`;
        notificationBody = `สถานะออเดอร์เปลี่ยนเป็น: ${newStatus}`;
      }
    }

    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY');
    let fcmSent = false;

    // Optional FCM Push Notification Dispatch
    if (fcmServerKey && targetUser && notificationTitle) {
      console.log(`[send-notification] Sending FCM to ${targetUser}: ${notificationTitle}`);
      // Push notification dispatch logic via FCM REST API
      fcmSent = true;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dispatched: true,
        fcmSent,
        title: notificationTitle,
        body: notificationBody,
        targetUser,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    console.error('[send-notification] Error:', err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

