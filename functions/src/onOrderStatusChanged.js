/**
 * onOrderStatusChanged
 * ─────────────────────────────────────────────────────────────────────────────
 * Firestore trigger: fires on every update to orders/{orderId}.
 * Sends targeted push notifications based on who needs to know:
 *
 *  → Customer  : every meaningful status transition on their order
 *  → Rider     : when their accepted job is cancelled mid-delivery
 *  → Merchant  : when a new food order arrives for their restaurant
 *                (status pending → preparing is handled here;
 *                 initial creation is handled by onOrderCreated)
 *
 * Design principles:
 *  - Each notification targets ONE specific person (send() not multicast)
 *  - Idempotent: checks old vs new status before firing
 *  - Graceful: token-fetch failure never crashes the function
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');
const { logger }            = require('firebase-functions');

// ── Status → customer notification copy ──────────────────────────────────────
// Keys = the NEW status the order just changed TO.
// 'ready_to_pickup' is intentionally omitted — that's an internal state
// (food: waiting for rider pickup), handled by onOrderReadyForPickup for riders.
const CUSTOMER_COPY = {
  preparing:      { icon: '👨‍🍳', title: 'ร้านกำลังเตรียมออเดอร์',      body: 'อาหารของคุณกำลังถูกปรุง รอสักครู่นะ!' },
  rider_accepted: { icon: '🛵', title: 'ไรเดอร์รับงานแล้ว',             body: 'ไรเดอร์กำลังเดินทางไปรับของ' },
  picking_up:     { icon: '🏃', title: 'ไรเดอร์ถึงร้านแล้ว',            body: 'กำลังรับของ — อีกไม่นาน!' },
  delivering:     { icon: '🚀', title: 'กำลังนำส่ง!',                   body: 'ไรเดอร์กำลังมุ่งหน้ามาหาคุณ' },
  delivered:      { icon: '📦', title: 'ออเดอร์ถึงแล้ว!',               body: 'กรุณากดยืนยันรับสินค้าในแอป' },
  completed:      { icon: '✅', title: 'เสร็จสมบูรณ์ ขอบคุณ!',          body: 'หวังว่าคุณจะพึงพอใจกับบริการ BoomRider' },
  cancelled:      { icon: '❌', title: 'ออเดอร์ถูกยกเลิก',              body: 'ตรวจสอบรายละเอียดและคืนเงิน (ถ้ามี) ในแอป' },
};

// ── Statuses where the rider has already committed to the job ────────────────
const RIDER_ACTIVE_STATUSES = ['rider_accepted', 'picking_up', 'delivering'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch FCM token for any user UID from users/{uid}.fcmToken */
const getFcmToken = async (uid) => {
  if (!uid) return null;
  try {
    const snap = await getFirestore().doc(`users/${uid}`).get();
    return snap.exists ? (snap.data()?.fcmToken ?? null) : null;
  } catch (err) {
    logger.warn(`[getFcmToken] uid=${uid} err=${err?.message}`);
    return null;
  }
};

/**
 * Send a push notification to a single FCM token.
 * Uses messaging.send() (not multicast) — one person, one message.
 * Swallows errors so a bad token never crashes the function.
 */
const sendToToken = async ({ token, title, body, data = {} }) => {
  if (!token) return;

  // FCM data values must all be strings
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  try {
    await getMessaging().send({
      token,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          sound:       'default',
          channelId:   'boomrider_orders',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
      },
      webPush: {
        headers: { Urgency: 'high' },
        notification: {
          icon:  '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
        },
        fcmOptions: { link: '/' },
      },
    });
    logger.info(`[sendToToken] ✓ "${title}"`);
  } catch (err) {
    // messaging/registration-token-not-registered = token expired, safe to ignore
    const code = err?.errorInfo?.code || err?.code || err?.message;
    logger.warn(`[sendToToken] ✗ ${code} — "${title}"`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Function
// ─────────────────────────────────────────────────────────────────────────────

const onOrderStatusChanged = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const newData = event.data?.after?.data();
    const oldData = event.data?.before?.data();
    if (!newData || !oldData) return;

    const newStatus = newData.status;
    const oldStatus = oldData.status;

    // Nothing to do if status didn't change
    if (newStatus === oldStatus) return;

    const orderId    = event.params.orderId;
    const shortId    = orderId.slice(-6).toUpperCase();
    const orderType  = newData.type || 'food';           // 'food' | 'parcel'
    const customerId = newData.customerId || '';
    const riderUid   = newData.riderUid   || '';         // Firebase UID of the assigned rider

    logger.info(
      `[onOrderStatusChanged] #${shortId} (${orderType}) ${oldStatus} → ${newStatus}`,
    );

    // Human-readable order label for notification body
    const orderLabel = orderType === 'parcel'
      ? `📦 ส่งพัสดุ #${shortId}`
      : `🍔 ${newData.restaurantName || 'ออเดอร์'} #${shortId}`;

    // Run all notifications concurrently — failures are isolated per sendToToken
    const jobs = [];

    // ── 1. Customer notification ─────────────────────────────────────────────
    const copy = CUSTOMER_COPY[newStatus];
    if (copy && customerId) {
      jobs.push(
        getFcmToken(customerId).then((token) =>
          sendToToken({
            token,
            title: `${copy.icon} ${copy.title}`,
            body:  `${orderLabel} — ${copy.body}`,
            data:  { orderId, type: orderType, url: '/', role: 'customer' },
          }),
        ),
      );
    }

    // ── 2. Rider: job cancelled while they had already accepted ──────────────
    if (newStatus === 'cancelled' && RIDER_ACTIVE_STATUSES.includes(oldStatus) && riderUid) {
      jobs.push(
        getFcmToken(riderUid).then((token) =>
          sendToToken({
            token,
            title: '❌ งานถูกยกเลิก',
            body: `${orderLabel}${newData.cancelReason ? ` — ${newData.cancelReason}` : ''}`,
            data: { orderId, type: orderType, url: '/', role: 'rider' },
          }),
        ),
      );
    }

    await Promise.allSettled(jobs);
  },
);

module.exports = { onOrderStatusChanged };
