/**
 * processOrderPayment
 * ────────────────────────────────────────────────────────────────────────────
 * Firestore trigger: fires whenever an `orders/{orderId}` document is written.
 *
 * Responsible for:
 *  1. Detecting status transition → 'completed' (wallet orders only).
 *  2. Re-validating stored income figures against the live GP config
 *     (prevents a tampered client from inflating rider/merchant income).
 *  3. Atomically marking the order `incomeDistributed: true` so the function
 *     is idempotent even if it retries.
 *  4. Crediting rider, merchant, and admin wallets via server-side writes.
 *  5. Appending audit rows to the `transactions` collection.
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger }  = require('firebase-functions');
const { creditWallet, addEntry, saveTransaction } = require('./helpers');

// ── GP validation tolerance (THB) ─────────────────────────────────────────
// Allow small rounding gaps caused by promo codes or floating-point arithmetic.
const TOLERANCE = 2;

const processOrderPayment = onDocumentWritten(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const newSnap = event.data?.after;
    const oldSnap = event.data?.before;
    if (!newSnap?.exists) return; // document deleted — nothing to do

    const order    = newSnap.data();
    const oldOrder = oldSnap?.exists ? oldSnap.data() : {};

    // ── Guard: only process wallet orders transitioning to 'completed' ────
    if (order.status !== 'completed')      return;
    if (oldOrder.status === 'completed')   return; // already completed
    if (order.paymentMethod !== 'wallet')  return; // cash settled via processCashSettlement
    if (order.incomeDistributed === true)  return; // idempotency guard

    const orderId  = event.params.orderId;
    const shortId  = `#${orderId.slice(-6)}`;
    const db       = getFirestore();
    const ADMIN_UID = process.env.ADMIN_UID || '';

    // ── 1. Load GP config from Firestore (server-authoritative) ──────────
    const configSnap = await db.doc('system/config').get();
    const cfg        = configSnap.exists ? configSnap.data() : {};
    const gpFoodRate     = (cfg.gpFood     ?? 30) / 100;
    const gpDeliveryRate = (cfg.gpDelivery ?? 15) / 100;

    const foodTotal   = order.foodTotal   ?? 0;
    const deliveryFee = order.deliveryFee ?? 0;
    const promoDisc   = order.promoDiscount ?? 0;

    // ── 2. Re-calculate expected income figures ──────────────────────────
    const rawFoodGP     = parseFloat((foodTotal   * gpFoodRate).toFixed(2));
    const rawDeliveryGP = parseFloat((deliveryFee * gpDeliveryRate).toFixed(2));
    const totalRawGP    = rawFoodGP + rawDeliveryGP;
    const effectivePromo = Math.min(promoDisc, totalRawGP);

    const expectedAdminGP      = parseFloat((totalRawGP - effectivePromo).toFixed(2));
    const expectedMerchantInc  = parseFloat((foodTotal   - rawFoodGP).toFixed(2));
    const expectedRiderInc     = parseFloat((deliveryFee - rawDeliveryGP).toFixed(2));

    // ── 3. Determine actual amounts (prefer stored, fall back to computed) ─
    // The stored values were locked at order-placement time — use them unless
    // they differ suspiciously from what the current config would produce.
    let riderIncome    = typeof order.riderIncome    === 'number' ? order.riderIncome    : expectedRiderInc;
    let merchantIncome = typeof order.merchantIncome === 'number' ? order.merchantIncome : expectedMerchantInc;
    let adminGP        = typeof order.adminGP        === 'number' ? order.adminGP        : expectedAdminGP;

    // ── 4. Fraud / tampering check ────────────────────────────────────────
    // If any figure deviates too far from server-expected, clamp to the
    // server-computed value and log a warning for investigation.
    if (Math.abs(riderIncome    - expectedRiderInc)    > TOLERANCE) {
      logger.warn(`[processOrderPayment] riderIncome mismatch on ${orderId}: stored=${riderIncome} expected=${expectedRiderInc} — using server value`);
      riderIncome = expectedRiderInc;
    }
    if (Math.abs(merchantIncome - expectedMerchantInc) > TOLERANCE) {
      logger.warn(`[processOrderPayment] merchantIncome mismatch on ${orderId}: stored=${merchantIncome} expected=${expectedMerchantInc} — using server value`);
      merchantIncome = expectedMerchantInc;
    }
    if (Math.abs(adminGP        - expectedAdminGP)     > TOLERANCE) {
      logger.warn(`[processOrderPayment] adminGP mismatch on ${orderId}: stored=${adminGP} expected=${expectedAdminGP} — using server value`);
      adminGP = expectedAdminGP;
    }

    // ── 5. Resolve UIDs from order data ───────────────────────────────────
    // riderUid stored on order at acceptance time; shopOwnerUid stored at placement.
    const riderUid     = order.riderUid     || null;
    const shopOwnerUid = order.merchantUid  || null;
    const restName     = order.restaurantName || (order.type === 'parcel' ? 'พัสดุ' : '');

    logger.info(`[processOrderPayment] ${orderId} — rider=${riderUid} merchant=${shopOwnerUid} admin=${ADMIN_UID} | riderIncome=${riderIncome} merchantIncome=${merchantIncome} adminGP=${adminGP}`);

    // ── 6. Mark order as processed (idempotency) within a transaction ─────
    // Use runTransaction so the flag flip is atomic with the status check.
    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(db.doc(`orders/${orderId}`));
        if (!freshSnap.exists) throw new Error('ORDER_NOT_FOUND');
        const fresh = freshSnap.data();

        // Double-check inside the transaction to prevent race conditions
        if (fresh.incomeDistributed === true) throw new Error('ALREADY_PROCESSED');

        tx.update(db.doc(`orders/${orderId}`), {
          incomeDistributed: true,
          updatedAt:         FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      if (err.message === 'ALREADY_PROCESSED') {
        logger.info(`[processOrderPayment] ${orderId} already processed — skipping`);
        return;
      }
      throw err; // let Functions runtime retry on transient errors
    }

    // ── 7. Distribute income ──────────────────────────────────────────────
    const _d   = new Date();
    const _p   = n => String(n).padStart(2, '0');
    const now  = `${_p(_d.getDate())}/${_p(_d.getMonth()+1)}/${_d.getFullYear()} ${_p(_d.getHours())}:${_p(_d.getMinutes())}`;
    const jobs = [];

    if (riderUid && riderIncome > 0) {
      const gpNote = rawDeliveryGP > 0 ? ` (หัก GP ฿${Math.round(rawDeliveryGP)})` : '';
      jobs.push(creditWallet(riderUid, riderIncome, `ค่าส่ง ${restName} ${shortId}${gpNote}`));
      jobs.push(addEntry(riderUid, 'income', riderIncome, `ค่าส่ง ${restName} ${shortId}${gpNote}`));
    }
    if (shopOwnerUid && merchantIncome > 0) {
      const gpNote = rawFoodGP > 0 ? ` (หัก GP ฿${Math.round(rawFoodGP)})` : '';
      jobs.push(creditWallet(shopOwnerUid, merchantIncome, `รายได้ร้าน ${restName} ${shortId}${gpNote}`));
      jobs.push(addEntry(shopOwnerUid, 'income', merchantIncome, `รายได้ร้าน ${restName} ${shortId}${gpNote}`));
    }
    if (ADMIN_UID && adminGP > 0) {
      jobs.push(creditWallet(ADMIN_UID, adminGP, `GP ${restName} ${shortId}`));
      jobs.push(addEntry(ADMIN_UID, 'income', adminGP, `GP ${restName} ${shortId}`));
    }

    await Promise.allSettled(jobs);

    // ── 8. Transaction audit log ──────────────────────────────────────────
    const txJobs = [
      saveTransaction({
        type: 'order_completed', orderId,
        userId: order.customerId, userName: order.customerName,
        role: 'customer', amount: 0,
        desc: `ออเดอร์เสร็จสิ้น ${shortId}`, date: now,
      }),
    ];
    if (riderUid     && riderIncome    > 0) txJobs.push(saveTransaction({ type: 'rider_income',    orderId, userId: riderUid,     userName: order.riderName    || 'ไรเดอร์',  role: 'rider',    amount: riderIncome,    desc: `ค่าส่ง ${shortId}`,     date: now }));
    if (shopOwnerUid && merchantIncome > 0) txJobs.push(saveTransaction({ type: 'merchant_income', orderId, userId: shopOwnerUid, userName: restName            || 'ร้านค้า',  role: 'merchant', amount: merchantIncome, desc: `รายได้ร้าน ${shortId}`, date: now }));
    if (ADMIN_UID    && adminGP        > 0) txJobs.push(saveTransaction({ type: 'admin_gp',         orderId, userId: ADMIN_UID,   userName: 'Admin',                          role: 'admin',    amount: adminGP,        desc: `GP ${shortId}`,         date: now }));

    await Promise.allSettled(txJobs);

    logger.info(`[processOrderPayment] ${orderId} income distributed ✓`);
  },
);

module.exports = { processOrderPayment };
