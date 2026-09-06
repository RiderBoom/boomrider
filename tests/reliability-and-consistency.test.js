import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useWalletActions } from '../src/context/hooks/useWalletActions.js';
import { useRegistration } from '../src/context/hooks/useRegistration.js';
import { useOrderActions } from '../src/context/hooks/useOrderActions.js';

// Setup minimal React hooks dispatcher mock for React 19 in Node test runner
const reactInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
if (reactInternals && !reactInternals.H) {
  reactInternals.H = {
    useRef: (val) => ({ current: val }),
    useState: (val) => [typeof val === 'function' ? val() : val, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
  };
}

test('requestTopUp rolls back local state and returns false on Supabase insert failure', async () => {
  let pendingRequests = [];
  let notifiedSystem = null;
  let adminNotified = false;

  const mockSupabase = {
    from: () => ({
      insert: async () => ({
        error: { message: 'Database constraint violation' },
      }),
    }),
  };

  const deps = {
    walletQueues: { current: {} },
    submittingRef: { current: false },
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Test User' },
    userWallet: 100,
    pendingRequests,
    setUserWallet: () => {},
    setWalletAllEntries: () => {},
    setGlobalWallets: () => {},
    setPendingRequests: (updater) => {
      pendingRequests = typeof updater === 'function' ? updater(pendingRequests) : updater;
    },
    setShowTopUpModal: () => {},
    setTopUpSlip: () => {},
    setWithdrawAmount: () => {},
    setWithdrawBank: () => {},
    setWithdrawAccount: () => {},
    setWithdrawName: () => {},
    setWithdrawMode: () => {},
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    notifyAdmin: () => {
      adminNotified = true;
    },
    supabase: mockSupabase,
  };

  const walletActions = useWalletActions(deps);
  const success = await walletActions.requestTopUp(500, 'slip.jpg');

  assert.equal(success, false, 'requestTopUp should return false on insert failure');
  assert.equal(pendingRequests.length, 0, 'Local pendingRequests should be rolled back');
  assert.equal(notifiedSystem?.type, 'error', 'Error notification should be displayed');
  assert.equal(adminNotified, false, 'Admin should not be notified on insert failure');
});

test('requestWithdraw rolls back local state and returns false on Supabase insert failure', async () => {
  let pendingRequests = [];
  let notifiedSystem = null;

  const mockSupabase = {
    from: () => ({
      insert: async () => ({
        error: { message: 'Network disconnect' },
      }),
    }),
  };

  const deps = {
    walletQueues: { current: {} },
    submittingRef: { current: false },
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Test User' },
    userWallet: 1000,
    pendingRequests,
    setUserWallet: () => {},
    setWalletAllEntries: () => {},
    setGlobalWallets: () => {},
    setPendingRequests: (updater) => {
      pendingRequests = typeof updater === 'function' ? updater(pendingRequests) : updater;
    },
    setShowTopUpModal: () => {},
    setTopUpSlip: () => {},
    setWithdrawAmount: () => {},
    setWithdrawBank: () => {},
    setWithdrawAccount: () => {},
    setWithdrawName: () => {},
    setWithdrawMode: () => {},
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    notifyAdmin: () => {},
    supabase: mockSupabase,
  };

  const walletActions = useWalletActions(deps);
  const success = await walletActions.requestWithdraw(200, { bank: 'KBank', accountName: 'Test', accountNumber: '1234' });

  assert.equal(success, false, 'requestWithdraw should return false on insert failure');
  assert.equal(pendingRequests.length, 0, 'Local pendingRequests should be rolled back');
  assert.equal(notifiedSystem?.type, 'error', 'Error notification should be displayed');
});

test('requestTopUp prevents duplicate submissions during rapid consecutive clicks', async () => {
  let pendingRequests = [];
  let insertCount = 0;

  const mockSupabase = {
    from: () => ({
      insert: async () => {
        insertCount++;
        await new Promise(r => setTimeout(r, 50));
        return { error: null };
      },
    }),
  };

  const deps = {
    walletQueues: { current: {} },
    submittingRef: { current: false },
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Test User' },
    userWallet: 100,
    pendingRequests,
    setUserWallet: () => {},
    setWalletAllEntries: () => {},
    setGlobalWallets: () => {},
    setPendingRequests: (updater) => {
      pendingRequests = typeof updater === 'function' ? updater(pendingRequests) : updater;
    },
    setShowTopUpModal: () => {},
    setTopUpSlip: () => {},
    setWithdrawAmount: () => {},
    setWithdrawBank: () => {},
    setWithdrawAccount: () => {},
    setWithdrawName: () => {},
    setWithdrawMode: () => {},
    notifySystem: () => {},
    notifyAdmin: () => {},
    supabase: mockSupabase,
  };

  const walletActions = useWalletActions(deps);
  const promise1 = walletActions.requestTopUp(100, null);
  const promise2 = walletActions.requestTopUp(100, null);

  const [res1, res2] = await Promise.all([promise1, promise2]);

  assert.equal(res1, true, 'First click should succeed');
  assert.equal(res2, false, 'Second rapid click should be blocked as duplicate');
  assert.equal(insertCount, 1, 'Supabase insert should only be called once');
});

test('requestRegisterMerchant rolls back local state and returns false on Supabase insert failure', async () => {
  let pendingRequests = [];
  let notifiedSystem = null;
  let adminNotified = false;

  const mockSupabase = {
    from: () => ({
      insert: async () => ({
        error: { message: 'Insert failed' },
      }),
    }),
  };

  const deps = {
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Merchant Test' },
    userRoles: ['customer'],
    restaurants: [],
    isPending: () => false,
    setPendingRequests: (updater) => {
      pendingRequests = typeof updater === 'function' ? updater(pendingRequests) : updater;
    },
    grantRole: () => {},
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    notifyAdmin: () => {
      adminNotified = true;
    },
    supabase: mockSupabase,
  };

  const reg = useRegistration(deps);
  const success = await reg.requestRegisterMerchant({
    shopName: 'ร้านลองขาย',
    realName: 'นายทดสอบ',
    idCard: '1234567890123',
    phone: '0812345678',
    bankName: 'กสิกรไทย',
    bankAccount: '123-4-56789-0',
    idCardImage: 'idcard.jpg',
  });

  assert.equal(success, false, 'requestRegisterMerchant should return false on insert failure');
  assert.equal(pendingRequests.length, 0, 'Local pendingRequests should be rolled back');
  assert.equal(notifiedSystem?.type, 'error', 'Error notification should be displayed');
  assert.equal(adminNotified, false, 'notifyAdmin must not be called when DB insert fails');
});

test('acceptOrder resolves rider by targetRiderId or userId and handles accept_order_direct RPC', async () => {
  let calledRpcName = null;
  let calledRpcArgs = null;
  let notifiedSystem = null;
  let ordersState = [
    { id: 'ord-100', status: 'ready_to_pickup', data: { id: 'ord-100', status: 'ready_to_pickup' } }
  ];

  const mockSupabase = {
    rpc: async (fnName, args) => {
      calledRpcName = fnName;
      calledRpcArgs = args;
      return {
        data: {
          ok: true,
          order_id: 'ord-100',
          order_data: { id: 'ord-100', status: 'rider_accepted', riderId: 'rider-abc', riderName: 'นายไรเดอร์' }
        },
        error: null
      };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })
  };

  const deps = {
    orders: ordersState,
    setOrders: (updater) => {
      ordersState = typeof updater === 'function' ? updater(ordersState) : updater;
    },
    riders: [
      { id: 'rider-abc', userId: 'user-999', name: 'นายไรเดอร์' }
    ],
    currentUser: { id: 'user-999' },
    userProfile: { id: 'user-999', name: 'นายไรเดอร์' },
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    supabase: mockSupabase,
  };

  const orderActions = useOrderActions(deps);
  const result = await orderActions.acceptOrder('ord-100', 'rider-abc');

  assert.equal(result, true, 'acceptOrder should return true on success');
  assert.equal(calledRpcName, 'accept_order_direct');
  assert.equal(calledRpcArgs.p_order_id, 'ord-100');
  assert.equal(calledRpcArgs.p_rider_id, 'rider-abc');
  assert.equal(notifiedSystem?.type, 'success');
  assert.equal(ordersState[0].status, 'rider_accepted');
});

