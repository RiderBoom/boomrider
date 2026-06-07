import { useState, useCallback } from 'react';
import { generateId } from '../../utils';

export function usePromoActions({ notifySystem, supabase }) {
  const [promoCodes, setPromoCodes] = useState([]);

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
      const next = prev.map(p => p.code.toUpperCase() === code.toUpperCase()
        ? { ...p, usedCount: (p.usedCount || 0) + 1 }
        : p,
      );
      const updated = next.find(p => p.code.toUpperCase() === code.toUpperCase());
      if (updated) supabase.from('promo_codes').upsert({ id: updated.id, data: updated }).then(() => {});
      return next;
    });
  }, [supabase]);

  const createPromoCode = useCallback((data) => {
    const newCode = { id: generateId(), ...data, code: data.code.toUpperCase(), usedCount: 0, active: true, createdAt: new Date().toISOString() };
    setPromoCodes(prev => [newCode, ...prev]);
    supabase.from('promo_codes').insert({ id: newCode.id, data: newCode }).then(() => {});
    notifySystem('สำเร็จ', `สร้างโค้ด "${data.code.toUpperCase()}" เรียบร้อย`, 'success');
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePromoCode = useCallback((id) => {
    setPromoCodes(prev => {
      const next = prev.map(p => p.id === id ? { ...p, active: !p.active } : p);
      const updated = next.find(p => p.id === id);
      if (updated) supabase.from('promo_codes').upsert({ id: updated.id, data: updated }).then(() => {});
      return next;
    });
  }, [supabase]);

  const deletePromoCode = useCallback((id) => {
    setPromoCodes(prev => prev.filter(p => p.id !== id));
    supabase.from('promo_codes').delete().eq('id', id).then(() => {});
  }, [supabase]);

  return { promoCodes, setPromoCodes, validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode };
}
