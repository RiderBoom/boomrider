// ── useAutoDispatch.js ────────────────────────────────────────────────────────
// Calls dispatch_order RPC when merchant marks order as ready_to_pickup.
// Wraps the RPC in a debounce guard to prevent double-fire.

const _inFlight = new Set();

export async function autoDispatch(supabase, order) {
  const { id: orderId, pickupLocation } = order;
  if (!orderId || !pickupLocation?.lat || !pickupLocation?.lng) return null;

  // Debounce: skip if a dispatch for this order is already in-flight
  if (_inFlight.has(orderId)) return null;
  _inFlight.add(orderId);

  try {
    const { data, error } = await supabase.rpc('dispatch_order', {
      p_order_id:   orderId,
      p_pickup_lat: pickupLocation.lat,
      p_pickup_lng: pickupLocation.lng,
      p_radius_km:  5,
    });

    if (error) {
      console.error('[AutoDispatch] RPC error:', error.message);
      return null;
    }

    return data; // { ok, offer_id, rider_id, attempt, dist_km } | { ok:false, reason }
  } finally {
    // Allow retry after 30 s (one offer cycle)
    setTimeout(() => _inFlight.delete(orderId), 30_000);
  }
}

// Called by RiderView when a job_offer expires on the client (before Edge Function runs)
export async function timeoutOffer(supabase, offerId) {
  await supabase
    .from('job_offers')
    .update({ status: 'timeout', responded_at: new Date().toISOString() })
    .eq('id', offerId)
    .eq('status', 'pending');
}

// Called when rider rejects — triggers next dispatch attempt immediately
export async function rejectAndRedispatch(supabase, offerId, order) {
  await supabase
    .from('job_offers')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', offerId)
    .eq('status', 'pending');

  // Immediately try next rider (don't wait for pg_cron)
  return autoDispatch(supabase, order);
}
