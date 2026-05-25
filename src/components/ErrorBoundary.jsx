import React from 'react';

// localStorage keys ที่อาจมีข้อมูลเสีย — ล้างก่อน reload เพื่อหยุด crash loop
const CACHE_KEYS = [
  'boomrider_orders',
  'boomrider_pending_requests',
  'boomrider_riders',
  'boomrider_restaurants',
  'boomrider_menu_items',
  'boomrider_appconfig',
];

function clearCacheAndReload() {
  CACHE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  window.location.reload();
}

/**
 * ErrorBoundary — ป้องกันหน้าจอขาวเมื่อเกิด rendering error
 * ครอบ App ทั้งหมดใน main.jsx
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  handleRetry = () => {
    // ลอง reset state ก่อน (ไม่ล้าง localStorage) — อาจพอ
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      const triedOnce = this.state.retryCount > 0;
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 32, textAlign: 'center',
          fontFamily: "'Noto Sans Thai', 'Inter', sans-serif",
          background: 'linear-gradient(160deg,#fff7ed 0%,#fff 40%,#eff6ff 100%)',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#ef4444', fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
            เกิดข้อผิดพลาดในแอป
          </h2>
          <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 320, lineHeight: 1.6 }}>
            {triedOnce
              ? 'ยังไม่สามารถโหลดแอปได้ กรุณากดปุ่มด้านล่างเพื่อล้างข้อมูลชั่วคราวและโหลดใหม่'
              : 'ข้อมูลที่แสดงผลอาจมีปัญหา\nกรุณาลองโหลดหน้าใหม่อีกครั้ง'}
          </p>

          {/* ลอง retry ก่อน (ไม่ล้าง localStorage) */}
          {!triedOnce && (
            <button
              onClick={this.handleRetry}
              style={{
                background: 'linear-gradient(to right,#f97316,#ea580c)',
                color: 'white', border: 'none', borderRadius: 14,
                padding: '14px 36px', fontWeight: 'bold', fontSize: 16,
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(249,115,22,0.3)',
                marginBottom: 12,
              }}
            >
              🔄 ลองใหม่
            </button>
          )}

          {/* ถ้า retry ไม่ได้ → ล้าง cache แล้ว reload */}
          <button
            onClick={clearCacheAndReload}
            style={{
              background: triedOnce
                ? 'linear-gradient(to right,#f97316,#ea580c)'
                : 'transparent',
              color: triedOnce ? 'white' : '#9ca3af',
              border: triedOnce ? 'none' : '1px solid #e5e7eb',
              borderRadius: 14,
              padding: '12px 28px', fontWeight: 'bold', fontSize: triedOnce ? 16 : 13,
              cursor: 'pointer',
              boxShadow: triedOnce ? '0 4px 12px rgba(249,115,22,0.3)' : 'none',
            }}
          >
            {triedOnce ? '🗑️ ล้างข้อมูลและโหลดใหม่' : 'ล้างข้อมูล cache แล้วโหลดใหม่'}
          </button>

          {import.meta.env.DEV && this.state.error && (
            <details style={{ marginTop: 20, textAlign: 'left', fontSize: 11, color: '#9ca3af', maxWidth: 400 }}>
              <summary style={{ cursor: 'pointer' }}>รายละเอียด (DEV)</summary>
              <pre style={{ overflow: 'auto', marginTop: 8, background: '#f9fafb', padding: 8, borderRadius: 8 }}>
                {String(this.state.error)}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
