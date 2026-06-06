import { useState } from 'react';
import { USER_LOCATION } from '../../constants';
import { compressImage, generateId, formatDateTime } from '../../utils';

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
    if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankName || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนรวมถึงชื่อธนาคาร และอัปโหลดรูปบัตรประชาชน', 'error');
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

    // compress images to base64 for local storage
    let idCardImage = data.idCardImage;
    let shopImage   = data.shopImage;
    if (data._idCardImageFile) {
      try { idCardImage = await compressImage(data._idCardImageFile, 1200, 900, 0.75); } catch {}
    }
    if (data._shopImageFile) {
      try { shopImage = await compressImage(data._shopImageFile, 800, 600, 0.65); } catch {}
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
    notifySystem('สำเร็จ', 'ส่งใบสมัครร้านค้าเรียบร้อย รอแอดมินอนุมัติ', 'success');
    notifyAdmin('🏪 สมัครร้านค้าใหม่', `${userProfile.name} ส่งใบสมัครร้าน ${data.shopName}`, 'warning');
    return true;
  };

  const requestRegisterRider = async (data) => {
    if (!data.realName || !data.idCard || !data.phone || !data.bankName || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนรวมถึงชื่อธนาคาร และอัปโหลดรูปบัตรประชาชน', 'error');
    }
    if (isPending('rider_reg')) return notifySystem('รออนุมัติ', 'คำขอสมัครไรเดอร์กำลังรอการอนุมัติ', 'info');
    const uid = userProfile.id || currentUser?.id || '';

    let idCardImage  = data.idCardImage;
    let profileImage = data.profileImage;
    if (data._idCardImageFile) {
      try { idCardImage = await compressImage(data._idCardImageFile, 1200, 900, 0.75); } catch {}
    }
    if (data._profileImageFile) {
      try { profileImage = await compressImage(data._profileImageFile, 400, 400, 0.7); } catch {}
    }

    const { _idCardImageFile, _profileImageFile, ...dataNoFiles } = data;
    const newReq = {
      id: generateId(), type: 'rider_reg',
      data: { ...dataNoFiles, idCardImage, profileImage },
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
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
