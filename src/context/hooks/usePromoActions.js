import { useState, useEffect, useCallback, useRef } from 'react';
import { FIREBASE_ENABLED } from '../../constants';
import { generateId } from '../../utils';
import { savePromoCodes, subscribeToPromoCodes } from '../../firebase/firestore';

export function usePromoActions({ notifySystem }) {
  const [promoCodes, setPromoCodes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('boomrider_promo_codes') || '[]'); } catch { return []; }
  });
  const promoUnsubRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('boomrider_promo_codes', JSON.stringify(promoCodes));
  }, [promoCodes]);

  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    const unsub = subscribeToPromoCodes((codes) => {
      if (codes.length > 0) {
        setPromoCodes(codes);
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('boomrider_promo_codes') || '[]');
          if (local.length > 0) savePromoCodes(local).catch(() => {});
        } catch {}
      }
    });
    promoUnsubRef.current = unsub;
    return () => { unsub(); promoUnsubRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const validatePromoCode = useCallback((code, orderTotal) => {
    const promo = promoCodes.find(p => p.code.toUpperCase() === code.toUpperCase() && p.active);
    if (!promo) return { valid: false, message: 'ไม่พบโค้ดส่วนลด' };
    if ((promo.usedCount || 0) >= promo.maxUses) return { valid: false, message: 'โค้ดนี้ถูกใช้ครบแล้ว' };
    if (promo.expiry && new Date(promo.expiry) < new Date()) return { valid: false, message: 'โค้ดหมดอายุแล้ว' };
    if (promo.minOrder && orderTotal < promo.minOrder) return { valid: false, message: `ยอดขั้นต่ำ ฿${promo.minOrder}` };
    const rawDiscount = promo.type === 'percent' ? (orderTotal * promo.value / 100) : promo.value;
    const discount    = Math.min(rawDiscount, promo.maxDiscount || 9999);
    return { valid: true, discount: Math.round(discount), promo };
  }, [promoCodes]);

  const usePromoCode = useCallback((code) => {
    setPromoCodes(prev => {
      const next = prev.map(p => p.code.toUpperCase() === code.toUpperCase() ? { ...p, usedCount: (p.usedCount || 0) + 1 } : p);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  const createPromoCode = useCallback((data) => {
    const newCode = {
      id: generateId(), ...data,
      code: data.code.toUpperCase(),
      usedCount: 0, active: true,
      createdAt: new Date().toISOString(),
    };
    setPromoCodes(prev => {
      const next = [newCode, ...prev];
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
    notifySystem('สำเร็จ', `สร้างโค้ด "${data.code.toUpperCase()}" เรียบร้อย`, 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePromoCode = useCallback((id) => {
    setPromoCodes(prev => {
      const next = prev.map(p => p.id === id ? { ...p, active: !p.active } : p);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  const deletePromoCode = useCallback((id) => {
    setPromoCodes(prev => {
      const next = prev.filter(p => p.id !== id);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  return {
    promoCodes, setPromoCodes,
    validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode,
  };
}
