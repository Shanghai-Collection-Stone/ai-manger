import { moduleTip as aiAgentTip } from '../../ai-agent/description/ai-agent.tip.js';
import { moduleTip as aiContextTip } from './ai-context.tip.js';
import { moduleTip as contextRetrievalTip } from './context-retrieval.tip.js';
import { moduleTip as batchTaskTip } from '../../batch-task/description/batch-task.tip.js';
import { moduleTip as canvasTip } from '../../canvas/description/canvas.tip.js';
import { moduleTip as chatMainTip } from '../../chat-main/description/chat-main.tip.js';
import { moduleTip as checkpointTip } from '../../checkpoint/description/checkpoint.tip.js';
import { moduleTip as contextTip } from '../../context/description/context.tip.js';
import { moduleTip as dataSourceTip } from '../../data-source/description/data-source.tip.js';
import { moduleTip as embeddingTip } from '../../shared/embedding/description/embedding.tip.js';
import { moduleTip as formatTip } from '../../format/description/format.tip.js';
import { moduleTip as frontendAgentTip } from '../../frontend-agent/description/frontend.tip.js';
import { moduleTip as fcAnalysisTip } from '../../function-call/analysis/description/analysis.tip.js';
import { moduleTip as fcFrontendTip } from '../../function-call/frontend/description/frontend.tip.js';
import { moduleTip as fcMcpTip } from '../../function-call/mcp/description/mcp.tip.js';
import { moduleTip as fcSchemaTip } from '../../function-call/schema/description/schema.tip.js';
import { moduleTip as fcTitleTip } from '../../function-call/title/description/title.tip.js';
import { moduleTip as fcTodoTip } from '../../function-call/todo/description/todo.tip.js';
import { moduleTip as fcToolsTip } from '../../function-call/tools/description/tools.tip.js';
import { moduleTip as galleryTip } from '../../gallery/description/gallery.tip.js';
import { moduleTip as graphTip } from '../../graph/description/graph.tip.js';
import { moduleTip as schemaTip } from '../../schema/description/schema.tip.js';
import { moduleTip as skillThoughtTip } from '../../skill-thought/description/skill-thought.tip.js';
import { moduleTip as todoTip } from '../../todo/description/todo.tip.js';

function getTipKeywords(tip: Record<string, unknown>): string[] {
  const raw: unknown[] = [];
  raw.push((tip as { keywords?: unknown }).keywords);
  raw.push((tip as { keywordsCn?: unknown }).keywordsCn);
  raw.push((tip as { keywordsEn?: unknown }).keywordsEn);

  const out: string[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      for (const x of item) {
        if (typeof x === 'string' && x.trim().length > 0) out.push(x.trim());
      }
    }
  }
  return Array.from(new Set(out));
}

export const moduleKeywordsIndex = {
  lastUpdated: '2026-02-05',
  modules: [
    { name: 'Ai-Agent', tip: aiAgentTip },
    { name: 'Ai-Context', tip: aiContextTip },
    { name: 'Ai-Context-Retrieval', tip: contextRetrievalTip },
    { name: 'Batch-Task', tip: batchTaskTip },
    { name: 'Canvas', tip: canvasTip },
    { name: 'Chat-Main', tip: chatMainTip },
    { name: 'Checkpoint', tip: checkpointTip },
    { name: 'Context', tip: contextTip },
    { name: 'Data-Source', tip: dataSourceTip },
    { name: 'Embedding', tip: embeddingTip },
    { name: 'Format', tip: formatTip },
    { name: 'Frontend-Agent', tip: frontendAgentTip },
    { name: 'Function-Call-Analysis', tip: fcAnalysisTip },
    { name: 'Function-Call-Frontend', tip: fcFrontendTip },
    { name: 'Function-Call-MCP', tip: fcMcpTip },
    { name: 'Function-Call-Schema', tip: fcSchemaTip },
    { name: 'Function-Call-Title', tip: fcTitleTip },
    { name: 'Function-Call-Todo', tip: fcTodoTip },
    { name: 'Function-Call-Tools', tip: fcToolsTip },
    { name: 'Gallery', tip: galleryTip },
    { name: 'Graph', tip: graphTip },
    { name: 'Schema', tip: schemaTip },
    { name: 'Skill-Thought', tip: skillThoughtTip },
    { name: 'Todo', tip: todoTip },
  ].map((x) => ({
    name: x.name,
    keywords: getTipKeywords(x.tip as Record<string, unknown>),
  })),
} as const;

export const keywordToModules = (() => {
  const map = new Map<string, string[]>();
  for (const m of moduleKeywordsIndex.modules) {
    for (const k of m.keywords) {
      const key = k.toLowerCase();
      const cur = map.get(key) ?? [];
      if (!cur.includes(m.name)) cur.push(m.name);
      map.set(key, cur);
    }
  }
  return Object.fromEntries(
    Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
})();
