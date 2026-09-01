export const ORDER_STATUS_RANK = {
  pending: 0,
  preparing: 1,
  ready_to_pickup: 2,
  rider_accepted: 3,
  picking_up: 4,
  delivering: 5,
  delivered: 6,
  completed: 7,
  cancelled: 99,
};

// Prevent stale polling/realtime payloads from moving an order backwards.
export const canApplyOrderUpdate = (existing, incoming) => {
  if (!existing) return true;
  if (!incoming) return false;
  if (incoming.status === 'cancelled') {
    return !['delivered', 'completed'].includes(existing.status);
  }
  return (ORDER_STATUS_RANK[incoming.status] ?? -1) >=
    (ORDER_STATUS_RANK[existing.status] ?? -1);
};
