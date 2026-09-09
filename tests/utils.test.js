import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDistanceFromLatLonInKm,
  isSameDay,
  parseDateMs,
  r2,
  isValidCoordinate,
  isDefaultFallbackLocation,
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

test('isValidCoordinate validates bounds, lat/lng = 0, and default Bangkok fallback', () => {
  assert.equal(isValidCoordinate({ lat: 13.7367, lng: 100.5231 }), true);
  assert.equal(isValidCoordinate({ lat: 0, lng: 0 }), true); // 0 is a valid coordinate!
  assert.equal(isValidCoordinate({ lat: -90, lng: 180 }), true);
  assert.equal(isValidCoordinate({ lat: 91, lng: 100 }), false);
  assert.equal(isValidCoordinate({ lat: 13, lng: 181 }), false);
  assert.equal(isValidCoordinate(null), false);
  assert.equal(isValidCoordinate({ lat: 'abc', lng: 'def' }), false);

  // Default Bangkok fallback location:
  assert.equal(isDefaultFallbackLocation({ lat: 13.7563, lng: 100.5018 }), true);
  assert.equal(isValidCoordinate({ lat: 13.7563, lng: 100.5018 }), false); // Rejected for order creation!
  assert.equal(isValidCoordinate({ lat: 13.7563, lng: 100.5018 }, { allowDefaultFallback: true }), true);
});
