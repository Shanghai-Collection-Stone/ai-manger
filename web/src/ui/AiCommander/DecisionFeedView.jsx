import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { 
  CheckCircle2, Play, Loader2, Eye, X
} from 'lucide-react';
import { $decisionCount, $decisionFocusCardId, $decisionsRefreshKey } from './store';
import { chatService } from './chatService';

/**
 * @description 决策流视图组件，展示待办决策任务卡片
 * @keyword-en DecisionFeedView
 * @returns {JSX.Element} DecisionFeedView component
 */
const DecisionFeedView = () => {
  const focusCardId = useStore($decisionFocusCardId);
  const refreshKey = useStore($decisionsRefreshKey);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCard, setDetailCard] = useState(null);

  const reloadCards = () => {
    setLoading(true);
    chatService
      .listDecisionCards()
      .then((res) => {
        const nextCards = Array.isArray(res.cards) ? res.cards : [];
        setCards(nextCards);
        $decisionCount.set(nextCards.filter((c) => c?.status === 'generated').length);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reloadCards();
  }, []);

  useEffect(() => {
    if (refreshKey <= 0) return;
    reloadCards();
  }, [refreshKey]);

  const handleApply = async (cardId) => {
    setApplyingId(cardId);
    try {
      const res = await chatService.applyDecisionCard(cardId);
      if (res.success) {
        setCards((prev) => {
          const next = prev.map((c) =>
            c._id === cardId ? { ...c, status: 'applied' } : c,
          );
          $decisionCount.set(
            next.filter((c) => c?.status === 'generated').length,
          );
          return next;
        });
      }
    } finally {
      setApplyingId(null);
    }
  };

  const handleOpenDetail = async (card) => {
    setDetailOpen(true);
    setDetailCard(card || null);
    const cardId = card?._id;
    if (!cardId) return;
    setDetailLoading(true);
    try {
      const res = await chatService.getDecisionCard(cardId);
      if (res?.card) {
        setDetailCard(res.card);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!focusCardId) return;
    const target = cards.find((c) => String(c?._id || '') === String(focusCardId));
    if (target) {
      void handleOpenDetail(target);
      setTimeout(() => {
        const el = document.getElementById(`decision-card-${target._id}`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 0);
      $decisionFocusCardId.set(null);
      return;
    }
    void handleOpenDetail({ _id: focusCardId });
    $decisionFocusCardId.set(null);
  }, [focusCardId, cards]);

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailLoading(false);
  };

  const renderListBlock = (title, items) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className="text-sm text-slate-700 flex items-start gap-2">
              <span className="text-slate-400">{idx + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  if (loading && cards.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
          <CheckCircle2 size={24} className="text-slate-300" />
        </div>
        <p className="text-sm font-medium">暂无待办决策</p>
        <p className="text-xs text-slate-400 mt-1">AI 正在分析最新业务数据...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in p-4 pb-32" id="decisions-view">
      {cards.map((card) => (
        <div
          id={`decision-card-${card._id}`}
          key={card._id}
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">{card.title}</h3>
              <p className="text-sm text-slate-500 mt-1">{card.summary}</p>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              card.status === 'generated' 
                ? 'bg-amber-50 text-amber-600' 
                : 'bg-green-50 text-green-600'
            }`}>
              {card.status === 'generated' ? '待执行' : '已应用'}
            </span>
          </div>

          {card.recommendation && (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">建议</p>
              <p className="text-sm text-slate-700">{card.recommendation}</p>
            </div>
          )}

          {card.actions && card.actions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">行动计划</p>
              <ul className="space-y-1">
                {card.actions.map((action, idx) => (
                  <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                    <span className="text-slate-400">{idx + 1}.</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.status === 'generated' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenDetail(card)}
                className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition"
              >
                <Eye size={16} />
                查看详情
              </button>
              <button
                onClick={() => handleApply(card._id)}
                disabled={applyingId === card._id}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition disabled:opacity-50"
              >
                {applyingId === card._id ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    生成任务中...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    执行决策
                  </>
                )}
              </button>
            </div>
          )}

          {card.status !== 'generated' && (
            <button
              onClick={() => handleOpenDetail(card)}
              className="w-full flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition"
            >
              <Eye size={16} />
              查看详情
            </button>
          )}
        </div>
      ))}

      {detailOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">决策详情</h3>
              <button
                onClick={handleCloseDetail}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto space-y-4">
              {detailLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={22} className="animate-spin text-slate-400" />
                </div>
              )}
              {!detailLoading && detailCard && (
                <>
                  <div className="space-y-1">
                    <h4 className="text-base font-semibold text-slate-900">
                      {detailCard.title || '决策卡'}
                    </h4>
                    <p className="text-sm text-slate-600">
                      {detailCard.summary || '暂无摘要'}
                    </p>
                  </div>
                  {detailCard.question && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs font-medium text-slate-500 mb-1">问题背景</p>
                      <p className="text-sm text-slate-700">{detailCard.question}</p>
                    </div>
                  )}
                  {detailCard.recommendation && (
                    <div className="bg-indigo-50/60 rounded-lg p-3">
                      <p className="text-xs font-medium text-indigo-500 mb-1">核心建议</p>
                      <p className="text-sm text-indigo-700">{detailCard.recommendation}</p>
                    </div>
                  )}
                  {renderListBlock('决策依据', detailCard.reasoning)}
                  {renderListBlock('可选方案', detailCard.options)}
                  {renderListBlock('行动计划', detailCard.actions)}
                  {renderListBlock('风险提示', detailCard.risks)}
                  {detailCard.capabilityBrief && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">能力摘要</p>
                      <p className="text-sm text-slate-700">{detailCard.capabilityBrief}</p>
                    </div>
                  )}
                  {detailCard.sourceDataBrief && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">数据摘要</p>
                      <p className="text-sm text-slate-700">{detailCard.sourceDataBrief}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DecisionFeedView;
