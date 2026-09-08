import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function mockCalculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 1;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (Math.sin(dLon / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return Math.round(R * c * 100) / 100;
}

// Helper mimicking create_service_quote RPC (035_service_quotes_and_authoritative_pricing.sql)

test('quote migration reads coordinates from the deployed JSON schema', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/036_service_quotes_and_authoritative_pricing.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /SELECT data INTO v_rest_data FROM public\.restaurants/);
  assert.match(migration, /FROM public\.profiles p/);
  assert.doesNotMatch(migration, /public\.user_addresses/);
  assert.doesNotMatch(migration, /v_rest_data\.location/);
});
function mockCreateServiceQuoteRPC(pQuote, authUid, dbStores) {
  const { quotes = {}, appConfig = {}, restaurants = {}, userAddresses = {} } = dbStores;

  if (!authUid) throw new Error('authentication_required');

  const serviceType = (pQuote.serviceType || 'food').toLowerCase();
  if (!['food', 'parcel', 'ride', 'service'].includes(serviceType)) {
    return { ok: false, reason: 'INVALID_SERVICE_TYPE' };
  }

  let plat = pQuote.pickupLat;
  let plng = pQuote.pickupLng;
  let dlat = pQuote.dropoffLat;
  let dlng = pQuote.dropoffLng;

  if (serviceType === 'food') {
    if (pQuote.restaurantId && restaurants[pQuote.restaurantId]) {
      const rLoc = restaurants[pQuote.restaurantId].location;
      if (rLoc) { plat = rLoc.lat; plng = rLoc.lng; }
    }
    if (pQuote.addressId && userAddresses[pQuote.addressId]) {
      const aLoc = userAddresses[pQuote.addressId].location;
      if (aLoc) { dlat = aLoc.lat; dlng = aLoc.lng; }
    }
  }

  if (plat == null || plng == null || dlat == null || dlng == null) {
    return { ok: false, reason: 'MISSING_COORDINATES' };
  }

  if (plat < -90 || plat > 90 || dlat < -90 || dlat > 90 ||
      plng < -180 || plng > 180 || dlng < -180 || dlng > 180) {
    return { ok: false, reason: 'INVALID_COORDINATES_OUT_OF_BOUNDS' };
  }

  const distMeters = mockCalculateHaversineDistance(plat, plng, dlat, dlng) * 1000;
  const billableKm = Math.max(1, Math.ceil(distMeters / 1000));
  const baseFee = appConfig.baseFee ?? 20;
  const perKmFee = appConfig.perKmFee ?? 10;
  const subtotal = baseFee + (billableKm * perKmFee);
  const discount = 0;
  const grandTotal = Math.max(0, subtotal - discount);
  const gpRate = (appConfig.gpDelivery ?? 15) / 100;
  const adminGP = Math.round(grandTotal * gpRate * 100) / 100;
  const riderIncome = Math.round((grandTotal - adminGP) * 100) / 100;

  const quoteId = 'quote_' + Math.random().toString(36).slice(2, 9);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const quoteObj = {
    id: quoteId,
    customerId: authUid,
    serviceType,
    pickupLat: plat, pickupLng: plng,
    dropoffLat: dlat, dropoffLng: dlng,
    distanceMeters: distMeters,
    billableKm,
    distanceSource: 'haversine_estimate',
    baseFee, perKmFee, subtotal, discount, grandTotal, adminGP, riderIncome,
    expiresAt,
    usedAt: null
  };

  quotes[quoteId] = quoteObj;

  return { ok: true, quoteId, ...quoteObj };
}

