import { useState } from 'react';
import { compressImage } from '../../utils';

export function usePhotoHandlers({
  setTempProfile, setRestaurants, setEditForm, setTopUpSlip,
  setShowImageModal, setPreviewImageUrl,
  notifySystem,
}) {
  const [profileUploading] = useState(false);

  const handleProfilePhotoChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setTempProfile(prev => ({ ...prev, image: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleShopPhotoChange = (restaurantId, event) => {
    const file = event.target.files[0];
    if (!file) return;
    notifySystem('กำลังประมวลผล', 'กำลังบีบอัดรูปภาพ...', 'info');
    compressImage(file, 800, 600, 0.75)
      .then(compressed => {
        setRestaurants(prev => prev.map(r => r.id === restaurantId ? { ...r, image: compressed } : r));
        notifySystem('สำเร็จ', 'อัปเดตรูปหน้าร้านเรียบร้อย', 'success');
      })
      .catch(() => notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error'));
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

  const handleTopUpSlipSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    compressImage(file, 1024, 1400, 0.8)
      .then(compressed => setTopUpSlip(compressed))
      .catch(() => {
        const reader = new FileReader();
        reader.onloadend = () => setTopUpSlip(reader.result);
        reader.readAsDataURL(file);
      });
  };

  const handleMenuPhotoSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setEditForm(prev => ({ ...prev, _imageUploading: true }));
    compressImage(file, 400, 400, 0.65)
      .then(compressed => setEditForm(prev => ({ ...prev, image: compressed, _imageUploading: false })))
      .catch(() => {
        setEditForm(prev => ({ ...prev, _imageUploading: false }));
        notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error');
      });
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
