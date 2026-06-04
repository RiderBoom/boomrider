import {
  creditWalletInDB, addWalletEntry, savePendingRequest,
} from '../../firebase/firestore';
import { generateId, formatDateTime, r2 } from '../../utils';
import { FIREBASE_ENABLED } from '../../constants';

export function useWalletActions(deps) {
  const {
    currentUser,
    currentUserRef,
    userProfile,
    userWallet,
    pendingRequests,
    setUserWallet,
    setWalletAllEntries,
    setGlobalWallets,
    setPendingRequests,
    setShowTopUpModal,
    setTopUpSlip,
    setWithdrawAmount,
    setWithdrawBank,
    setWithdrawAccount,
    setWithdrawName,
    setWithdrawMode,
    notifySystem,
    notifyAdmin,
  } = deps;

  const creditWallet = (userId, amount, desc) => {
    setGlobalWallets(prev => {
      const cur = prev[userId] || { balance: 0, history: [] };
      return {
        ...prev,
        [userId]: {
          balance: cur.balance + amount,
          history: [
            { id: generateId(), type: amount > 0 ? 'deposit' : 'withdraw', amount, date: formatDateTime(), desc, createdAtMs: Date.now() },
            ...cur.history,
          ],
        },
      };
    });
    if (currentUser?.id === userId) {
      setUserWallet(prev => r2(prev + amount));
      if (!FIREBASE_ENABLED) {
        setWalletAllEntries(prev => [
          { id: generateId(), type: amount > 0 ? 'deposit' : 'withdraw', amount, date: formatDateTime(), desc, createdAtMs: Date.now() },
          ...prev,
        ]);
      }
    }
  };

  const processTransaction = (type, amount, description) => {
    setUserWallet(prev => r2(prev + amount));
    const entry = { id: generateId(), type, amount, date: formatDateTime(), desc: description, createdAtMs: Date.now() };
    if (!FIREBASE_ENABLED) setWalletAllEntries(prev => [entry, ...prev]);
    if (FIREBASE_ENABLED) {
      const uid = currentUserRef.current?.id;
      if (uid) addWalletEntry(uid, { type, amount, desc: description, date: entry.date, createdAtMs: entry.createdAtMs }).catch(() => {});
    }
  };

  const requestTopUp = (amount, slipImage, _walletType = null, bankInfo = {}) => {
    const uid = userProfile.id || currentUser?.id || '';
    const newReq = {
      id: generateId(), type: 'topup',
      data: {
        amount,
        bank:          bankInfo.bank          || null,
        accountName:   bankInfo.accountName   || null,
        accountNumber: bankInfo.accountNumber || null,
        slipImage:     slipImage || null,
      },
      _hasSlip: !!slipImage,
      userId: uid, user: userProfile.name || 'ผู้ใช้',
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) {
      savePendingRequest(newReq).catch(() => {});
    }
    setPendingRequests(prev => [newReq, ...prev]);
    setShowTopUpModal(false);
    setTopUpSlip(null);
    setWithdrawAmount('');
    notifySystem('ส่งคำขอแล้ว ✅', `แจ้งเติมกระเป๋าเงิน ฿${Number(amount).toLocaleString()} — รอ Admin อนุมัติ`, 'success');
    notifyAdmin('💰 เติมเงินใหม่', `${userProfile.name || 'ผู้ใช้'} แจ้งเติม ฿${amount}`, 'warning');
  };

  const requestWithdraw = (amount, bankInfo, _walletType = null) => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return notifySystem('ผิดพลาด', 'กรุณาระบุจำนวนเงิน', 'error');
    const uid = userProfile.id || currentUser?.id || '';
    const pendingWithdrawTotal = pendingRequests
      .filter(r => r.userId === uid && r.type === 'withdraw')
      .reduce((sum, r) => sum + (Number(r.data?.amount) || 0), 0);
    const effectiveBalance = userWallet - pendingWithdrawTotal;
    if (effectiveBalance < parsedAmount) {
      return notifySystem(
        'ผิดพลาด',
        pendingWithdrawTotal > 0
          ? `ยอดคงเหลือที่ถอนได้ ฿${effectiveBalance.toLocaleString()} (หักยอดรอถอน ฿${pendingWithdrawTotal.toLocaleString()} แล้ว)`
          : 'ยอดเงินในกระเป๋าไม่เพียงพอ',
        'error',
      );
    }

    const bank          = bankInfo.bank          || bankInfo.bankName   || '';
    const accountName   = bankInfo.accountName   || bankInfo.name       || '';
    const accountNumber = bankInfo.accountNumber || bankInfo.account    || '';

    const newReq = {
      id: generateId(), type: 'withdraw',
      data: { amount: parsedAmount, bank, accountName, accountNumber, account: accountNumber, name: accountName },
      userId: uid, user: userProfile.name || 'ผู้ใช้',
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount(''); setWithdrawName('');
    setWithdrawMode(false);
    notifySystem('ส่งคำขอแล้ว ✅', `แจ้งถอนกระเป๋าเงิน ฿${parsedAmount.toLocaleString()} — รอ Admin อนุมัติ`, 'success');
    notifyAdmin('💸 ถอนเงินใหม่', `${userProfile.name || 'ผู้ใช้'} แจ้งถอน ฿${parsedAmount}`, 'warning');
  };

  const adminAdjustWallet = (userId, amount, desc) => {
    const fullDesc = `[Admin] ${desc}`;
    creditWallet(userId, amount, fullDesc);
    if (FIREBASE_ENABLED) {
      const _adjDate = formatDateTime();
      creditWalletInDB(userId, amount, fullDesc).catch(() => {});
      addWalletEntry(userId, { type: amount > 0 ? 'deposit' : 'withdraw', amount, desc: fullDesc, date: _adjDate }).catch(() => {});
    }
    notifySystem('Admin', `ปรับยอด ${amount > 0 ? '+' : ''}฿${amount} ให้ผู้ใช้เรียบร้อย`, 'success');
  };

  return { creditWallet, processTransaction, requestTopUp, requestWithdraw, adminAdjustWallet };
}
