import {
  saveOrder, updateOrderStatusInDB, saveTransaction,
  creditWalletInDB, addWalletEntry, acceptOrderTransaction,
  loadAllOrders, loadPendingRequests, savePendingRequest, safeLocalSet,
  cancelOrderBatch, loadOrder,
} from '../../firebase/firestore';
import { generateId, formatDateTime } from '../../utils';
import { FIREBASE_ENABLED, ADMIN_UID, USER_LOCATION } from '../../constants';

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
    const effectivePromo = Math.min(promoDiscount || 0, totalRawGP);
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

    const adminGP        = totalRawGP - effectivePromo;
    const merchantIncome = foodTotal - rawFoodGP;
    const riderIncome    = deliveryFee - rawDeliveryGP;
    const newOrder = {
      id: `OD-${generateId()}`,
      type: 'food',
      items: cart,
      foodTotal,
      deliveryFee,
      promoDiscount: effectivePromo,
      grandTotal,
      paymentMethod,
      distance,
      adminGP,
      merchantIncome,
      riderIncome,
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
      riderId: null,
      riderUid: null,
      riderLocation: null,
    };
    const restaurantName = cart[0]?.restaurantName || '';
    pendingLocalOrderIdsRef.current.add(newOrder.id);
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
    setCart([]);
    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, `ชำระค่าอาหาร (${restaurantName})`);
      if (FIREBASE_ENABLED) {
        const uid = currentUser?.id || userProfile?.id;
        if (uid) creditWalletInDB(uid, -grandTotal, `ชำระค่าอาหาร (${restaurantName})`).catch(() => {});
      }
    }
    if (FIREBASE_ENABLED) {
      saveOrder(newOrder).catch(() => {});
      saveTransaction({
        type: 'order_placed',
        orderId: newOrder.id,
        userId: newOrder.customerId,
        userName: newOrder.customerName,
        role: 'customer',
        amount: newOrder.paymentMethod === 'wallet' ? -newOrder.grandTotal : 0,
        desc: `สั่งอาหาร ${newOrder.restaurantName} ฿${newOrder.grandTotal.toLocaleString()}`,
        date: formatDateTime(),
        paymentMethod: newOrder.paymentMethod,
      }).catch(() => {});
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
      pickup:         parcelDetails.pickup,
      dropoff:        parcelDetails.dropoff,
      location:       parcelDetails.dropoffLocation || userProfile.location,
      pickupLocation: parcelDetails.pickupLocation  || userProfile.location,
      distance,
      weight:         parcelDetails.weight,
      foodTotal:      0,
      deliveryFee,
      grandTotal,
      paymentMethod,
      adminGP,
      merchantIncome: 0,
      riderIncome,
      status:         'ready_to_pickup',
      customerName:   userProfile.name,
      customerPhone:  userProfile.phone,
      customerId:     userProfile.id || currentUser?.id,
      receiverName:   parcelDetails.receiverName  || '',
      receiverPhone:  parcelDetails.receiverPhone || '',
      timestamp:      formatDateTime(),
      riderId:        null,
      riderUid:       null,
      riderLocation:  null,
    };

    pendingLocalOrderIdsRef.current.add(newOrder.id);
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);

    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, 'ชำระค่าส่งพัสดุ');
      if (FIREBASE_ENABLED) {
        const uid = currentUser?.id || userProfile?.id;
        if (uid) creditWalletInDB(uid, -grandTotal, 'ชำระค่าส่งพัสดุ').catch(() => {});
      }
    }
    if (FIREBASE_ENABLED) {
      saveOrder(newOrder).catch(() => {});
      saveTransaction({
        type: 'order_placed',
        orderId: newOrder.id,
        userId: newOrder.customerId,
        userName: newOrder.customerName,
        role: 'customer',
        amount: newOrder.paymentMethod === 'wallet' ? -newOrder.grandTotal : 0,
        desc: `ส่งพัสดุ ฿${newOrder.grandTotal.toLocaleString()} (${newOrder.pickup || ''} → ${newOrder.dropoff || ''})`,
        date: formatDateTime(),
        paymentMethod: newOrder.paymentMethod,
      }).catch(() => {});
    }

    notifySystem('เรียกรถสำเร็จ', `ค่าส่ง ฿${grandTotal} — กำลังค้นหาไรเดอร์...`, 'success');

    setParcelDetails({ pickup: '', dropoff: '', weight: '1', distance: 0, pickupLocation: null, dropoffLocation: null, receiverName: '', receiverPhone: '' });
    setParcelMapTarget(null);
    setParcelEstimate(0);
    setParcelDistance(0);
    setPaymentMethod('wallet');
    setActiveTab('activity');
  };

  const acceptOrder = async (orderId, riderId, riderLocation) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'ready_to_pickup' || order.riderId) {
      notifySystem('เสียใจด้วย', 'งานนี้ถูกรับไปแล้ว 😔', 'error');
      return false;
    }

    const riderUid  = currentUser?.id || null;
    const riderInfo = riders.find(r => r.id === riderId);
    const riderPhone = riderInfo?.phone || '';
    const riderName  = riderInfo?.name  || '';

    if (FIREBASE_ENABLED) {
      try {
        await acceptOrderTransaction(orderId, riderId, riderLocation, riderUid);
        // Guard against the brief window where q2 drops the order before q1 picks it up.
        // Without this, the accepted order disappears from myJobs until q1 fires,
        // causing the rider to see an empty active-tab and potentially re-accepting.
        pendingLocalOrderIdsRef.current.add(orderId);
        setOrders(prev => prev.map(o => {
          if (o.id !== orderId) return o;
          return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
        }));
        updateOrderStatusInDB(orderId, { riderPhone, riderName }).catch(() => {});
        notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย — ไปรับงานได้เลย', 'success');
        return true;
      } catch (err) {
        console.error('[acceptOrder] err:', err?.code, err?.message);

        if (err.message === 'ORDER_ALREADY_TAKEN') {
          // The transaction may have committed but the ack was lost (bad network).
          // Do a fresh read: if THIS rider already owns the order, treat as success.
          try {
            const fresh = await loadOrder(orderId);
            if (fresh && fresh.status === 'rider_accepted' && fresh.riderId === riderId) {
              setOrders(prev => prev.map(o => {
                if (o.id !== orderId) return o;
                return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
              }));
              updateOrderStatusInDB(orderId, { riderPhone, riderName }).catch(() => {});
              notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย — ไปรับงานได้เลย', 'success');
              return true;
            }
          } catch (_) {}
          setOrders(prev => prev.filter(o => o.id !== orderId || o.status !== 'ready_to_pickup'));
          notifySystem('เสียใจด้วย', 'งานนี้ถูกไรเดอร์คนอื่นรับไปก่อน 😔', 'error');
        } else if (err.message === 'ORDER_NOT_FOUND') {
          setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o;
            return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
          }));
          notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย (offline mode)', 'success');
          return true;
        } else if (err.code === 'resource-exhausted') {
          // Quota exceeded — verify availability via a single getDoc before
          // falling back to non-transactional update (reduces double-accept risk).
          try {
            const fresh = await loadOrder(orderId);
            if (!fresh || fresh.status !== 'ready_to_pickup' || fresh.riderId) {
              notifySystem('เสียใจด้วย', 'งานนี้ถูกรับไปแล้ว 😔', 'error');
              return false;
            }
            await updateOrderStatusInDB(orderId, {
              status: 'rider_accepted', riderId, riderUid, riderPhone, riderName,
              riderLocation: riderLocation || order.pickupLocation || null,
            });
            setOrders(prev => prev.map(o => {
              if (o.id !== orderId) return o;
              return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
            }));
            notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย', 'success');
            return true;
          } catch {
            notifySystem('ระบบขัดข้องชั่วคราว', 'กรุณาลองใหม่ในอีกสักครู่', 'error');
            return false;
          }
        } else if (err.code === 'permission-denied') {
          notifySystem('ไม่มีสิทธิ์', 'กรุณา login ใหม่แล้วลองอีกครั้ง', 'error');
        } else if (err.code === 'unavailable' || err.code === 'deadline-exceeded') {
          notifySystem('ไม่มีสัญญาณ', 'กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'error');
        } else {
          notifySystem('เกิดข้อผิดพลาด', `กรุณาลองใหม่ (${err.code || 'unknown'})`, 'error');
        }
        return false;
      }
    } else {
      setOrders(prev => prev.map(o => {
        if (o.id !== orderId) return o;
        return { ...o, status: 'rider_accepted', riderId, riderPhone, riderName };
      }));
      notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย', 'success');
      return true;
    }
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

    if (FIREBASE_ENABLED) {
      const dbFields = { status: finalOrder.status };
      if (finalOrder.riderId  != null) dbFields.riderId  = finalOrder.riderId;
      if (finalOrder.riderUid != null) dbFields.riderUid = finalOrder.riderUid;
      if (finalOrder.completedAt)         dbFields.completedAt      = finalOrder.completedAt;
      if (finalOrder.cancelReason)        dbFields.cancelReason     = finalOrder.cancelReason;
      if (finalOrder.deliveryProofUrl)    dbFields.deliveryProofUrl = finalOrder.deliveryProofUrl;
      updateOrderStatusInDB(orderId, dbFields).catch(() => {});
    }

    if (prevStatus !== newStatus) {
      const sid = orderId.slice(-6);
      if (newStatus === 'preparing')       notifySystem('รับออเดอร์แล้ว ✅', `กำลังเตรียม #${sid}`, 'info');
      if (newStatus === 'ready_to_pickup') notifySystem('พร้อมส่งแล้ว ✅', `ส่งออเดอร์ #${sid} ให้ไรเดอร์แล้ว`, 'success');
      if (newStatus === 'rider_accepted')  notifySystem('รับงานแล้ว ✅', `กำลังออกเดินทาง #${sid}`, 'success');
      if (newStatus === 'picking_up')      notifySystem('ถึงร้านแล้ว 🛵', `กำลังรับสินค้า #${sid}`, 'info');
      if (newStatus === 'delivering')      notifySystem('รับสินค้าแล้ว 🛵', `กำลังนำส่ง #${sid}`, 'info');
      if (newStatus === 'delivered')       notifySystem('ส่งถึงแล้ว! 📦', `รอลูกค้ายืนยันรับสินค้า #${sid}`, 'success');
      if (newStatus === 'completed') {
        // Pre-mark before Firestore write so the subscription's justCompleted
        // filter skips it — prevents double toast on the actor's device.
        seenOrderIdsRef?.current?.add(`${orderId}_completed`);
        notifySystem('ยืนยันรับแล้ว ✅', `ออเดอร์ #${sid} เสร็จสิ้น 🎉`, 'success');
      }
      if (newStatus === 'cancelled') {
        // Pre-mark so subscription's justCancelled skips it on the actor's device.
        // When a DIFFERENT party (merchant/admin) cancels, seenOrderIdsRef won't
        // have this key → customer's device still shows the notification.
        seenOrderIdsRef?.current?.add(`${orderId}_cancelled`);
        notifySystem('ยกเลิกแล้ว', `#${sid} ถูกยกเลิก`, 'error');
      }
    }

    // ── Cash settlement: handled by Cloud Function processCashSettlement ──
    // Firestore wallet writes are done server-side when status → 'delivered'.
    // Client wallet subscriptions (subscribeToWallet) will sync the result.

    // ── Income distribution: Cloud Function processOrderPayment handles ──
    // All Firestore wallet writes are done server-side.
    // Local processTransaction() below gives instant UI feedback for the
    // currently logged-in user only; their subscription will re-sync afterward.
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

        if (FIREBASE_ENABLED) {
          // Cloud Function processOrderPayment handles all Firestore wallet writes.
          // Only update local state here to give instant UI feedback; the subscription
          // will re-sync the canonical value shortly after.
          let localDelta = 0;
          if (riderUid     && riderUid     === myUidNow && riderIncome    > 0) localDelta += riderIncome;
          if (shopOwnerUid && shopOwnerUid === myUidNow && merchantIncome > 0) localDelta += merchantIncome;
          if (ADMIN_UID    && ADMIN_UID    === myUidNow && gpAmount       > 0) localDelta += gpAmount;
          if (localDelta > 0) setUserWallet(prev => prev + localDelta);
        } else {
          // Firebase disabled — no Cloud Functions, so write everything client-side.
          if (riderUid     && riderIncome    > 0) {
            const gpNote = deliveryFeeGP > 0 ? ` (หัก GP ฿${deliveryFeeGP})` : '';
            processTransaction('income', riderIncome, `ค่าส่ง ${restName} #${shortId}${gpNote}`);
          }
          if (shopOwnerUid && merchantIncome > 0) {
            const gpNote = foodGP > 0 ? ` (หัก GP ฿${foodGP})` : '';
            processTransaction('income', merchantIncome, `รายได้ร้าน ${restName} #${shortId}${gpNote}`);
          }
          if (ADMIN_UID && gpAmount > 0) {
            processTransaction('income', gpAmount, `GP ${restName} #${shortId}`);
          }
          if (riderUid     && riderIncome    > 0) creditWallet(riderUid,     riderIncome,    `ค่าส่ง ${restName} #${shortId}`);
          if (shopOwnerUid && merchantIncome > 0) creditWallet(shopOwnerUid, merchantIncome, `รายได้ร้าน #${shortId}`);
          if (ADMIN_UID    && gpAmount       > 0) creditWallet(ADMIN_UID,    gpAmount,        `GP #${shortId}`);
        }
      } else {
        // Cash order: rider collected grandTotal from customer in cash
        // Credit merchant and platform GP from system accounting; rider retains delivery cut as cash (no wallet credit for rider)
        if (!targetOrder.cashSettled) {
          const shortId_       = targetOrder.id.slice(-6);
          const merchantIncome = typeof targetOrder.merchantIncome === 'number' ? targetOrder.merchantIncome : 0;
          const gpAmount       = typeof targetOrder.adminGP        === 'number' ? targetOrder.adminGP        : 0;
          const restName       = targetOrder.restaurantName || (targetOrder.type === 'parcel' ? 'พัสดุ' : '');
          const myUidNow       = userProfile.id || currentUser?.id;

          // Mark settled before writes to prevent duplicate calls
          setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, cashSettled: true } : o));

          if (FIREBASE_ENABLED) {
            updateOrderStatusInDB(orderId, { cashSettled: true }).catch(() => {});
            if (shopOwnerUid && merchantIncome > 0)
              creditWalletInDB(shopOwnerUid, merchantIncome, `รายได้ร้าน(สด) ${restName} #${shortId_}`).catch(() => {});
            if (ADMIN_UID && gpAmount > 0)
              creditWalletInDB(ADMIN_UID, gpAmount, `GP(สด) ${restName} #${shortId_}`).catch(() => {});
            // Update local wallet UI for whoever is currently logged in
            let localCashDelta = 0;
            if (shopOwnerUid && shopOwnerUid === myUidNow && merchantIncome > 0) localCashDelta += merchantIncome;
            if (ADMIN_UID    && ADMIN_UID    === myUidNow && gpAmount       > 0) localCashDelta += gpAmount;
            if (localCashDelta > 0) setUserWallet(prev => prev + localCashDelta);
          } else {
            if (shopOwnerUid && merchantIncome > 0)
              creditWallet(shopOwnerUid, merchantIncome, `รายได้ร้าน(สด) ${restName} #${shortId_}`);
            if (ADMIN_UID    && gpAmount       > 0)
              creditWallet(ADMIN_UID, gpAmount, `GP(สด) ${restName} #${shortId_}`);
          }
        }
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

    const order = orders.find(o => o.id === orderId);
    if (!order || ['cancelled', 'delivered', 'completed'].includes(order.status)) {
      setShowCancelModal(false);
      setSelectedOrderToCancel(null);
      return;
    }

    // Optimistic local update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled', cancelReason: reason } : o));

    const isWalletOrder = order.paymentMethod === 'wallet' && order.grandTotal > 0;

    if (isWalletOrder) {
      const desc = `คืนเงิน: ยกเลิกออเดอร์ #${order.id.slice(-6)} (${reason})`;
      // Instant local wallet feedback
      creditWallet(order.customerId, order.grandTotal, desc);

      if (FIREBASE_ENABLED) {
        // Atomic batch: order cancel + wallet credit + entry + tx log — all or nothing
        cancelOrderBatch(orderId, {
          cancelReason: reason,
          customerId:   order.customerId,
          refundAmount: order.grandTotal,
          refundDesc:   desc,
        }).catch(() => {
          // Batch failed — fall back to individual writes
          updateOrderStatusInDB(orderId, { status: 'cancelled', cancelReason: reason }).catch(() => {});
          creditWalletInDB(order.customerId, order.grandTotal, desc).catch(() => {});
          addWalletEntry(order.customerId, { type: 'refund', amount: order.grandTotal, desc, date: formatDateTime() }).catch(() => {});
          saveTransaction({ type: 'wallet_refund', orderId, userId: order.customerId, userName: order.customerName, role: 'customer', amount: order.grandTotal, desc, date: formatDateTime() }).catch(() => {});
        });
      }
    } else if (FIREBASE_ENABLED) {
      updateOrderStatusInDB(orderId, { status: 'cancelled', cancelReason: reason }).catch(() => {});
      saveTransaction({ type: 'order_cancelled', orderId, userId: order.customerId, userName: order.customerName, role: 'customer', amount: 0, desc: `ยกเลิกออเดอร์ #${order.id.slice(-6)}: ${reason}`, date: formatDateTime() }).catch(() => {});
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
      id: generateId(),
      type: 'cancel_order',
      userId: uid,
      user: userProfile.name || 'ลูกค้า',
      timestamp: formatDateTime(),
      data: {
        orderId:        order.id,
        orderType:      order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal:     order.grandTotal || 0,
        paymentMethod:  order.paymentMethod,
        prevStatus:     order.status,
        reason:         reason?.trim() || 'ไม่ระบุเหตุผล',
      },
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
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
      id: generateId(),
      type: 'cancel_order',
      userId: userProfile.id || currentUser?.uid || '',
      user: `${roleName}: ${userProfile.name || ''}`,
      timestamp: formatDateTime(),
      data: {
        orderId:        order.id,
        orderType:      order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal:     order.grandTotal || 0,
        paymentMethod:  order.paymentMethod,
        prevStatus:     order.status,
        reason:         reason?.trim() || 'ไม่ระบุเหตุผล',
        requestedBy:    role,
      },
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('ส่งคำขอแล้ว ✅', 'ส่งคำขอยกเลิกถึง Admin เรียบร้อย รอการอนุมัติ', 'info');
  };

  const forceRefresh = async () => {
    if (!FIREBASE_ENABLED) {
      notifySystem('รีเฟรช', 'โหลดข้อมูลแล้ว (offline mode)', 'info');
      return;
    }
    try {
      const [freshOrders, freshPending] = await Promise.all([
        loadAllOrders(),
        loadPendingRequests(),
      ]);

      if (freshOrders && freshOrders.length > 0) {
        const STATUS_RANK = {
          pending: 1, preparing: 2, ready_to_pickup: 3,
          rider_accepted: 4, picking_up: 5, delivering: 6,
          delivered: 7, completed: 8, cancelled: 9,
        };
        setOrders(prev => {
          const localMap = new Map(prev.map(o => [o.id, o]));
          const merged = freshOrders.map(co => {
            const lo = localMap.get(co.id);
            if (!lo) return co;
            const cloudRank = STATUS_RANK[co.status] ?? 0;
            const localRank = STATUS_RANK[lo.status] ?? 0;
            return localRank > cloudRank ? lo : co;
          });
          prev.forEach(lo => {
            if (!merged.find(co => co.id === lo.id)) {
              if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
            }
          });
          const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
          deduped.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          safeLocalSet('boomrider_orders', deduped);
          return deduped;
        });
      }

      if (freshPending) {
        setPendingRequests(freshPending);
        safeLocalSet('boomrider_pending_requests', freshPending);
      }

      notifySystem('รีเฟรชแล้ว ✅', 'โหลดข้อมูลล่าสุดเรียบร้อย', 'success');
    } catch (_) {
      notifySystem('รีเฟรช', 'ไม่สามารถโหลดข้อมูลได้ตอนนี้', 'error');
    }
  };

  return {
    calculateDeliveryFee, calculateFoodTotal, isPending, hasPendingCancelRequest,
    addToCart, placeOrder, placeParcelOrder, acceptOrder, updateOrderStatus,
    initiateCancelOrder, confirmCancelOrder, requestCancelOrder, requestCancelByRole,
    forceRefresh,
  };
}
