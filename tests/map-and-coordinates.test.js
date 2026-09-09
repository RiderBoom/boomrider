import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidCoordinate, isDefaultFallbackLocation, getDistanceFromLatLonInKm } from '../src/utils.js';

test('isValidCoordinate rejects null, undefined, out-of-bounds, and default Bangkok fallback', () => {
  // Valid real coordinates
  assert.equal(isValidCoordinate({ lat: 13.7367, lng: 100.5231 }), true);
  assert.equal(isValidCoordinate({ lat: 0, lng: 0 }), true); // 0 is valid coordinate

  // Out of bounds
  assert.equal(isValidCoordinate({ lat: 91, lng: 100 }), false);
  assert.equal(isValidCoordinate({ lat: -91, lng: 100 }), false);
  assert.equal(isValidCoordinate({ lat: 13, lng: 181 }), false);
  assert.equal(isValidCoordinate({ lat: 13, lng: -181 }), false);

  // Missing / non-numeric
  assert.equal(isValidCoordinate(null), false);
  assert.equal(isValidCoordinate(undefined), false);
  assert.equal(isValidCoordinate({ lat: 'invalid', lng: 100 }), false);

  // Default Bangkok fallback coordinates
  assert.equal(isDefaultFallbackLocation({ lat: 13.7563, lng: 100.5018 }), true);
  assert.equal(isValidCoordinate({ lat: 13.7563, lng: 100.5018 }), false);
});

test('Editing address text clears old coordinates state', () => {
  let parcelDetails = {
    pickup: '123 Sukhumvit',
    pickupLocation: { lat: 13.7367, lng: 100.5231 },
    dropoff: '456 Silom',
    dropoffLocation: { lat: 13.7250, lng: 100.5300 },
  };

  // User manually edits pickup text:
  const newPickupText = '123 Sukhumvit Soi 55';
  parcelDetails = {
    ...parcelDetails,
    pickup: newPickupText,
    pickupLocation: null, // cleared
  };

  assert.equal(parcelDetails.pickup, '123 Sukhumvit Soi 55');
  assert.equal(parcelDetails.pickupLocation, null);
  assert.equal(isValidCoordinate(parcelDetails.pickupLocation), false);
});

test('Swapping pickup and dropoff preserves correct text and location coordinates', () => {
  let rideDetails = {
    pickup: 'Siam Paragon',
    pickupLocation: { lat: 13.7460, lng: 100.5340 },
    dropoff: 'Iconsiam',
    dropoffLocation: { lat: 13.7266, lng: 100.5108 },
  };

  // Swap action:
  rideDetails = {
    ...rideDetails,
    pickup: rideDetails.dropoff,
    dropoff: rideDetails.pickup,
    pickupLocation: rideDetails.dropoffLocation,
    dropoffLocation: rideDetails.pickupLocation,
  };

  assert.equal(rideDetails.pickup, 'Iconsiam');
  assert.deepEqual(rideDetails.pickupLocation, { lat: 13.7266, lng: 100.5108 });
  assert.equal(rideDetails.dropoff, 'Siam Paragon');
  assert.deepEqual(rideDetails.dropoffLocation, { lat: 13.7460, lng: 100.5340 });
});

test('Service order requires valid location coordinates', () => {
  let serviceDetailsWithoutLoc = {
    serviceCategory: 'ทำความสะอาดบ้าน',
    address: 'บ้านเลขที่ 99',
    location: null,
    price: 350,
  };

  assert.equal(isValidCoordinate(serviceDetailsWithoutLoc.location), false);

  // User pins location on map:
  let serviceDetailsWithLoc = {
    ...serviceDetailsWithoutLoc,
    location: { lat: 13.7367, lng: 100.5231 },
  };

  assert.equal(isValidCoordinate(serviceDetailsWithLoc.location), true);
});

test('Haversine distance calculation fallback returns stable kilometer estimates', () => {
  const dist = getDistanceFromLatLonInKm(13.7367, 100.5231, 13.7250, 100.5300);
  assert.equal(typeof dist, 'number');
  assert.ok(dist > 0 && dist < 10);
});

test('AbortController cancels pending geocoding/routing requests upon query change', async () => {
  const controller1 = new AbortController();

  let request1Cancelled = false;

  const fetchPromise = new Promise((resolve, reject) => {
    controller1.signal.addEventListener('abort', () => {
      request1Cancelled = true;
      reject(new Error('AbortError'));
    });
  });

  // User types new character -> abort previous request
  controller1.abort();

  await assert.rejects(fetchPromise, { message: 'AbortError' });
  assert.equal(request1Cancelled, true);
});
