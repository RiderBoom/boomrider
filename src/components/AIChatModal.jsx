import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Bot, Send, Loader2, Sparkles, User } from 'lucide-react';
import { useApp } from '../context/AppContext';

const STATUS_MAP = {
  pending: 'รอร้านค้ารับออเดอร์',
  preparing: 'ร้านกำลังเตรียมอาหาร',
  ready_to_pickup: 'รอไรเดอร์เข้ารับสินค้า',
  rider_accepted: 'ไรเดอร์รับงานแล้ว',
  picking_up: 'ไรเดอร์กำลังรับสินค้า',
  delivering: 'ไรเดอร์กำลังเดินทางไปส่ง',
  delivered: 'จัดส่งแล้ว (รอคุณยืนยัน)',
  completed: 'เสร็จสิ้นเรียบร้อย',
  cancelled: 'ยกเลิกแล้ว',
};

export default function AIChatModal({ isOpen, onClose }) {
  const { userProfile, orders, userWallet, restaurants, activeRole } = useApp();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Initialize initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          sender: 'bot',
          text: `สวัสดีครับคุณ ${userProfile?.name || 'ลูกค้า'}! 🛵✨ ผมน้องบูม AI Assistant พร้อมดึงข้อมูลออเดอร์ ยอดเงิน Wallet และร้านอาหารมาช่วยดูแลคุณครับ วันนี้มีอะไรให้ผมช่วยไหมครับ?`,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [userProfile?.name, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (!isOpen) return null;

  const quickPrompts = [
    '📦 เช็คสถานะออเดอร์',
    '💳 สอบถามยอดเงิน Wallet',
    '🍔 แนะนำร้านอาหารอร่อย',
    '❓ วิธีเรียกส่งพัสดุ',
  ];

  // Get user's own active and recent orders
  const myOrders = (orders || []).filter(
    (o) => o.customerId === userProfile?.id || o.riderUserId === userProfile?.id
  );
  const activeOrders = myOrders.filter(
    (o) => o.status !== 'completed' && o.status !== 'cancelled'
  );

  // Format real-time context for System Prompt
  const buildContextPrompt = () => {
    const walletBalance = typeof userWallet === 'number' ? userWallet : 0;
    const activeOrderSummary = activeOrders.map((o, idx) => {
      const typeStr = o.type === 'parcel' ? 'ส่งพัสดุ' : `สั่งอาหาร (${o.restaurantName || 'ร้านค้า'})`;
      const statusStr = STATUS_MAP[o.status] || o.status;
      const riderStr = o.riderName ? ` | ไรเดอร์: ${o.riderName}` : '';
      return `${idx + 1}. ออเดอร์ #${o.id.slice(-6)} [${typeStr}] - สถานะ: ${statusStr} - ยอดรวม: ฿${o.total || o.amount || 0}${riderStr}`;
    }).join('\n');

    const openShops = (restaurants || [])
      .filter((r) => r.status === 'open')
      .slice(0, 5)
      .map((r) => `- ${r.name} (⭐ ${r.rating || 5.0}, ค่าส่ง ฿${r.deliveryFee ?? 15})`)
      .join('\n');

    return `คุณคือ "น้องบูม (BoomBot)" AI Assistant ประจำแอปพลิเคชัน BoomRider
หน้าที่ของคุณคือช่วยเหลือผู้ใช้อย่างเป็นกันเอง สุภาพ มีหางเสียง (ครับ/ค่ะ) โดยอ้างอิงข้อมูลจริงจากระบบดังนี้:

[ข้อมูลผู้ใช้ปัจจุบัน]
- ชื่อ: ${userProfile?.name || 'ลูกค้า'}
- เบอร์โทร: ${userProfile?.phone || 'ไม่ระบุ'}
- บทบาท: ${activeRole || 'customer'}
- ยอดเงินคงเหลือใน Wallet: ฿${walletBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

[สถานะออเดอร์ปัจจุบันของคุณ (${activeOrders.length} รายการ)]
${activeOrderSummary || 'ไม่มีออเดอร์ที่กำลังดำเนินการในขณะนี้'}

[ร้านอาหารที่เปิดให้บริการขณะนี้]
${openShops || 'ไม่มีข้อมูลร้านค้า'}

คำสั่งสถิติตอบให้ตรงกับข้อมูลจริงด้านบนเสมอ หากผู้ใช้ถามเรื่องยอดเงิน ให้ตอบ ฿${walletBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} หากถามออเดอร์ ให้ระบุสถานะและเลขท้ายออเดอร์ตรงตามข้อมูลจริงสั้นกระชับเข้าใจง่ายครับ`;
  };

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
      const walletBalance = typeof userWallet === 'number' ? userWallet : 0;

      // Direct intent checks with real system context
      if (text.includes('สถานะออเดอร์') || text.includes('เช็คออเดอร์')) {
        if (activeOrders.length === 0) {
          replyText = 'ขณะนี้คุณไม่มีออเดอร์ที่กำลังดำเนินการอยู่ครับ สามารถเลือกสั่งอาหารหรือส่งพัสดุได้เลยครับ 🛵';
        } else {
          const listStr = activeOrders
            .map((o) => {
              const typeStr = o.type === 'parcel' ? '📦 ส่งพัสดุ' : `🍔 สั่งอาหารจาก ${o.restaurantName || 'ร้านค้า'}`;
              const statusText = STATUS_MAP[o.status] || o.status;
              const riderInfo = o.riderName ? `\n   🛵 ไรเดอร์: ${o.riderName} (${o.riderPhone || ''})` : '';
              return `• ออเดอร์ #${o.id.slice(-6)} (${typeStr})\n   📌 สถานะ: ${statusText}\n   💰 ยอดรวม: ฿${o.total || o.amount || 0}${riderInfo}`;
            })
            .join('\n\n');
          replyText = `ขณะนี้คุณมีออเดอร์กำลังดำเนินการ ${activeOrders.length} รายการครับ:\n\n${listStr}`;
        }
      } else if (text.includes('Wallet') || text.includes('ยอดเงิน')) {
        replyText = `ยอดเงินคงเหลือใน Wallet ของคุณ ${userProfile?.name || ''} ในขณะนี้คือ ฿${walletBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ครับ 💳\n\nสามารถใช้ชำระค่าอาหารและค่าส่งพัสดุได้ทันทีเลยครับ!`;
      } else if (text.includes('ร้านอาหาร') || text.includes('แนะนำร้าน')) {
        const openShops = (restaurants || []).filter((r) => r.status === 'open');
        if (openShops.length === 0) {
          replyText = 'ขณะนี้ยังไม่มีร้านอาหารเปิดให้บริการครับ กรุณาลองเช็คใหม่อีกครั้งในภายหลังครับ 🍔';
        } else {
          const shopList = openShops
            .slice(0, 5)
            .map((r) => `• ${r.name} (⭐ ${r.rating || 5.0} | ค่าส่ง ฿${r.deliveryFee ?? 15})`)
            .join('\n');
          replyText = `ร้านอาหารที่เปิดให้บริการอยู่ในขณะนี้ครับ:\n\n${shopList}\n\nกดเลือกดูเมนูและสั่งผ่านหน้าแรกได้เลยครับ! 🛵`;
        }
      } else if (text.includes('ส่งพัสดุ')) {
        replyText = 'วิธีการเรียกส่งพัสดุง่ายๆ ครับ:\n1. ไปที่แท็บ "ส่งพัสดุ"\n2. ปักหมุดจุดรับของ และ จุดส่งของ บนแผนที่\n3. ใส่รายละเอียดพัสดุและเบอร์ผู้รับ\n4. กดยืนยันการเรียกไรเดอร์ได้เลยครับ 📦';
      } else if (apiKey) {
        // Call Google Gemini API with Real Context System Prompt
        const systemPromptWithContext = buildContextPrompt();
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${systemPromptWithContext}\n\nคำถามจากผู้ใช้: "${text}"` }],
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
        // Smart fallback logic using real context
        replyText = `น้องบูมยินดีรับฟังครับ! สำหรับเรื่อง "${text}" คุณสามารถถามข้อมูลจริงกับผมได้เลยครับ เช่น:\n- "เช็คสถานะออเดอร์"\n- "สอบถามยอดเงิน Wallet" (ปัจจุบัน: ฿${walletBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})\n- "แนะนำร้านอาหาร" 🛵✨`;
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
              <p className="text-[11px] text-purple-200">เชื่อมต่อข้อมูลเรียลไทม์ 24 ชม.</p>
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
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow-sm ${
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
              <span>น้องบูมกำลังดึงข้อมูลและพิมพ์คำตอบ...</span>
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
