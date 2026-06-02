import { useEffect, useRef } from 'react';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';

export default function PromptPayQR({ promptPayId, amount, size = 160 }) {
  const canvasRef = useRef();

  useEffect(() => {
    if (!promptPayId || !canvasRef.current) return;
    const payload = generatePayload(promptPayId, { amount: amount > 0 ? amount : undefined });
    QRCode.toCanvas(canvasRef.current, payload, {
      width: size,
      margin: 1,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });
  }, [promptPayId, amount, size]);

  if (!promptPayId) {
    return (
      <div
        style={{ width: size, height: size }}
        className="bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs text-center p-2"
      >
        ยังไม่ตั้งค่า PromptPay
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded-lg" />;
}
