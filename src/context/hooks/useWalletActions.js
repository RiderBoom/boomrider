import { useRef } from 'react';
import { generateId, formatDateTime, r2 } from '../../utils';

export function useWalletActions(deps) {
  const {
    currentUser,
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
    supabase,
  } = deps;

  // Serial queue per userId — prevents concurrent reads from corrupting balance
  const walletQueues = useRef({});

  const _makeEntry = (amount, desc) => ({
    id: generateId(),
    type: amount > 0 ? 'deposit' : 'withdraw',
    amount,
    date: formatDateTime(),
    desc,
    createdAtMs: Date.now(),
  });

  const creditWallet = (userId, amount, desc) => {
    const entry = _makeEntry(amount, desc);

    // Optimistic local update (immediate)
    setGlobalWallets(prev => {
      const cur = prev[userId] || { balance: 0, history: [] };
      return { ...prev, [userId]: { balance: r2(cur.balance + amount), history: [entry, ...cur.history] } };
    });
    if (currentUser?.id === userId || currentUser?.email === userId) {
      setUserWallet(prev => r2(prev + amount));
      setWalletAllEntries(prev => [entry, ...prev]);
    }

    // Serial queue per userId — prevents concurrent writes from corrupting balance
    const queue = walletQueues.current;
    const prev = queue[userId] || Promise.resolve();
    queue[userId] = prev.then(async () => {
      try {
        const { data: current } = await supabase.from('wallets').select('balance, history').eq('user_id', userId).single();
        const newBalance = r2((current?.balance || 0) + amount);
        const newHistory = [entry, ...(current?.history || [])].slice(0, 500);
        await supabase.from('wallets').upsert({ user_id: userId, balance: newBalance, history: newHistory });
      } catch (e) {
        console.error('creditWallet sync error', e);
      }
    });
  };

  const processTransaction = (type, amount, description) => {
    setUserWallet(prev => r2(prev + amount));
    setWalletAllEntries(prev => [_makeEntry(amount, description), ...prev]);
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
    setPendingRequests(prev => [newReq, ...prev]);
    supabase.from('pending_requests').insert({ id: newReq.id, data: newReq }).then(() => {});
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
    setPendingRequests(prev => [newReq, ...prev]);
    supabase.from('pending_requests').insert({ id: newReq.id, data: newReq }).then(() => {});
    setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount(''); setWithdrawName('');
    setWithdrawMode(false);
    notifySystem('ส่งคำขอแล้ว ✅', `แจ้งถอนกระเป๋าเงิน ฿${parsedAmount.toLocaleString()} — รอ Admin อนุมัติ`, 'success');
    notifyAdmin('💸 ถอนเงินใหม่', `${userProfile.name || 'ผู้ใช้'} แจ้งถอน ฿${parsedAmount}`, 'warning');
  };

  const adminAdjustWallet = (userId, amount, desc) => {
    creditWallet(userId, amount, `[Admin] ${desc}`);
    notifySystem('Admin', `ปรับยอด ${amount > 0 ? '+' : ''}฿${amount} ให้ผู้ใช้เรียบร้อย`, 'success');
  };

  return { creditWallet, processTransaction, requestTopUp, requestWithdraw, adminAdjustWallet };
}
