import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import ToastContainer from '../components/ToastContainer';

export default function AuthView() {
  const {
    authMode, setAuthMode,
    loginForm, setLoginForm,
    registerForm, setRegisterForm,
    handleLogin, handleRegister,
    authLoading,
    toasts, removeToast,
  } = useApp();
  const [showForgot, setShowForgot] = useState(false);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #fff7ed 0%, #fff 40%, #eff6ff 100%)' }}>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
        <div className="mb-8 text-center animate-fade-in-down">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-orange-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-orange-200">
            <span className="text-4xl">🛵</span>
          </div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">BoomRider</h1>
          <p className="text-gray-500 mt-1 text-sm">ส่งเร็ว ส่งถึง ส่งใจ</p>
        </div>
        <div className="flex gap-2 mb-8 flex-wrap justify-center animate-fade-in-up">
          {['🍔 อาหารร้อนๆ', '📦 ส่งพัสดุ', '⚡ เร็วใน 30 นาที'].map((chip) => (
            <span key={chip} className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1 rounded-full shadow-sm font-medium">
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* Auth Card */}
      <div className="bg-white rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.12)] px-6 pt-6 pb-10 animate-slide-in-from-bottom">
        <div className="flex mb-5 bg-gray-100 rounded-2xl p-1">
          <button
            onClick={() => setAuthMode('login')}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${authMode === 'login' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-500'}`}
          >เข้าสู่ระบบ</button>
          <button
            onClick={() => setAuthMode('register')}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${authMode === 'register' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-500'}`}
          >สมัครใช้งาน</button>
        </div>

        {authMode === 'login' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">เบอร์โทร หรือ อีเมล</label>
              <input
                type="text"
                value={loginForm.phone || loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, phone: e.target.value, email: e.target.value })}
                className="input-field"
                placeholder="081-xxx-xxxx หรือ email@example.com"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">รหัสผ่าน</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="input-field"
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <button
              onClick={handleLogin}
              disabled={authLoading}
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2 disabled:opacity-60"
            >{authLoading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="w-full text-center text-xs text-orange-500 font-medium mt-1 py-1"
            >ลืมรหัสผ่าน?</button>
          </div>
        ) : (
          <div className="space-y-3">
            {[
              { label: 'ชื่อ-นามสกุล *', type: 'text', field: 'name', placeholder: 'ชื่อจริง นามสกุล', autoComplete: 'name' },
              { label: 'อีเมล *', type: 'email', field: 'email', placeholder: 'email@example.com', autoComplete: 'email' },
              { label: 'เบอร์โทรศัพท์ (ไม่บังคับ)', type: 'tel', field: 'phone', placeholder: '081-xxx-xxxx', autoComplete: 'tel' },
              { label: 'รหัสผ่าน * (6 ตัวขึ้นไป)', type: 'password', field: 'password', placeholder: '••••••••', autoComplete: 'new-password' },
              { label: 'ยืนยันรหัสผ่าน *', type: 'password', field: 'confirmPassword', placeholder: '••••••••', autoComplete: 'new-password' },
            ].map(({ label, type, field, placeholder, autoComplete }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">{label}</label>
                <input
                  type={type}
                  value={registerForm[field]}
                  onChange={(e) => setRegisterForm({ ...registerForm, [field]: e.target.value })}
                  className="input-field"
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                />
              </div>
            ))}
            <button
              onClick={handleRegister}
              disabled={authLoading}
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2 disabled:opacity-60"
            >{authLoading ? 'กำลังสมัคร...' : 'สมัครใช้งานฟรี'}</button>
          </div>
        )}

        <p className="text-center text-[11px] text-gray-400 mt-4">
          การเข้าสู่ระบบแสดงว่าคุณยอมรับ
          <span className="text-orange-500 font-medium"> นโยบายความเป็นส่วนตัว</span> ของเรา
        </p>
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={() => setShowForgot(false)}>
          <div className="bg-white rounded-t-3xl w-full max-w-md px-6 pt-6 pb-10 animate-slide-in-from-bottom" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <h2 className="text-lg font-bold text-gray-900 mb-2">ลืมรหัสผ่าน?</h2>
            <p className="text-sm text-gray-500 mb-4">
              ระบบนี้ไม่มีการรีเซ็ตรหัสผ่านอัตโนมัติ<br />
              กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัสผ่านให้คุณ
            </p>
            <div className="bg-orange-50 rounded-2xl p-4 mb-5">
              <p className="text-xs font-semibold text-orange-700 mb-1">ช่องทางติดต่อผู้ดูแล</p>
              <p className="text-sm text-orange-600 font-medium">boomzalnw2@gmail.com</p>
            </div>
            <button
              onClick={() => setShowForgot(false)}
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3 rounded-2xl font-bold text-sm"
            >รับทราบ</button>
          </div>
        </div>
      )}
    </div>
  );
}
