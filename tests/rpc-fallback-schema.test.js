import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useOrderActions } from '../src/context/hooks/useOrderActions.js';

test('supabase_schema.sql contains all essential RPC function definitions and tables', () => {
  const schemaContent = readFileSync('supabase_schema.sql', 'utf8');

  const requiredTokens = [
    'create table if not exists public.orders',
    'create table if not exists public.job_offers',
    'create table if not exists public.push_devices',
    'function public.place_customer_order',
    'function public.accept_order_direct',
    'function public.process_order_settlement',
    'function public.approve_pending_request',
    'function public.dispatch_order',
    'function public.accept_job_offer',
    'function public.js_credit_wallet',
    'function public._wallet_credit',
    'function public.is_admin',
  ];

  for (const token of requiredTokens) {
    assert.ok(
      schemaContent.toLowerCase().includes(token.toLowerCase()),
      `supabase_schema.sql is missing required token: "${token}"`
    );
  }
});

test('useOrderActions falls back to direct order insert when place_customer_order RPC is missing', async () => {
  let directInsertedRow = null;
  const mockOrders = [];
  let systemNotif = null;

  const mockSupabase = {
    rpc: async (functionName) => {
      if (functionName === 'place_customer_order') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.place_customer_order(p_order) in the schema cache',
          },
        };
      }
      return { data: { ok: true }, error: null };
    },
    from: (table) => ({
      insert: async (row) => {
        if (table === 'orders') {
          directInsertedRow = row;
          return { error: null };
        }
        return { error: null };
      },
    }),
  };

  const deps = {
    orders: mockOrders,
    setOrders: (updater) => {
      if (typeof updater === 'function') {
        const updated = updater(mockOrders);
        mockOrders.length = 0;
        mockOrders.push(...updated);
      }
    },
    cart: [
      {
        id: 'item-1',
        name: 'ข้าวผัดกะเพรา',
        price: 50,
        qty: 1,
        restaurantId: 'rest-1',
        restaurantName: 'ร้านกะเพราตาแป๊ะ',
        distance: 2,
      },
    ],
    setCart: () => {},
    restaurants: [{ id: 'rest-1', name: 'ร้านกะเพราตาแป๊ะ', ownerId: 'owner-1' }],
    riders: [],
    appConfig: { baseFee: 20, perKmFee: 10 },
    currentUser: { id: 'cust-1' },
    userProfile: { id: 'cust-1', name: 'ลูกค้าทดสอบ', phone: '0812345678' },
    userAddresses: [{ address: '123/45 BKK', location: { lat: 13.75, lng: 100.5 } }],
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
      systemNotif = { title, message, type };
    },
    notifyAdmin: () => {},
    supabase: mockSupabase,
  };

  const actions = useOrderActions(deps);
  await actions.placeOrder(0, '');

  assert.ok(directInsertedRow, 'Direct order insertion should have been invoked when RPC was missing');
  assert.equal(directInsertedRow.data.restaurantId, 'rest-1');
  assert.equal(directInsertedRow.data.customerId, 'cust-1');
  assert.equal(systemNotif?.type, 'success', 'Order placement should succeed via fallback');
});
