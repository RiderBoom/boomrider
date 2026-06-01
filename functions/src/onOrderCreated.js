/**
 * onOrderCreated + onOrderReadyForPickup
 * ────────────────────────────────────────────────────────────────────────────
 * Push notifications to riders (and admin) via Firebase Cloud Messaging.
 *
 *  onOrderCreated       — fires on any new order document
 *    • Parcel order   → notify all active riders immediately (already ready_to_pickup)
 *    • Food order     → notify admin only (riders get notified when shop marks ready)
 *
 *  onOrderReadyForPickup — fires when order.status changes to 'ready_to_pickup'
 *    • Food order ready → notify all active riders
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getFirestore }   = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');
const { logger }         = require('firebase-functions');

const ADMIN_UID = process.env.ADMIN_UID || '';

// ── Shared: fetch all active rider tokens + admin token ─────────────────────

/**
 * Returns { riderTokens: string[], adminToken: string|null }
 * riderTokens = fcmTokens of riders where status == 'active' and token exists
 * adminToken  = fcmToken of the admin user
 */
const fetchTokens = async ({ includeRiders = true, includeAdmin = false } = {}) => {
  const db          = getFirestore();
  const riderTokens = [];
  let   adminToken  = null;

  const jobs = [];

  if (includeRiders) {
    jobs.push(
      db.collection('riders').where('status', '==', 'active').get().then(async (snap) => {
        // For each active rider, look up their FCM token in users/{userId}
        const userReads = snap.docs
          .filter(d => d.data().userId)
          .map(d => db.doc(`users/${d.data().userId}`).get());

        const userSnaps = await Promise.all(userReads);
        userSnaps.forEach((us, idx) => {
          const token = us.exists ? us.data()?.fcmToken : null;
          if (token) {
            riderTokens.push(token);
          } else {
            logger.debug(`[fetchTokens] no fcmToken for rider userId=${snap.docs[idx]?.data()?.userId}`);
          }
        });
      }),
    );
  }

  if (includeAdmin && ADMIN_UID) {
    jobs.push(
      db.doc(`users/${ADMIN_UID}`).get().then((snap) => {
        const token = snap.exists ? snap.data()?.fcmToken : null;
        if (token) adminToken = token;
      }),
    );
  }

  await Promise.allSettled(jobs);
  return { riderTokens, adminToken };
};

// ── Shared: build & send a multicast notification ────────────────────────────

/**
 * Sends to a list of FCM tokens and logs any invalid tokens for cleanup.
 * Uses sendEachForMulticast so we get per-token results.
 */
const sendMulticast = async ({ tokens, title, body, data = {} }) => {
  if (!tokens || tokens.length === 0) {
    logger.info('[sendMulticast] no tokens — skipping');
    return;
  }

  // FCM limit: 500 tokens per sendEachForMulticast call
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  const messaging = getMessaging();

  for (const chunk of chunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          sound:     'default',
          channelId: 'boomrider_orders',
          priority:  'max',
          defaultSound:       true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
      },
      webPush: {
        headers:     { Urgency: 'high' },
        notification: { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' },
        fcmOptions:  { link: '/' },
      },
    });

    logger.info(`[sendMulticast] sent=${response.successCount} failed=${response.failureCount}`);

    // Log (don't delete) tokens that returned UNREGISTERED — they should be cleaned
    // up on next login when the client refreshes the token.
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code;
        logger.warn(`[sendMulticast] token[${i}] failed: ${code}`);
      }
    });
  }
};

// ── onOrderCreated ────────────────────────────────────────────────────────────

const onOrderCreated = onDocumentCreated(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const order = event.data?.data();
    if (!order) return;

    const orderId  = event.params.orderId;
    const shortId  = orderId.slice(-6);
    const isParcel = order.type === 'parcel';
    const isFood   = order.type === 'food';

    logger.info(`[onOrderCreated] orderId=${orderId} type=${order.type} status=${order.status}`);

    // ── Parcel: notify riders immediately (already ready_to_pickup) ──────────
    if (isParcel) {
      const { riderTokens, adminToken } = await fetchTokens({ includeRiders: true, includeAdmin: true });
      const allTokens = [...new Set([...riderTokens, ...(adminToken ? [adminToken] : [])])];

      await sendMulticast({
        tokens: allTokens,
        title:  '📦 งานส่งพัสดุใหม่!',
        body:   `${order.pickup || 'จุดรับ'} → ${order.dropoff || 'จุดส่ง'}  ค่าส่ง ฿${order.deliveryFee ?? order.grandTotal ?? 0}`,
        data:   { orderId, type: 'parcel', url: '/' },
      });
      return;
    }

    // ── Food: notify admin only — riders get notified when shop marks ready ──
    if (isFood && ADMIN_UID) {
      const { adminToken } = await fetchTokens({ includeRiders: false, includeAdmin: true });
      if (adminToken) {
        await sendMulticast({
          tokens: [adminToken],
          title:  '🛍️ ออเดอร์อาหารใหม่',
          body:   `${order.customerName || 'ลูกค้า'} สั่งจาก ${order.restaurantName || ''} ฿${order.grandTotal ?? 0}  #${shortId}`,
          data:   { orderId, type: 'food', url: '/' },
        });
      }
    }
  },
);

// ── onOrderReadyForPickup ─────────────────────────────────────────────────────
// Fires when a food order's status changes to 'ready_to_pickup'.
// This is when the rider needs to be notified.

const onOrderReadyForPickup = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const newData = event.data?.after?.data();
    const oldData = event.data?.before?.data();
    if (!newData || !oldData) return;

    // Only fire on the specific transition → ready_to_pickup
    if (newData.status !== 'ready_to_pickup') return;
    if (oldData.status === 'ready_to_pickup') return;
    if (newData.riderId) return; // already taken

    const orderId      = event.params.orderId;
    const shortId      = orderId.slice(-6);
    const restName     = newData.restaurantName || '';
    const deliveryFee  = newData.deliveryFee ?? 0;
    const customerAddr = newData.address || '';

    logger.info(`[onOrderReadyForPickup] orderId=${orderId} restaurant=${restName}`);

    const { riderTokens } = await fetchTokens({ includeRiders: true, includeAdmin: false });

    await sendMulticast({
      tokens: riderTokens,
      title:  '🍔 มีออเดอร์พร้อมส่ง!',
      body:   `${restName}  →  ${customerAddr}  ค่าส่ง ฿${deliveryFee}  #${shortId}`,
      data:   { orderId, type: 'food', url: '/' },
    });
  },
);

module.exports = { onOrderCreated, onOrderReadyForPickup };
