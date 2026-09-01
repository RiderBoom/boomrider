import test from 'node:test';
import assert from 'node:assert/strict';

import { getRiderJobDoneMs, getRiderJobIncome } from '../src/domain/riderJobs.js';

test('uses persisted rider income when available', () => {
  assert.equal(getRiderJobIncome({ riderIncome: 87, type: 'parcel' }, { gpDelivery: 15 }), 87);
});

test('calculates rider income from the configured GP by service type', () => {
  const config = { gpDelivery: 10, gpRide: 20, gpService: 25 };
  assert.equal(getRiderJobIncome({ type: 'parcel', deliveryFee: 100 }, config), 90);
  assert.equal(getRiderJobIncome({ type: 'ride', grandTotal: 200 }, config), 160);
  assert.equal(getRiderJobIncome({ type: 'service', grandTotal: 400 }, config), 300);
  assert.equal(getRiderJobIncome({ type: 'food', deliveryFee: 45 }, config), 45);
});

test('selects the best available completion timestamp', () => {
  assert.equal(getRiderJobDoneMs({ deliveredAtMs: 123, completedAtMs: 456 }), 123);
  const parsed = getRiderJobDoneMs({ completedAt: '31/08/2026 10:30:00' });
  assert.equal(new Date(parsed).getHours(), 10);
  assert.ok(Number.isNaN(getRiderJobDoneMs({})));
});
