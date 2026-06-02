import React, { lazy, Suspense } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import ToastContainer from './components/ToastContainer';
import ChatModal from './components/ChatModal';
import InstallBanner from './components/InstallBanner';
import AuthView from './views/AuthView';

// Lazy load — แต่ละ role โหลด chunk ของตัวเองเมื่อ login ครั้งแรก
// ลด initial bundle จาก 1.1 MB → ~300 KB
const CustomerView = lazy(() => import('./views/CustomerView'));
const MerchantView = lazy(() => import('./views/MerchantView'));
const RiderView    = lazy(() => import('./views/RiderView'));
const AdminView    = lazy(() => import('./views/AdminView'));

function ViewLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-orange-400 to-orange-600">
      <div className="text-white text-2xl font-black tracking-tight mb-6">🛵 BoomRider</div>
      <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
}

function RoleSwitcher() {
  const { activeRole, setActiveRole, pendingRequests, isAdmin } = useApp();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed top-0 left-0 right-0 bg-gray-900 text-white p-2 z-50 flex justify-between items-center text-xs sm:text-sm shadow-md overflow-x-auto">
      <span className="font-bold mr-2 whitespace-nowrap hidden sm:block">DEV MODE:</span>
      <div className="flex space-x-2">
        {isAdmin && (
          <button onClick={() => setActiveRole('admin')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'admin' ? 'bg-red-500 font-bold' : 'bg-gray-700'}`}>
            Admin {pendingRequests.length > 0 && <span className="ml-1 bg-white text-red-600 px-1 rounded-full text-[10px]">{pendingRequests.length}</span>}
          </button>
        )}
        <button onClick={() => setActiveRole('customer')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'customer' ? 'bg-green-500 font-bold' : 'bg-gray-700'}`}>Customer</button>
      </div>
    </div>
  );
}

function AppRouter() {
  const {
    isLoggedIn, activeRole,
    toasts, removeToast,
  } = useApp();

  return (
    /* #app-scroll คือ scroll container เดียวของทั้งแอป
       mouse wheel / touchpad / touch ทั้งหมดถูกรับที่นี่ */
    <div
      id="app-scroll"
      style={{ fontFamily: "'Noto Sans Thai', 'Inter', sans-serif" }}
    >
      <RoleSwitcher />
      <InstallBanner />
      {!isLoggedIn ? (
        <AuthView />
      ) : (
        <>
          <ToastContainer toasts={toasts} removeToast={removeToast} />
          <ChatModal />
          <Suspense fallback={<ViewLoader />}>
            {activeRole === 'customer' && <CustomerView />}
            {activeRole === 'merchant' && <MerchantView />}
            {activeRole === 'rider'    && <RiderView />}
            {activeRole === 'admin'    && <AdminView />}
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
