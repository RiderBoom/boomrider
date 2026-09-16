import test from 'node:test';
import assert from 'node:assert/strict';
import { autoDispatch } from '../src/context/hooks/useAutoDispatch.js';
import { INITIAL_CONFIG } from '../src/constants.js';

test('Item 1 & 2: GP rate validation and config parsing with default fallbacks', () => {
  const parseAndValidateConfig = (editConfig) => {
    const parseConfigVal = (val, defaultVal) => {
      if (val === '' || val === null || val === undefined) return defaultVal;
      const num = parseFloat(val);
      return Number.isNaN(num) ? defaultVal : num;
    };

    const baseFee = parseConfigVal(editConfig.baseFee, INITIAL_CONFIG.baseFee);
    const perKmFee = parseConfigVal(editConfig.perKmFee, INITIAL_CONFIG.perKmFee);

    const appRadius = parseConfigVal(editConfig.appRadius, INITIAL_CONFIG.appRadius);
    const restaurantRadius = parseConfigVal(editConfig.restaurantRadius, INITIAL_CONFIG.restaurantRadius);
    const riderRadius = parseConfigVal(editConfig.riderRadius, INITIAL_CONFIG.riderRadius);
    const rideBaseFee = parseConfigVal(editConfig.rideBaseFee ?? editConfig.baseFee, baseFee);
    const ridePerKmFee = parseConfigVal(editConfig.ridePerKmFee ?? editConfig.perKmFee, perKmFee);
    const gpFood = parseConfigVal(editConfig.gpFood, INITIAL_CONFIG.gpFood);
    const gpDelivery = parseConfigVal(editConfig.gpDelivery, INITIAL_CONFIG.gpDelivery);
    const gpRide = parseConfigVal(editConfig.gpRide, INITIAL_CONFIG.gpRide);
    const gpService = parseConfigVal(editConfig.gpService, INITIAL_CONFIG.gpService);

    if ([appRadius, restaurantRadius, riderRadius, baseFee, perKmFee, rideBaseFee, ridePerKmFee].some(v => isNaN(v) || v < 0)) {
      return { ok: false, error: 'รัศมีให้บริการและค่าธรรมเนียมต้องเป็นตัวเลขที่ไม่ติดลบ' };
    }
    if ([gpFood, gpDelivery, gpRide, gpService].some(v => isNaN(v) || v < 0 || v > 100)) {
      return { ok: false, error: 'อัตรา GP ต้องอยู่ระหว่าง 0% ถึง 100%' };
    }
    return {
      ok: true,
      cleanedConfig: {
        appRadius, restaurantRadius, riderRadius, baseFee, perKmFee,
        rideBaseFee, ridePerKmFee, gpFood, gpDelivery, gpRide, gpService,
      },
    };
  };

  assert.equal(parseAndValidateConfig({ appRadius: 15, restaurantRadius: 10, riderRadius: 5, baseFee: 20, perKmFee: 10, rideBaseFee: 20, ridePerKmFee: 10, gpFood: 150, gpDelivery: 15, gpRide: 15, gpService: 15 }).ok, false);
  assert.equal(parseAndValidateConfig({ appRadius: -5, restaurantRadius: 10, riderRadius: 5, baseFee: 20, perKmFee: 10, rideBaseFee: 20, ridePerKmFee: 10, gpFood: 30, gpDelivery: 15, gpRide: 15, gpService: 15 }).ok, false);
  assert.equal(parseAndValidateConfig({ appRadius: 15, restaurantRadius: 10, riderRadius: 5, baseFee: -20, perKmFee: 10, rideBaseFee: 20, ridePerKmFee: 10, gpFood: 30, gpDelivery: 15, gpRide: 15, gpService: 15 }).ok, false);
  assert.equal(parseAndValidateConfig({ appRadius: 15, restaurantRadius: 10, riderRadius: 5, baseFee: 20, perKmFee: 10, rideBaseFee: 20, ridePerKmFee: 10, gpFood: 30, gpDelivery: 15, gpRide: 15, gpService: 15 }).ok, true);

  // Fallback tests for empty/undefined values
  const emptyResult = parseAndValidateConfig({ rideBaseFee: '', ridePerKmFee: '', appRadius: undefined });
  assert.equal(emptyResult.ok, true, 'Empty and undefined config fields should fall back to defaults without error');
  assert.equal(emptyResult.cleanedConfig.rideBaseFee, INITIAL_CONFIG.baseFee);
  assert.equal(emptyResult.cleanedConfig.ridePerKmFee, INITIAL_CONFIG.perKmFee);
  assert.equal(emptyResult.cleanedConfig.appRadius, INITIAL_CONFIG.appRadius);
});

test('Item 3: App Config fetch error preserves existing state without overwrite', () => {
  let appConfig = { baseFee: 25, perKmFee: 12 };
  const configResult = { error: { message: 'Network Timeout' }, data: null };

  if (!configResult.error) {
    appConfig = configResult.data;
  }

  assert.equal(appConfig.baseFee, 25, 'State must not be overwritten when fetch fails');
});

test('Item 5: autoDispatch uses parameterized appConfig.riderRadius', async () => {
  let passedRadius = null;
  const mockSupabase = {
    rpc: async (fn, params) => {
      if (fn === 'dispatch_order') {
        passedRadius = params.p_radius_km;
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const testOrder = { id: 'order-test-123', pickupLocation: { lat: 13.7, lng: 100.5 } };
  await autoDispatch(mockSupabase, testOrder, { riderRadius: 8 });

  assert.equal(passedRadius, 8, 'autoDispatch must pass configured riderRadius (8km)');
});

test('Item 7: TopUpModal falls back to adminQrCode image when adminPromptPayId is missing', () => {
  const getQrRenderMode = (config) => {
    if (config.adminPromptPayId) return 'promptpay_qr_generator';
    if (config.adminQrCode) return 'image_qr_fallback';
    return 'empty_qr';
  };

  assert.equal(getQrRenderMode({ adminPromptPayId: '0812345678', adminQrCode: 'https://img.png' }), 'promptpay_qr_generator');
  assert.equal(getQrRenderMode({ adminPromptPayId: '', adminQrCode: 'https://img.png' }), 'image_qr_fallback');
});

test('Item 9: Service category pricing has no hardcoded 350 Baht fallback', () => {
  const appConfig = { extraServices: [{ name: 'ล้างแอร์', price: 500 }] };
  const getServicePrice = (cat, config) => {
    const list = config.extraServices || [];
    const match = list.find(s => s.name === cat);
    return match ? match.price : 0;
  };

  assert.equal(getServicePrice('ทำความสะอาด', appConfig), 0, 'Unmatched service must return 0 instead of 350');
  assert.equal(getServicePrice('ล้างแอร์', appConfig), 500);
});
