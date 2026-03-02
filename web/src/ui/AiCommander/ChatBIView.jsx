import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Zap, History, Plus, MessageSquare, X
} from 'lucide-react';
import { chatService } from './chatService';

/**
 * @description AI中枢对话视图组件，提供自然语言交互
 * @keyword-en ChatBIView
 * @returns {JSX.Element} ChatBIView component
 */
const ChatBIView = ({ isDrawerOpen, onDrawerToggle }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // 初始化会话列表
    const init = async () => {
      const loadedSessions = await chatService.getSessions();
      setSessions(loadedSessions);
    };
    init();

    // 初始化当前会话 ID (使用本地临时 ID，发送消息时再创建真实会话)
    setSessionId('local-' + Date.now());
  }, []);

  useEffect(() => {
    // 滚动到底部
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewSession = () => {
    const newId = 'local-' + Date.now();
    setSessionId(newId);
    setMessages([]);
    if (onDrawerToggle) onDrawerToggle(false);
  };

  const handleSwitchSession = async (sess) => {
    if (sess.sessionId === sessionId) {
      if (onDrawerToggle) onDrawerToggle(false);
      return;
    }
    
    setIsLoading(true);
    setSessionId(sess.sessionId);
    if (onDrawerToggle) onDrawerToggle(false);
    
    try {
      // 获取历史记录
      const history = await chatService.fetchHistory(sess.sessionId);
      // 转换格式适配 UI (假设后端返回格式需要适配，这里简单处理)
      // 如果后端返回的就是标准格式则直接使用
      // 这里模拟适配：假设 history 是 { messages: [] } 或 []
      const msgs = Array.isArray(history) ? history : (history.messages || []);
      
      // 如果历史记录为空，且是本地存储的会话，可能需要从本地恢复（如果做了本地存储消息的话）
      // 目前 chatService 只有 fetchHistory 从后端取。
      // MVP 阶段：如果后端没取到，就置空
      setMessages(msgs.map(m => ({
        ...m,
        id: m.id || Date.now() + Math.random(),
        type: 'text' // 确保有 type
      })));
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setInputValue('');
    
    // 如果是本地会话，先创建远程会话
    let currentSessionId = sessionId;
    if (currentSessionId.startsWith('local-')) {
      try {
        const session = await chatService.createSession();
        currentSessionId = session.sessionId;
        setSessionId(currentSessionId);
      } catch (e) {
        console.error('Failed to create session', e);
        return;
      }
    }

    // 添加用户消息
    const userMsg = { id: Date.now(), role: 'user', content: userText, type: 'text' };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // 添加 AI 占位消息
      const aiMsgId = Date.now() + 1;
      setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', type: 'text', isStreaming: true }]);

      const response = await chatService.streamChatPost(currentSessionId, userText);
      
      if (!response.body) throw new Error('No response body');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        aiContent += chunk;
        
        // 更新 AI 消息内容
        setMessages(prev => prev.map(msg => 
          msg.id === aiMsgId ? { ...msg, content: aiContent } : msg
        ));
      }
      
      // 完成流式传输
      setMessages(prev => prev.map(msg => 
        msg.id === aiMsgId ? { ...msg, isStreaming: false } : msg
      ));

      // 刷新会话列表 (如果之前是新会话)
      const updatedSessions = await chatService.getSessions();
      setSessions(updatedSessions);

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { id: Date.now(), role: 'ai', content: '抱歉，我现在无法回答。请稍后再试。', type: 'error' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] animate-fade-in relative overflow-hidden">
      
      {/* 历史会话 Drawer */}
      <div 
        className={`absolute top-0 right-0 h-full w-64 bg-white z-30 transform transition-all duration-300 ease-in-out border-l border-slate-100 flex flex-col ${
          isDrawerOpen 
            ? 'translate-x-0 opacity-100 pointer-events-auto shadow-xl' 
            : 'translate-x-full opacity-0 pointer-events-none shadow-none'
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-bold text-slate-700 text-sm">历史会话</h3>
          <button onClick={() => onDrawerToggle && onDrawerToggle(false)} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-3">
          <button 
            onClick={handleNewSession}
            className="w-full flex items-center justify-center space-x-2 bg-indigo-50 text-indigo-600 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors border border-indigo-100"
          >
            <Plus size={16} />
            <span>新会话</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {sessions.length === 0 ? (
             <div className="text-center text-xs text-slate-400 py-8">暂无历史会话</div>
          ) : (
            sessions.map(sess => (
              <button
                key={sess.sessionId}
                onClick={() => handleSwitchSession(sess)}
                className={`w-full text-left p-3 rounded-lg text-xs transition-all border ${
                  sessionId === sess.sessionId 
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                    : 'bg-white text-slate-600 border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-medium truncate mb-1 flex items-center">
                  <MessageSquare size={12} className="mr-2 opacity-70" />
                  <span className="truncate">{sess.title || '未命名会话'}</span>
                </div>
                <div className="text-[10px] opacity-60">
                  {new Date(sess.timestamp).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 遮罩层 */}
      {isDrawerOpen && (
        <div 
          className="absolute inset-0 bg-black/20 z-10 backdrop-blur-[1px]"
          onClick={() => onDrawerToggle && onDrawerToggle(false)}
        />
      )}

      {/* 消息列表区域 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-24 pt-4">
        {messages.length === 0 ? (
          // 空状态 - 仅在无消息时显示
          <div className="h-full flex flex-col items-center justify-center pb-20 opacity-80 animate-fade-in-up">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-white ring-4 ring-indigo-50/50">
              <Sparkles size={32} className="text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">AI 主脑中枢</h2>
            <p className="text-sm text-slate-500 max-w-xs text-center leading-relaxed">
              我是您的智能业务助手。<br/>
              您可以问我关于营收、客流的分析，或者下达运营指令。
            </p>
            
            <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-md px-4">
              <button 
                onClick={() => setInputValue('本月客流趋势如何？')}
                className="text-xs bg-white border border-slate-200 p-3 rounded-xl text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm transition-all text-left"
              >
                📈 本月客流趋势如何？
              </button>
              <button 
                onClick={() => setInputValue('分析一下Top5商铺的销售额')}
                className="text-xs bg-white border border-slate-200 p-3 rounded-xl text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm transition-all text-left"
              >
                💰 分析Top5商铺销售额
              </button>
            </div>
          </div>
        ) : (
          // 消息列表
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
                {msg.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-sm shadow-sm font-medium leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="flex flex-col space-y-1 max-w-[90%]">
                     <div className="bg-white border border-slate-100 rounded-3xl rounded-tl-sm p-5 shadow-[0_2px_15px_rgba(0,0,0,0.04)]">
                      <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                        {msg.content || (msg.isStreaming ? <span className="animate-pulse flex items-center text-slate-400"><Sparkles size={14} className="mr-1"/> 思考中...</span> : '')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
               <div className="flex justify-start items-center space-x-2 text-xs text-slate-400 font-medium pl-2 mb-4">
                 <Sparkles size={14} className="animate-pulse text-indigo-500" />
                 <span>主脑正在思考...</span>
               </div>
            )}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 底部输入框区域 - 调整 padding */}
      <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#F7F9FC] via-[#F7F9FC] to-transparent pt-6 pb-4 px-4">
        <div className="flex items-center bg-white border border-slate-200 shadow-lg shadow-slate-200/50 rounded-full p-1.5 px-4 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all max-w-2xl mx-auto">
          <input 
            type="text" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问问数据，或者下达指令..." 
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder-slate-400 py-2.5 font-medium"
            disabled={isLoading}
          />
          <button 
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-sm ${
              inputValue.trim() && !isLoading ? 'bg-slate-900 text-white hover:bg-slate-800 scale-100' : 'bg-slate-100 text-slate-300 cursor-not-allowed scale-95'
            }`}
          >
            <Zap size={16} />
          </button>
        </div>
      </div>

    </div>
  );
};

export default ChatBIView;
