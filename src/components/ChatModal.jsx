import React from 'react';
import { X, MessageCircle, Send } from 'lucide-react';
import { useApp } from '../context/AppContext';

const ChatModal = () => {
  const { activeChat, chats, activeRole, closeChatWindow, sendMessage } = useApp();

  if (!activeChat) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white w-full max-w-md h-[500px] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-green-600 p-4 flex justify-between items-center text-white shadow-md">
          <div className="flex items-center">
            <div className="bg-white/20 p-2 rounded-full mr-3"><MessageCircle size={20} /></div>
            <div>
              <h3 className="font-bold text-lg">{activeChat.title}</h3>
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full capitalize">{activeChat.role}</span>
            </div>
          </div>
          <button onClick={closeChatWindow} className="p-1 hover:bg-white/20 rounded-full">
            <X size={24} />
          </button>
        </div>

        {/* Messages Body */}
        <div className="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-3">
          {(chats[activeChat.id] || []).length === 0 ? (
            <div className="text-center text-gray-400 mt-10">เริ่มสนทนาได้เลย...</div>
          ) : (
            (chats[activeChat.id] || []).map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === activeRole ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-3 rounded-2xl shadow-sm ${
                  msg.sender === activeRole
                    ? 'bg-green-500 text-white rounded-br-none'
                    : 'bg-white text-gray-800 rounded-bl-none'
                }`}>
                  <p className="text-sm">{msg.text}</p>
                  <span className={`text-[10px] block text-right mt-1 ${msg.sender === activeRole ? 'text-green-100' : 'text-gray-400'}`}>
                    {msg.time}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Input */}
        <div className="p-3 bg-white border-t flex items-center gap-2">
          <input
            type="text"
            placeholder="พิมพ์ข้อความ..."
            className="flex-1 border bg-gray-100 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                sendMessage(e.target.value);
                e.target.value = '';
              }
            }}
          />
          <button
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling;
              sendMessage(input.value);
              input.value = '';
            }}
            className="bg-green-600 text-white p-2.5 rounded-full hover:bg-green-700 shadow-lg transition-transform active:scale-95"
          >
            <Send size={18} className="ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatModal;
