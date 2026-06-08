// ── useJobOffer.js ─────────────────────────────────────────────────────────────
// Rider-side hook: subscribes to job_offers table via Supabase Realtime.
// When a new offer arrives, shows a 25-second countdown popup.
// Handles accept / reject / timeout with race-condition protection.

import { useEffect, useRef, useState, useCallback } from 'react';

export function useJobOffer({ supabase, riderUserId, onAccepted, onRejected }) {
  const [offer,     setOffer]     = useState(null);  // current job offer row
  const [countdown, setCountdown] = useState(0);     // seconds remaining
  const [accepting, setAccepting] = useState(false); // debounce guard

  const channelRef     = useRef(null);
  const timerRef       = useRef(null);   // auto-timeout setTimeout
  const intervalRef    = useRef(null);   // 1-second tick setInterval
  const processedRef   = useRef(new Set()); // prevent double-processing

  const clearTimers = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(intervalRef.current);
  }, []);

  // Start countdown for a given offer
  const startCountdown = useCallback((newOffer) => {
    clearTimers();
    const secsLeft = Math.max(
      0,
      Math.ceil((new Date(newOffer.expires_at).getTime() - Date.now()) / 1000),
    );
    setCountdown(secsLeft);

    // Tick every second
    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);

    // Auto-timeout: mark expired on server + dismiss UI
    timerRef.current = setTimeout(async () => {
      clearTimers();
      await supabase
        .from('job_offers')
        .update({ status: 'timeout', responded_at: new Date().toISOString() })
        .eq('id', newOffer.id)
        .eq('status', 'pending');
      setOffer(null);
      setCountdown(0);
    }, secsLeft * 1000);
  }, [supabase, clearTimers]);

  // ── Accept ────────────────────────────────────────────────────────────────
  const acceptOffer = useCallback(async (offerId) => {
    if (accepting) return false;
    setAccepting(true);
    clearTimers();
    try {
      const { error } = await supabase
        .from('job_offers')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', offerId)
        .eq('status', 'pending'); // only update if still pending (prevents race)

      if (error) {
        console.error('[JobOffer] accept error:', error.message);
        return false;
      }
      setOffer(null);
      setCountdown(0);
      onAccepted?.();
      return true;
    } finally {
      setAccepting(false);
    }
  }, [supabase, accepting, clearTimers, onAccepted]);

  // ── Reject / Re-dispatch ──────────────────────────────────────────────────
  const rejectOffer = useCallback(async (offerId, orderForRedispatch) => {
    clearTimers();
    await supabase
      .from('job_offers')
      .update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq('id', offerId)
      .eq('status', 'pending');
    setOffer(null);
    setCountdown(0);

    // Immediately try next rider — don't wait for pg_cron / Edge Function
    if (orderForRedispatch?.pickupLocation?.lat) {
      supabase.rpc('dispatch_order', {
        p_order_id:   orderForRedispatch.id,
        p_pickup_lat: orderForRedispatch.pickupLocation.lat,
        p_pickup_lng: orderForRedispatch.pickupLocation.lng,
        p_radius_km:  5,
      }).then(() => {});
    }
    onRejected?.();
  }, [supabase, clearTimers, onRejected]);

  // ── Supabase Realtime subscription ───────────────────────────────────────
  useEffect(() => {
    if (!riderUserId) return;

    channelRef.current = supabase
      .channel(`job-offers-${riderUserId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'job_offers',
          filter: `rider_user_id=eq.${riderUserId}`,
        },
        (payload) => {
          const newOffer = payload.new;
          // Skip if already processed or not pending
          if (processedRef.current.has(newOffer.id)) return;
          if (newOffer.status !== 'pending') return;
          // Skip if already expired
          if (new Date(newOffer.expires_at).getTime() < Date.now()) return;

          processedRef.current.add(newOffer.id);
          setOffer(newOffer);
          startCountdown(newOffer);
        },
      )
      .subscribe();

    return () => {
      clearTimers();
      supabase.removeChannel(channelRef.current);
    };
  }, [riderUserId, supabase, startCountdown, clearTimers]);

  // Cleanup timers on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  return { offer, countdown, accepting, acceptOffer, rejectOffer };
}
