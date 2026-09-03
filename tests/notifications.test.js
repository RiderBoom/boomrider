import test from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating buildNotification recipient and channel routing logic
function resolveNotificationRouting(payload, extraData = {}) {
  const record = payload.record || {};
  const data = record.data || record || {};
  const users = new Set();
  let title = '', body = '', channel = 'orders', kind = 'order_status';
  let orderId = String(record.order_id || data.id || record.id || '');

  if (payload.table === 'job_offers' && payload.type === 'INSERT') {
    if (record.rider_user_id) users.add(String(record.rider_user_id));
    title = '🛵 งานใหม่เข้ามา!';
    body = `คุณมีออเดอร์ใหม่ #${String(record.order_id || '').slice(-6)} รอรับงาน`;
    channel = 'new_jobs'; kind = 'new_job'; orderId = String(record.order_id || '');
  } else if (payload.table === 'orders' && payload.type === 'INSERT') {
    const merchantOwnerId = data.restaurantOwnerId || extraData.restaurantOwnerId;
    [data.customerId, merchantOwnerId].filter(Boolean).forEach(id => users.add(String(id)));
    title = '🛎️ ออเดอร์ใหม่'; body = `ออเดอร์ #${orderId.slice(-6)} ถูกสร้างเรียบร้อยแล้ว`;
    channel = 'merchant_orders'; kind = 'new_order';
  } else if (payload.table === 'orders' && payload.type === 'UPDATE') {
    const oldData = (payload.old_record && payload.old_record.data) || payload.old_record || {};
    if (!data.status || data.status === oldData.status) return null;
    const merchantOwnerId = data.restaurantOwnerId || extraData.restaurantOwnerId;
    const riderUserId = data.riderUserId || extraData.riderUserId;
    [data.customerId, merchantOwnerId, riderUserId]
      .filter(Boolean).forEach(id => users.add(String(id)));
    const labels = {
      preparing: 'ร้านกำลังเตรียมอาหาร', ready_to_pickup: 'อาหารพร้อมรับแล้ว',
      rider_accepted: 'ไรเดอร์รับงานแล้ว', picking_up: 'ไรเดอร์ถึงจุดรับแล้ว',
      delivering: 'กำลังเดินทางไปส่ง', delivered: 'สินค้าเดินทางถึงแล้ว',
      completed: 'จัดส่งสำเร็จ', cancelled: 'ออเดอร์ถูกยกเลิก',
    };
    title = `📦 อัปเดตออเดอร์ #${orderId.slice(-6)}`;
    body = labels[data.status] || `สถานะเปลี่ยนเป็น ${data.status}`;
  } else if (payload.table === 'admin_notifs' && payload.type === 'INSERT') {
    (extraData.adminUserIds || []).forEach(id => users.add(String(id)));
    title = String(record.title || 'BoomRider Admin');
    body = String(record.message || 'มีเหตุการณ์ใหม่ที่ต้องตรวจสอบ');
    channel = 'admin_alerts'; kind = 'admin_alert';
  } else return null;

  return { users: [...users], title, body, channel, kind, orderId, status: String(data.status || '') };
}

function computeEventKey(payload) {
  const record = payload.record || {};
  const data = record.data || record || {};
  const id = record.id || record.order_id || data.id || 'unknown';
  const version = data.status || record.status || record.updated_at || record.created_at || 'event';
  return `${payload.table}:${payload.type}:${id}:${version}`;
}

function isStaleTokenError(detail) {
  return /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND|registration-token-not-registered/i.test(detail);
}

function resolveNotificationClickRoute(data) {
  if (!data) return null;
  if (data.type === 'new_job') {
    return { role: 'rider', tab: 'jobs' };
  } else if (data.type === 'new_order') {
    return { role: 'merchant', tab: 'orders' };
  } else if (data.type === 'admin_alert') {
    return { role: 'admin', tab: 'dashboard' };
  } else if (data.type === 'order_status' || data.orderId) {
    return { role: 'customer', tab: 'activity' };
  }
  return null;
}

