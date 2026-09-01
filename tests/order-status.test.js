import test from 'node:test';
import assert from 'node:assert/strict';

import { canApplyOrderUpdate } from '../src/domain/orderStatus.js';

test('allows a new order and forward status transitions', () => {
  assert.equal(canApplyOrderUpdate(null, { status: 'pending' }), true);
  assert.equal(canApplyOrderUpdate({ status: 'preparing' }, { status: 'delivering' }), true);
});

test('rejects stale status regressions', () => {
  assert.equal(canApplyOrderUpdate({ status: 'delivering' }, { status: 'preparing' }), false);
  assert.equal(canApplyOrderUpdate({ status: 'completed' }, { status: 'delivered' }), false);
});

test('never cancels a delivered or completed order', () => {
  assert.equal(canApplyOrderUpdate({ status: 'delivered' }, { status: 'cancelled' }), false);
  assert.equal(canApplyOrderUpdate({ status: 'completed' }, { status: 'cancelled' }), false);
  assert.equal(canApplyOrderUpdate({ status: 'preparing' }, { status: 'cancelled' }), true);
});
