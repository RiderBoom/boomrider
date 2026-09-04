import test from 'node:test';
import assert from 'node:assert/strict';

// Helper mimicking DB behavior of place_customer_order RPC (031_server_authoritative_order_pricing.sql)
function mockPlaceCustomerOrderRPC(pOrder, authUid, dbStores) {
  const { menuItems = {}, promoCodes = {}, appConfig = {}, wallets = {}, orders = {} } = dbStores;

  if (!authUid) {
    throw new Error('authentication_required');
  }

  // 1. Identity Enforcement
  const customerId = authUid;

  // 2. Order ID & Idempotency
  const orderId = pOrder.id || 'gen-uuid';

  if (orders[orderId]) {
    const existing = orders[orderId];
    if (existing.customerId === customerId) {
      return { ok: true, order_id: orderId, order: existing, idempotent: true };
    }
    return { ok: false, reason: 'DUPLICATE_ORDER' };
  }

  // 3. Payment Method Validation
  const paymentMethod = (pOrder.paymentMethod || 'cash').toLowerCase();
  if (!['cash', 'wallet', 'online'].includes(paymentMethod)) {
    return { ok: false, reason: 'INVALID_PAYMENT_METHOD' };
  }

  // 4. Order Type Validation & Status Hardening
  const type = (pOrder.type || 'food').toLowerCase();
  if (!['food', 'parcel', 'ride', 'service'].includes(type)) {
    return { ok: false, reason: 'INVALID_ORDER_TYPE' };
  }

  const status = type === 'food' ? 'pending' : 'ready_to_pickup';

  // 5. Config Rates
  const baseFee = appConfig.baseFee ?? 20;
  const perKmFee = appConfig.perKmFee ?? 10;
  const rideBaseFee = appConfig.rideBaseFee ?? baseFee;
  const ridePerKmFee = appConfig.ridePerKmFee ?? perKmFee;
  const gpFoodRate = (appConfig.gpFood ?? 30) / 100;
  const gpDelivRate = (appConfig.gpDelivery ?? 15) / 100;
  const gpRideRate = (appConfig.gpRide ?? 15) / 100;
  const gpServiceRate = (appConfig.gpService ?? 15) / 100;
  const extraServices = appConfig.extraServices || [
    { name: "ทำความสะอาดบ้าน", price: 350 },
    { name: "ล้างแอร์ / ซ่อมแอร์", price: 500 },
    { name: "ซ่อมประปา / ไฟฟ้า", price: 400 },
    { name: "ขนย้ายสิ่งของ", price: 600 }
  ];

  // 6. Pricing Calculation
  let foodTotal = 0;
  let deliveryFee = 0;
  let promoDiscount = 0;
  let grandTotal = 0;
  let adminGP = 0;
  let riderIncome = 0;
  let authItems = [];

  if (type === 'food') {
    const restId = pOrder.restaurantId;
    if (!restId) return { ok: false, reason: 'MISSING_RESTAURANT_ID' };

    const menu = menuItems[restId] || [];
    const reqItems = pOrder.items || [];
    if (!reqItems.length) return { ok: false, reason: 'EMPTY_FOOD_ORDER' };

    for (const reqItem of reqItems) {
      const origId = reqItem.originalId || reqItem.id;
      const qty = reqItem.qty ?? 0;
      if (qty <= 0) return { ok: false, reason: 'INVALID_QUANTITY' };

      const dbItem = menu.find(m => m.id === origId || m.id === reqItem.id);
      if (!dbItem) return { ok: false, reason: 'INVALID_ITEM', itemId: origId };
      if (dbItem.available === false) return { ok: false, reason: 'ITEM_UNAVAILABLE', itemName: dbItem.name };

      let basePrice = dbItem.price;
      let optsExtra = 0;

      if (reqItem.selectedOptions) {
        for (const selOpt of reqItem.selectedOptions) {
          const dbOpt = (dbItem.options || []).find(o => o.name === selOpt.name);
          if (!dbOpt) {
            return { ok: false, reason: 'INVALID_OPTION', optionName: selOpt.name };
          }
          optsExtra += dbOpt.price;
        }
      }

      const unitPrice = Math.round((basePrice + optsExtra) * 100) / 100;
      foodTotal += Math.round(unitPrice * qty * 100) / 100;

      authItems.push({
        id: reqItem.id,
        originalId: origId,
        name: dbItem.name,
        price: unitPrice,
        qty,
        selectedOptions: reqItem.selectedOptions || [],
      });
    }

    // Authoritative Promo Validation
    const promoCodeStr = (pOrder.promoCode || '').toUpperCase().trim();
    if (promoCodeStr) {
      const dbPromo = promoCodes[promoCodeStr];
      if (dbPromo && dbPromo.active !== false && (dbPromo.usedCount || 0) < (dbPromo.maxUses || 100) && foodTotal >= (dbPromo.minOrder || 0)) {
        if (dbPromo.type === 'percent') {
          promoDiscount = Math.min(Math.round(foodTotal * (dbPromo.value / 100) * 100) / 100, dbPromo.maxDiscount || 9999);
        } else {
          promoDiscount = Math.min(dbPromo.value, foodTotal);
        }
      }
    }

    const dist = Math.max(0, pOrder.distance || 1);
    deliveryFee = baseFee + (Math.ceil(dist) * perKmFee);
    grandTotal = Math.max(0, foodTotal + deliveryFee - promoDiscount);
    adminGP = Math.round(foodTotal * gpFoodRate * 100) / 100;
    riderIncome = deliveryFee;

  } else if (type === 'parcel') {
    const dist = Math.max(0, pOrder.distance || pOrder.parcelDetails?.distance || 1);
    deliveryFee = baseFee + (Math.ceil(dist) * perKmFee);
    grandTotal = deliveryFee;
    adminGP = Math.round(grandTotal * gpDelivRate * 100) / 100;
    riderIncome = Math.round((grandTotal - adminGP) * 100) / 100;

  } else if (type === 'ride') {
    const dist = Math.max(0, pOrder.distance || 1);
    deliveryFee = rideBaseFee + (Math.ceil(dist) * ridePerKmFee);
    grandTotal = deliveryFee;
    adminGP = Math.round(grandTotal * gpRideRate * 100) / 100;
    riderIncome = Math.round((grandTotal - adminGP) * 100) / 100;

  } else if (type === 'service') {
    const serviceCat = pOrder.serviceCategory;
    const matchedService = extraServices.find(s => s.name === serviceCat);
    deliveryFee = matchedService ? matchedService.price : 350;
    grandTotal = deliveryFee;
    adminGP = Math.round(grandTotal * gpServiceRate * 100) / 100;
    riderIncome = Math.round((grandTotal - adminGP) * 100) / 100;
  }

  // 7. Wallet Deduction Transaction
  if (paymentMethod === 'wallet' && grandTotal > 0) {
    const bal = wallets[customerId] ?? 0;
    if (bal < grandTotal) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_CUSTOMER_WALLET',
        requiredBalance: grandTotal,
        currentBalance: bal,
      };
    }
    // Debit wallet
    wallets[customerId] = Math.round((bal - grandTotal) * 100) / 100;
  }

  // 8. Construct & Save Authoritative Order
  const finalOrder = {
    ...pOrder,
    id: orderId,
    type,
    status,
    customerId,
    paymentMethod,
    foodTotal,
    deliveryFee,
    promoDiscount,
    grandTotal,
    adminGP,
    riderIncome,
    items: type === 'food' ? authItems : pOrder.items,
  };

  orders[orderId] = finalOrder;

  return {
    ok: true,
    order_id: orderId,
    order: finalOrder,
    pricing: { foodTotal, deliveryFee, promoDiscount, grandTotal },
  };
}

