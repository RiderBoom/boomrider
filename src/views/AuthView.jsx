import React from 'react';
import { Phone, Mail } from 'lucide-react';
import { useApp } from '../context/AppContext';
import ToastContainer from '../components/ToastContainer';
import { FIREBASE_ENABLED } from '../constants';

export default function AuthView() {
  const {
    authMode, setAuthMode,
    loginForm, setLoginForm,
    registerForm, setRegisterForm,
    handleLogin, handleLoginWithGoogle, handleRegister,
    toasts, removeToast,
  } = useApp();

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
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2"
            >เข้าสู่ระบบ</button>
          </div>
        ) : (
          <div className="space-y-3">
            {[
              { label: 'ชื่อ-นามสกุล *', type: 'text', field: 'name', placeholder: 'ชื่อจริง นามสกุล', autoComplete: 'name' },
              { label: FIREBASE_ENABLED ? 'อีเมล *' : 'อีเมล (ไม่บังคับ)', type: 'email', field: 'email', placeholder: 'email@example.com', autoComplete: 'email' },
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
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2"
            >สมัครใช้งานฟรี</button>
          </div>
        )}

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-400 mb-2">หรือเข้าสู่ระบบด้วย</p>
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 rounded-xl py-2.5 text-sm font-medium text-gray-600 active:bg-gray-100 transition-colors">
              <Phone size={16} className="text-green-600" /> เบอร์โทร
            </button>
            <button onClick={handleLoginWithGoogle} className="flex-1 flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 rounded-xl py-2.5 text-sm font-medium text-gray-600 active:bg-gray-100 transition-colors">
              <Mail size={16} className="text-red-500" /> Google
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          การเข้าสู่ระบบแสดงว่าคุณยอมรับ
          <span className="text-orange-500 font-medium"> นโยบายความเป็นส่วนตัว</span> ของเรา
        </p>
      </div>
    </div>
  );
}
