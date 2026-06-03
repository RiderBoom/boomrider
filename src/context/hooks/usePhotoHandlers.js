import { useState } from 'react';
import { FIREBASE_ENABLED } from '../../constants';
import { compressImage } from '../../utils';
import { uploadProfilePhoto, uploadShopPhoto, uploadMenuPhoto, uploadTopUpSlip } from '../../firebase/storage';
import { saveRestaurant } from '../../firebase/firestore';

export function usePhotoHandlers({
  currentUser, userProfile,
  restaurants, isEditingMenu,
  setTempProfile, setRestaurants, setEditForm, setTopUpSlip,
  setShowImageModal, setPreviewImageUrl,
  notifySystem,
}) {
  const [profileUploading, setProfileUploading] = useState(false);

  const handleProfilePhotoChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const uid = currentUser?.id || userProfile?.id;
    if (FIREBASE_ENABLED && uid) {
      setProfileUploading(true);
      try {
        const compressed = await compressImage(file, 400, 400, 0.8).catch(() => file);
        const url = await uploadProfilePhoto(uid, compressed);
        setTempProfile(prev => ({ ...prev, image: url }));
      } catch {
        notifySystem('ผิดพลาด', 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ', 'error');
      } finally {
        setProfileUploading(false);
      }
    } else {
      const reader = new FileReader();
      reader.onloadend = () => setTempProfile(prev => ({ ...prev, image: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleShopPhotoChange = async (restaurantId, event) => {
    const file = event.target.files[0];
    if (!file) return;
    const applyUpdate = (imageData) => {
      setRestaurants(prev => prev.map(r => {
        if (r.id !== restaurantId) return r;
        const updated = { ...r, image: imageData };
        if (FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
        return updated;
      }));
      notifySystem('สำเร็จ', 'อัปเดตรูปหน้าร้านเรียบร้อย', 'success');
    };
    if (FIREBASE_ENABLED) {
      notifySystem('กำลังอัปโหลด', 'กำลังอัปโหลดรูปภาพ...', 'info');
      try {
        const compressed = await compressImage(file, 800, 600, 0.75).catch(() => file);
        const url = await uploadShopPhoto(restaurantId, compressed);
        applyUpdate(url);
      } catch {
        notifySystem('ผิดพลาด', 'อัปโหลดรูปร้านไม่สำเร็จ', 'error');
      }
    } else {
      notifySystem('กำลังประมวลผล', 'กำลังบีบอัดรูปภาพ...', 'info');
      compressImage(file, 800, 600, 0.75)
        .then(compressed => applyUpdate(compressed))
        .catch(() => notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error'));
    }
  };

  const handleRegistrationPhotoSelect = (event, setForm, field) => {
    const file = event.target.files[0];
    if (!file) {
      setForm(prev => ({ ...prev, [field]: null, [`_${field}File`]: null }));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () =>
      setForm(prev => ({ ...prev, [field]: reader.result, [`_${field}File`]: file }));
    reader.readAsDataURL(file);
  };

  const handleTopUpSlipSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (FIREBASE_ENABLED) {
      const uid = currentUser?.id || userProfile?.id;
      notifySystem('กำลังอัปโหลด', 'กำลังอัปโหลดสลิป...', 'info');
      try {
        const compressed = await compressImage(file, 1024, 1400, 0.85).catch(() => file);
        const url = await uploadTopUpSlip(uid, compressed);
        setTopUpSlip(url);
      } catch {
        notifySystem('ผิดพลาด', 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่', 'error');
      }
    } else {
      compressImage(file, 1024, 1400, 0.8)
        .then(compressed => setTopUpSlip(compressed))
        .catch(() => {
          const reader = new FileReader();
          reader.onloadend = () => setTopUpSlip(reader.result);
          reader.readAsDataURL(file);
        });
    }
  };

  const handleMenuPhotoSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setEditForm(prev => ({ ...prev, _imageUploading: true }));
    if (FIREBASE_ENABLED) {
      const uid    = currentUser?.id || userProfile?.id;
      const shopId = restaurants.find(r => r.ownerId === uid)?.id || 'unknown';
      const itemId = (isEditingMenu && isEditingMenu !== 'new') ? isEditingMenu : `item_${Date.now()}`;
      try {
        const compressed = await compressImage(file, 400, 400, 0.65).catch(() => file);
        const url = await uploadMenuPhoto(shopId, itemId, compressed);
        setEditForm(prev => ({ ...prev, image: url, _imageUploading: false }));
      } catch {
        setEditForm(prev => ({ ...prev, _imageUploading: false }));
        notifySystem('ผิดพลาด', 'อัปโหลดรูปเมนูไม่สำเร็จ', 'error');
      }
    } else {
      compressImage(file, 400, 400, 0.65)
        .then(compressed => setEditForm(prev => ({ ...prev, image: compressed, _imageUploading: false })))
        .catch(() => {
          setEditForm(prev => ({ ...prev, _imageUploading: false }));
          notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error');
        });
    }
  };

  const openImagePreview = (url) => {
    setPreviewImageUrl(url);
    setShowImageModal(true);
  };

  return {
    profileUploading,
    handleProfilePhotoChange,
    handleShopPhotoChange,
    handleRegistrationPhotoSelect,
    handleTopUpSlipSelect,
    handleMenuPhotoSelect,
    openImagePreview,
  };
}
