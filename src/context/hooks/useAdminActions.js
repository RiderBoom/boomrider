import {
  creditWalletInDB, addWalletEntry, saveTransaction, deletePendingRequest,
  updateOrderStatusInDB, saveRestaurant, saveRider, saveMenuItems, loadWallet, setBanUser,
  safeLocalSet,
} from '../../firebase/firestore';
import { FIREBASE_ENABLED, ADMIN_UID, USER_LOCATION } from '../../constants';
import { formatDateTime } from '../../utils';

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
      if (FIREBASE_ENABLED) {
        const _topupDate = formatDateTime();
        const _topupMs   = Date.now();
        creditWalletInDB(req.userId, amt, topupDesc).catch(() => {});
        addWalletEntry(req.userId, { type: 'deposit', amount: amt, desc: topupDesc, date: _topupDate, createdAtMs: _topupMs }).catch(() => {});
        saveTransaction({ type: 'topup_approved', userId: req.userId, userName: req.user, role: 'customer', amount: amt, desc: topupDesc, date: _topupDate }).catch(() => {});
      }
      notifySystem('Admin ✅', `อนุมัติเติมเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'withdraw') {
      const amt          = Number(req.data.amount);
      const withdrawDesc = `ถอนเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;
      let liveBalance = globalWallets[req.userId]?.balance ?? 0;
      if (FIREBASE_ENABLED) {
        try {
          const cloudWallet = await loadWallet(req.userId);
          if (cloudWallet != null) {
            liveBalance = cloudWallet.balance ?? 0;
            setGlobalWallets(prev => ({ ...prev, [req.userId]: { balance: liveBalance, history: cloudWallet.history || [] } }));
          }
        } catch (_) {}
      }
      if (liveBalance < amt) {
        return notifySystem('ผิดพลาด', `${req.user} มียอดเงินไม่พอ (มี ฿${liveBalance.toLocaleString()}, ต้องการ ฿${amt.toLocaleString()})`, 'error');
      }
      creditWallet(req.userId, -amt, withdrawDesc);
      if (FIREBASE_ENABLED) {
        const _wdDate = formatDateTime();
        const _wdMs   = Date.now();
        creditWalletInDB(req.userId, -amt, withdrawDesc).catch(() => {});
        addWalletEntry(req.userId, { type: 'withdraw', amount: -amt, desc: withdrawDesc, date: _wdDate, createdAtMs: _wdMs }).catch(() => {});
        saveTransaction({ type: 'withdraw_approved', userId: req.userId, userName: req.user, role: 'customer', amount: -amt, desc: withdrawDesc, date: _wdDate }).catch(() => {});
      }
      notifySystem('Admin ✅', `อนุมัติถอนเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, 'success');

    } else if (req.type === 'merchant_reg') {
      const newId = `rest_${Date.now()}`;
      const newRest = {
        id: newId,
        ownerId: req.userId,
        name: req.data.shopName,
        phone: req.data.phone,
        rating: 5.0,
        time: '20-30 min',
        image: req.data.shopImage || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=500&q=60',
        category: req.data.category,
        status: 'open',
        location: req.data.location || USER_LOCATION,
      };
      setRestaurants(prev => [newRest, ...prev]);
      grantRole(req.userId, 'merchant');
      setMenuItems(prev => ({ ...prev, [newId]: [] }));
      if (FIREBASE_ENABLED) {
        saveRestaurant(newRest).catch(() => {});
        saveMenuItems(newId, []).catch(() => {});
      }
      notifySystem('Admin', 'อนุมัติร้านค้าเรียบร้อย', 'success');

    } else if (req.type === 'rider_reg') {
      const newId = `rider_${Date.now()}`;
      const newRider = { id: newId, userId: req.userId, name: req.data.realName, phone: req.data.phone, status: 'active', balance: 0, location: USER_LOCATION };
      setRiders(prev => [newRider, ...prev]);
      safeLocalSet('boomrider_riders', [newRider, ...riders]);
      grantRole(req.userId, 'rider');
      if (FIREBASE_ENABLED) saveRider(newRider).catch(() => {});
      notifySystem('Admin', 'อนุมัติไรเดอร์เรียบร้อย', 'success');

    } else if (req.type === 'cancel_order') {
      const targetOrder = orders.find(o => o.id === req.data.orderId);
      const requestedBy = req.data.requestedBy;
      const roleName    = requestedBy === 'rider' ? 'ไรเดอร์' : requestedBy === 'merchant' ? 'ร้านค้า' : 'ลูกค้า';
      const cancelReason = `${roleName}ขอยกเลิก: ${req.data.reason}`;
      if (targetOrder && !['cancelled', 'completed'].includes(targetOrder.status)) {
        const cancelledOrder = { ...targetOrder, status: 'cancelled', cancelReason };
        setOrders(prev => prev.map(o => o.id === req.data.orderId ? cancelledOrder : o));
        if (FIREBASE_ENABLED) {
          updateOrderStatusInDB(req.data.orderId, { status: 'cancelled', cancelReason }).catch(() => {});
          saveTransaction({ type: 'order_cancelled', orderId: req.data.orderId, userId: req.userId, userName: req.user, role: 'customer', amount: 0, desc: `ยกเลิกออเดอร์ #${req.data.orderId.slice(-6)}`, date: formatDateTime() }).catch(() => {});
        }
      }
      if (req.data.paymentMethod === 'wallet' && req.data.grandTotal > 0) {
        // Use the customer's UID for the refund — req.userId may be the rider/merchant
        // who submitted the cancel request, not the customer who paid.
        const refundTo   = targetOrder?.customerId || req.data.customerId || req.userId;
        const refundName = targetOrder?.customerName || req.data.customerName || req.user;
        const refundDesc = `คืนเงิน: ยกเลิกออเดอร์ #${req.data.orderId.slice(-6)} (Admin อนุมัติ)`;
        creditWallet(refundTo, req.data.grandTotal, refundDesc);
        if (FIREBASE_ENABLED) {
          const _refDate = formatDateTime();
          creditWalletInDB(refundTo, req.data.grandTotal, refundDesc).catch(() => {});
          addWalletEntry(refundTo, { type: 'refund', amount: req.data.grandTotal, desc: refundDesc, date: _refDate }).catch(() => {});
          saveTransaction({ type: 'wallet_refund', orderId: req.data.orderId, userId: refundTo, userName: refundName, role: 'customer', amount: req.data.grandTotal, desc: refundDesc, date: _refDate }).catch(() => {});
        }
      }
      const refundNote = req.data.paymentMethod === 'wallet'
        ? ` — คืนเงิน ฿${(req.data.grandTotal || 0).toLocaleString()} แล้ว`
        : ' — ไม่มีการตัดเงิน';
      notifySystem('Admin', `อนุมัติยกเลิกออเดอร์ #${req.data.orderId.slice(-6)}${refundNote}`, 'success');
    }

    if (FIREBASE_ENABLED) deletePendingRequest(req.id).catch(() => {});
    setPendingRequests(prev => prev.filter(r => r.id !== req.id));
  };

  const initiateRejectRequest = (id) => {
    setSelectedRequestToReject(id);
    setShowRejectModal(true);
  };

  const confirmRejectRequest = () => {
    if (selectedRequestToReject) {
      const req = pendingRequests.find(r => r.id === selectedRequestToReject);
      if (FIREBASE_ENABLED) deletePendingRequest(selectedRequestToReject).catch(() => {});
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
    if (FIREBASE_ENABLED) setBanUser(userId, newBanned).catch(() => {});
    notifySystem('Admin', `${newBanned ? 'ระงับ' : 'ปลดระงับ'}บัญชีเรียบร้อย`, 'success');
  };

  const toggleRestaurantStatus = (id, action) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== id) return r;
      let updated = r;
      if (action === 'toggle_open') updated = { ...r, status: r.status === 'open' ? 'closed' : 'open' };
      if (action === 'ban')         updated = { ...r, status: r.status === 'banned' ? 'open' : 'banned' };
      if (updated !== r && FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
      return updated;
    }));
  };

  const toggleRiderBan = (id) => {
    setRiders(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, status: r.status === 'banned' ? 'active' : 'banned' };
      if (FIREBASE_ENABLED) saveRider(updated).catch(() => {});
      return updated;
    }));
  };

  const saveShopEdit = () => {
    let savedRest = null;
    setRestaurants(prev => prev.map(r => {
      if (r.id !== editingShop) return r;
      savedRest = { ...r, ...shopEditForm };
      return savedRest;
    }));
    if (FIREBASE_ENABLED && savedRest) saveRestaurant(savedRest).catch(() => {});
    setEditingShop(null);
    notifySystem('สำเร็จ', 'บันทึกข้อมูลร้านค้าเรียบร้อย', 'success');
  };

  return {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit,
  };
}
