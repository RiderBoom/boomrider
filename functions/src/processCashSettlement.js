/**
 * processCashSettlement
 * ────────────────────────────────────────────────────────────────────────────
 * Firestore trigger: fires whenever an `orders/{orderId}` document is written.
 *
 * Responsible for cash-order settlement when the rider marks the order
 * 'delivered' (they collected cash from the customer and now owe the platform
 * the merchant portion + admin GP).
 *
 *  Flow:
 *   Rider wallet  -= merchantIncome  (ยอดอาหารที่เก็บแทนร้านค้า)
 *   Rider wallet  -= adminGP         (GP ที่เก็บแทน platform)
 *   Merchant wallet += merchantIncome
 *   Admin wallet    += adminGP
 *
 * Mirrors the cash settlement block in useOrderActions.js → updateOrderStatus()
 * but runs server-side so no client can skip or falsify the settlement.
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger }  = require('firebase-functions');
const { creditWallet, addEntry, saveTransaction } = require('./helpers');

const TOLERANCE = 2;

const processCashSettlement = onDocumentWritten(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const newSnap = event.data?.after;
    const oldSnap = event.data?.before;
    if (!newSnap?.exists) return;

    const order    = newSnap.data();
    const oldOrder = oldSnap?.exists ? oldSnap.data() : {};

    // ── Guard: cash orders transitioning to 'delivered' only ─────────────
    if (order.status !== 'delivered')       return;
    if (oldOrder.status === 'delivered')    return;
    if (order.paymentMethod !== 'cash')     return;
    if (order.cashSettled === true)         return; // idempotency guard

    const orderId   = event.params.orderId;
    const shortId   = `#${orderId.slice(-6)}`;
    const db        = getFirestore();
    const ADMIN_UID = process.env.ADMIN_UID || '';

    // ── Load server-authoritative GP config ──────────────────────────────
    const configSnap = await db.doc('system/config').get();
    const cfg        = configSnap.exists ? configSnap.data() : {};
    const gpFoodRate     = (cfg.gpFood     ?? 30) / 100;
    const gpDeliveryRate = (cfg.gpDelivery ?? 15) / 100;

    const foodTotal   = order.foodTotal   ?? 0;
    const deliveryFee = order.deliveryFee ?? 0;
    const promoDisc   = order.promoDiscount ?? 0;

    const rawFoodGP     = parseFloat((foodTotal   * gpFoodRate).toFixed(2));
    const rawDeliveryGP = parseFloat((deliveryFee * gpDeliveryRate).toFixed(2));
    const totalRawGP    = rawFoodGP + rawDeliveryGP;
    const effectivePromo = Math.min(promoDisc, totalRawGP);

    const expectedAdminGP     = parseFloat((totalRawGP - effectivePromo).toFixed(2));
    const expectedMerchantInc = parseFloat((foodTotal  - rawFoodGP).toFixed(2));
    const expectedRiderInc    = parseFloat((deliveryFee - rawDeliveryGP).toFixed(2));

    let merchantIncome = typeof order.merchantIncome === 'number' ? order.merchantIncome : expectedMerchantInc;
    let adminGP        = typeof order.adminGP        === 'number' ? order.adminGP        : expectedAdminGP;
    let riderIncome    = typeof order.riderIncome    === 'number' ? order.riderIncome    : expectedRiderInc;

    if (Math.abs(merchantIncome - expectedMerchantInc) > TOLERANCE) {
      logger.warn(`[processCashSettlement] merchantIncome mismatch on ${orderId}: stored=${merchantIncome} expected=${expectedMerchantInc} — using server value`);
      merchantIncome = expectedMerchantInc;
    }
    if (Math.abs(adminGP - expectedAdminGP) > TOLERANCE) {
      logger.warn(`[processCashSettlement] adminGP mismatch on ${orderId}: stored=${adminGP} expected=${expectedAdminGP} — using server value`);
      adminGP = expectedAdminGP;
    }
    if (Math.abs(riderIncome - expectedRiderInc) > TOLERANCE) {
      logger.warn(`[processCashSettlement] riderIncome mismatch on ${orderId}: stored=${riderIncome} expected=${expectedRiderInc} — using server value`);
      riderIncome = expectedRiderInc;
    }

    const riderUid     = order.riderUid    || null;
    const shopOwnerUid = order.merchantUid || null;
    const restName     = order.restaurantName || (order.type === 'parcel' ? 'พัสดุ' : '');

    if (!shopOwnerUid) {
      logger.warn(`[processCashSettlement] ${orderId} — shopOwnerUid is null: merchant will NOT be credited. Check restaurant.ownerId for restaurantId=${order.restaurantId}`);
    }
    if (!riderUid) {
      logger.warn(`[processCashSettlement] ${orderId} — riderUid is null: cash settlement cannot debit rider or credit merchant correctly.`);
    }
    logger.info(`[processCashSettlement] ${orderId} — rider=${riderUid} merchant=${shopOwnerUid} | riderIncome=${riderIncome} merchantIncome=${merchantIncome} adminGP=${adminGP}`);

    // ── Mark as settled atomically ────────────────────────────────────────
    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(db.doc(`orders/${orderId}`));
        if (!freshSnap.exists) throw new Error('ORDER_NOT_FOUND');
        if (freshSnap.data().cashSettled === true) throw new Error('ALREADY_SETTLED');
        tx.update(db.doc(`orders/${orderId}`), {
          cashSettled: true,
          updatedAt:   FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      if (err.message === 'ALREADY_SETTLED') {
        logger.info(`[processCashSettlement] ${orderId} already settled — skipping`);
        return;
      }
      throw err;
    }

    // ── Settle wallets ────────────────────────────────────────────────────
    const _d   = new Date();
    const _p   = n => String(n).padStart(2, '0');
    const now  = `${_p(_d.getDate())}/${_p(_d.getMonth()+1)}/${_d.getFullYear()} ${_p(_d.getHours())}:${_p(_d.getMinutes())}`;
    const jobs = [];

    // Cash order: rider collected grandTotal as physical cash from the customer.
    // Merchant receives food portion as physical cash from the rider — no wallet credit.
    // Only the platform GP is settled digitally: deducted from rider, credited to admin.
    if (riderUid && adminGP > 0) {
      jobs.push(creditWallet(riderUid, -adminGP, `หัก GP(สด) ${restName} ${shortId}`));
      jobs.push(addEntry(riderUid, 'expense', -adminGP, `หัก GP(สด) ${restName} ${shortId}`));
    }
    if (ADMIN_UID && adminGP > 0) {
      jobs.push(creditWallet(ADMIN_UID, adminGP, `GP(สด) ${restName} ${shortId}`));
      jobs.push(addEntry(ADMIN_UID, 'income', adminGP, `GP(สด) ${restName} ${shortId}`));
    }

    await Promise.allSettled(jobs);

    // ── Audit log ─────────────────────────────────────────────────────────
    const txJobs = [];
    if (adminGP > 0) txJobs.push(saveTransaction({ type: 'admin_gp', orderId, userId: ADMIN_UID, userName: 'Admin', role: 'admin', amount: adminGP, desc: `GP(สด) ${shortId}`, date: now }));
    await Promise.allSettled(txJobs);

    logger.info(`[processCashSettlement] ${orderId} cash settled ✓`);
  },
);

module.exports = { processCashSettlement };
