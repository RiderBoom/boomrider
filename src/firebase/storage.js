import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config';

// ===== Generic Upload =====

export const uploadFile = async (file, path) => {
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
};

// ===== Upload with Progress =====

export const uploadFileWithProgress = (file, path, onProgress) =>
  new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      'state_changed',
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress?.(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });

// ===== Profile Photo =====

export const uploadProfilePhoto = (userId, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `users/${userId}/profile.jpg`);

// ===== Shop Photo =====

export const uploadShopPhoto = (shopId, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `shops/${shopId}/cover.jpg`);

// ===== ID Card (KYC) =====

export const uploadIdCard = (userId, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `kyc/${userId}/id_card.jpg`);

// ===== Top-up Slip =====

export const uploadTopUpSlip = (userId, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `slips/${userId}/topup_${Date.now()}.jpg`);

// ===== Delivery Proof Photo =====

export const uploadDeliveryProof = (orderId, type, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `orders/${orderId}/${type}_proof.jpg`);

// ===== Menu Item Photo =====

export const uploadMenuPhoto = (shopId, itemId, fileOrDataUrl) =>
  uploadImageAuto(fileOrDataUrl, `menus/${shopId}/${itemId}.jpg`);

// ===== Upload from base64 Data URL =====

/**
 * Upload a base64 data URL to Firebase Storage and return the download URL.
 * Used when we only have a base64 string (e.g. from FileReader.readAsDataURL).
 */
export const uploadDataUrl = async (dataUrl, path) => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, blob);
  return getDownloadURL(snapshot.ref);
};

// ===== Delete File =====

export const deleteFile = async (path) => {
  try {
    await deleteObject(ref(storage, path));
  } catch (_) { /* ignore if not found */ }
};

// ===== Upload Image (File | Blob | base64 data URL) =====
// ใช้แทน raw FileReader base64 ก่อน save ลง Firestore
// - ถ้าเป็น https:// อยู่แล้ว → คืน URL เดิมโดยไม่อัปโหลดซ้ำ
// - ถ้าเป็น data:image → แปลงเป็น Blob แล้ว upload
// - ถ้าเป็น File/Blob → upload ตรง
export const uploadImageAuto = async (fileOrDataUrl, path) => {
  if (!fileOrDataUrl) return null;
  if (typeof fileOrDataUrl === 'string') {
    if (fileOrDataUrl.startsWith('https://')) return fileOrDataUrl;
    if (fileOrDataUrl.startsWith('data:'))   return uploadDataUrl(fileOrDataUrl, path);
    return null;
  }
  if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
    return uploadFile(fileOrDataUrl, path);
  }
  return null;
};
