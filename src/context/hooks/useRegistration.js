import { useState } from 'react';
import { FIREBASE_ENABLED, USER_LOCATION } from '../../constants';
import { compressImage, generateId, formatDateTime } from '../../utils';
import { uploadIdCard, uploadShopPhoto, uploadProfilePhoto, uploadDataUrl } from '../../firebase/storage';
import { savePendingRequest } from '../../firebase/firestore';

export function useRegistration({
  currentUser, userProfile, userRoles,
  restaurants, isPending,
  setPendingRequests,
  grantRole,
  notifySystem, notifyAdmin,
}) {
  const [merchantRegForm, setMerchantRegForm] = useState({
    shopName: '', category: 'Street Food', realName: '', idCard: '', phone: '',
    bankName: '', bankAccount: '', idCardImage: null, shopImage: null, location: null,
  });
  const [riderRegForm, setRiderRegForm] = useState({
    realName: '', vehicle: 'Motorcycle', idCard: '', phone: '',
    bankName: '', bankAccount: '', idCardImage: null, profileImage: null,
  });

  const requestRegisterMerchant = async (data) => {
    if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน', 'error');
    }
    if (restaurants.some(r => r.ownerId === userProfile.id || r.ownerId === currentUser?.id)) {
      if (!userRoles.includes('merchant')) {
        grantRole(userProfile.id || currentUser?.id, 'merchant');
        notifySystem('อัปเดต', 'พบร้านค้าในระบบ กำลังเปิดสิทธิ์ร้านค้าให้', 'success');
      } else {
        notifySystem('ซ้ำซ้อน', 'คุณมีร้านค้าอยู่แล้ว', 'error');
      }
      return;
    }
    if (isPending('merchant_reg')) return notifySystem('รออนุมัติ', 'คำขอสมัครร้านค้ากำลังรอการอนุมัติ', 'info');
    const uid = userProfile.id || currentUser?.id || '';

    // ── อัปโหลดรูป KYC ไป Firebase Storage ก่อน save pending request ─────────
    let idCardUrl = null;
    let shopImageUrl = null;
    if (FIREBASE_ENABLED && uid) {
      try {
        idCardUrl = data._idCardImageFile
          ? await uploadIdCard(uid, await compressImage(data._idCardImageFile, 1200, 900, 0.88).catch(() => data._idCardImageFile))
          : data.idCardImage?.startsWith('data:')
            ? await uploadDataUrl(data.idCardImage, `kyc/${uid}/id_card_${Date.now()}.jpg`)
            : null;
      } catch {}
      try {
        shopImageUrl = data._shopImageFile
          ? await uploadShopPhoto(`pending_${uid}`, await compressImage(data._shopImageFile, 800, 600, 0.75).catch(() => data._shopImageFile))
          : data.shopImage?.startsWith('data:')
            ? await uploadDataUrl(data.shopImage, `shops/pending_${uid}/cover_${Date.now()}.jpg`)
            : null;
      } catch {}
    }

    const { idCardImage, shopImage, _idCardImageFile, _shopImageFile, ...dataNoImages } = data;
    const merchantLocation = data.location || userProfile.location || USER_LOCATION;
    const newReq = {
      id: generateId(), type: 'merchant_reg',
      data: {
        ...dataNoImages,
        location:    merchantLocation,
        idCardImage: idCardUrl    || (idCardImage  ? '✓ อัปโหลดบัตรประชาชนแล้ว' : null),
        shopImage:   shopImageUrl || (shopImage    ? '✓ อัปโหลดรูปร้านแล้ว'       : null),
      },
      _hasImages: !!(idCardUrl || shopImageUrl || idCardImage || shopImage),
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('สำเร็จ', 'ส่งใบสมัครร้านค้าเรียบร้อย รอแอดมินอนุมัติ', 'success');
    notifyAdmin('🏪 สมัครร้านค้าใหม่', `${userProfile.name} ส่งใบสมัครร้าน ${data.shopName}`, 'warning');
    return true;
  };

  const requestRegisterRider = async (data) => {
    if (!data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน', 'error');
    }
    if (isPending('rider_reg')) return notifySystem('รออนุมัติ', 'คำขอสมัครไรเดอร์กำลังรอการอนุมัติ', 'info');
    const uid = userProfile.id || currentUser?.id || '';

    // ── อัปโหลดรูป KYC ไป Firebase Storage ก่อน save pending request ─────────
    let idCardUrl = null;
    let profileImageUrl = null;
    if (FIREBASE_ENABLED && uid) {
      try {
        idCardUrl = data._idCardImageFile
          ? await uploadIdCard(uid, await compressImage(data._idCardImageFile, 1200, 900, 0.88).catch(() => data._idCardImageFile))
          : data.idCardImage?.startsWith('data:')
            ? await uploadDataUrl(data.idCardImage, `kyc/${uid}/id_card_${Date.now()}.jpg`)
            : null;
      } catch {}
      try {
        profileImageUrl = data._profileImageFile
          ? await uploadProfilePhoto(uid, await compressImage(data._profileImageFile, 400, 400, 0.8).catch(() => data._profileImageFile))
          : data.profileImage?.startsWith('data:')
            ? await uploadDataUrl(data.profileImage, `users/${uid}/kyc_profile_${Date.now()}.jpg`)
            : null;
      } catch {}
    }

    const { idCardImage, profileImage, _idCardImageFile, _profileImageFile, ...dataNoImages } = data;
    const newReq = {
      id: generateId(), type: 'rider_reg',
      data: {
        ...dataNoImages,
        idCardImage:  idCardUrl       || (idCardImage  ? '✓ อัปโหลดบัตรประชาชนแล้ว' : null),
        profileImage: profileImageUrl || (profileImage ? '✓ อัปโหลดรูปโปรไฟล์แล้ว'   : null),
      },
      _hasImages: !!(idCardUrl || profileImageUrl || idCardImage || profileImage),
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('สำเร็จ', 'ส่งใบสมัครไรเดอร์เรียบร้อย รอแอดมินอนุมัติ', 'success');
    notifyAdmin('🛵 สมัครไรเดอร์ใหม่', `${userProfile.name} ส่งใบสมัคร`, 'warning');
    return true;
  };

  return {
    merchantRegForm, setMerchantRegForm,
    riderRegForm, setRiderRegForm,
    requestRegisterMerchant,
    requestRegisterRider,
  };
}
