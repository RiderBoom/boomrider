const { initializeApp } = require('firebase-admin/app');

// Initialize Admin SDK once (singleton — safe to call multiple times)
initializeApp();

const { processOrderPayment }                   = require('./src/processOrderPayment');
const { processCashSettlement }                 = require('./src/processCashSettlement');
const { onOrderCreated, onOrderReadyForPickup } = require('./src/onOrderCreated');
const { onOrderStatusChanged }                  = require('./src/onOrderStatusChanged');
const { autoTimeoutPendingOrders }              = require('./src/autoTimeoutPendingOrders');

module.exports = {
  processOrderPayment,
  processCashSettlement,
  onOrderCreated,
  onOrderReadyForPickup,
  onOrderStatusChanged,
  autoTimeoutPendingOrders,
};