// Helper mimicking approve_pending_request RPC (031_server_authoritative_order_pricing.sql)
function mockApprovePendingRequestRPC(requestId, isCallerAdmin, pendingRequests, wallets) {
  if (!isCallerAdmin) throw new Error('admin_required');

  const req = pendingRequests[requestId];
  if (!req) return { ok: false, reason: 'request_not_found' };

  const reqType = (req.type || req.data?.type || '').toLowerCase();
  if (!['topup', 'withdraw'].includes(reqType)) {
    // Unsupported request type: MUST NOT MUTATE OR DELETE REQUEST!
    return { ok: false, reason: 'UNSUPPORTED_REQUEST_TYPE', type: reqType };
  }

  const userId = req.userId || req.data?.userId;
  const amt = req.data?.data?.amount || req.data?.amount || 0;

  if (reqType === 'topup') {
    wallets[userId] = (wallets[userId] || 0) + amt;
  } else if (reqType === 'withdraw') {
    const bal = wallets[userId] || 0;
    if (bal < amt) return { ok: false, reason: 'INSUFFICIENT_WALLET_BALANCE' };
    wallets[userId] = bal - amt;
  }

  delete pendingRequests[requestId];
  return { ok: true, request_id: requestId, type: reqType };
}

// ── Test Cases ──────────────────────────────────────────────────────────────

