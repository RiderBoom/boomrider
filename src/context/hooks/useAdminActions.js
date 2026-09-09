import { USER_LOCATION } from '../../constants.js';

export function useAdminActions(deps) {
  const {
    orders, setOrders,
    riders, setRiders,
    restaurants, setRestaurants,
    setMenuItems,
    pendingRequests, setPendingRequests,
    editingShop, shopEditForm, setEditingShop,
    selectedRequestToReject, setSelectedRequestToReject,
    setShowRejectModal,
    creditWalletLocal, grantRole,
    notifySystem,
    supabase,
  } = deps;

  const handleApproveRequest = async (req) => {
    if (req.type === 'topup' || req.type === 'withdraw') {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('approve_pending_request', { p_request_id: req.id });
      if (rpcErr || (rpcRes && !rpcRes.ok)) {
        const msg = rpcRes?.reason === 'INSUFFICIENT_WALLET_BALANCE'
          ? `${req.user} มียอดเงินไม่พอ (มี ฿${rpcRes.currentBalance}, ต้องการ ฿${rpcRes.requestedAmount})`
          : (rpcErr?.message || rpcRes?.reason || 'ไม่สามารถอนุมัติรายการได้');
        return notifySystem('ผิดพลาด', msg, 'error');
      }

      const amt = Number(req.data?.amount || 0);
      const adjustAmt = req.type === 'topup' ? amt : -amt;
      const desc = req.type === 'topup'
        ? `เติมเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`
        : `ถอนเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;

      if (creditWalletLocal) {
        creditWalletLocal(req.userId, adjustAmt, desc);
      }
      setPendingRequests(prev => prev.filter(r => r.id !== req.id));
      const actionLabel = req.type === 'topup' ? 'เติมเงิน' : 'ถอนเงิน';
      notifySystem('Admin ✅', `อนุมัติ${actionLabel} ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'merchant_reg') {
      // Grant merchant role first
      const roleOk = await grantRole(req.userId, 'merchant');
      if (!roleOk) {
        return; // grantRole handles notification and error rollback
      }

      // Guard: don't create a duplicate restaurant if one already exists for this user
      const existingShop = restaurants.find(r => r.ownerId === req.userId);
      if (existingShop) {
        notifySystem('Admin', 'อนุมัติร้านค้าเรียบร้อย (พบร้านในระบบแล้ว)', 'success');
      } else {
        const newId = `rest_${Date.now()}`;
        const shopImageUrl = req.data.shopImage?.startsWith('http') ? req.data.shopImage : null;
        const newRest = {
          id: newId,
          ownerId: req.userId,
          name: req.data.shopName,
          phone: req.data.phone,
          rating: 5.0,
          time: '20-30 min',
          image: shopImageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=500&q=60',
          category: req.data.category,
          status: 'open',
          location: req.data.location || USER_LOCATION,
        };

        const [{ error: restErr }, { error: menuErr }] = await Promise.all([
          supabase.from('restaurants').insert({ id: newId, owner_id: req.userId, data: newRest }),
          supabase.from('menu_items').insert({ restaurant_id: newId, items: [] }),
        ]);

        if (restErr || menuErr) {
          console.error('Merchant registration approval DB insert error:', restErr || menuErr);
          return notifySystem('ผิดพลาด', restErr?.message || menuErr?.message || 'ไม่สามารถสร้างข้อมูลร้านค้าได้', 'error');
        }

        setRestaurants(prev => [newRest, ...prev]);
        setMenuItems(prev => ({ ...prev, [newId]: [] }));
        notifySystem('Admin', 'อนุมัติร้านค้าเรียบร้อย', 'success');
      }

    } else if (req.type === 'rider_reg') {
      const roleOk = await grantRole(req.userId, 'rider');
      if (!roleOk) {
        return;
      }

      const newId = `rider_${Date.now()}`;
      const profileImageUrl = req.data.profileImage?.startsWith('http') ? req.data.profileImage : null;
      const newRider = {
        id: newId,
        userId: req.userId,
        name: req.data.realName,
        phone: req.data.phone,
        vehicle: req.data.vehicle || 'Motorcycle',
        image: profileImageUrl || null,
        status: 'active',
        balance: 0,
        location: USER_LOCATION,
      };

      const { error: riderErr } = await supabase.from('riders').insert({ id: newId, user_id: req.userId, data: newRider });
      if (riderErr) {
        console.error('Rider registration approval DB insert error:', riderErr);
        return notifySystem('ผิดพลาด', riderErr.message || 'ไม่สามารถสร้างข้อมูลไรเดอร์ได้', 'error');
      }

      setRiders(prev => [newRider, ...prev]);
      notifySystem('Admin', 'อนุมัติไรเดอร์เรียบร้อย', 'success');

    } else if (req.type === 'cancel_order') {
      const { data: latestOrderRow } = await supabase.from('orders').select('data').eq('id', req.data.orderId).maybeSingle();
      const targetOrder = latestOrderRow?.data || orders.find(o => o.id === req.data.orderId);
      const roleName = req.data.requestedBy === 'rider' ? 'ไรเดอร์' : req.data.requestedBy === 'merchant' ? 'ร้านค้า' : 'ลูกค้า';
      const cancelReason = `${roleName}ขอยกเลิก: ${req.data.reason}`;
      if (targetOrder && !['cancelled', 'completed'].includes(targetOrder.status)) {
        const { data: cancelRes, error: cancelErr } = await supabase.rpc('cancel_order_atomic', {
          p_order_id: req.data.orderId,
          p_reason: cancelReason,
        });
        if (cancelErr || !cancelRes?.ok) {
          return notifySystem('ผิดพลาด', cancelErr?.message || cancelRes?.reason || 'ยกเลิกและคืนเงินไม่สำเร็จ', 'error');
        }
        const cancelledOrder = cancelRes.order || { ...targetOrder, status: 'cancelled', cancelReason };
        setOrders(prev => {
          const idx = prev.findIndex(o => o.id === req.data.orderId);
          if (idx === -1) return [cancelledOrder, ...prev];
          const next = [...prev];
          next[idx] = cancelledOrder;
          return next;
        });
        if (cancelledOrder.riderId) {
          const riderRow = riders.find(r => r.id === cancelledOrder.riderId);
          if (riderRow) {
            await supabase.from('riders').update({ is_available: true }).eq('id', riderRow.id);
          }
        }
      }
      const refundNote = req.data.paymentMethod === 'wallet'
        ? ` — คืนเงิน ฿${(req.data.grandTotal || 0).toLocaleString()} แล้ว`
        : ' — ไม่มีการตัดเงิน';
      notifySystem('Admin', `อนุมัติยกเลิกออเดอร์ #${req.data.orderId.slice(-6)}${refundNote}`, 'success');
    }

    setPendingRequests(prev => prev.filter(r => r.id !== req.id));
    await supabase.from('pending_requests').delete().eq('id', req.id);
  };

  const initiateRejectRequest = (id) => {
    setSelectedRequestToReject(id);
    setShowRejectModal(true);
  };

  const confirmRejectRequest = async () => {
    if (!selectedRequestToReject) return;
    const req = pendingRequests.find(r => r.id === selectedRequestToReject);
    setPendingRequests(prev => prev.filter(r => r.id !== selectedRequestToReject));
    await supabase.from('pending_requests').delete().eq('id', selectedRequestToReject);
    setShowRejectModal(false);
    setSelectedRequestToReject(null);
    if (req?.type === 'cancel_order') {
      notifySystem('Admin', `ปฏิเสธคำขอยกเลิก #${req.data.orderId.slice(-6)} — ออเดอร์ดำเนินต่อปกติ`, 'info');
    } else {
      notifySystem('Admin', 'ปฏิเสธคำขอเรียบร้อย', 'info');
    }
  };

  const adminBanUser = async (userId) => {
    const { data: profile } = await supabase.from('profiles').select('banned').eq('id', userId).maybeSingle();
    const newBanned = !profile?.banned;
    await supabase.from('profiles').update({ banned: newBanned }).eq('id', userId);
    notifySystem('Admin', `${newBanned ? 'ระงับ' : 'ปลดระงับ'}บัญชีเรียบร้อย`, 'success');
  };

  const toggleRestaurantStatus = (id, action) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== id) return r;
      let updated = r;
      if (action === 'toggle_open') updated = { ...r, status: r.status === 'open' ? 'closed' : 'open' };
      if (action === 'ban')         updated = { ...r, status: r.status === 'banned' ? 'open' : 'banned' };
      supabase.from('restaurants').update({ data: updated }).eq('id', id).then(() => {});
      return updated;
    }));
  };

  const toggleRiderBan = (id) => {
    setRiders(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, status: r.status === 'banned' ? 'active' : 'banned' };
      supabase.from('riders').update({ data: updated }).eq('id', id).then(() => {});
      return updated;
    }));
  };

  const saveShopEdit = () => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== editingShop) return r;
      const updated = { ...r, ...shopEditForm };
      supabase.from('restaurants').update({ data: updated }).eq('id', editingShop).then(() => {});
      return updated;
    }));
    setEditingShop(null);
    notifySystem('สำเร็จ', 'บันทึกข้อมูลร้านค้าเรียบร้อย', 'success');
  };

  const deleteRestaurant = async (id) => {
    setRestaurants(prev => prev.filter(r => r.id !== id));
    await Promise.all([
      supabase.from('restaurants').delete().eq('id', id),
      supabase.from('menu_items').delete().eq('restaurant_id', id),
    ]);
    notifySystem('ลบร้านค้าแล้ว', 'ลบร้านค้าออกจากระบบเรียบร้อย', 'success');
  };

  return {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit, deleteRestaurant,
  };
}
