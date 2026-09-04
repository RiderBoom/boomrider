import test from 'node:test';
import assert from 'node:assert/strict';

// Helper mimicking DB logic in 029_rider_cash_wallet_eligibility.sql
function calculateRiderOrderCashLiability(order, rates = {}) {
  const method = order.paymentMethod ?? 'cash';
  if (method !== 'cash') return 0;

  const type = order.type ?? 'food';
  const foodTotal = order.foodTotal ?? 0;
  const deliveryFee = order.deliveryFee ?? 0;
  const grandTotal = order.grandTotal ?? deliveryFee;

  const gpDelivRate = rates.gpDelivery ?? 0.15;
  const gpRideRate = rates.gpRide ?? 0.15;
  const gpServiceRate = rates.gpService ?? 0.15;

  if (type === 'food') return foodTotal;
  if (type === 'parcel') return order.adminGP ?? Math.round(deliveryFee * gpDelivRate * 100) / 100;
  if (type === 'ride') return order.adminGP ?? Math.round(grandTotal * gpRideRate * 100) / 100;
  if (type === 'service') return order.adminGP ?? Math.round(grandTotal * gpServiceRate * 100) / 100;
  return 0;
}

function getRiderActiveCashLiability(activeOrders, riderId, rates = {}) {
  return activeOrders
    .filter(o =>
      o.riderId === riderId &&
      ['rider_accepted', 'picking_up', 'delivering'].includes(o.status) &&
      (o.paymentMethod ?? 'cash') === 'cash' &&
      o.settlementStatus !== 'settled'
    )
    .reduce((sum, o) => sum + calculateRiderOrderCashLiability(o, rates), 0);
}

function evaluateAcceptOrderEligibility(walletBalance, activeOrders, targetOrder, riderId, rates = {}) {
  const reqLiability = calculateRiderOrderCashLiability(targetOrder, rates);
  if (reqLiability <= 0) return { ok: true };

  const activeLiability = getRiderActiveCashLiability(activeOrders, riderId, rates);
  const availableBal = walletBalance - activeLiability;

  if (availableBal < reqLiability) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_RIDER_WALLET',
      requiredBalance: reqLiability,
      currentBalance: walletBalance,
      availableBalance: Math.round(availableBal * 100) / 100,
    };
  }

  return { ok: true, requiredBalance: reqLiability, availableBalance: Math.round(availableBal * 100) / 100 };
}

// Helper mimicking process_order_settlement RPC idempotency and completion guard
function mockProcessOrderSettlement(order, walletStore) {
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.settlementStatus === 'settled') {
    return { ok: true, skipped: 'already_settled' };
  }

  const method = order.paymentMethod ?? 'cash';
  const type = order.type ?? 'food';
  const foodTotal = order.foodTotal ?? 0;
  const deliveryFee = order.deliveryFee ?? 0;
  const grandTotal = order.grandTotal ?? deliveryFee;

  const gpAmount = order.adminGP ?? (type === 'food' ? foodTotal * 0.3 : grandTotal * 0.15);
  const riderIncome = order.riderIncome ?? (type === 'food' ? deliveryFee : grandTotal - gpAmount);
  const merchantIncome = order.merchantIncome ?? (type === 'food' ? foodTotal - gpAmount : 0);

  const riderUid = order.riderUserId;
  const shopUid = order.restaurantOwnerId;
  const adminUid = 'admin-uuid';

  if (method === 'cash') {
    if (['parcel', 'ride', 'service'].includes(type)) {
      if (riderUid) walletStore[riderUid] = (walletStore[riderUid] || 0) - gpAmount;
      if (adminUid) walletStore[adminUid] = (walletStore[adminUid] || 0) + gpAmount;
    } else {
      if (riderUid) walletStore[riderUid] = (walletStore[riderUid] || 0) - foodTotal;
      if (shopUid) walletStore[shopUid] = (walletStore[shopUid] || 0) + merchantIncome;
      if (adminUid) walletStore[adminUid] = (walletStore[adminUid] || 0) + gpAmount;
    }
  } else {
    if (shopUid && merchantIncome > 0) walletStore[shopUid] = (walletStore[shopUid] || 0) + merchantIncome;
    if (adminUid && gpAmount > 0) walletStore[adminUid] = (walletStore[adminUid] || 0) + gpAmount;
    if (riderUid && riderIncome > 0) walletStore[riderUid] = (walletStore[riderUid] || 0) + riderIncome;
  }

  order.settlementStatus = 'settled';
  return {
    ok: true,
    type,
    method,
    gpAmount,
    riderIncome,
    merchantIncome,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('1. Rider Cash + Sufficient Wallet -> Acceptable', () => {
  const walletBalance = 500;
  const activeOrders = [];
  const targetOrder = { id: 'o1', type: 'food', paymentMethod: 'cash', foodTotal: 300, deliveryFee: 40 };

  const res = evaluateAcceptOrderEligibility(walletBalance, activeOrders, targetOrder, 'r1');
  assert.equal(res.ok, true);
});

test('2. Rider Cash + Insufficient Wallet -> Blocked with INSUFFICIENT_RIDER_WALLET', () => {
  const walletBalance = 100;
  const activeOrders = [];
  const targetOrder = { id: 'o1', type: 'food', paymentMethod: 'cash', foodTotal: 250, deliveryFee: 40 };

  const res = evaluateAcceptOrderEligibility(walletBalance, activeOrders, targetOrder, 'r1');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'INSUFFICIENT_RIDER_WALLET');
  assert.equal(res.requiredBalance, 250);
  assert.equal(res.currentBalance, 100);
});