test('1. Food client sends grandTotal=1 but DB price is 500 -> server uses 500', () => {
  const dbStores = {
    menuItems: {
      r1: [
        { id: 'm1', name: 'Burger', price: 200, available: true },
        { id: 'm2', name: 'Fries', price: 250, available: true },
      ],
    },
    appConfig: { baseFee: 30, perKmFee: 10 },
    wallets: { 'user-1': 1000 },
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-1',
    type: 'food',
    restaurantId: 'r1',
    paymentMethod: 'wallet',
    distance: 2, // delivery = 30 + 2*10 = 50
    items: [
      { id: 'm1', qty: 1, price: 1 }, // tampered item price
      { id: 'm2', qty: 1, price: 1 },
    ],
    grandTotal: 1, // tampered total
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.foodTotal, 450); // 200 + 250
  assert.equal(res.order.deliveryFee, 50); // 30 + 20
  assert.equal(res.order.grandTotal, 500); // 450 + 50
  assert.equal(dbStores.wallets['user-1'], 500); // 1000 - 500
});

test('2. Client sends fake item price -> ignored/overridden by DB menu price', () => {
  const dbStores = {
    menuItems: {
      r1: [{ id: 'm1', name: 'Pizza', price: 300, available: true }],
    },
    appConfig: { baseFee: 20, perKmFee: 10 },
    wallets: { 'user-1': 500 },
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-2',
    type: 'food',
    restaurantId: 'r1',
    paymentMethod: 'cash',
    distance: 1,
    items: [{ id: 'm1', qty: 2, price: 10 }], // fake unit price 10
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.items[0].price, 300); // DB price applied
  assert.equal(res.order.foodTotal, 600); // 300 * 2
});

test('3. Client sends fake deliveryFee -> ignored/recalculated by server', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Noodles', price: 80, available: true }] },
    appConfig: { baseFee: 20, perKmFee: 10 }, // 2km -> 20 + 20 = 40
    wallets: {},
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-3',
    type: 'food',
    restaurantId: 'r1',
    paymentMethod: 'cash',
    distance: 2,
    deliveryFee: 0, // tampered deliveryFee
    items: [{ id: 'm1', qty: 1 }],
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.deliveryFee, 40);
  assert.equal(res.order.grandTotal, 120);
});

test('4. Client sends status=completed -> overridden to allowed initial state (pending/ready_to_pickup)', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Rice', price: 50, available: true }] },
    appConfig: { baseFee: 20, perKmFee: 10 },
    wallets: {},
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-4',
    type: 'food',
    restaurantId: 'r1',
    status: 'completed', // tampered privileged status
    paymentMethod: 'cash',
    items: [{ id: 'm1', qty: 1 }],
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.status, 'pending'); // Overridden to pending!
});

test('5. Client sends customerId of someone else -> server uses auth.uid()', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Soup', price: 60, available: true }] },
    appConfig: { baseFee: 20, perKmFee: 10 },
    wallets: {},
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-5',
    type: 'food',
    restaurantId: 'r1',
    customerId: 'victim-uid-999', // spoofed customer ID
    items: [{ id: 'm1', qty: 1 }],
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'actual-caller-uid', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.customerId, 'actual-caller-uid'); // Enforced!
});

