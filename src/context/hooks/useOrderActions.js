import { generateId, formatDateTime, r2, safeLocalSet } from '../../utils';
import { ADMIN_EMAIL, USER_LOCATION } from '../../constants';

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
    creditWallet, processTransaction, setUserWallet,
    notifySystem, notifyAdmin,
    supabase,
  } = deps;

  const calculateDeliveryFee = (distance) => appConfig.baseFee + (Math.ceil(distance) * appConfig.perKmFee);
  const calculateFoodTotal   = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const isPending = (type) => pendingRequests.some(r => r.type === type && r.userId === userProfile.id);
  const hasPendingCancelRequest = (orderId) =>
    pendingRequests.some(r => r.type === 'cancel_order' && r.data?.orderId === orderId);

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
      status: 'pending',
      customerId: uid,
      customerName: userProfile.name || 'ลูกค้า',
      pickup: parcelDetails.pickup,
      dropoff: parcelDetails.dropoff,
      pickupLocation: parcelDetails.pickupLocation || USER_LOCATION,
      location: parcelDetails.dropoffLocation || USER_LOCATION,
      weight: parcelDetails.weight,
      receiverName: parcelDetails.receiverName,
      receiverPhone: parcelDetails.receiverPhone,
      deliveryFee: grandTotal,
      grandTotal,
      paymentMethod,
      createdAt: formatDateTime(),
    };
    setOrders(prev => [newOrder, ...prev]);
    await supabase.from('orders').insert({ id: orderId, status: 'pending', data: newOrder });

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
    await _updateOrder(orderId, {
      riderId: rider.id,
      riderName: rider.name,
      riderPhone: rider.phone,
      status: 'rider_accepted',
      riderAcceptedAt: formatDateTime(),
    });
    notifySystem('รับงานแล้ว!', `ออเดอร์ #${orderId.slice(-6)} — ไปรับของที่ร้านได้เลย`, 'success');
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const patch = newStatus === 'completed'
      ? { status: newStatus, completedAt: new Date().toISOString() }
      : { status: newStatus };
    await _updateOrder(orderId, patch);

    if (newStatus === 'completed') {
      const uid     = currentUser?.id || userProfile?.id;
      const gpRate  = appConfig.gpPercent || 0.1;
      const gpAmount = r2(order.grandTotal * gpRate);
      const merchantIncomeCash = r2(order.foodTotal || 0);
      const riderUid = riders.find(r => r.id === order.riderId)?.userId;
      const shopOwnerUid = restaurants.find(r => r.id === order.restaurantId)?.ownerId;

      if (order.paymentMethod === 'cash') {
        if (riderUid && gpAmount > 0)              creditWallet(riderUid, -gpAmount,           `หัก GP(สด) ออเดอร์ #${orderId.slice(-6)}`);
        if (riderUid && merchantIncomeCash > 0)    creditWallet(riderUid, -merchantIncomeCash, `หัก ยอดร้าน(สด) ออเดอร์ #${orderId.slice(-6)}`);
        if (shopOwnerUid && merchantIncomeCash > 0) creditWallet(shopOwnerUid, merchantIncomeCash, `รายได้ร้าน(สด) ออเดอร์ #${orderId.slice(-6)}`);
        if (ADMIN_EMAIL && gpAmount > 0)            creditWallet(ADMIN_EMAIL, gpAmount,         `GP(สด) ออเดอร์ #${orderId.slice(-6)}`);
      } else {
        const merchantIncome = r2((order.foodTotal || 0) * (1 - gpRate));
        if (shopOwnerUid && merchantIncome > 0)   creditWallet(shopOwnerUid, merchantIncome, `รายได้ร้านค้า ออเดอร์ #${orderId.slice(-6)}`);
        if (ADMIN_EMAIL && gpAmount > 0)          creditWallet(ADMIN_EMAIL, gpAmount,        `GP ออเดอร์ #${orderId.slice(-6)}`);
        if (riderUid && order.deliveryFee > 0)    creditWallet(riderUid, order.deliveryFee,  `ค่าส่ง ออเดอร์ #${orderId.slice(-6)}`);
      }
      notifySystem('✅ ส่งของสำเร็จ!', `ออเดอร์ #${orderId.slice(-6)} เสร็จสมบูรณ์`, 'success');
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
      const uid = currentUser?.id || userProfile?.id;
      creditWallet(uid, order.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ #${orderId.slice(-6)}`);
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

  const forceRefresh = async () => {
    const { data } = await supabase.from('orders').select('id, data').order('created_at', { ascending: false }).limit(200);
    if (data?.length) setOrders(data.map(o => o.data));
    notifySystem('รีเฟรชแล้ว', 'โหลดออเดอร์ล่าสุดแล้ว', 'success');
  };

  return {
    calculateDeliveryFee, calculateFoodTotal, isPending, hasPendingCancelRequest,
    addToCart, placeOrder, placeParcelOrder, acceptOrder, updateOrderStatus,
    initiateCancelOrder, confirmCancelOrder, requestCancelOrder, requestCancelByRole,
    forceRefresh,
  };
}
