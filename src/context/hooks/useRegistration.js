import { useState } from 'react';
import { USER_LOCATION } from '../../constants.js';
import { compressImage, generateId, formatDateTime } from '../../utils.js';

export function useRegistration(deps) {
  const {
    currentUser, userProfile, userRoles,
    restaurants, isPending,
    setPendingRequests,
    grantRole,
    notifySystem, notifyAdmin,
    supabase,
  } = deps;
  const defaultMerchantRegFormState = useState({
    shopName: '', category: 'Street Food', realName: '', idCard: '', phone: '',
    bankName: '', bankAccount: '', idCardImage: null, shopImage: null, location: null,
  });
  const [merchantRegForm, setMerchantRegForm] = deps.merchantRegFormState || defaultMerchantRegFormState;

  const defaultRiderRegFormState = useState({
    realName: '', vehicle: 'Motorcycle', idCard: '', phone: '',
    bankName: '', bankAccount: '', idCardImage: null, profileImage: null,
  });
  const [riderRegForm, setRiderRegForm] = deps.riderRegFormState || defaultRiderRegFormState;

  const requestRegisterMerchant = async (data) => {
    if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankName || !data.bankAccount || !data.idCardImage) {
      notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนรวมถึงชื่อธนาคาร และอัปโหลดรูปบัตรประชาชน', 'error');
      return false;
    }
    if (restaurants.some(r => r.ownerId === userProfile.id || r.ownerId === currentUser?.id)) {
      if (!userRoles.includes('merchant')) {
        grantRole(userProfile.id || currentUser?.id, 'merchant');
        notifySystem('อัปเดต', 'พบร้านค้าในระบบ กำลังเปิดสิทธิ์ร้านค้าให้', 'success');
        return true;
      } else {
        notifySystem('ซ้ำซ้อน', 'คุณมีร้านค้าอยู่แล้ว', 'error');
        return false;
      }
    }
    if (isPending('merchant_reg')) {
      notifySystem('รออนุมัติ', 'คำขอสมัครร้านค้ากำลังรอการอนุมัติ', 'info');
      return false;
    }
    const uid = userProfile.id || currentUser?.id || '';

    let idCardImage = data.idCardImage;
    let shopImage   = data.shopImage;
    if (data._idCardImageFile) {
      try { idCardImage = await compressImage(data._idCardImageFile, 1200, 900, 0.75); } catch { void 0; }
    }
    if (data._shopImageFile) {
      try { shopImage = await compressImage(data._shopImageFile, 800, 600, 0.65); } catch { void 0; }
    }

    const { _idCardImageFile, _shopImageFile, ...dataNoFiles } = data;
    const merchantLocation = data.location || userProfile.location || USER_LOCATION;
    const newReq = {
      id: generateId(), type: 'merchant_reg',
      data: { ...dataNoFiles, location: merchantLocation, idCardImage, shopImage },
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
    setPendingRequests(prev => [newReq, ...prev]);

    try {
      const { error } = await supabase.from('pending_requests').insert({ id: newReq.id, data: newReq });
      if (error) throw error;

      notifySystem('สำเร็จ', 'ส่งใบสมัครร้านค้าเรียบร้อย รอแอดมินอนุมัติ', 'success');
      notifyAdmin('🏪 สมัครร้านค้าใหม่', `${userProfile.name} ส่งใบสมัครร้าน ${data.shopName}`, 'warning');
      return true;
    } catch (e) {
      console.error('requestRegisterMerchant insert error', e);
      setPendingRequests(prev => prev.filter(r => r.id !== newReq.id));
      notifySystem('ไม่สำเร็จ', 'ไม่สามารถส่งใบสมัครร้านค้าได้ กรุณาลองใหม่อีกครั้ง', 'error');
      return false;
    }
  };

  const requestRegisterRider = async (data) => {
    if (!data.realName || !data.idCard || !data.phone || !data.bankName || !data.bankAccount || !data.idCardImage) {
      notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนรวมถึงชื่อธนาคาร และอัปโหลดรูปบัตรประชาชน', 'error');
      return false;
    }
    if (isPending('rider_reg')) {
      notifySystem('รออนุมัติ', 'คำขอสมัครไรเดอร์กำลังรอการอนุมัติ', 'info');
      return false;
    }
    const uid = userProfile.id || currentUser?.id || '';

    let idCardImage  = data.idCardImage;
    let profileImage = data.profileImage;
    if (data._idCardImageFile) {
      try { idCardImage  = await compressImage(data._idCardImageFile, 1200, 900, 0.75); } catch { void 0; }
    }
    if (data._profileImageFile) {
      try { profileImage = await compressImage(data._profileImageFile, 400, 400, 0.7); } catch { void 0; }
    }

    const { _idCardImageFile, _profileImageFile, ...dataNoFiles } = data;
    const newReq = {
      id: generateId(), type: 'rider_reg',
      data: { ...dataNoFiles, idCardImage, profileImage },
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
    setPendingRequests(prev => [newReq, ...prev]);

    try {
      const { error } = await supabase.from('pending_requests').insert({ id: newReq.id, data: newReq });
      if (error) throw error;

      notifySystem('สำเร็จ', 'ส่งใบสมัครไรเดอร์เรียบร้อย รอแอดมินอนุมัติ', 'success');
      notifyAdmin('🛵 สมัครไรเดอร์ใหม่', `${userProfile.name} ส่งใบสมัคร`, 'warning');
      return true;
    } catch (e) {
      console.error('requestRegisterRider insert error', e);
      setPendingRequests(prev => prev.filter(r => r.id !== newReq.id));
      notifySystem('ไม่สำเร็จ', 'ไม่สามารถส่งใบสมัครไรเดอร์ได้ กรุณาลองใหม่อีกครั้ง', 'error');
      return false;
    }
  };

  return { merchantRegForm, setMerchantRegForm, riderRegForm, setRiderRegForm, requestRegisterMerchant, requestRegisterRider };
}
