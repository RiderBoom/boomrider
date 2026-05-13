import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { auth } from './config';

// ===== Email/Password =====

export const registerWithEmail = async (email, password, displayName) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
};

export const loginWithEmail = async (email, password) => {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
};

// ===== Google OAuth =====

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

// ===== Phone OTP =====

export const setupRecaptcha = (containerId) => {
  if (window.recaptchaVerifier) {
    window.recaptchaVerifier.clear();
  }
  window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {},
  });
  return window.recaptchaVerifier;
};

export const sendOTP = async (phoneNumber, appVerifier) => {
  const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
  window.confirmationResult = confirmation;
  return confirmation;
};

export const verifyOTP = async (otp) => {
  if (!window.confirmationResult) throw new Error('No OTP pending');
  const cred = await window.confirmationResult.confirm(otp);
  return cred.user;
};

// ===== Logout =====

export const logout = () => signOut(auth);

// ===== Auth State Listener =====

export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);
