import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDistanceFromLatLonInKm,
  isSameDay,
  parseDateMs,
  r2,
} from '../src/utils.js';

test('r2 rounds wallet values to two decimal places', () => {
  assert.equal(r2(10.005), 10.01);
  assert.equal(r2(null), 0);
});

test('parseDateMs accepts epoch and documented Thai date format', () => {
  assert.equal(parseDateMs(1_700_000_000_000), 1_700_000_000_000);
  const parsed = new Date(parseDateMs('31/08/2026 14:30:05'));
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 31);
  assert.equal(parsed.getHours(), 14);
  assert.ok(Number.isNaN(parseDateMs('not-a-date')));
});

test('isSameDay compares values in the local timezone', () => {
  assert.equal(isSameDay('31/08/2026 00:00:00', '31/08/2026 23:59:59'), true);
  assert.equal(isSameDay('31/08/2026 23:59:59', '01/09/2026 00:00:00'), false);
});

test('distance calculation returns stable kilometer estimates', () => {
  assert.equal(getDistanceFromLatLonInKm(13.7563, 100.5018, 13.7563, 100.5018), 0);
  assert.equal(getDistanceFromLatLonInKm(13.7563, 100.5018, 13.7367, 100.5231), 3.17);
});
