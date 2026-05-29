import React, { useEffect, useState } from 'react';
import { X, Download, Share } from 'lucide-react';

const DISMISSED_KEY = 'boomrider_install_dismissed';
const DISMISSED_TTL = 7 * 24 * 60 * 60 * 1000; // 7 วัน

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function isDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - parseInt(raw, 10) < DISMISSED_TTL;
  } catch {
    return false;
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {}
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode()) return;
    if (isDismissed()) return;

    if (isIOS()) {
      setShowBanner(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function handleInstall() {
    if (isIOS()) {
      setShowIOSHint(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null);
      setShowBanner(false);
    });
  }

  function handleDismiss() {
    saveDismissed();
    setShowBanner(false);
    setShowIOSHint(false);
  }

  if (!showBanner) return null;

  return (
    <>
      {/* แบนเนอร์หลัก */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="bg-white rounded-2xl shadow-2xl border border-orange-100 overflow-hidden">
          {/* แถบสีส้มด้านบน */}
          <div className="h-1 bg-gradient-to-r from-orange-400 to-orange-600" />

          <div className="relative flex items-center gap-3 p-4">
            {/* ไอคอนแอป */}
            <img
              src="/icons/icon-96.png"
              alt="BoomRider"
              className="w-14 h-14 rounded-2xl shadow-md flex-shrink-0"
            />

            {/* ข้อความ */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-tight">
                BoomRider
              </p>
              <p className="text-gray-500 text-xs mt-0.5 leading-tight">
                ติดตั้งแอปเพื่อประสบการณ์ที่ดีกว่า
              </p>
              <p className="text-orange-500 text-xs mt-0.5">
                ฟรี · ไม่ใช้พื้นที่เยอะ · เร็วกว่าเบราว์เซอร์
              </p>
            </div>

            {/* ปุ่ม */}
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                <Download size={14} />
                ติดตั้ง
              </button>
              <button
                onClick={handleDismiss}
                className="text-gray-400 text-xs text-center hover:text-gray-600 transition-colors"
              >
                ไม่ขอบคุณ
              </button>
            </div>

            {/* ปุ่มปิด */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition-colors"
              aria-label="ปิด"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* คำแนะนำ iOS "Add to Home Screen" */}
      {showIOSHint && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-orange-400 to-orange-600" />
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                <p className="font-bold text-gray-900">วิธีติดตั้งบน iPhone / iPad</p>
                <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              <ol className="space-y-3 text-sm text-gray-700">
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>
                    แตะปุ่ม <Share size={14} className="inline text-blue-500 mx-0.5" />
                    <strong> แชร์</strong> ที่แถบเมนูด้านล่างของ Safari
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>เลื่อนลงแล้วเลือก <strong>"เพิ่มในหน้าจอโฮม"</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>แตะ <strong>"เพิ่ม"</strong> ที่มุมขวาบน</span>
                </li>
              </ol>
              <button
                onClick={handleDismiss}
                className="mt-5 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                เข้าใจแล้ว
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
