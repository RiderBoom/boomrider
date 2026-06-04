/**
 * autoTimeoutPendingOrders
 * ─────────────────────────────────────────────────────────────────────────────
 * Scheduled Cloud Function (every 2 minutes) that finds orders stuck at
 * `pending` for more than 10 minutes and auto-cancels them.
 *
 * Per-order flow:
 *  1. runTransaction (idempotency guard via `timeoutProcessed: true`)
 *  2. Set status → 'cancelled_timeout'
 *  3. If paymentMethod == 'wallet': refund grandTotal to customer wallet
 *  4. Send FCM push to customer
 *
 * Race condition safety: the runTransaction re-reads the order inside the
 * transaction. If another process already set timeoutProcessed or changed
 * the status, the transaction throws 'SKIP' and we move on.
 */

const { onSchedule }    = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging }  = require('firebase-admin/messaging');
const { logger }        = require('firebase-functions');
const { creditWallet, addEntry, saveTransaction } = require('./helpers');

const TIMEOUT_MINUTES = 10;
const REGION          = 'asia-southeast1';

// ── FCM helpers (same pattern as onOrderStatusChanged) ───────────────────────

const getFcmToken = async (uid) => {
  if (!uid) return null;
  try {
    const snap = await getFirestore().doc(`users/${uid}`).get();
    return snap.exists ? (snap.data()?.fcmToken ?? null) : null;
  } catch (err) {
    logger.warn(`[autoTimeout] getFcmToken uid=${uid}: ${err?.message}`);
    return null;
  }
};

const sendToToken = async ({ token, title, body, data = {} }) => {
  if (!token) return;
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
          sound: 'default', channelId: 'boomrider_orders',
          defaultSound: true, defaultVibrateTimings: true,
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
      },
      webPush: {
        headers: { Urgency: 'high' },
        notification: { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' },
        fcmOptions: { link: '/' },
      },
    });
  } catch (err) {
    const code = err?.errorInfo?.code || err?.code || err?.message;
    logger.warn(`[autoTimeout] sendToToken failed: ${code}`);
  }
};

// ── Process a single timed-out order ─────────────────────────────────────────

const processTimedOutOrder = async (db, orderDoc) => {
  const orderId = orderDoc.id;
  const orderRef = db.doc(`orders/${orderId}`);

  // Idempotency: re-read inside transaction to guard against concurrent runs
  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      if (!fresh.exists) throw new Error('SKIP:not_found');

      const data = fresh.data();

      // Guard: another process already handled this, or merchant accepted in time
      if (data.timeoutProcessed === true) throw new Error('SKIP:already_processed');
      if (data.status !== 'pending')      throw new Error('SKIP:status_changed');

      tx.update(orderRef, {
        status:           'cancelled_timeout',
        timeoutProcessed: true,
        cancelReason:     'ร้านค้าไม่รับออเดอร์ภายใน 10 นาที',
        cancelledAt:      FieldValue.serverTimestamp(),
        updatedAt:        FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    if (err.message?.startsWith('SKIP:')) {
      logger.debug(`[autoTimeout] ${orderId} skipped — ${err.message}`);
      return; // expected, not an error
    }
    logger.error(`[autoTimeout] transaction failed for ${orderId}: ${err?.message}`);
    return;
  }

  // ── Transaction committed — now do the side-effects ──────────────────────
  const order      = orderDoc.data();
  const customerId = order.customerId || '';
  const shortId    = orderId.slice(-6).toUpperCase();
  const amount     = Number(order.grandTotal) || 0;
  const isWallet   = order.paymentMethod === 'wallet';

  logger.info(`[autoTimeout] cancelled #${shortId} customerId=${customerId} wallet=${isWallet} amount=${amount}`);

  const sideEffects = [];

  // ── Wallet refund (only if paid via wallet) ───────────────────────────────
  if (isWallet && customerId && amount > 0) {
    const refundDesc = `คืนเงินออเดอร์ #${shortId} (ร้านค้าไม่รับออเดอร์)`;

    sideEffects.push(
      creditWallet(customerId, amount, refundDesc).catch((err) =>
        logger.error(`[autoTimeout] creditWallet failed ${orderId}: ${err?.message}`),
      ),
    );

    sideEffects.push(
      addEntry(customerId, 'refund', amount, refundDesc).catch((err) =>
        logger.error(`[autoTimeout] addEntry failed ${orderId}: ${err?.message}`),
      ),
    );

    sideEffects.push(
      saveTransaction({
        type:        'refund',
        orderId,
        customerId,
        amount,
        reason:      'order_timeout',
        paymentMethod: 'wallet',
      }).catch((err) =>
        logger.error(`[autoTimeout] saveTransaction failed ${orderId}: ${err?.message}`),
      ),
    );
  }

  // ── FCM push to customer ──────────────────────────────────────────────────
  if (customerId) {
    const refundNote = isWallet && amount > 0
      ? ` คืนเงิน ฿${amount} เข้ากระเป๋าเงินแล้ว`
      : '';

    sideEffects.push(
      getFcmToken(customerId).then((token) =>
        sendToToken({
          token,
          title: '❌ ออเดอร์ถูกยกเลิกอัตโนมัติ',
          body:  `ออเดอร์ #${shortId} ถูกยกเลิกเนื่องจากร้านค้าไม่รับภายใน 10 นาที${refundNote}`,
          data:  { orderId, type: order.type || 'food', url: '/', role: 'customer' },
        }),
      ).catch((err) =>
        logger.warn(`[autoTimeout] push failed ${orderId}: ${err?.message}`),
      ),
    );
  }

  await Promise.allSettled(sideEffects);
};

// ── Scheduled Function ────────────────────────────────────────────────────────

const autoTimeoutPendingOrders = onSchedule(
  { schedule: 'every 2 minutes', region: REGION, timeoutSeconds: 540 },
  async () => {
    const db          = getFirestore();
    const cutoff      = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);
    const cutoffStamp = cutoff; // Firestore Timestamp comparison works with Date

    logger.info(`[autoTimeout] scanning pending orders older than ${cutoff.toISOString()}`);

    // Single-field equality query — no composite index needed.
    // Time filter is applied in-memory after fetch (pending orders are always a small set).
    let snap;
    try {
      snap = await db.collection('orders')
        .where('status', '==', 'pending')
        .get();
    } catch (err) {
      logger.error(`[autoTimeout] query failed: ${err?.message}`);
      return;
    }

    if (snap.empty) {
      logger.info('[autoTimeout] no timed-out orders found');
      return;
    }

    // Filter timed-out orders in-memory
    const timedOut = snap.docs.filter(d => {
      const updatedAt = d.data().updatedAt;
      if (!updatedAt) return false;
      const ts = updatedAt.toDate ? updatedAt.toDate() : new Date(updatedAt);
      return ts < cutoffStamp;
    });

    if (timedOut.length === 0) {
      logger.info('[autoTimeout] no timed-out orders found');
      return;
    }

    logger.info(`[autoTimeout] found ${timedOut.length} candidates (from ${snap.size} pending)`);

    // Process up to 20 at a time to stay well within the 540s timeout
    const docs    = timedOut.slice(0, 20);
    const results = await Promise.allSettled(
      docs.map((d) => processTimedOutOrder(db, d)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) logger.warn(`[autoTimeout] ${failed}/${docs.length} orders failed`);
    else logger.info(`[autoTimeout] processed ${docs.length} orders successfully`);
  },
);

module.exports = { autoTimeoutPendingOrders };
