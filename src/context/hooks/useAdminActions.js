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
  } = deps;

  const handleApproveRequest = async (req) => {
    if (req.type === 'topup') {
      const amt       = Number(req.data.amount);
      const topupDesc = `เติมเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;
      creditWallet(req.userId, amt, topupDesc);
      notifySystem('Admin ✅', `อนุมัติเติมเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'withdraw') {
      const amt          = Number(req.data.amount);
      const withdrawDesc = `ถอนเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;
      const liveBalance  = globalWallets[req.userId]?.balance ?? 0;
      if (liveBalance < amt) {
        return notifySystem('ผิดพลาด', `${req.user} มียอดเงินไม่พอ (มี ฿${liveBalance.toLocaleString()}, ต้องการ ฿${amt.toLocaleString()})`, 'error');
      }
      creditWallet(req.userId, -amt, withdrawDesc);
      notifySystem('Admin ✅', `อนุมัติถอนเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'merchant_reg') {
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
      notifySystem('Admin', 'อนุมัติร้านค้าเรียบร้อย', 'success');

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
      notifySystem('Admin', 'อนุมัติไรเดอร์เรียบร้อย', 'success');

    } else if (req.type === 'cancel_order') {
      const targetOrder = orders.find(o => o.id === req.data.orderId);
      const requestedBy = req.data.requestedBy;
      const roleName    = requestedBy === 'rider' ? 'ไรเดอร์' : requestedBy === 'merchant' ? 'ร้านค้า' : 'ลูกค้า';
      const cancelReason = `${roleName}ขอยกเลิก: ${req.data.reason}`;
      if (targetOrder && !['cancelled', 'completed'].includes(targetOrder.status)) {
        const cancelledOrder = { ...targetOrder, status: 'cancelled', cancelReason };
        setOrders(prev => prev.map(o => o.id === req.data.orderId ? cancelledOrder : o));
      }
      if (req.data.paymentMethod === 'wallet' && req.data.grandTotal > 0) {
        const refundTo   = targetOrder?.customerId || req.data.customerId || req.userId;
        const refundDesc = `คืนเงิน: ยกเลิกออเดอร์ #${req.data.orderId.slice(-6)} (Admin อนุมัติ)`;
        creditWallet(refundTo, req.data.grandTotal, refundDesc);
      }
      const refundNote = req.data.paymentMethod === 'wallet'
        ? ` — คืนเงิน ฿${(req.data.grandTotal || 0).toLocaleString()} แล้ว`
        : ' — ไม่มีการตัดเงิน';
      notifySystem('Admin', `อนุมัติยกเลิกออเดอร์ #${req.data.orderId.slice(-6)}${refundNote}`, 'success');
    }

    setPendingRequests(prev => prev.filter(r => r.id !== req.id));
  };

  const initiateRejectRequest = (id) => {
    setSelectedRequestToReject(id);
    setShowRejectModal(true);
  };

  const confirmRejectRequest = () => {
    if (selectedRequestToReject) {
      const req = pendingRequests.find(r => r.id === selectedRequestToReject);
      setPendingRequests(prev => prev.filter(r => r.id !== selectedRequestToReject));
      setShowRejectModal(false);
      setSelectedRequestToReject(null);
      if (req?.type === 'cancel_order') {
        notifySystem('Admin', `ปฏิเสธคำขอยกเลิก #${req.data.orderId.slice(-6)} — ออเดอร์ดำเนินต่อปกติ`, 'info');
      } else {
        notifySystem('Admin', 'ปฏิเสธคำขอเรียบร้อย', 'info');
      }
    }
  };

  const adminBanUser = (userId) => {
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const target = users.find(u => u.id === userId);
    const newBanned = !(target?.banned);
    const updated = users.map(u => u.id === userId ? { ...u, banned: newBanned } : u);
    localStorage.setItem('boomrider_users', JSON.stringify(updated));
    notifySystem('Admin', `${newBanned ? 'ระงับ' : 'ปลดระงับ'}บัญชีเรียบร้อย`, 'success');
  };

  const toggleRestaurantStatus = (id, action) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== id) return r;
      let updated = r;
      if (action === 'toggle_open') updated = { ...r, status: r.status === 'open' ? 'closed' : 'open' };
      if (action === 'ban')         updated = { ...r, status: r.status === 'banned' ? 'open' : 'banned' };
      return updated;
    }));
  };

  const toggleRiderBan = (id) => {
    setRiders(prev => prev.map(r => {
      if (r.id !== id) return r;
      return { ...r, status: r.status === 'banned' ? 'active' : 'banned' };
    }));
  };

  const saveShopEdit = () => {
    let savedRest = null;
    setRestaurants(prev => prev.map(r => {
      if (r.id !== editingShop) return r;
      savedRest = { ...r, ...shopEditForm };
      return savedRest;
    }));
    setEditingShop(null);
    notifySystem('สำเร็จ', 'บันทึกข้อมูลร้านค้าเรียบร้อย', 'success');
  };

  return {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit,
  };
}