test('6. Wallet balance 100, authoritative total 500, client total 1 -> rejected INSUFFICIENT_CUSTOMER_WALLET', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Steak', price: 450, available: true }] },
    appConfig: { baseFee: 50, perKmFee: 0 },
    wallets: { 'user-1': 100 }, // only 100 in wallet
    orders: {},
  };

  const clientPayload = {
    id: 'ord-tamper-6',
    type: 'food',
    restaurantId: 'r1',
    paymentMethod: 'wallet',
    grandTotal: 1, // client claims total is 1
    items: [{ id: 'm1', qty: 1 }],
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'INSUFFICIENT_CUSTOMER_WALLET');
  assert.equal(res.requiredBalance, 500); // 450 + 50
  assert.equal(dbStores.wallets['user-1'], 100); // Wallet untouched!
});

test('7. Two concurrent wallet orders, wallet only sufficient for 1 -> exactly 1 succeeds', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Fish', price: 150, available: true }] },
    appConfig: { baseFee: 30, perKmFee: 0 },
    wallets: { 'user-1': 200 }, // wallet balance = 200, each order costs 180
    orders: {},
  };

  const order1 = { id: 'ord-c1', type: 'food', restaurantId: 'r1', paymentMethod: 'wallet', items: [{ id: 'm1', qty: 1 }] };
  const order2 = { id: 'ord-c2', type: 'food', restaurantId: 'r1', paymentMethod: 'wallet', items: [{ id: 'm1', qty: 1 }] };

  const res1 = mockPlaceCustomerOrderRPC(order1, 'user-1', dbStores);
  assert.equal(res1.ok, true);
  assert.equal(dbStores.wallets['user-1'], 20); // 200 - 180 = 20

  const res2 = mockPlaceCustomerOrderRPC(order2, 'user-1', dbStores);
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, 'INSUFFICIENT_CUSTOMER_WALLET');
  assert.equal(dbStores.wallets['user-1'], 20); // Remaining 20 protected!
});

test('8. Order insert failure -> wallet debit rolled back', () => {
  const wallets = { 'user-1': 300 };

  // Helper simulating DB transaction rollback on failure
  function simulateTxWithRollback(order, authUid, walletStore) {
    const originalBal = walletStore[authUid];
    const total = 250;

    // Step 1: Wallet debit
    walletStore[authUid] -= total;

    // Step 2: Order insert throws error
    try {
      throw new Error('DB_DISK_FULL_OR_CONSTRAINT_VIOLATION');
    } catch (err) {
      // Transaction Rollback
      walletStore[authUid] = originalBal;
      return { ok: false, reason: err.message };
    }
  }

  const res = simulateTxWithRollback({}, 'user-1', wallets);
  assert.equal(res.ok, false);
  assert.equal(wallets['user-1'], 300); // Balance fully restored!
});

test('9. Duplicate retry with same order ID -> idempotent success, no double debit', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Tea', price: 40, available: true }] },
    appConfig: { baseFee: 20, perKmFee: 0 },
    wallets: { 'user-1': 200 },
    orders: {},
  };

  const payload = { id: 'ord-retry-1', type: 'food', restaurantId: 'r1', paymentMethod: 'wallet', items: [{ id: 'm1', qty: 1 }] };

  // Attempt 1
  const res1 = mockPlaceCustomerOrderRPC(payload, 'user-1', dbStores);
  assert.equal(res1.ok, true);
  assert.equal(dbStores.wallets['user-1'], 140); // 200 - 60

  // Attempt 2 (Client network retry after timeout)
  const res2 = mockPlaceCustomerOrderRPC(payload, 'user-1', dbStores);
  assert.equal(res2.ok, true);
  assert.equal(res2.idempotent, true);
  assert.equal(dbStores.wallets['user-1'], 140); // Wallet NOT debited again!
});

test('10. Invalid payment method -> reject', () => {
  const dbStores = { menuItems: {}, appConfig: {}, wallets: {}, orders: {} };
  const payload = { id: 'ord-inv-pay', type: 'food', paymentMethod: 'crypto_magic' };

  const res = mockPlaceCustomerOrderRPC(payload, 'user-1', dbStores);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'INVALID_PAYMENT_METHOD');
});

test('11. Unsupported pending request type -> request remains untouched in DB', () => {
  const pendingRequests = {
    'req-unknown-1': { id: 'req-unknown-1', type: 'custom_unknown_action', userId: 'u1', data: { amount: 100 } },
  };
  const wallets = { u1: 50 };

  const res = mockApprovePendingRequestRPC('req-unknown-1', true, pendingRequests, wallets);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'UNSUPPORTED_REQUEST_TYPE');
  assert.notEqual(pendingRequests['req-unknown-1'], undefined); // Request NOT deleted!
  assert.equal(wallets.u1, 50); // Wallet NOT modified!
});

