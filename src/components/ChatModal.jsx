import React, { useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, MessageCircle, Send, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const ChatModal = () => {
  const { activeChat, chats, activeRole, closeChatWindow, sendMessage, deleteChat } = useApp();
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeChat]);

  if (!activeChat) return null;

  const messages = chats[activeChat.id] || [];
  // Render via portal so position:fixed escapes overflow:hidden in #app-scroll
  const portal = document.getElementById('modal-root') || document.body;
  const canDelete = activeRole === 'admin' || activeRole === 'customer';

  const handleSend = () => {
    if (!inputRef.current?.value.trim()) return;
    sendMessage(inputRef.current.value);
    inputRef.current.value = '';
    inputRef.current.focus();
  };

  const handleDelete = () => {
    if (window.confirm('ลบการสนทนานี้ทั้งหมดหรือไม่?')) {
      deleteChat(activeChat.id);
    }
  };

  // Sender display name — admin เสมอแสดงเป็น 'เจ้าหน้าที่' ไม่ว่า senderName จะเป็นอะไร
  const senderLabel = (msg) => {
    if (msg.sender === 'admin') return 'เจ้าหน้าที่';
    if (msg.senderName) return msg.senderName;
    const map = { rider: 'ไรเดอร์', merchant: 'ร้านค้า', customer: 'ลูกค้า' };
    return map[msg.sender] || msg.sender;
  };

  // Header colour per chat type
  const chatId = activeChat.id || '';
  const headerBg = chatId.endsWith('-rider-merchant') ? 'bg-teal-600'
                 : chatId.endsWith('-rider')    ? 'bg-blue-600'
                 : chatId.endsWith('-merchant') ? 'bg-orange-500'
                 : chatId.startsWith('support-')? 'bg-purple-600'
                 : 'bg-green-600';

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[99999] p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md h-[85vh] sm:h-[520px] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">

        {/* ── Header ── */}
        <div className={`${headerBg} p-4 flex justify-between items-center text-white shadow-md flex-shrink-0`}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-full"><MessageCircle size={20} /></div>
            <div>
              <h3 className="font-bold text-base leading-tight">{activeChat.title}</h3>
              <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">
                {chatId.endsWith('-rider-merchant') ? 'ไรเดอร์ ↔ ร้านค้า'
                 : chatId.endsWith('-rider')    ? 'ลูกค้า ↔ ไรเดอร์'
                 : chatId.endsWith('-merchant') ? 'ลูกค้า ↔ ร้านค้า'
                 : chatId.startsWith('support-') ? 'ผู้ใช้ ↔ เจ้าหน้าที่'
                 : 'แชท'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canDelete && messages.length > 0 && (
              <button
                onClick={handleDelete}
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
                title="ลบการสนทนา"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={closeChatWindow} className="p-1.5 hover:bg-white/20 rounded-full transition-colors">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-gray-400 mt-16">
              <MessageCircle size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">เริ่มสนทนาได้เลย...</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMine = msg.sender === activeRole;
              return (
                <div key={idx} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                  {/* Sender name */}
                  <span className="text-[10px] text-gray-400 mb-0.5 px-1">
                    {isMine ? 'คุณ' : senderLabel(msg)}
                  </span>
                  <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl shadow-sm ${
                    isMine
                      ? 'bg-green-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <span className={`text-[10px] block text-right mt-1 ${isMine ? 'text-green-100' : 'text-gray-400'}`}>
                      {msg.time}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Input ── */}
        <div className="p-3 bg-white border-t flex items-center gap-2 flex-shrink-0">
          <input
            ref={inputRef}
            type="text"
            placeholder="พิมพ์ข้อความ..."
            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 transition-all"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button
            onClick={handleSend}
            className="bg-green-600 text-white p-2.5 rounded-full hover:bg-green-700 shadow-md transition-all active:scale-95 flex-shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
  // Use portal so the modal renders at body level, escaping any overflow:hidden parent
  return ReactDOM.createPortal(modal, portal);
};

export default ChatModal;