// Helper mimicking DB behavior of place_customer_order RPC (035_service_quotes_and_authoritative_pricing.sql)
function mockPlaceCustomerOrderRPC(pOrder, authUid, dbStores) {
  const { quotes = {}, menuItems = {}, wallets = {}, orders = {} } = dbStores;

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

  // 5. Mandatory Quote Verification
  const quoteId = pOrder.quoteId;
  if (!quoteId) {
    return { ok: false, reason: 'QUOTE_REQUIRED' };
  }

  const quote = quotes[quoteId];
  if (!quote) return { ok: false, reason: 'QUOTE_NOT_FOUND' };
  if (quote.customerId !== customerId) return { ok: false, reason: 'QUOTE_ACCESS_DENIED' };
  if (quote.serviceType !== type) return { ok: false, reason: 'QUOTE_SERVICE_MISMATCH' };
  if (quote.usedAt) return { ok: false, reason: 'QUOTE_ALREADY_USED' };
  if (new Date(quote.expiresAt) < new Date()) return { ok: false, reason: 'QUOTE_EXPIRED' };

  let deliveryFee = quote.grandTotal;
  let promoDiscount = quote.discount;
  let adminGP = quote.adminGP;
  let riderIncome = quote.riderIncome;
  quote.usedAt = new Date().toISOString();

  // 6. Pricing Calculation
  let foodTotal = 0;
  let grandTotal = 0;
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

    grandTotal = Math.max(0, foodTotal + deliveryFee - promoDiscount);

  } else {
    foodTotal = 0;
    grandTotal = deliveryFee;
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
    wallets[customerId] = Math.round((bal - grandTotal) * 100) / 100;
  }

  // 8. Construct & Save Authoritative Order
  const finalOrder = {
    ...pOrder,
    id: orderId,
    quoteId,
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

// ── Test Cases ──────────────────────────────────────────────────────────────

test('Server Quote creation validates coordinate bounds', () => {
  const dbStores = { quotes: {}, appConfig: {} };
  const invalidQuoteReq = {
    serviceType: 'parcel',
    pickupLat: 150, // Invalid lat > 90
    pickupLng: 100,
    dropoffLat: 13.7,
    dropoffLng: 100.5
  };

  const res = mockCreateServiceQuoteRPC(invalidQuoteReq, 'user-1', dbStores);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'INVALID_COORDINATES_OUT_OF_BOUNDS');
});

test('Order Placement consumes Server Quote single-use token', () => {
  const dbStores = {
    quotes: {},
    appConfig: { baseFee: 20, perKmFee: 10 },
    wallets: { 'user-1': 500 },
    orders: {}
  };

  const quoteRes = mockCreateServiceQuoteRPC({
    serviceType: 'parcel',
    pickupLat: 13.7, pickupLng: 100.5,
    dropoffLat: 13.8, dropoffLng: 100.6
  }, 'user-1', dbStores);

  assert.equal(quoteRes.ok, true);
  const quoteId = quoteRes.quoteId;

  const orderReq = { id: 'ord-q1', type: 'parcel', quoteId, paymentMethod: 'wallet' };
  const orderRes1 = mockPlaceCustomerOrderRPC(orderReq, 'user-1', dbStores);
  assert.equal(orderRes1.ok, true);

  const orderReq2 = { id: 'ord-q2', type: 'parcel', quoteId, paymentMethod: 'wallet' };
  const orderRes2 = mockPlaceCustomerOrderRPC(orderReq2, 'user-1', dbStores);
  assert.equal(orderRes2.ok, false);
  assert.equal(orderRes2.reason, 'QUOTE_ALREADY_USED');
});

test('Order placement without quote is rejected with QUOTE_REQUIRED', () => {
  const dbStores = { quotes: {}, appConfig: {}, wallets: {}, orders: {} };
  const orderReq = { id: 'ord-no-quote', type: 'parcel', paymentMethod: 'cash' };

  const res = mockPlaceCustomerOrderRPC(orderReq, 'user-1', dbStores);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'QUOTE_REQUIRED');
});

test('Food client sends grandTotal=1 but DB price is 500 -> server uses 500', () => {
  const dbStores = {
    quotes: {},
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

  const quoteRes = mockCreateServiceQuoteRPC({
    serviceType: 'food',
    restaurantId: 'r1',
    pickupLat: 13.7, pickupLng: 100.5,
    dropoffLat: 13.8, dropoffLng: 100.6
  }, 'user-1', dbStores);

  const clientPayload = {
    id: 'ord-tamper-1',
    type: 'food',
    quoteId: quoteRes.quoteId,
    restaurantId: 'r1',
    paymentMethod: 'wallet',
    items: [
      { id: 'm1', qty: 1, price: 1 },
      { id: 'm2', qty: 1, price: 1 },
    ],
    grandTotal: 1,
  };

  const res = mockPlaceCustomerOrderRPC(clientPayload, 'user-1', dbStores);
  assert.equal(res.ok, true);
  assert.equal(res.order.foodTotal, 450);
  assert.equal(res.order.grandTotal, 450 + quoteRes.grandTotal);
});
