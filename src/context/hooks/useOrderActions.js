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
  } = deps;

  const calculateDeliveryFee = (distance) => appConfig.baseFee + (Math.ceil(distance) * appConfig.perKmFee);
  const calculateFoodTotal = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
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

  const placeOrder = (promoDiscount = 0, notes = '') => {
    if (placingOrderRef.current || cart.length === 0) return;
    placingOrderRef.current = true;
    setTimeout(() => { placingOrderRef.current = false; }, 3000);

    const distance = cart[0].distance;
    const foodTotal = calculateFoodTotal();
    const deliveryFee = calculateDeliveryFee(distance);
    const rawFoodGP     = foodTotal * (appConfig.gpFood / 100);
    const rawDeliveryGP = deliveryFee * (appConfig.gpDelivery / 100);
    const totalRawGP    = rawFoodGP + rawDeliveryGP;
    const effectivePromo = Math.min(promoDiscount || 0, foodTotal + deliveryFee);
    const grandTotal     = Math.max(0, foodTotal + deliveryFee - effectivePromo);
    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      placingOrderRef.current = false;
      return notifySystem('ยอดเงินไม่พอ', 'กรุณาเติมเงินหรือเลือกชำระเงินสด', 'error');
    }
    const restaurantData = restaurants.find(r => r.id === cart[0].restaurantId);
    const merchantUid    = restaurantData?.ownerId || null;
    if (!merchantUid) {
      placingOrderRef.current = false;
      return notifySystem('ร้านยังไม่พร้อม', 'ร้านนี้ยังไม่มีเจ้าของในระบบ กรุณาติดต่อ Admin', 'error');
    }

    const adminGP        = Math.max(0, totalRawGP - effectivePromo);
    const merchantIncome = foodTotal - rawFoodGP;
    const riderIncome    = deliveryFee - rawDeliveryGP;
    const newOrder = {
      id: `OD-${generateId()}`,
      type: 'food',
      items: cart,
      foodTotal, deliveryFee,
      promoDiscount: effectivePromo, grandTotal,
      paymentMethod, distance,
      adminGP, merchantIncome, riderIncome,
      restaurantId: cart[0].restaurantId,
      restaurantName: cart[0].restaurantName,
      restaurantPhone: restaurantData?.phone || '',
      merchantUid,
      notes: notes ? notes.trim().substring(0, 200) : '',
      status: 'pending',
      customerName: userProfile.name,
      customerPhone: userProfile.phone,
      customerId: userProfile.id,
      address: userAddresses[0]?.address,
      location: userProfile.location || userAddresses[0]?.location || USER_LOCATION,
      pickupLocation: restaurants.find(r => r.id === cart[0].restaurantId)?.location || USER_LOCATION,
      timestamp: formatDateTime(),
      riderId: null, riderUid: null, riderLocation: null,
    };
    pendingLocalOrderIdsRef.current.add(newOrder.id);
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
    setCart([]);
    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, `ชำระค่าอาหาร (${cart[0].restaurantName})`);
    }
    setPaymentMethod('wallet');
    notifySystem('สั่งซื้อสำเร็จ', 'ออเดอร์ถูกส่งไปยังร้านค้าแล้ว', 'success');
    setActiveTab('activity');
    setSelectedRestaurant(null);
  };

  const placeParcelOrder = () => {
    if (placingOrderRef.current) return;
    if (!parcelDetails.pickup || !parcelDetails.dropoff) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณาระบุจุดรับและจุดส่ง', 'error');
    }
    placingOrderRef.current = true;
    setTimeout(() => { placingOrderRef.current = false; }, 3000);

    const hasLocations = !!(parcelDetails.pickupLocation && parcelDetails.dropoffLocation);
    const distance    = hasLocations ? parcelDistance  : 0;
    const deliveryFee = hasLocations ? Math.max(parcelEstimate, appConfig.baseFee) : appConfig.baseFee;
    const grandTotal  = deliveryFee;

    if (hasLocations && distance > appConfig.appRadius) {
      placingOrderRef.current = false;
      return notifySystem('นอกพื้นที่', `ระยะทาง (${distance} กม.) เกินขอบเขตให้บริการ`, 'error');
    }
    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      placingOrderRef.current = false;
      return notifySystem('ยอดเงินไม่พอ', 'กรุณาเติมเงินหรือเลือกชำระเงินสด', 'error');
    }

    const adminGP    = deliveryFee * (appConfig.gpDelivery / 100);
    const riderIncome = deliveryFee * (1 - (appConfig.gpDelivery / 100));

    const newOrder = {
      id: `EX-${generateId()}`,
      type: 'parcel',
      pickup: parcelDetails.pickup, dropoff: parcelDetails.dropoff,
      location: parcelDetails.dropoffLocation || userProfile.location,
      pickupLocation: parcelDetails.pickupLocation || userProfile.location,
      distance, weight: parcelDetails.weight,
      foodTotal: 0, deliveryFee, grandTotal,
      paymentMethod, adminGP, merchantIncome: 0, riderIncome,
      status: 'ready_to_pickup',
      customerName: userProfile.name, customerPhone: userProfile.phone,
      customerId: userProfile.id || currentUser?.id,
      receiverName: parcelDetails.receiverName || '', receiverPhone: parcelDetails.receiverPhone || '',
      timestamp: formatDateTime(),
      riderId: null, riderUid: null, riderLocation: null,
    };

    pendingLocalOrderIdsRef.current.add(newOrder.id);
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);

    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, 'ชำระค่าส่งพัสดุ');
    }

    notifySystem('เรียกรถสำเร็จ', `ค่าส่ง ฿${grandTotal} — กำลังค้นหาไรเดอร์...`, 'success');
    setParcelDetails({ pickup: '', dropoff: '', weight: '1', distance: 0, pickupLocation: null, dropoffLocation: null, receiverName: '', receiverPhone: '' });
    setParcelMapTarget(null);
    setParcelEstimate(0);
    setParcelDistance(0);
    setPaymentMethod('wallet');
    setActiveTab('activity');
  };

  const acceptOrder = (orderId, riderId, riderLocation) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'ready_to_pickup' || order.riderId) {
      notifySystem('เสียใจด้วย', 'งานนี้ถูกรับไปแล้ว 😔', 'error');
      return false;
    }
    const riderUid   = currentUser?.id || null;
    const riderInfo  = riders.find(r => r.id === riderId);
    const riderPhone = riderInfo?.phone || '';
    const riderName  = riderInfo?.name  || '';
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
    }));
    notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย', 'success');
    return true;
  };

  const updateOrderStatus = (orderId, newStatus, actorId = null, extraData = {}) => {
    const targetOrder = orders.find(o => o.id === orderId);
    const prevStatus  = targetOrder?.status;
    if (!targetOrder) return;

    let finalOrder = { ...targetOrder, status: newStatus, ...extraData };
    if (newStatus === 'rider_accepted' && actorId) {
      finalOrder.riderId       = actorId;
      finalOrder.riderLocation = targetOrder.pickupLocation || null;
    }
    if (newStatus === 'completed' && !finalOrder.completedAt) {
      finalOrder = { ...finalOrder, completedAt: new Date().toISOString() };
    }
    if (finalOrder.riderId && !finalOrder.riderUid) {
      finalOrder = { ...finalOrder, riderUid: currentUser?.id || null };
    }

    setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? finalOrder : o));

    if (prevStatus !== newStatus) {
      const sid = orderId.slice(-6);
      if (newStatus === 'preparing')       notifySystem('รับออเดอร์แล้ว ✅', `กำลังเตรียม #${sid}`, 'info');
      if (newStatus === 'ready_to_pickup') notifySystem('พร้อมส่งแล้ว ✅', `ส่งออเดอร์ #${sid} ให้ไรเดอร์แล้ว`, 'success');
      if (newStatus === 'rider_accepted')  notifySystem('รับงานแล้ว ✅', `กำลังออกเดินทาง #${sid}`, 'success');
      if (newStatus === 'picking_up')      notifySystem('ถึงร้านแล้ว 🛵', `กำลังรับสินค้า #${sid}`, 'info');
      if (newStatus === 'delivering')      notifySystem('รับสินค้าแล้ว 🛵', `กำลังนำส่ง #${sid}`, 'info');
      if (newStatus === 'delivered')       notifySystem('ส่งถึงแล้ว! 📦', `รอลูกค้ายืนยันรับสินค้า #${sid}`, 'success');
      if (newStatus === 'completed') {
        seenOrderIdsRef?.current?.add(`${orderId}_completed`);
        notifySystem('ยืนยันรับแล้ว ✅', `ออเดอร์ #${sid} เสร็จสิ้น 🎉`, 'success');
      }
      if (newStatus === 'cancelled') {
        seenOrderIdsRef?.current?.add(`${orderId}_cancelled`);
        notifySystem('ยกเลิกแล้ว', `#${sid} ถูกยกเลิก`, 'error');
      }
    }

    if (newStatus === 'completed' && targetOrder && prevStatus !== 'completed') {
      const restaurant   = targetOrder.type === 'food' ? restaurants.find(r => r.id === targetOrder.restaurantId) : null;
      const riderProfile = riders.find(r => r.id === targetOrder.riderId);
      const riderUid     = targetOrder.riderUid || riderProfile?.userId || null;
      const shopOwnerUid = restaurant?.ownerId || null;
      const isCashOrder  = targetOrder.paymentMethod === 'cash';

      if (!isCashOrder) {
        const shortId        = targetOrder.id.slice(-6);
        const riderIncome    = typeof targetOrder.riderIncome    === 'number' ? targetOrder.riderIncome    : 0;
        const merchantIncome = typeof targetOrder.merchantIncome === 'number' ? targetOrder.merchantIncome : 0;
        const gpAmount       = typeof targetOrder.adminGP        === 'number' ? targetOrder.adminGP        : 0;
        const myUidNow       = userProfile.id || currentUser?.id;
        const restName       = targetOrder.restaurantName || (targetOrder.type === 'parcel' ? 'พัสดุ' : '');
        const deliveryFeeGP  = targetOrder.deliveryFee > 0 ? Math.round(targetOrder.deliveryFee - riderIncome)    : 0;
        const foodGP         = targetOrder.foodTotal   > 0 ? Math.round(targetOrder.foodTotal   - merchantIncome) : 0;

        if (riderUid && riderIncome > 0) {
          const gpNote = deliveryFeeGP > 0 ? ` (หัก GP ฿${deliveryFeeGP})` : '';
          creditWallet(riderUid, riderIncome, `ค่าส่ง ${restName} #${shortId}${gpNote}`);
        }
        if (shopOwnerUid && merchantIncome > 0) {
          const gpNote = foodGP > 0 ? ` (หัก GP ฿${foodGP})` : '';
          creditWallet(shopOwnerUid, merchantIncome, `รายได้ร้าน ${restName} #${shortId}${gpNote}`);
        }
        if (ADMIN_EMAIL && gpAmount > 0) {
          creditWallet(ADMIN_EMAIL, gpAmount, `GP ${restName} #${shortId}`);
        }
      } else if (!targetOrder.cashSettled) {
        const shortId_       = targetOrder.id.slice(-6);
        const gpAmount       = typeof targetOrder.adminGP        === 'number' ? targetOrder.adminGP        : 0;
        const riderIncomeCash    = typeof targetOrder.riderIncome    === 'number' ? targetOrder.riderIncome    : 0;
        const merchantIncomeCash = typeof targetOrder.merchantIncome === 'number' ? targetOrder.merchantIncome : 0;
        const restName       = targetOrder.restaurantName || (targetOrder.type === 'parcel' ? 'พัสดุ' : '');
        setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, cashSettled: true } : o));
        // ไรเดอร์รับเงินสดทั้งหมด — หักส่วนที่ต้องโอนให้คนอื่น
        if (riderUid && gpAmount > 0)             creditWallet(riderUid, -gpAmount,             `หัก GP(สด) ${restName} #${shortId_}`);
        if (riderUid && merchantIncomeCash > 0)   creditWallet(riderUid, -merchantIncomeCash,   `หัก ยอดร้าน(สด) ${restName} #${shortId_}`);
        // โอนให้ผู้รับที่ถูกต้อง
        if (shopOwnerUid && merchantIncomeCash > 0) creditWallet(shopOwnerUid, merchantIncomeCash, `รายได้ร้าน(สด) ${restName} #${shortId_}`);
        if (ADMIN_EMAIL && gpAmount > 0)             creditWallet(ADMIN_EMAIL,  gpAmount,            `GP(สด) ${restName} #${shortId_}`);
      }
    }
  };

  const initiateCancelOrder = (orderId) => {
    setSelectedOrderToCancel(orderId);
    setCancelReasonInput('');
    setShowCancelModal(true);
  };

  const confirmCancelOrder = () => {
    if (!selectedOrderToCancel) return;
    const orderId = selectedOrderToCancel;
    const reason  = cancelReasonInput.trim() || 'ร้านค้ายกเลิกออเดอร์';
    const order   = orders.find(o => o.id === orderId);
    if (!order || ['cancelled', 'delivered', 'completed'].includes(order.status)) {
      setShowCancelModal(false);
      setSelectedOrderToCancel(null);
      return;
    }
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled', cancelReason: reason } : o));
    const isWalletOrder = order.paymentMethod === 'wallet' && order.grandTotal > 0;
    if (isWalletOrder) {
      creditWallet(order.customerId, order.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ #${order.id.slice(-6)} (${reason})`);
    }
    setShowCancelModal(false);
    setSelectedOrderToCancel(null);
    notifySystem('ยกเลิกออเดอร์แล้ว', `#${orderId.slice(-6)} — ${isWalletOrder ? `คืนเงิน ฿${order.grandTotal} ให้ลูกค้าแล้ว` : 'ไม่มีการตัดเงิน'}`, 'info');
  };

  const requestCancelOrder = (orderId, reason) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (hasPendingCancelRequest(orderId)) {
      return notifySystem('รออนุมัติ', 'คำขอยกเลิกของออเดอร์นี้กำลังรอ Admin อนุมัติอยู่แล้ว', 'info');
    }
    const uid = userProfile.id || currentUser?.id || '';
    const newReq = {
      id: generateId(), type: 'cancel_order',
      userId: uid, user: userProfile.name || 'ลูกค้า',
      timestamp: formatDateTime(),
      data: {
        orderId: order.id, orderType: order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal: order.grandTotal || 0, paymentMethod: order.paymentMethod,
        prevStatus: order.status, reason: reason?.trim() || 'ไม่ระบุเหตุผล',
      },
    };
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('ส่งคำขอแล้ว ✅', 'คำขอยกเลิกส่งถึง Admin เรียบร้อย รอการอนุมัติ', 'info');
  };

  const requestCancelByRole = (orderId, reason, role) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (hasPendingCancelRequest(orderId)) {
      return notifySystem('รออนุมัติ', 'คำขอยกเลิกกำลังรอ Admin อนุมัติอยู่แล้ว', 'info');
    }
    const roleName = role === 'merchant' ? 'ร้านค้า' : role === 'rider' ? 'ไรเดอร์' : 'ผู้ใช้';
    const newReq = {
      id: generateId(), type: 'cancel_order',
      userId: userProfile.id || currentUser?.id || '',
      user: `${roleName}: ${userProfile.name || ''}`,
      timestamp: formatDateTime(),
      data: {
        orderId: order.id, orderType: order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal: order.grandTotal || 0, paymentMethod: order.paymentMethod,
        prevStatus: order.status, reason: reason?.trim() || 'ไม่ระบุเหตุผล',
        requestedBy: role, customerId: order.customerId || '', customerName: order.customerName || 'ลูกค้า',
      },
    };
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('ส่งคำขอแล้ว ✅', 'ส่งคำขอยกเลิกถึง Admin เรียบร้อย รอการอนุมัติ', 'info');
  };

  const forceRefresh = () => {
    notifySystem('รีเฟรช', 'โหลดข้อมูลจาก localStorage แล้ว', 'info');
  };

  return {
    calculateDeliveryFee, calculateFoodTotal, isPending, hasPendingCancelRequest,
    addToCart, placeOrder, placeParcelOrder, acceptOrder, updateOrderStatus,
    initiateCancelOrder, confirmCancelOrder, requestCancelOrder, requestCancelByRole,
    forceRefresh,
  };
}
