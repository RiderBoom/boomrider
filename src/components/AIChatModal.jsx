import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Bot, Send, Loader2, Sparkles, User } from 'lucide-react';
import { useApp } from '../context/AppContext';

const SYSTEM_PROMPT = `คุณคือ "น้องบูม (BoomBot)" ผู้ช่วยอัจฉริยะ AI ประจำแอปพลิเคชัน BoomRider (บริการสั่งอาหารและส่งพัสดุในประเทศไทย)
หน้าที่ของคุณคือบริการและช่วยเหลือผู้ใช้ด้วยความเป็นกันเอง สุภาพ มีหางเสียง (ครับ/ค่ะ)
ข้อมูลของแอป BoomRider:
- สั่งอาหาร: เลือกร้าน ชำระเงินด้วย Wallet หรือเงินสด
- ส่งพัสดุ: ปักหมุดจุดรับ-จุดส่ง คำนวณค่าส่งตามระยะทาง
- ระบบ Wallet: เติมเงิน ถอนเงิน ชำระเงินสะดวก
- ตอบคำถามสั้นกระชับ ชัดเจน เข้าใจง่าย ภาษาไทยเสมอ`;

export default function AIChatModal({ isOpen, onClose }) {
  const { userProfile, orders, userWallet } = useApp();
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: `สวัสดีครับคุณ ${userProfile?.name || 'ลูกค้า'}! 🛵✨ ผมน้องบูม AI Assistant มีอะไรให้ผมช่วยเหลือวันนี้ไหมครับ?`,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (!isOpen) return null;

  const quickPrompts = [
    '📦 เช็คสถานะออเดอร์',
    '🍔 แนะนำร้านอาหารอร่อย',
    '💳 สอบถามยอดเงิน Wallet',
    '❓ วิธีเรียกส่งพัสดุ',
  ];

  const handleSend = async (textToSend) => {
    const text = textToSend || inputText.trim();
    if (!text || loading) return;

    const userMsg = {
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      let replyText = '';

      // Check context based quick answers or Gemini API
      if (text.includes('สถานะออเดอร์') || text.includes('เช็คออเดอร์')) {
        const activeOrders = orders?.filter((o) => o.status !== 'completed' && o.status !== 'cancelled') || [];
        if (activeOrders.length === 0) {
          replyText = 'ขณะนี้คุณไม่มีออเดอร์ที่กำลังดำเนินการอยู่ครับ สามารถเลือกสั่งอาหารหรือส่งพัสดุได้เลยครับ 🛵';
        } else {
          const latest = activeOrders[0];
          const statusMap = {
            pending: 'รอร้านค้ารับออเดอร์',
            accepted: 'ร้านค้ากำลังเตรียมสินค้า/อาหาร',
            ready_to_pickup: 'รอไรเดอร์เข้ารับสินค้า',
            delivering: 'ไรเดอร์กำลังเดินทางไปส่ง',
          };
          replyText = `ออเดอร์ #${latest.id.slice(-6)} (${latest.type === 'parcel' ? 'ส่งพัสดุ' : 'อาหาร'})\nสถานะปัจจุบัน: ${
            statusMap[latest.status] || latest.status
          }\nยอดรวม: ฿${latest.total || latest.amount || 0}`;
        }
      } else if (text.includes('Wallet') || text.includes('ยอดเงิน')) {
        replyText = `ยอดเงินใน Wallet ของคุณในปัจจุบันคือ ฿${(userWallet?.balance || 0).toLocaleString()} ครับ สามารถใช้ชำระค่าอาหารและค่าส่งพัสดุได้ทันที! 💳`;
      } else if (text.includes('ส่งพัสดุ')) {
        replyText = 'วิธีการเรียกส่งพัสดุง่ายๆ ครับ:\n1. ไปที่แท็บ "ส่งพัสดุ"\n2. ปักหมุดจุดรับของ และ จุดส่งของ บนแผนที่\n3. ใส่รายละเอียดพัสดุและเบอร์ผู้รับ\n4. กดยืนยันการเรียกไรเดอร์ได้เลยครับ 📦';
      } else if (apiKey) {
        // Call Google Gemini 2.0 Flash / 1.5 Flash Free API
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${SYSTEM_PROMPT}\n\nผู้ใช้พูดว่า: "${text}"` }],
                },
              ],
            }),
          }
        );
        const data = await response.json();
        replyText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          'ขออภัยครับ เกิดปัญหาในการประมวลผล กรุณาลองใหม่อีกครั้งครับ';
      } else {
        // Smart fallback logic
        replyText = `น้องบูมยินดีรับฟังครับ! สำหรับเรื่อง "${text}" สามารถสอบถามเรื่อง สั่งอาหาร, ส่งพัสดุ, หรือเช็คยอดเงิน Wallet กับผมได้เลยครับ 🛵✨`;
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: replyText,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: 'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งครับ',
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const portal = document.getElementById('modal-root') || document.body;

  const modal = (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center z-[99999] p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md h-[85vh] sm:h-[560px] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up border border-purple-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 p-4 text-white shadow-md flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-2xl backdrop-blur-md border border-white/20">
              <Bot size={22} className="text-purple-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-base">น้องบูม AI Assistant</h3>
                <Sparkles size={14} className="text-amber-300 animate-pulse" />
              </div>
              <p className="text-[11px] text-purple-200">ผู้ช่วยอัจฉริยะ 24 ชม.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto bg-slate-50 space-y-3">
          {messages.map((msg, idx) => {
            const isBot = msg.sender === 'bot';
            return (
              <div
                key={idx}
                className={`flex gap-2 ${isBot ? 'items-start' : 'items-end justify-end'}`}
              >
                {isBot && (
                  <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs shrink-0 mt-1 shadow-sm">
                    <Bot size={15} />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow-sm ${
                    isBot
                      ? 'bg-white text-gray-800 rounded-tl-xs border border-purple-50/80'
                      : 'bg-purple-600 text-white rounded-tr-xs'
                  }`}
                >
                  {msg.text}
                  <span
                    className={`block text-[9px] mt-1 text-right ${
                      isBot ? 'text-gray-400' : 'text-purple-200'
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
                {!isBot && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs shrink-0 shadow-sm">
                    <User size={15} />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-2 items-center text-xs text-purple-600 bg-purple-50 p-3 rounded-2xl w-fit animate-pulse border border-purple-100">
              <Loader2 size={16} className="animate-spin" />
              <span>น้องบูมกำลังพิมพ์...</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick Prompts */}
        <div className="px-3 py-2 bg-slate-100 border-t border-slate-200/60 overflow-x-auto flex gap-2 no-scrollbar shrink-0">
          {quickPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(prompt.replace(/^[^\s]+\s/, ''))}
              className="px-3 py-1.5 bg-white hover:bg-purple-50 text-purple-700 text-[11px] font-medium rounded-full border border-purple-200/80 shrink-0 shadow-xs transition-colors active:scale-95"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="พิมพ์คำถามถึงน้องบูม AI..."
            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!inputText.trim() || loading}
            className="bg-purple-600 hover:bg-purple-700 text-white p-2.5 rounded-full shadow-md transition-all active:scale-95 disabled:opacity-40 shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, portal);
}