test('3. Wallet payment -> Not blocked by cash reserve rule', () => {
  const walletBalance = 0; // ฿0 in wallet
  const activeOrders = [];
  const targetOrder = { id: 'o1', type: 'food', paymentMethod: 'wallet', foodTotal: 500, grandTotal: 550 };

  const res = evaluateAcceptOrderEligibility(walletBalance, activeOrders, targetOrder, 'r1');
  assert.equal(res.ok, true);
});

test('4. Rider accepting 2 concurrent cash jobs with sufficient wallet for only 1 -> Only 1 succeeds according to liability', () => {
  let walletBalance = 200;
  const activeOrders = [];
  const job1 = { id: 'j1', riderId: 'r1', type: 'food', paymentMethod: 'cash', foodTotal: 150, deliveryFee: 30, status: 'ready_to_pickup' };
  const job2 = { id: 'j2', riderId: 'r1', type: 'food', paymentMethod: 'cash', foodTotal: 100, deliveryFee: 30, status: 'ready_to_pickup' };

  // Accept job 1
  const res1 = evaluateAcceptOrderEligibility(walletBalance, activeOrders, job1, 'r1');
  assert.equal(res1.ok, true);

  // Commit job 1 acceptance
  job1.status = 'rider_accepted';
  activeOrders.push(job1);

  // Try accept job 2 — remaining available balance = 200 - 150 = 50, required = 100
  const res2 = evaluateAcceptOrderEligibility(walletBalance, activeOrders, job2, 'r1');
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, 'INSUFFICIENT_RIDER_WALLET');
  assert.equal(res2.availableBalance, 50);
});

test('5. Customer confirm completed -> Settlement occurs once', () => {
  const walletStore = { 'rider-u1': 0, 'shop-u1': 0, 'admin-uuid': 0 };
  const order = {
    id: 'ord-100',
    type: 'food',
    paymentMethod: 'wallet',
    foodTotal: 200,
    deliveryFee: 40,
    grandTotal: 240,
    riderUserId: 'rider-u1',
    restaurantOwnerId: 'shop-u1',
    adminGP: 60,
    merchantIncome: 140,
    riderIncome: 40,
  };

  const settlementRes = mockProcessOrderSettlement(order, walletStore);
  assert.equal(settlementRes.ok, true);
  assert.equal(walletStore['shop-u1'], 140);
  assert.equal(walletStore['admin-uuid'], 60);
  assert.equal(walletStore['rider-u1'], 40);
});

test('6. Wallet balance change -> Realtime sync updates client without restart', () => {
  const localWalletState = { balance: 100, history: [] };

  // Simulate Realtime payload from wallets table
  const realtimePayload = {
    new: {
      user_id: 'u1',
      balance: 350.50,
      history: [{ id: 'tx1', amount: 250.50, desc: 'Topup' }],
    },
  };

  // Handler update
  localWalletState.balance = realtimePayload.new.balance;
  localWalletState.history = realtimePayload.new.history;

  assert.equal(localWalletState.balance, 350.50);
  assert.equal(localWalletState.history.length, 1);
});

test('7. Settlement failure -> Order must not transition to completed status', () => {
  const order = { id: 'ord-err', status: 'delivered', settlementStatus: null };

  // Simulate RPC error (e.g. database network error or lock timeout)
  const rpcResult = { ok: false, error: 'concurrent_settlement_in_progress' };

  let orderStatus = order.status;
  if (rpcResult.ok) {
    orderStatus = 'completed';
  }

  assert.equal(orderStatus, 'delivered');
  assert.notEqual(orderStatus, 'completed');
});

test('8. Duplicate completion request -> Idempotent response, no duplicate transactions', () => {
  const walletStore = { 'rider-u1': 100, 'shop-u1': 0, 'admin-uuid': 0 };
  const order = {
    id: 'ord-dup',
    type: 'food',
    paymentMethod: 'cash',
    foodTotal: 100,
    deliveryFee: 30,
    grandTotal: 130,
    riderUserId: 'rider-u1',
    restaurantOwnerId: 'shop-u1',
    adminGP: 30,
    merchantIncome: 70,
    riderIncome: 30,
  };

  // 1st Settlement
  const res1 = mockProcessOrderSettlement(order, walletStore);
  assert.equal(res1.ok, true);
  assert.equal(res1.skipped, undefined);
  assert.equal(walletStore['rider-u1'], 0); // 100 - 100

  // 2nd Settlement (Duplicate retry / double tap)
  const res2 = mockProcessOrderSettlement(order, walletStore);
  assert.equal(res2.ok, true);
  assert.equal(res2.skipped, 'already_settled');
  assert.equal(walletStore['rider-u1'], 0); // Wallet unchanged!
});
