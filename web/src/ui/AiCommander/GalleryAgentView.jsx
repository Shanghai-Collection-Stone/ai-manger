import React, { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import ChatBIView from './ChatBIView';

/**
 * @description Gallery Agent View with dual-tab pattern
 * Tab 'gallery' - Normal gallery management (image list, upload, groups)
 * Tab 'chat' - LLM-powered gallery chat with tools
 * @keyword-en GalleryAgentView, gallery, agent, dual-tab
 */
const GalleryAgentView = ({ onBack }) => {
  const [tab, setTab] = useState('chat'); // 'chat' | 'gallery'

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header with dual-tab */}
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
        <button
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
          <button
            onClick={() => setTab('chat')}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${
              tab === 'chat'
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500'
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setTab('gallery')}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${
              tab === 'gallery'
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500'
            }`}
          >
            图库
          </button>
        </div>
      </div>

      {tab === 'chat' ? (
        <div className="flex-1 min-h-0">
          <ChatBIView
            sessionType="gallery-agent"
            sessionStorageKey="ai_commander_gallery_agent_session"
            welcomeTitle="图库智能助手"
            welcomeDesc="基于图库和标签管理，帮你搜索和管理图片素材"
            quickPrompts={[
              '搜索风景类图片',
              '查找所有人物照片',
              '帮我整理图片标签',
            ]}
            inputPlaceholder="输入问题，关于图库搜索和管理..."
            showInlineSessionPicker
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Gallery mode - embedded GalleryView would go here */}
          <div className="p-4 text-center text-slate-400">
            <p className="text-sm">图库管理模式开发中</p>
            <p className="text-xs mt-1">可通过 ToolsView {'>'} AI图库 访问完整功能</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryAgentView;
