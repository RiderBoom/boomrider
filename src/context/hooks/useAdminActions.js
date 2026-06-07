import { generateId, formatDateTime } from '../../utils';
import { USER_LOCATION } from '../../constants';

export function useAdminActions(deps) {
  const {
    orders, setOrders,
    riders, setRiders,
    restaurants, setRestaurants,
    menuItems, setMenuItems,
    pendingRequests, setPendingRequests,
    globalWallets, setGlobalWallets,
    editingShop, shopEditForm, setEditingShop,
    selectedRequestToReject, setSelectedRequestToReject,
    setShowRejectModal,
    creditWallet, grantRole,
    notifySystem,
    supabase,
  } = deps;

  const handleApproveRequest = async (req) => {
    if (req.type === 'topup') {
      const amt = Number(req.data.amount);
      await creditWallet(req.userId, amt, `เติมเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`);
      notifySystem('Admin ✅', `อนุมัติเติมเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'withdraw') {
      const amt = Number(req.data.amount);
      const { data: walletData } = await supabase.from('wallets').select('balance').eq('user_id', req.userId).single();
      const liveBalance = walletData?.balance ?? globalWallets[req.userId]?.balance ?? 0;
      if (liveBalance < amt) {
        return notifySystem('ผิดพลาด', `${req.user} มียอดเงินไม่พอ (มี ฿${liveBalance.toLocaleString()}, ต้องการ ฿${amt.toLocaleString()})`, 'error');
      }
      await creditWallet(req.userId, -amt, `ถอนเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`);
      notifySystem('Admin ✅', `อนุมัติถอนเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'merchant_reg') {
      // Guard: don't create a duplicate restaurant if one already exists for this user
      const existingShop = restaurants.find(r => r.ownerId === req.userId);
      if (existingShop) {
        grantRole(req.userId, 'merchant');
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
        setRestaurants(prev => [newRest, ...prev]);
        grantRole(req.userId, 'merchant');
        setMenuItems(prev => ({ ...prev, [newId]: [] }));
        await Promise.all([
          supabase.from('restaurants').insert({ id: newId, owner_id: req.userId, data: newRest }),
          supabase.from('menu_items').insert({ restaurant_id: newId, items: [] }),
        ]);
        notifySystem('Admin', 'อนุมัติร้านค้าเรียบร้อย', 'success');
      }

    } else if (req.type === 'rider_reg') {
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
      setRiders(prev => [newRider, ...prev]);
      grantRole(req.userId, 'rider');
      await supabase.from('riders').insert({ id: newId, user_id: req.userId, data: newRider });
      notifySystem('Admin', 'อนุมัติไรเดอร์เรียบร้อย', 'success');

    } else if (req.type === 'cancel_order') {
      const targetOrder = orders.find(o => o.id === req.data.orderId);
      const roleName = req.data.requestedBy === 'rider' ? 'ไรเดอร์' : req.data.requestedBy === 'merchant' ? 'ร้านค้า' : 'ลูกค้า';
      const cancelReason = `${roleName}ขอยกเลิก: ${req.data.reason}`;
      if (targetOrder && !['cancelled', 'completed'].includes(targetOrder.status)) {
        const cancelledOrder = { ...targetOrder, status: 'cancelled', cancelReason };
        setOrders(prev => prev.map(o => o.id === req.data.orderId ? cancelledOrder : o));
        await supabase.from('orders').update({ status: 'cancelled', data: cancelledOrder }).eq('id', req.data.orderId);
      }
      if (req.data.paymentMethod === 'wallet' && req.data.grandTotal > 0) {
        const refundTo = targetOrder?.customerId || req.data.customerId || req.userId;
        await creditWallet(refundTo, req.data.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ #${req.data.orderId.slice(-6)} (Admin อนุมัติ)`);
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
    const { data: profile } = await supabase.from('profiles').select('banned').eq('id', userId).single();
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

  return {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit,
  };
}
