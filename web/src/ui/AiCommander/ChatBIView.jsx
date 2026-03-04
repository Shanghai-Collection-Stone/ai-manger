import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Zap, History, Plus, MessageSquare, X, 
  AlertCircle, Loader2, BrainCircuit
} from 'lucide-react';
import { chatService } from './chatService';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked to handle AI output better
marked.setOptions({ breaks: true, gfm: true });
const renderer = new marked.Renderer();
// Override code block rendering: if it looks like plain text (no language specified
// and no code-like patterns), render as a styled paragraph instead of <pre><code>
const _origCode = renderer.code.bind(renderer);
renderer.code = function({ text, lang }) {
  if (lang) return _origCode({ text, lang });
  // Heuristic: if text has no typical code patterns, treat as plain text
  const looksLikeCode = /[{}[\];=<>]|function |const |let |var |import |class |=>|\.map\(|console\.|return /.test(text);
  if (!looksLikeCode) {
    // Render as normal text paragraph, preserving line breaks
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<p style="white-space:pre-wrap">${escaped}</p>`;
  }
  return _origCode({ text, lang });
};
marked.use({ renderer });

/* ─── SSE Line Parser ─── */

/**
 * Parse raw SSE text buffer into individual JSON event payloads.
 * Returns { events: parsed[], remainder: unparsed tail }
 */
function parseSSEChunk(buffer) {
  const events = [];
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() || '';
  for (const part of parts) {
    for (const line of part.split('\n')) {
      const prefix = line.startsWith('data: ') ? 6 : line.startsWith('data:') ? 5 : 0;
      if (prefix) {
        try { events.push(JSON.parse(line.slice(prefix))); } catch { /* skip */ }
      }
    }
  }
  return { events, remainder };
}

/* ─── Thinking Indicator (replaces tool call cards) ─── */

const ThinkingBubble = ({ toolCount }) => (
  <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50/70 border border-indigo-100 rounded-2xl rounded-tl-sm mb-1 animate-pulse">
    <BrainCircuit size={16} className="text-indigo-500" />
    <span className="text-xs text-indigo-600 font-medium">
      思考中{toolCount > 0 ? `（已调用 ${toolCount} 个工具）` : '...'}
    </span>
    <Loader2 size={12} className="animate-spin text-indigo-400" />
  </div>
);

/* ─── AI Message Component ─── */

const AIMessage = ({ msg }) => {
  // Parse markdown securely
  const htmlContent = React.useMemo(() => {
    if (!msg.content) return { __html: '' };
    let rawMarkup = marked.parse(msg.content);
    // Wrap each <table> in a scrollable container so only the table scrolls, not the bubble
    rawMarkup = rawMarkup.replace(/<table/g, '<div class="ai-table-scroll"><table');
    rawMarkup = rawMarkup.replace(/<\/table>/g, '</table></div>');
    return { __html: DOMPurify.sanitize(rawMarkup) };
  }, [msg.content]);

  return (
    <div className="flex flex-col space-y-1 max-w-[90%] overflow-hidden">
      {/* Thinking indicator — show when streaming and tools are being called */}
      {msg.isStreaming && msg.toolCount > 0 && (
        <ThinkingBubble toolCount={msg.toolCount} />
      )}

      {/* Text content */}
      {(msg.content || msg.isStreaming) && (
        <div className="bg-white border border-slate-100 rounded-3xl rounded-tl-sm p-4 px-5 shadow-[0_2px_15px_rgba(0,0,0,0.04)] overflow-hidden">
          {msg.content ? (
            <div 
              className="prose prose-sm prose-indigo max-w-none text-slate-700 leading-relaxed break-words
                         prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5
                         [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:bg-slate-50 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:my-2
                         [&_code]:break-all [&_code]:text-xs
                         [&_p]:[overflow-wrap:anywhere]
                         [&_.ai-table-scroll]:overflow-x-auto [&_.ai-table-scroll]:rounded-lg [&_.ai-table-scroll]:my-2
                         [&_table]:w-max [&_table]:min-w-full
                         [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap
                         [&_table]:border-collapse [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5
                         [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5"
              dangerouslySetInnerHTML={htmlContent} 
            />
          ) : (
            msg.isStreaming && (
              <span className="animate-pulse flex items-center text-slate-400 text-sm font-medium">
                <Sparkles size={14} className="mr-1" /> 思考中...
              </span>
            )
          )}
        </div>
      )}

    {/* Show empty placeholder while loading, no content yet, no error */}
    {!msg.content && !msg.isStreaming && !msg.errorText && (
      <div className="bg-white border border-slate-100 rounded-3xl rounded-tl-sm p-5 shadow-[0_2px_15px_rgba(0,0,0,0.04)]">
        <span className="text-sm text-slate-400">（无内容）</span>
      </div>
    )}

    {/* Error message */}
    {msg.errorText && (
      <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="text-xs text-red-600 font-medium flex items-center gap-1.5">
          <AlertCircle size={14} />
          <span>{msg.errorText}</span>
        </div>
      </div>
    )}
  </div>
  );
};

/**
 * @description AI中枢对话视图组件，支持SSE流式解析，工具调用隐藏在思考状态中
 * @keyword-en ChatBIView
 */
const ChatBIView = ({ isDrawerOpen, onDrawerToggle }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const loadedSessions = await chatService.getSessions();
      setSessions(loadedSessions);
      
      const savedSessionId = localStorage.getItem('ai_commander_session_id');
      
      if (savedSessionId && savedSessionId.startsWith('local-')) {
        // Just empty local session
        setSessionId(savedSessionId);
      } else if (savedSessionId && loadedSessions.some(s => s.sessionId === savedSessionId)) {
        // Load the saved remote session
        handleSwitchSession({ sessionId: savedSessionId }, loadedSessions);
      } else {
        // Start fresh
        const newLocalId = 'local-' + Date.now();
        setSessionId(newLocalId);
        localStorage.setItem('ai_commander_session_id', newLocalId);
      }
    };
    init();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewSession = () => {
    const newId = 'local-' + Date.now();
    setSessionId(newId);
    setMessages([]);
    localStorage.setItem('ai_commander_session_id', newId);
    if (onDrawerToggle) onDrawerToggle(false);
  };

  // added a loadedSessions parameter for the initial load case where state might not be updated yet
  const handleSwitchSession = async (sess, currentSessions = sessions) => {
    if (sess.sessionId === sessionId) {
      if (onDrawerToggle) onDrawerToggle(false);
      return;
    }
    setIsLoading(true);
    setSessionId(sess.sessionId);
    localStorage.setItem('ai_commander_session_id', sess.sessionId);
    if (onDrawerToggle) onDrawerToggle(false);
    try {
      const history = await chatService.fetchHistory(sess.sessionId);
      const msgs = Array.isArray(history) ? history : (history.messages || []);
      setMessages(msgs.map(m => ({
        ...m,
        id: m.id || Date.now() + Math.random(),
        role: m.role === 'assistant' ? 'ai' : m.role,
        toolCount: 0,
      })));
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  /* ─── Send message with SSE streaming ─── */
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setInputValue('');

    // 1. Ensure remote session exists
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

    // 2. Add user message
    const userMsg = { id: Date.now(), role: 'user', content: userText };

    // 3. Immediately create an empty AI placeholder (early-refresh protection)
    //    Content is empty = shows "思考中..." placeholder
    //    This msg is "on-record" so even if user refreshes, it exists
    const aiMsgId = Date.now() + 1;
    const aiMsg = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      toolCount: 0,
      isStreaming: true,
      errorText: null,
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setIsLoading(true);  // Blocks input field

    try {
      const response = await chatService.streamChatPost(currentSessionId, userText);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let textContent = '';
      let toolCount = 0;

      const updateAiMsg = (overrides) => {
        setMessages(prev => prev.map(msg =>
          msg.id === aiMsgId
            ? { ...msg, content: textContent, toolCount, ...overrides }
            : msg
        ));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSSEChunk(sseBuffer);
        sseBuffer = remainder;

        for (const evt of events) {
          switch (evt.type) {
            case 'token': {
              const text = evt.data?.text ?? '';
              if (text) {
                textContent += text;
                updateAiMsg();
              }
              break;
            }
            case 'tool_start': {
              toolCount++;
              updateAiMsg();
              break;
            }
            case 'tool_end':
            case 'tool_chunk':
            case 'reasoning':
            case 'log':
            case 'ping':
              // All hidden — tool calls go into the thinking indicator count
              break;
            case 'error': {
              const errMsg = evt.data?.message || '未知错误';
              updateAiMsg({ errorText: errMsg, isStreaming: false });
              break;
            }
            case 'end':
              // Stream complete
              break;
            default:
              break;
          }
        }
      }

      // Finalize
      updateAiMsg({ isStreaming: false });

      // Refresh session list
      const updatedSessions = await chatService.getSessions();
      setSessions(updatedSessions);

    } catch (error) {
      console.error('Chat error:', error);
      // Record error in the already-created AI message (not a new one)
      setMessages(prev => prev.map(msg =>
        msg.id === aiMsgId
          ? { ...msg, errorText: '抱歉，我现在无法回答。请稍后再试。', isStreaming: false }
          : msg
      ));
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
    <div className="flex flex-col h-full animate-fade-in relative overflow-hidden">

      {/* 历史会话 Drawer */}
      <div
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
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
      <div 
        className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-24 pt-4"
        onTouchStart={(e) => {
          // 如果点击的是代码块、表格或任何可能横向滚动的容器，阻止冒泡
          const isScrollable = e.target.closest('pre, table, .ai-table-scroll, .overflow-x-auto');
          if (isScrollable) {
            e.stopPropagation();
          }
        }}
        onTouchEnd={(e) => {
          const isScrollable = e.target.closest('pre, table, .ai-table-scroll, .overflow-x-auto');
          if (isScrollable) {
            e.stopPropagation();
          }
        }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center pb-20 opacity-80 animate-fade-in-up">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-white ring-4 ring-indigo-50/50">
              <Sparkles size={32} className="text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">AI 主脑中枢</h2>
            <p className="text-sm text-slate-500 max-w-xs text-center leading-relaxed">
              我是您的智能业务助手。<br />
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
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
                {msg.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-sm shadow-sm font-medium leading-relaxed break-words overflow-hidden">
                    {msg.content}
                  </div>
                ) : (
                  <AIMessage msg={msg} />
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 底部输入框区域 */}
      <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#F7F9FC] via-[#F7F9FC] to-transparent pt-6 pb-4 px-4">
        <div className={`flex items-center bg-white border shadow-lg shadow-slate-200/50 rounded-full p-1.5 px-4 transition-all max-w-2xl mx-auto ${
          isLoading 
            ? 'border-indigo-200 bg-indigo-50/30' 
            : 'border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500/20'
        }`}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'AI 正在回复中，请稍候...' : '问问数据，或者下达指令...'}
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder-slate-400 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-sm ${
              inputValue.trim() && !isLoading
                ? 'bg-slate-900 text-white hover:bg-slate-800 scale-100'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed scale-95'
            }`}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          </button>
        </div>
      </div>

    </div>
  );
};

export default ChatBIView;
