const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Credit (or debit) a wallet atomically using FieldValue.increment().
 * No read required — safe for concurrent writes from multiple functions.
 *
 * Mirrors the client-side creditWalletInDB() in src/firebase/firestore.js.
 */
const formatDateTH = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const creditWallet = async (userId, amount, desc) => {
  if (!userId || !amount) return;
  const db    = getFirestore();
  const ref   = db.collection('wallets').doc(userId);
  const entry = {
    id:          `${userId.slice(-4)}_${Date.now()}`,
    type:        amount > 0 ? 'deposit' : 'withdraw',
    amount,
    date:        formatDateTH(),
    createdAtMs: Date.now(),
    desc,
  };
  await ref.set(
    {
      balance:   FieldValue.increment(amount),
      history:   FieldValue.arrayUnion(entry),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
};

/**
 * Append a row to the wallets/{userId}/entries subcollection.
 * Mirrors addWalletEntry() on the client.
 */
const addEntry = async (userId, type, amount, desc) => {
  if (!userId) return;
  const db = getFirestore();
  await db.collection('wallets').doc(userId).collection('entries').add({
    type,
    amount,
    desc,
    date:        formatDateTH(),
    createdAtMs: Date.now(),
    createdAt:   FieldValue.serverTimestamp(),
  });
};

/**
 * Append a row to the global `transactions` collection.
 * Mirrors saveTransaction() on the client.
 */
const saveTransaction = async (tx) => {
  if (!tx?.type) return;
  const db = getFirestore();
  await db.collection('transactions').add({
    ...tx,
    createdAt: FieldValue.serverTimestamp(),
  });
};

module.exports = { creditWallet, addEntry, saveTransaction };
