import { lazy, Suspense } from 'react';

// AppShell pulls in AppContext → Firebase SDK.
// Dynamic import keeps vendor-firebase out of the initial modulepreload list,
// so the login screen paints before the 471 KB Firebase chunk is fetched.
const AppShell = lazy(() => import('./AppShell'));

function BootSpinner() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-orange-400 to-orange-600">
      <div className="text-white text-2xl font-black tracking-tight mb-6">🛵 BoomRider</div>
      <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<BootSpinner />}>
      <AppShell />
    </Suspense>
  );
}
