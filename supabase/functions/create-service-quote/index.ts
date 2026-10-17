import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://boomrider.vercel.app';
const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const requestWindows = new Map<string, { count: number; resetAt: number }>();

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

function allowRequest(userId: string) {
  const now = Date.now();
  const current = requestWindows.get(userId);
  if (!current || current.resetAt <= now) {
    requestWindows.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

function coordinate(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!authHeader || !supabaseUrl || !anonKey || !serviceKey) return json({ ok: false, reason: 'SERVICE_NOT_CONFIGURED' }, 503);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ ok: false, reason: 'UNAUTHORIZED' }, 401);
    if (!allowRequest(user.id)) return json({ ok: false, reason: 'RATE_LIMITED' }, 429);

    const body = await req.json();
    const serviceType = typeof body?.p_service_type === 'string' ? body.p_service_type.toLowerCase() : '';
    if (!['food', 'parcel', 'ride', 'service'].includes(serviceType)) return json({ ok: false, reason: 'INVALID_SERVICE_TYPE' }, 400);

    const pickupLat = coordinate(body?.p_pickup_lat);
    const pickupLng = coordinate(body?.p_pickup_lng);
    const dropoffLat = coordinate(body?.p_dropoff_lat);
    const dropoffLng = coordinate(body?.p_dropoff_lng);
    if ([pickupLat, pickupLng, dropoffLat, dropoffLng].some(value => value === null) ||
        pickupLat! < -90 || pickupLat! > 90 || dropoffLat! < -90 || dropoffLat! > 90 ||
        pickupLng! < -180 || pickupLng! > 180 || dropoffLng! < -180 || dropoffLng! > 180) {
      return json({ ok: false, reason: 'INVALID_COORDINATES' }, 400);
    }

    let routeDistanceMeters = 0;
    if (serviceType !== 'service') {
      const coordinates = `${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`;
      const routeResponse = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&alternatives=false`,
        { signal: AbortSignal.timeout(7_000), headers: { Accept: 'application/json' } },
      );
      if (!routeResponse.ok) return json({ ok: false, reason: 'ROUTING_UNAVAILABLE' }, 503);
      const routeData = await routeResponse.json();
      routeDistanceMeters = Number(routeData?.routes?.[0]?.distance);
      if (!Number.isFinite(routeDistanceMeters) || routeDistanceMeters <= 0) return json({ ok: false, reason: 'ROUTE_NOT_FOUND' }, 422);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: quote, error: quoteError } = await adminClient.rpc('create_service_quote_from_route', {
      p_customer_id: user.id,
      p_service_type: serviceType,
      p_pickup_lat: pickupLat,
      p_pickup_lng: pickupLng,
      p_dropoff_lat: dropoffLat,
      p_dropoff_lng: dropoffLng,
      p_route_distance_meters: routeDistanceMeters,
      p_restaurant_id: typeof body?.p_restaurant_id === 'string' ? body.p_restaurant_id : null,
      p_address_id: typeof body?.p_address_id === 'string' ? body.p_address_id : null,
      p_service_category: typeof body?.p_service_category === 'string' ? body.p_service_category : null,
      p_promo_code: typeof body?.p_promo_code === 'string' ? body.p_promo_code : null,
    });
    if (quoteError) {
      console.error('[create-service-quote] quote error', quoteError.message);
      return json({ ok: false, reason: 'QUOTE_UNAVAILABLE' }, 503);
    }
    return json(quote ?? { ok: false, reason: 'QUOTE_UNAVAILABLE' }, quote?.ok ? 200 : 422);
  } catch (error) {
    console.error('[create-service-quote]', error instanceof Error ? error.message : error);
    return json({ ok: false, reason: 'ROUTING_UNAVAILABLE' }, 503);
  }
});