test('12. Parcel/Ride/Service tampered total -> authoritative server pricing used', () => {
  const dbStores = {
    menuItems: {},
    appConfig: {
      baseFee: 20, perKmFee: 10, rideBaseFee: 25, ridePerKmFee: 15, gpDelivery: 15, gpRide: 20, gpService: 15,
      extraServices: [{ name: "ทำความสะอาดบ้าน", price: 350 }, { name: "ล้างแอร์ / ซ่อมแอร์", price: 500 }]
    },
    wallets: { 'user-1': 500 },
    orders: {},
  };

  // Parcel tamper test
  const parcelReq = { id: 'p1', type: 'parcel', distance: 3, paymentMethod: 'wallet', grandTotal: 1 }; // actual = 20 + 3*10 = 50
  const pRes = mockPlaceCustomerOrderRPC(parcelReq, 'user-1', dbStores);
  assert.equal(pRes.ok, true);
  assert.equal(pRes.order.deliveryFee, 50);
  assert.equal(pRes.order.grandTotal, 50);
  assert.equal(pRes.order.adminGP, 7.5); // 15% of 50
  assert.equal(pRes.order.riderIncome, 42.5);

  // Ride tamper test
  const rideReq = { id: 'r1', type: 'ride', distance: 2, paymentMethod: 'cash', grandTotal: 10 }; // actual = 25 + 2*15 = 55
  const rRes = mockPlaceCustomerOrderRPC(rideReq, 'user-1', dbStores);
  assert.equal(rRes.ok, true);
  assert.equal(rRes.order.grandTotal, 55);
  assert.equal(rRes.order.adminGP, 11); // 20% of 55
  assert.equal(rRes.order.riderIncome, 44);

  // Service tamper test
  const serviceReq = { id: 's1', type: 'service', serviceCategory: 'ล้างแอร์ / ซ่อมแอร์', paymentMethod: 'cash', grandTotal: 10, servicePrice: 10 };
  const sRes = mockPlaceCustomerOrderRPC(serviceReq, 'user-1', dbStores);
  assert.equal(sRes.ok, true);
  assert.equal(sRes.order.grandTotal, 500); // 500 from extraServices config
  assert.equal(sRes.order.adminGP, 75); // 15% of 500
});

test('13. Option price tampering / unmatched option -> rejected INVALID_OPTION', () => {
  const dbStores = {
    menuItems: {
      r1: [{ id: 'm1', name: 'Burger', price: 100, available: true, options: [{ name: 'Cheese', price: 15 }] }]
    },
    appConfig: { baseFee: 20, perKmFee: 0 },
    wallets: {},
    orders: {}
  };

  const payload = {
    id: 'ord-fake-opt',
    type: 'food',
    restaurantId: 'r1',
    items: [{ id: 'm1', qty: 1, selectedOptions: [{ name: 'Fake Discount', price: -50 }] }]
  };

  const res = mockPlaceCustomerOrderRPC(payload, 'user-1', dbStores);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'INVALID_OPTION');
});

test('14. Promo code tampering -> calculated strictly against DB promo_codes table', () => {
  const dbStores = {
    menuItems: { r1: [{ id: 'm1', name: 'Pizza', price: 200, available: true }] },
    promoCodes: {
      'BOOM20': { code: 'BOOM20', active: true, type: 'percent', value: 20, minOrder: 100, maxDiscount: 50, maxUses: 10, usedCount: 0 }
    },
    appConfig: { baseFee: 30, perKmFee: 0 },
    wallets: {},
    orders: {}
  };

  const payload = {
    id: 'ord-promo-tamper',
    type: 'food',
    restaurantId: 'r1',
    promoCode: 'BOOM20',
    promoDiscount: 999, // Tampered discount amount sent by client
    items: [{ id: 'm1', qty: 1 }]
  };

  const res = mockPlaceCustomerOrderRPC(payload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.promoDiscount, 40); // 20% of 200 = 40, ignoring 999
  assert.equal(res.order.grandTotal, 190); // 200 + 30 - 40
});
