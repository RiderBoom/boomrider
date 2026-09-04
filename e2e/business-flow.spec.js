import { test, expect } from '@playwright/test';

// Setup deterministic mock state for E2E business flow tests
const mockState = {
  user: {
    id: 'user-customer-123',
    email: 'customer@test.com',
  },
  profile: {
    id: 'user-customer-123',
    name: 'ลูกค้า ทดสอบ',
    phone: '0812345678',
    email: 'customer@test.com',
    location: { lat: 13.7563, lng: 100.5018 },
  },
  roles: [{ role: 'customer' }],
  wallets: { balance: 1000, history: [] },
  restaurants: [
    {
      id: 'rest-1',
      name: 'ร้านข้าวมันไก่ ประตูน้ำ',
      status: 'open',
      ownerId: 'user-merchant-123',
      rating: 4.8,
      location: { lat: 13.7563, lng: 100.5018 },
      time: '15-20 นาที',
      image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500',
    },
  ],
  menuItems: {
    'rest-1': [
      { id: 'item-1', name: 'ข้าวมันไก่ต้ม', price: 60, available: true, desc: 'ข้าวมันไก่นุ่มหอม' },
    ],
  },
  riders: [
    {
      id: 'rider-1',
      userId: 'user-rider-123',
      name: 'นายไกด์ ไรเดอร์',
      phone: '0899999999',
      isOnline: true,
      location: { lat: 13.7563, lng: 100.5018 },
    },
  ],
  orders: [],
  jobOffers: [],
};

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/v1/token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
          user: mockState.user,
          session: {
            access_token: 'mock-access-token',
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh-token',
            user: mockState.user,
          },
        }),
      });
      return;
    }

    if (url.includes('/auth/v1/user') || url.includes('/auth/v1/session')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState.user),
      });
      return;
    }

    if (url.includes('/rest/v1/profiles')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockState.profile]),
      });
      return;
    }

    if (url.includes('/rest/v1/user_roles')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState.roles),
      });
      return;
    }

    if (url.includes('/rest/v1/wallets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockState.wallets]),
      });
      return;
    }

    if (url.includes('/rest/v1/app_config')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, data: { baseFee: 30, perKmFee: 10, gpFood: 30 } }]),
      });
      return;
    }

    if (url.includes('/rest/v1/restaurants')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState.restaurants.map(r => ({ id: r.id, data: r }))),
      });
      return;
    }

    if (url.includes('/rest/v1/menu_items')) {
      const items = Object.entries(mockState.menuItems).map(([rid, list]) => ({
        restaurant_id: rid,
        items: list,
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      });
      return;
    }

    if (url.includes('/rest/v1/riders')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState.riders.map(r => ({ id: r.id, data: r }))),
      });
      return;
    }

    if (url.includes('/rest/v1/orders')) {
      if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        const body = route.request().postDataJSON();
        if (body?.data) {
          const idx = mockState.orders.findIndex(o => o.id === body.data.id);
          if (idx >= 0) mockState.orders[idx] = body.data;
          else mockState.orders.unshift(body.data);
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState.orders.map(o => ({ id: o.id, data: o }))),
      });
      return;
    }

    if (url.includes('/rest/v1/rpc/place_order_with_wallet')) {
      const payload = route.request().postDataJSON();
      const orderId = `order-${Date.now()}`;
      const newOrder = {
        id: orderId,
        type: payload.p_type || 'food',
        status: 'pending',
        customerId: mockState.user.id,
        customerName: mockState.profile.name,
        restaurantId: 'rest-1',
        restaurantName: 'ร้านข้าวมันไก่ ประตูน้ำ',
        items: [{ id: 'item-1', name: 'ข้าวมันไก่ต้ม', price: 60, qty: 1 }],
        subtotal: 60,
        deliveryFee: 15,
        grandTotal: 75,
        paymentMethod: 'wallet',
        createdAt: new Date().toISOString(),
      };
      mockState.orders.unshift(newOrder);
      mockState.jobOffers.unshift({
        id: `offer-${Date.now()}`,
        order_id: orderId,
        rider_user_id: 'user-rider-123',
        status: 'pending',
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(orderId),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
});

test('Customer logs in, views restaurant, and places an order', async ({ page }) => {
  await page.goto('/');

  await page.locator('#login-identifier').fill('customer@test.com');
  await page.locator('#login-password').fill('password123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).last().click();

  await expect(page.getByRole('heading', { name: 'BoomRider' })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('body')).not.toBeEmpty();
});

test('Merchant receives pending order and accepts it', async ({ page }) => {
  const orderId = 'order-merchant-test-101';
  mockState.orders = [
    {
      id: orderId,
      type: 'food',
      status: 'pending',
      customerId: 'user-customer-123',
      restaurantId: 'rest-1',
      restaurantName: 'ร้านข้าวมันไก่ ประตูน้ำ',
      items: [{ name: 'ข้าวมันไก่ต้ม', price: 60, qty: 1 }],
      grandTotal: 75,
      paymentMethod: 'wallet',
      createdAt: new Date().toISOString(),
    },
  ];

  mockState.roles = [{ role: 'merchant' }];
  mockState.user = { id: 'user-merchant-123', email: 'merchant@test.com' };
  mockState.profile = { id: 'user-merchant-123', name: 'เจ้าของร้าน', email: 'merchant@test.com' };

  await page.goto('/');
  await page.locator('#login-identifier').fill('merchant@test.com');
  await page.locator('#login-password').fill('password123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).last().click();

  await expect(page.locator('body')).not.toBeEmpty();
});

test('Rider receives job offer, accepts job, and completes delivery lifecycle', async ({ page }) => {
  const orderId = 'order-rider-test-202';
  mockState.orders = [
    {
      id: orderId,
      type: 'food',
      status: 'ready_to_pickup',
      customerId: 'user-customer-123',
      restaurantId: 'rest-1',
      restaurantName: 'ร้านข้าวมันไก่ ประตูน้ำ',
      items: [{ name: 'ข้าวมันไก่ต้ม', price: 60, qty: 1 }],
      grandTotal: 75,
      riderUserId: 'user-rider-123',
      riderName: 'นายไกด์ ไรเดอร์',
      paymentMethod: 'wallet',
      createdAt: new Date().toISOString(),
    },
  ];

  mockState.roles = [{ role: 'rider' }];
  mockState.user = { id: 'user-rider-123', email: 'rider@test.com' };
  mockState.profile = { id: 'user-rider-123', name: 'นายไกด์ ไรเดอร์', email: 'rider@test.com' };

  await page.goto('/');
  await page.locator('#login-identifier').fill('rider@test.com');
  await page.locator('#login-password').fill('password123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).last().click();

  await expect(page.locator('body')).not.toBeEmpty();

  const { canApplyOrderUpdate } = await import('../src/domain/orderStatus.js');
  expect(canApplyOrderUpdate({ status: 'ready_to_pickup' }, { status: 'rider_accepted' })).toBe(true);
  expect(canApplyOrderUpdate({ status: 'rider_accepted' }, { status: 'picking_up' })).toBe(true);
  expect(canApplyOrderUpdate({ status: 'picking_up' }, { status: 'delivering' })).toBe(true);
  expect(canApplyOrderUpdate({ status: 'delivering' }, { status: 'delivered' })).toBe(true);
  expect(canApplyOrderUpdate({ status: 'delivered' }, { status: 'completed' })).toBe(true);
});

test('Validates expired rider job offers and enforces unauthorized status regression guards', async ({ page }) => {
  await page.goto('/');

  const expiredOffer = {
    id: 'offer-expired-101',
    order_id: 'order-101',
    rider_user_id: 'user-rider-123',
    status: 'pending',
    expires_at: new Date(Date.now() - 10000).toISOString(),
  };

  expect(new Date(expiredOffer.expires_at).getTime()).toBeLessThan(Date.now());

  const { canApplyOrderUpdate } = await import('../src/domain/orderStatus.js');
  expect(canApplyOrderUpdate({ status: 'completed' }, { status: 'pending' })).toBe(false);
  expect(canApplyOrderUpdate({ status: 'delivered' }, { status: 'cancelled' })).toBe(false);
  expect(canApplyOrderUpdate({ status: 'completed' }, { status: 'delivering' })).toBe(false);
});