test('placeOrder falls back to direct insert when place_customer_order RPC returns schema cache error', async () => {
  let insertedOrders = [];
  let notifiedSystem = null;
  let ordersState = [];

  const mockSupabase = {
    rpc: async (fnName) => {
      if (fnName === 'place_customer_order') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.place_customer_order(p_order) in the schema cache'
          }
        };
      }
      return { data: null, error: null };
    },
    from: (table) => {
      if (table === 'orders') {
        return {
          insert: async (payload) => {
            insertedOrders.push(payload);
            return { error: null };
          }
        };
      }
      return {};
    }
  };

  const deps = {
    orders: ordersState,
    setOrders: (updater) => {
      ordersState = typeof updater === 'function' ? updater(ordersState) : updater;
    },
    cart: [{ id: 'm1', name: 'Pad Thai', price: 80, qty: 1, restaurantId: 'r1', restaurantName: 'Rest 1', distance: 2 }],
    setCart: () => {},
    restaurants: [{ id: 'r1', ownerId: 'owner-1', location: { lat: 13.7, lng: 100.5 } }],
    riders: [],
    appConfig: { baseFee: 20, perKmFee: 10 },
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Test Customer', phone: '0812345678' },
    userAddresses: [{ address: '123 BKK', location: { lat: 13.7, lng: 100.5 } }],
    userWallet: 500,
    parcelDetails: {},
    setParcelDetails: () => {},
    parcelEstimate: 0,
    paymentMethod: 'cash',
    pendingRequests: [],
    setPendingRequests: () => {},
    selectedOrderToCancel: null,
    setSelectedOrderToCancel: () => {},
    cancelReasonInput: '',
    setCancelReasonInput: () => {},
    setShowCancelModal: () => {},
    setSelectedRestaurant: () => {},
    setActiveTab: () => {},
    setParcelMapTarget: () => {},
    setParcelEstimate: () => {},
    setParcelDistance: () => {},
    placingOrderRef: { current: false },
    pendingLocalOrderIdsRef: { current: new Set() },
    creditWallet: () => {},
    creditWalletLocal: () => {},
    fetchUserWallet: () => {},
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    notifyAdmin: () => {},
    supabase: mockSupabase,
  };

  const orderActions = useOrderActions(deps);
  await orderActions.placeOrder(0, 'Extra spicy');

  assert.equal(insertedOrders.length, 1, 'Direct insert should have been called as fallback');
  assert.equal(insertedOrders[0].data.type, 'food');
  assert.equal(notifiedSystem?.type, 'success', 'Success notification should be displayed despite RPC error');
  assert.equal(ordersState.length, 1, 'Order should remain in local state');
});

