/**
 * onStatusValidation
 * ─────────────────────────────────────────────────────────────────────────────
 * Firestore trigger: fires on every update to orders/{orderId}.
 *
 * Acts as server-side defense-in-depth below Firestore Security Rules (P0-2).
 * Security Rules already enforce role-scoped writes; this function catches any
 * transition that still slips through (e.g. admin overrides, SDK writes,
 * future rule changes) and reverts the order to the previous status.
 *
 * Valid transition graph:
 *
 *  pending ──→ confirmed ──→ preparing ──→ ready_to_pickup
 *    │              │             │               │
 *    │              └─────────────┴──→ cancelled  │
 *    └─────────────────────────────────────────── │
 *                                                 ▼
 *                                         rider_accepted ──→ picking_up ──┐
 *                                                │                         │
 *                                                └─────────────────────────┤
 *                                                                          ▼
 *                                                                      delivering
 *                                                                          │
 *                                                                          ▼
 *                                                                       delivered
 *                                                                          │
 *                                                                          ▼
 *                                                                       completed  (terminal)
 *
 * → cancelled  is always a valid transition from any non-terminal state.
 * completed / cancelled  are terminal — no further transitions allowed.
 *
 * Notes:
 *  - confirmed → ready_to_pickup  is valid (merchant skips separate preparing step).
 *  - rider_accepted → delivering  is valid (rider skips explicit picking_up ping).
 *  - ready_to_pickup → delivering  is valid for parcel orders (no picking_up stop).
 *  - On an invalid transition the order status is written back to oldStatus and
 *    a _revertedAt / _revertReason field is stamped for audit purposes.
 *  - The revert write sets status back to oldStatus so this function will see
 *    newStatus === oldStatus on the next trigger and exit early — no infinite loop.
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');

// ── Allowed next-statuses for each status ─────────────────────────────────────
// Keys = current status, values = Set of statuses this can transition TO.
// 'cancelled' is NOT listed here but is handled as a universal escape below.
const NEXT = {
  pending:         new Set(['confirmed']),
  confirmed:       new Set(['preparing', 'ready_to_pickup']),
  preparing:       new Set(['ready_to_pickup']),
  ready_to_pickup: new Set(['rider_accepted', 'delivering']),  // delivering = parcel shortcut
  rider_accepted:  new Set(['picking_up', 'delivering']),
  picking_up:      new Set(['delivering']),
  delivering:      new Set(['delivered']),
  delivered:       new Set(['completed']),
  completed:       new Set([]),   // terminal
  cancelled:       new Set([]),   // terminal
};

const KNOWN = new Set(Object.keys(NEXT));
const TERMINAL = new Set(['completed', 'cancelled']);

/**
 * Returns true when the old→new transition is permitted by business rules.
 * Cancellation is always allowed from any non-terminal state.
 */
function isAllowed(from, to) {
  if (!KNOWN.has(from)) return true;      // unknown status — don't block
  if (TERMINAL.has(from)) return false;   // nothing can leave a terminal state
  if (to === 'cancelled') return true;    // cancellation is a universal exit
  return NEXT[from]?.has(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────

const onStatusValidation = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-southeast1' },
  async (event) => {
    const newData = event.data?.after?.data();
    const oldData = event.data?.before?.data();
    if (!newData || !oldData) return;

    const newStatus = newData.status;
    const oldStatus = oldData.status;

    // Nothing to do if status didn't change
    if (newStatus === oldStatus) return;

    if (isAllowed(oldStatus, newStatus)) return;

    // ── Invalid transition detected ───────────────────────────────────────────
    const orderId = event.params.orderId;
    const shortId = orderId.slice(-6).toUpperCase();

    logger.error(
      `[onStatusValidation] INVALID TRANSITION #${shortId}: ` +
      `"${oldStatus}" → "${newStatus}" — reverting`,
    );

    // Write back the previous status.
    // The next trigger invocation will see newStatus === oldStatus and return
    // early, so there is no infinite loop risk.
    try {
      await getFirestore().doc(`orders/${orderId}`).update({
        status:         oldStatus,
        _revertedAt:    FieldValue.serverTimestamp(),
        _revertReason:  `invalid transition: ${oldStatus} → ${newStatus}`,
      });
      logger.info(`[onStatusValidation] #${shortId} reverted to "${oldStatus}"`);
    } catch (err) {
      logger.error(
        `[onStatusValidation] failed to revert #${shortId}: ${err?.message}`,
      );
    }
  },
);

module.exports = { onStatusValidation };