test('job_offers INSERT targets only the specific rider user on channel new_jobs', () => {
  const payload = {
    table: 'job_offers',
    type: 'INSERT',
    record: { id: 'offer-1', order_id: 'ord-100200', rider_user_id: 'rider-uuid-123' },
  };
  const res = resolveNotificationRouting(payload);
  assert.deepEqual(res.users, ['rider-uuid-123']);
  assert.equal(res.channel, 'new_jobs');
  assert.equal(res.kind, 'new_job');
  assert.equal(res.orderId, 'ord-100200');
});

test('orders INSERT targets customer and merchant owner on channel merchant_orders', () => {
  const payload = {
    table: 'orders',
    type: 'INSERT',
    record: {
      id: 'ord-555',
      data: { id: 'ord-555', customerId: 'cust-uuid-1', restaurantOwnerId: 'merch-uuid-1' },
    },
  };
  const res = resolveNotificationRouting(payload);
  assert.deepEqual(res.users, ['cust-uuid-1', 'merch-uuid-1']);
  assert.equal(res.channel, 'merchant_orders');
  assert.equal(res.kind, 'new_order');
});

test('orders UPDATE with fallback owner and rider targets customer, merchant, and rider', () => {
  const payload = {
    table: 'orders',
    type: 'UPDATE',
    old_record: { data: { id: 'ord-777', status: 'preparing' } },
    record: {
      id: 'ord-777',
      data: { id: 'ord-777', status: 'delivering', customerId: 'cust-1', restaurantId: 'shop-1', riderId: 'r-1' },
    },
  };
  const extra = { restaurantOwnerId: 'merch-1', riderUserId: 'rider-1' };
  const res = resolveNotificationRouting(payload, extra);
  assert.deepEqual(res.users, ['cust-1', 'merch-1', 'rider-1']);
  assert.equal(res.channel, 'orders');
  assert.equal(res.kind, 'order_status');
  assert.equal(res.body, 'กำลังเดินทางไปส่ง');
});

test('admin_notifs INSERT targets admin user roles on channel admin_alerts', () => {
  const payload = {
    table: 'admin_notifs',
    type: 'INSERT',
    record: { id: 'an-1', title: 'System Alert', message: 'High CPU' },
  };
  const res = resolveNotificationRouting(payload, { adminUserIds: ['admin-1', 'admin-2'] });
  assert.deepEqual(res.users, ['admin-1', 'admin-2']);
  assert.equal(res.channel, 'admin_alerts');
  assert.equal(res.kind, 'admin_alert');
});

test('eventKey produces predictable idempotent key strings', () => {
  const payload = {
    table: 'orders',
    type: 'UPDATE',
    record: { id: 'ord-123', data: { id: 'ord-123', status: 'delivered' } },
  };
  assert.equal(computeEventKey(payload), 'orders:UPDATE:ord-123:delivered');
});

test('isStaleTokenError detects invalid or unregistered FCM tokens', () => {
  assert.equal(isStaleTokenError('{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"UNREGISTERED"}]}}'), true);
  assert.equal(isStaleTokenError('INVALID_ARGUMENT token format'), true);
  assert.equal(isStaleTokenError('registration-token-not-registered'), true);
  assert.equal(isStaleTokenError('Internal Server Error'), false);
});

test('resolveNotificationClickRoute routes push taps to correct role and view tab', () => {
  assert.deepEqual(resolveNotificationClickRoute({ type: 'new_job', orderId: 'o1' }), { role: 'rider', tab: 'jobs' });
  assert.deepEqual(resolveNotificationClickRoute({ type: 'new_order', orderId: 'o2' }), { role: 'merchant', tab: 'orders' });
  assert.deepEqual(resolveNotificationClickRoute({ type: 'admin_alert' }), { role: 'admin', tab: 'dashboard' });
  assert.deepEqual(resolveNotificationClickRoute({ type: 'order_status', orderId: 'o3' }), { role: 'customer', tab: 'activity' });
});
