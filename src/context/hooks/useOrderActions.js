import { generateId, formatDateTime, r2, safeLocalSet } from '../../utils';
import { ADMIN_EMAIL, USER_LOCATION } from '../../constants';
import { autoDispatch } from './useAutoDispatch';

export function useOrderActions(deps) {
  const {
    orders, setOrders,
    cart, setCart,
    restaurants, riders, appConfig,
    currentUser, userProfile, userAddresses, userWallet,
    parcelDetails, setParcelDetails,
    parcelDistance, parcelEstimate,
    paymentMethod, setPaymentMethod,
    pendingRequests, setPendingRequests,
    selectedOrderToCancel, setSelectedOrderToCancel,
    cancelReasonInput, setCancelReasonInput,
    setShowCancelModal,
    setSelectedRestaurant, setActiveTab,
    setParcelMapTarget, setParcelEstimate, setParcelDistance,
    placingOrderRef, pendingLocalOrderIdsRef,
    seenOrderIdsRef,
    creditWallet, creditWalletLocal, processTransaction, setUserWallet,
    notifySystem, notifyAdmin,
    supabase,
  } = deps;

  const calculateDeliveryFee = (distance) => appConfig.baseFee + (Math.ceil(distance) * appConfig.perKmFee);
  const calculateFoodTotal   = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const isPending = (type) => pendingRequests.some(r => r.type === type && r.userId === userProfile.id);
  const hasPendingCancelRequest = (orderId) =>
    pendingRequests.some(r => r.type === 'cancel_order' && r.data?.orderId === orderId);

  // Returns correct settlement split for both food and parcel orders
  const _settlementAmounts = (order) => {
    const gpFoodRate  = (appConfig.gpFood ?? 30) / 100;
    const gpDelivRate = (appConfig.gpDelivery ?? 15) / 100;
    const foodTotal   = r2(order.foodTotal   || 0);
    const deliveryFee = r2(order.deliveryFee || 0);

    if (order.type === 'parcel') {
      const adminGP     = r2(deliveryFee * gpDelivRate);
      const riderIncome = r2(deliveryFee - adminGP);
      return { foodTotal: 0, deliveryFee, gpAmount: adminGP, merchantIncome: 0, riderIncome };
    }
    return {
      foodTotal,
      deliveryFee,
      gpAmount:       r2(foodTotal * gpFoodRate),
      merchantIncome: r2(foodTotal * (1 - gpFoodRate)),
      riderIncome:    deliveryFee,
    };
  };

  const addToCart = (item, restaurantId, restaurantName, distance) => {
    if (!item.available) return notifySystem('ขออภัย', 'เมนูนี้หมดแล้ว', 'error');
    if (cart.length > 0 && cart[0].restaurantId !== restaurantId) {
      if (!window.confirm('คุณต้องการเริ่มออเดอร์ใหม่จากร้านนี้ใช่ไหม? (ตะกร้าเก่าจะถูกลบ)')) return;
      setCart([{ ...item, restaurantId, restaurantName, qty: 1, distance }]);
    } else {
      const existing = cart.find(c => c.id === item.id);
      if (existing) {
        setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      } else {
        setCart([...cart, { ...item, restaurantId, restaurantName, qty: 1, distance }]);
      }
      notifySystem('เพิ่มลงตะกร้า', `เพิ่ม ${item.name} แล้ว`, 'success');
    }
  };

  const placeOrder = async (promoDiscount = 0, notes = '') => {
    if (placingOrderRef.current || cart.length === 0) return;
    placingOrderRef.current = true;
    setTimeout(() => { placingOrderRef.current = false; }, 3000);

    const foodTotal    = calculateFoodTotal();
    const distance     = cart[0]?.distance || 1;
    const deliveryFee  = calculateDeliveryFee(distance);
    const grandTotal   = Math.max(0, foodTotal + deliveryFee - promoDiscount);
    const restaurant   = restaurants.find(r => r.id === cart[0].restaurantId);

    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      placingOrderRef.current = false;
      return notifySystem('ผิดพลาด', `ยอดเงินในกระเป๋าไม่เพียงพอ (มี ฿${userWallet} ต้องการ ฿${grandTotal})`, 'error');
    }

    const uid  = currentUser?.id || userProfile?.id || '';
    const addr = userAddresses?.[0] || { address: 'ที่อยู่ลูกค้า', location: USER_LOCATION };
    const orderId = generateId();

    const newOrder = {
      id: orderId,
      type: 'food',
      status: 'pending',
      customerId: uid,
      customerName: userProfile.name || 'ลูกค้า',
      customerPhone: userProfile.phone || null,
      restaurantId: cart[0].restaurantId,
      restaurantName: cart[0].restaurantName,
      restaurantOwnerId: restaurant?.ownerId || null,   // ← for settlement RPC
      restaurantLocation: restaurant?.location || USER_LOCATION,
      pickupLocation: restaurant?.location || USER_LOCATION,
      location: addr.location || USER_LOCATION,
      address: addr.address,
      items: cart.map(({ id, name, price, qty }) => ({ id, name, price, qty })),
      foodTotal,
      deliveryFee,
      promoDiscount,
      grandTotal,
      paymentMethod,
      notes,
      createdAt: formatDateTime(),
    };

    pendingLocalOrderIdsRef.current.add(orderId);
    setOrders(prev => [newOrder, ...prev]);
    await supabase.from('orders').insert({ id: orderId, status: 'pending', data: newOrder });

    if (paymentMethod === 'wallet') {
      creditWallet(uid, -grandTotal, `ชำระค่าอาหาร ออเดอร์ #${orderId.slice(-6)}`);
    }

    notifyAdmin('🛎️ ออเดอร์ใหม่', `${userProfile.name} สั่ง ${cart[0].restaurantName} ฿${grandTotal}`, 'info');
    setCart([]);
    setSelectedRestaurant(null);
    setActiveTab('orders');
    notifySystem('สั่งอาหารสำเร็จ! 🎉', `ออเดอร์ #${orderId.slice(-6)} ส่งไปยังร้านแล้ว`, 'success');
  };

  const placeParcelOrder = async () => {
    if (!parcelDetails.pickup || !parcelDetails.dropoff) {
      return notifySystem('ผิดพลาด', 'กรุณาระบุจุดรับและจุดส่ง', 'error');
    }
    const grandTotal  = parcelEstimate;
    const uid = currentUser?.id || userProfile?.id || '';
    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      return notifySystem('ผิดพลาด', `ยอดเงินในกระเป๋าไม่เพียงพอ (มี ฿${userWallet} ต้องการ ฿${grandTotal})`, 'error');
    }
    const orderId = generateId();
    const newOrder = {
      id: orderId,
      type: 'parcel',
      status: 'ready_to_pickup',
      customerId: uid,
      customerName: userProfile.name || 'ลูกค้า',
      customerPhone: userProfile.phone || null,
      pickup: parcelDetails.pickup,
      dropoff: parcelDetails.dropoff,
      pickupLocation: parcelDetails.pickupLocation || USER_LOCATION,
      location: parcelDetails.dropoffLocation || USER_LOCATION,
      weight: parcelDetails.weight,
      receiverName: parcelDetails.receiverName,
      receiverPhone: parcelDetails.receiverPhone,
      deliveryFee: grandTotal,
      riderIncome: r2(grandTotal * (1 - ((appConfig.gpDelivery ?? 15) / 100))),
      grandTotal,
      paymentMethod,
      createdAt: formatDateTime(),
    };
    pendingLocalOrderIdsRef.current.add(orderId);
    setOrders(prev => [newOrder, ...prev]);
    await supabase.from('orders').insert({ id: orderId, status: 'ready_to_pickup', data: newOrder });

    if (paymentMethod === 'wallet') {
      creditWallet(uid, -grandTotal, `ค่าส่งพัสดุ ออเดอร์ #${orderId.slice(-6)}`);
    }
    notifyAdmin('📦 พัสดุใหม่', `${userProfile.name} ส่ง ${parcelDetails.pickup} → ${parcelDetails.dropoff}`, 'info');
    setParcelDetails({ pickup: '', dropoff: '', weight: '1', distance: 0, receiverName: '', receiverPhone: '' });
    setParcelDistance(0);
    setParcelEstimate(0);
    setParcelMapTarget(null);
    setActiveTab('orders');
    notifySystem('สั่งส่งพัสดุสำเร็จ! 📦', `ออเดอร์ #${orderId.slice(-6)} กำลังหาไรเดอร์`, 'success');

    // Auto-dispatch parcel to nearest rider immediately
    autoDispatch(supabase, newOrder);
  };

  const _updateOrder = async (orderId, patch) => {
    let updated;
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      updated = { ...o, ...patch };
      return updated;
    }));
    if (updated) {
      await supabase.from('orders').update({ status: updated.status, data: updated }).eq('id', orderId);
    }
  };

  const acceptOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const uid    = currentUser?.id || userProfile?.id || '';
    const rider  = riders.find(r => r.userId === uid);
    if (!rider) return notifySystem('ผิดพลาด', 'ไม่พบข้อมูลไรเดอร์ของคุณ', 'error');

    const { gpAmount: adminGP, merchantIncome, riderIncome } = _settlementAmounts(order);

    const patch = {
      riderId: rider.id,
      riderUserId: uid,
      riderName: rider.name,
      riderPhone: rider.phone,
      status: 'rider_accepted',
      riderAcceptedAt: formatDateTime(),
      riderIncome,
      merchantIncome,
      adminGP,
    };

    // Atomic update to prevent race conditions (First-Come, First-Served manual accept)
    const updatedOrderData = { ...order, ...patch };
    const { data: updatedDbOrder, error } = await supabase
      .from('orders')
      .update({ status: patch.status, data: updatedOrderData })
      .eq('id', orderId)
      .in('status', ['pending', 'ready_to_pickup'])
      .select('id')
      .maybeSingle();

    if (error || !updatedDbOrder) {
      return notifySystem('เสียใจด้วย', 'มีไรเดอร์ท่านอื่นรับงานนี้ไปแล้ว', 'error');
    }

    // Since DB update succeeded, we can safely update local state
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrderData : o));
    // Mark rider as unavailable in riders table
    supabase.from('riders')
      .update({ is_available: false })
      .eq('id', rider.id)
      .then(() => {});
    notifySystem('รับงานแล้ว!', `ออเดอร์ #${orderId.slice(-6)} — ไปรับของที่ร้านได้เลย`, 'success');
  };

  const updateOrderStatus = async (orderId, newStatus, _unused, extraData = {}) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Stamp income breakdown when rider marks delivered (so history shows correct figures)
    let incomePatch = {};
    if (newStatus === 'delivered' || newStatus === 'completed') {
      const { gpAmount, merchantIncome, riderIncome: calcRider } = _settlementAmounts(order);
      incomePatch = {
        riderIncome:    order.riderIncome    ?? calcRider,
        merchantIncome: order.merchantIncome ?? merchantIncome,
        adminGP:        order.adminGP        ?? gpAmount,
        deliveredAt:    newStatus === 'delivered' ? formatDateTime() : order.deliveredAt,
        deliveredAtMs:  newStatus === 'delivered' ? Date.now() : order.deliveredAtMs,
      };
    }

    const basePatch = newStatus === 'completed'
      ? { status: newStatus, completedAt: new Date().toISOString() }
      : { status: newStatus };
    const patch = { ...basePatch, ...incomePatch, ...extraData };
    await _updateOrder(orderId, patch);

    // ── Grab Auto-Dispatch: trigger when merchant marks ready_to_pickup ──────
    if (newStatus === 'ready_to_pickup') {
      const updatedOrder = { ...order, ...patch };
      autoDispatch(supabase, updatedOrder);
    }

    // ── Rider's job ends at 'delivered' — release availability immediately ────
    if (newStatus === 'delivered') {
      const riderUid = order.riderUserId || riders.find(r => r.id === order.riderId)?.userId;
      const riderRow = riders.find(r => r.userId === riderUid);
      if (riderRow) {
        supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id).then(() => {});
      }
    }

    // ── Settlement: use SQL RPC first, fall back to JS wallet credits ────────
    if (newStatus === 'completed') {
      const { foodTotal, deliveryFee, gpAmount, merchantIncome, riderIncome: calcRiderIncome } = _settlementAmounts(order);
      const riderUid     = order.riderUserId || riders.find(r => r.id === order.riderId)?.userId;
      const shopOwnerUid = order.restaurantOwnerId || restaurants.find(r => r.id === order.restaurantId)?.ownerId;

      const gpFoodRate  = (appConfig.gpFood ?? 30) / 100;
      const gpDelivRate = (appConfig.gpDelivery ?? 15) / 100;

      const { data: rpcResult, error: rpcError } = await supabase
        .rpc('process_order_settlement', {
          p_order_id: orderId,
          p_gp_food_rate: gpFoodRate,
          p_gp_delivery_rate: gpDelivRate
        });

      if (rpcError || !rpcResult?.ok) {
        // Fallback: JS-side wallet credits (keeps working if RPC unavailable)
        if (order.paymentMethod === 'cash') {
          if (order.type === 'parcel') {
            // Parcel cash: rider collected full cash. No credit needed, only debit GP to admin.
            if (riderUid && gpAmount > 0)        creditWallet(riderUid,    -gpAmount, `หัก GP พัสดุ(สด) #${orderId.slice(-6)}`);
            if (ADMIN_EMAIL && gpAmount > 0)     creditWallet(ADMIN_EMAIL, gpAmount,  `GP พัสดุ(สด) #${orderId.slice(-6)}`);
          } else {
            // Food cash: rider collected (food + delivery) in cash. No credit needed for delivery fee, only debit food (minus GP) and GP to admin.
            if (riderUid && foodTotal > 0)          creditWallet(riderUid,     -foodTotal,      `หักค่าอาหาร(สด) ออเดอร์ #${orderId.slice(-6)}`);
            if (shopOwnerUid && merchantIncome > 0) creditWallet(shopOwnerUid, merchantIncome,  `รายได้ร้าน(สด) ออเดอร์ #${orderId.slice(-6)}`);
            if (ADMIN_EMAIL && gpAmount > 0)        creditWallet(ADMIN_EMAIL,  gpAmount,        `GP(สด) ออเดอร์ #${orderId.slice(-6)}`);
          }
        } else {
          // Wallet: customer already paid at placement; distribute to stakeholders
          if (shopOwnerUid && merchantIncome > 0) creditWallet(shopOwnerUid, merchantIncome,  `รายได้ร้านค้า ออเดอร์ #${orderId.slice(-6)}`);
          if (ADMIN_EMAIL && gpAmount > 0)        creditWallet(ADMIN_EMAIL,  gpAmount,        `GP ออเดอร์ #${orderId.slice(-6)}`);
          if (riderUid && calcRiderIncome > 0)    creditWallet(riderUid,     calcRiderIncome, `ค่าส่ง ออเดอร์ #${orderId.slice(-6)}`);
        }
      } else if (!rpcResult.skipped) {
        // RPC settled — DB already updated; sync React state only (no duplicate DB writes)
        const riderEarned    = r2(rpcResult.riderIncome    ?? calcRiderIncome);
        const merchantEarned = r2(rpcResult.merchantIncome ?? merchantIncome);
        const gpEarned       = r2(rpcResult.gpAmount       ?? gpAmount);
        if (order.paymentMethod === 'cash') {
          if (order.type === 'parcel') {
            if (riderUid && gpEarned > 0)            creditWalletLocal(riderUid,    -gpEarned,      `หัก GP พัสดุ(สด) #${orderId.slice(-6)}`);
            if (ADMIN_EMAIL && gpEarned > 0)         creditWalletLocal(ADMIN_EMAIL,  gpEarned,      `GP พัสดุ(สด) #${orderId.slice(-6)}`);
          } else {
            if (riderUid && foodTotal > 0)           creditWalletLocal(riderUid,     -foodTotal,      `หักค่าอาหาร(สด) ออเดอร์ #${orderId.slice(-6)}`);
            if (shopOwnerUid && merchantEarned > 0)  creditWalletLocal(shopOwnerUid, merchantEarned,  `รายได้ร้าน(สด) ออเดอร์ #${orderId.slice(-6)}`);
            if (ADMIN_EMAIL && gpEarned > 0)         creditWalletLocal(ADMIN_EMAIL,  gpEarned,        `GP(สด) ออเดอร์ #${orderId.slice(-6)}`);
          }
        } else {
          if (shopOwnerUid && merchantEarned > 0)  creditWalletLocal(shopOwnerUid, merchantEarned,  `รายได้ร้านค้า ออเดอร์ #${orderId.slice(-6)}`);
          if (ADMIN_EMAIL && gpEarned > 0)         creditWalletLocal(ADMIN_EMAIL,  gpEarned,        `GP ออเดอร์ #${orderId.slice(-6)}`);
          if (riderUid && riderEarned > 0)         creditWalletLocal(riderUid,     riderEarned,     `ค่าส่ง ออเดอร์ #${orderId.slice(-6)}`);
        }
      }

      // Mark rider as available again
      const riderRow = riders.find(r => r.userId === riderUid);
      if (riderRow) {
        supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id).then(() => {});
      }

      notifySystem('✅ ส่งของสำเร็จ!', `ออเดอร์ #${orderId.slice(-6)} เสร็จสมบูรณ์`, 'success');
    }

    // ── Mark rider available when job cancelled ──────────────────────────────
    if (newStatus === 'cancelled' && order.riderId) {
      const riderRow = riders.find(r => r.id === order.riderId);
      if (riderRow) {
        supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id).then(() => {});
      }
    }
  };

  const initiateCancelOrder = (orderId) => {
    setSelectedOrderToCancel(orderId);
    setShowCancelModal(true);
  };

  const confirmCancelOrder = async () => {
    const orderId = selectedOrderToCancel;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const cancelled = { ...order, status: 'cancelled', cancelReason: cancelReasonInput || 'ลูกค้ายกเลิก' };
    await _updateOrder(orderId, { status: 'cancelled', cancelReason: cancelReasonInput || 'ลูกค้ายกเลิก' });
    setShowCancelModal(false);
    setSelectedOrderToCancel(null);
    setCancelReasonInput('');
    if (order.paymentMethod === 'wallet' && order.grandTotal > 0) {
      const refundUid = order.customerId || currentUser?.id || userProfile?.id;
      creditWallet(refundUid, order.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ #${orderId.slice(-6)}`);
    }
    // Release rider
    if (order.riderId) {
      const riderRow = riders.find(r => r.id === order.riderId);
      if (riderRow) supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id).then(() => {});
    }
    notifySystem('ยกเลิกออเดอร์แล้ว', `ออเดอร์ #${orderId.slice(-6)} ถูกยกเลิก`, 'info');
  };

  const requestCancelOrder = (orderId, reason) => {
    const uid = currentUser?.id || userProfile?.id || '';
    const order = orders.find(o => o.id === orderId);
    const newReq = {
      id: generateId(), type: 'cancel_order',
      data: {
        orderId, reason,
        requestedBy: 'customer',
        customerId: uid,
        paymentMethod: order?.paymentMethod,
        grandTotal: order?.grandTotal || 0,
      },
      userId: uid, user: userProfile.name || 'ลูกค้า',
      timestamp: formatDateTime(),
    };
    setPendingRequests(prev => [newReq, ...prev]);
    supabase.from('pending_requests').insert({ id: newReq.id, data: newReq }).then(() => {});
    notifySystem('ส่งคำขอยกเลิกแล้ว', 'Admin จะพิจารณาคำขอของคุณ', 'info');
    notifyAdmin('⚠️ ขอยกเลิกออเดอร์', `ลูกค้า ${userProfile.name} ขอยกเลิก #${orderId.slice(-6)}: ${reason}`, 'warning');
  };

  const requestCancelByRole = (orderId, reason, role) => {
    const uid = currentUser?.id || userProfile?.id || '';
    const order = orders.find(o => o.id === orderId);
    const roleName = role === 'rider' ? 'ไรเดอร์' : 'ร้านค้า';
    const newReq = {
      id: generateId(), type: 'cancel_order',
      data: {
        orderId, reason,
        requestedBy: role,
        customerId: order?.customerId,
        paymentMethod: order?.paymentMethod,
        grandTotal: order?.grandTotal || 0,
      },
      userId: uid, user: userProfile.name || roleName,
      timestamp: formatDateTime(),
    };
    setPendingRequests(prev => [newReq, ...prev]);
    supabase.from('pending_requests').insert({ id: newReq.id, data: newReq }).then(() => {});
    notifySystem('ส่งคำขอยกเลิกแล้ว', 'Admin จะพิจารณาคำขอของคุณ', 'info');
    notifyAdmin(`⚠️ ${roleName}ขอยกเลิก`, `${userProfile.name} ขอยกเลิก #${orderId.slice(-6)}: ${reason}`, 'warning');
  };

  // Direct cancel — for customer on still-pending orders (no admin needed)
  const cancelOrderDirectly = async (orderId, reason = 'ลูกค้ายกเลิก') => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    await _updateOrder(orderId, { status: 'cancelled', cancelReason: reason });
    if (order.paymentMethod === 'wallet' && order.grandTotal > 0) {
      const uid = currentUser?.id || userProfile?.id;
      creditWallet(uid, order.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ #${orderId.slice(-6)}`);
    }
    if (order.riderId) {
      const riderRow = riders.find(r => r.id === order.riderId);
      if (riderRow) supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id).then(() => {});
    }
    notifySystem('ยกเลิกออเดอร์แล้ว', `ออเดอร์ #${orderId.slice(-6)} ถูกยกเลิกแล้ว`, 'info');
  };

  return {
    calculateDeliveryFee, calculateFoodTotal, isPending, hasPendingCancelRequest,
    addToCart, placeOrder, placeParcelOrder, acceptOrder, updateOrderStatus,
    initiateCancelOrder, confirmCancelOrder, cancelOrderDirectly,
    requestCancelOrder, requestCancelByRole,
  };
}
