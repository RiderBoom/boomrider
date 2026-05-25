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

export const uploadProfilePhoto = (userId, file) =>
  uploadFile(file, `users/${userId}/profile.${file.name.split('.').pop()}`);

// ===== Shop Photo =====

export const uploadShopPhoto = (shopId, file) =>
  uploadFile(file, `shops/${shopId}/cover.${file.name.split('.').pop()}`);

// ===== ID Card (KYC) =====

export const uploadIdCard = (userId, file) =>
  uploadFile(file, `kyc/${userId}/id_card.${file.name.split('.').pop()}`);

// ===== Top-up Slip =====

export const uploadTopUpSlip = (userId, file) => {
  const ts = Date.now();
  return uploadFile(file, `slips/${userId}/topup_${ts}.${file.name.split('.').pop()}`);
};

// ===== Delivery Proof Photo =====

export const uploadDeliveryProof = (orderId, type, file) =>
  uploadFile(file, `orders/${orderId}/${type}_proof.${file.name.split('.').pop()}`);

// ===== Menu Item Photo =====

export const uploadMenuPhoto = (shopId, itemId, file) =>
  uploadFile(file, `menus/${shopId}/${itemId}.${file.name.split('.').pop()}`);

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