test('requestRegisterRider rolls back local state and returns false on Supabase insert failure', async () => {
  let pendingRequests = [];
  let notifiedSystem = null;
  let adminNotified = false;

  const mockSupabase = {
    from: () => ({
      insert: async () => ({
        error: { message: 'Rider insert failed' },
      }),
    }),
  };

  const deps = {
    currentUser: { id: 'user-1' },
    userProfile: { id: 'user-1', name: 'Rider Test' },
    userRoles: ['customer'],
    restaurants: [],
    isPending: () => false,
    setPendingRequests: (updater) => {
      pendingRequests = typeof updater === 'function' ? updater(pendingRequests) : updater;
    },
    grantRole: () => {},
    notifySystem: (title, message, type) => {
      notifiedSystem = { title, message, type };
    },
    notifyAdmin: () => {
      adminNotified = true;
    },
    supabase: mockSupabase,
  };

  const reg = useRegistration(deps);
  const success = await reg.requestRegisterRider({
    realName: 'นายไรเดอร์',
    idCard: '1234567890123',
    phone: '0812345678',
    bankName: 'ไทยพาณิชย์',
    bankAccount: '987-6-54321-0',
    idCardImage: 'rider_idcard.jpg',
  });

  assert.equal(success, false, 'requestRegisterRider should return false on insert failure');
  assert.equal(pendingRequests.length, 0, 'Local pendingRequests should be rolled back');
  assert.equal(notifiedSystem?.type, 'error', 'Error notification should be displayed');
  assert.equal(adminNotified, false, 'notifyAdmin must not be called when DB insert fails');
});
