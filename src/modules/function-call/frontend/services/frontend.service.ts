import { Injectable, Inject } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { AgentService } from '../../../ai-agent/services/agent.service.js';
import { SchemaFunctionCallService } from '../../schema/services/schema.service.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { AsyncResource } from 'async_hooks';
import { Db } from 'mongodb';
import { AgentConfig } from '@/modules/ai-agent/types/agent.types.js';

@Injectable()
export class FrontendFunctionCallService {
  constructor(
    private readonly agent: AgentService,
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly schemaTools: SchemaFunctionCallService,
  ) {}

  getHandle(): CreateAgentParams['tools'] {
    const plan = tool(
      ({ input, contentType, uiFramework, layout }) => {
        const text = typeof input === 'string' ? input : '';
        const ct = contentType ?? 'chart';
        const ui = uiFramework ?? 'antd';
        const ly = layout ?? 'dashboard';
        const summary = `type=${ct}, ui=${ui}, layout=${ly}`;
        const hasLayout =
          /仪表盘|双列|grid|dashboard|布局/.test(text) ||
          typeof ly === 'string';
        const hasUI = typeof ui === 'string' && ui.length > 0;
        const missing: string[] = [];
        if (!hasUI) missing.push('uiFramework');
        if (!hasLayout) missing.push('layout');
        const requires_human = missing.length > 0;
        return JSON.stringify({
          requires_human,
          missing,
          proposal: {
            summary,
            input,
            options: {
              contentType: ct,
              uiFramework: ui,
              layout: ly,
            },
          },
        });
      },
      {
        name: 'frontend_plan',
        description:
          'Plan frontend page generation with HITL. Default chart page. Data API: POST /fc/mongo/search; Body: { collection: string(required), schema?: Record<field,type>, filter?: object, projection?: Record<field,0|1>, sort?: Record<field,1|-1>, limit?: number, skip?: number, includeTotal?: boolean, type?: "find"|"count"|"aggregate"|"distinct"|"min"|"max"|"sum"|"avg", key?: string(for distinct|min|max|sum|avg), pipeline?: object[](for aggregate) }. Response depends on type: find->[docs], count->[{count}], distinct->[values], aggregate->[docs], min/max/sum/avg->[{op:value}].',
        schema: z.object({
          input: z.string().describe('User requirement'),
          contentType: z
            .enum(['markdown', 'chart', 'table'])
            .optional()
            .describe('Page content type'),
          uiFramework: z
            .enum([
              'native',
              'antd',
              'element-ui',
              'mui',
              'tailwind',
              'bootstrap',
            ])
            .optional()
            .describe('Preferred UI framework'),
          layout: z
            .enum(['single', 'two_column', 'grid', 'dashboard'])
            .optional()
            .describe('Preferred layout type'),
        }),
      },
    );

    const finalize = tool(
      async ({
        input,
        uiFramework,
        chartLibrary,
        model,
        temperature,
        contentType,
        baseUrl,
        targetUrl,
        sessionId,
        layout,
      }) => {
        const base = baseUrl ?? '';
        const sys = [
          '只返回完整的纯HTML字符串（不含```代码块与说明文字）。',
          '先确定Schema, 在根据Schema生成页面和接口筛选参数等。',
          '必须使用 POST /fc/mongo/search 进行数据加载。',
          '先调用 schema_search 工具确定集合与字段，然后在页面脚本中构造请求体,减少使用联动查询,可以简单请求,多次组合的方式,并按需选择 type=find/count/aggregate/distinct/min/max/sum/avg：',
          '请求体示例: { collection, schema?, filter?, projection?, sort?, limit?, skip?, includeTotal?, type, key?, pipeline? }；其中 aggregate 需 pipeline，distinct/min/max/sum/avg 需 key。',
          '按参数加载依赖：UI框架(antd/mui/tailwind/bootstrap) 与 图表库(echarts/acharts)；当 uiFramework=native 时不加载任何框架。',
          '依赖顺序：样式<link>置于<head>；脚本<script>置于<body>末尾，并在使用前确保对应库已加载。',
          'uiFramework 与 layout 必须由用户提供，不得由 AI 猜测；若缺失则返回 requires_human 与 missing 以触发 HITL。',
          '接口文档：/fc/mongo/search (POST)。请求体支持 type=find/count/aggregate/distinct/min/max/sum/avg；count 返回 {count}，aggregate 需 pipeline，distinct/min/max/sum/avg 需 key，find 支持 includeTotal 返回没有额外的定义字段,返回的就是mongo查询的结果,例子[item,item],[{count:??}]像这样',
          '示例(find)：{ collection:"orders", filter:{ status:"paid", createdAt:"2025-12-xx" }, projection:{ _id:0, createdAt:1, total:1 }, limit:20, sort:{ createdAt:1 }, includeTotal:true }',
          '示例(aggregate)：{ collection:"orders", type:"aggregate", pipeline:[ { $match:{ status:"paid" } }, { $group:{ _id:"$category", total:{ $sum:"$amount" } } } ], limit:50 }',
          '示例(min/max/sum/avg)：{ collection:"orders", type:"avg", key:"amount", filter:{ status:"paid" } }',
          '查询最小化原则：尽量收敛 projection 与 limit，避免加载过多字段与行数；按需多次请求并在前端进行组合。',
          '数据维度说明：按人类可理解的维度组织数据（如 时间/地域/品类/状态/渠道/用户名 等），图表标题与副标题要清晰标注口径与单位；避免技术术语堆砌。',
          '【重要】尽可能避免使用ID做为数据维度,因为ID通常是数据库内部使用的,对人类不友好,纬度需要对人类友好,且符合业务逻辑',
          '注意在获取组合逻辑时,表名和字段名必须与 schema_search 工具返回的一致,然后按照这些定义去组合产生所需数据,尽量多想边界处理情况',
          '布局遵循 layout(single|two_column|grid|dashboard)，按该布局渲染主容器结构。',
          '不要使用模拟数据,一切数据通过现有通用查询接口组合,可以先确定组合方案,然后生成页面。',
          '页面顶部包含“刷新”按钮，点击后重新发起数据请求并更新图表与表格。',
          `接口基础地址: ${base}`,
          `布局要求：layout=${layout ?? 'dashboard'}`,
        ].join('\n');
        const pages = join(process.cwd(), 'public', 'pages');
        await fs.mkdir(pages, { recursive: true });
        let name: string;
        let hash: string;
        let prevHtml = '';
        if (
          typeof targetUrl === 'string' &&
          /\/static\/pages\/[a-f0-9]{16}\.html$/.test(targetUrl)
        ) {
          name = targetUrl.split('/').pop() as string;
          hash = name.replace('.html', '');
          try {
            prevHtml = await fs.readFile(join(pages, name), 'utf8');
          } catch {
            prevHtml = '';
          }
        } else {
          hash = randomBytes(8).toString('hex');
          name = `${hash}.html`;
        }

        const file = join(pages, name);
        const url = `/static/pages/${name}`;
        const now = new Date();
        const col = this.db.collection('frontend_jobs');

        // 写入默认模板并记录为 pending
        const text = typeof input === 'string' ? input : '';
        const ct =
          contentType ?? (/(图表|chart)/i.test(text) ? 'chart' : undefined);
        const ui = uiFramework ?? undefined;
        const lib = chartLibrary ?? undefined;
        const ly = layout ?? undefined;
        const miss: string[] = [];
        if (!ui) miss.push('uiFramework');
        if (!ly) miss.push('layout');
        const requires_human = miss.length > 0;

        const tpl = getDefaultTemplate(
          (ui ?? 'native').toLowerCase(),
          (lib ?? 'echarts').toLowerCase(),
          ly ?? 'dashboard',
          {
            title: requires_human ? '需要信息' : '图表生成中',
            description: requires_human
              ? `需要人工补充参数: ${JSON.stringify(miss)}`
              : '资源已创建，AI 正在生成页面内容…',
          },
        );
        await fs.writeFile(file, tpl, 'utf8');

        const record = {
          hash,
          url,
          status: 'pending' as const,
          input,
          sessionId,
          uiFramework: ui ?? null,
          chartLibrary: lib ?? null,
          contentType: ct ?? 'chart',
          model: model ?? 'deepseek-chat',
          targetUrl: targetUrl,
          layout: ly ?? null,
          created_at: now,
          updated_at: now,
        };
        await col.insertOne(record);

        // 异步生成最终HTML（脱离工具句柄执行，避免子Agent事件透传）
        setTimeout(() => {
          void this.generateHtmlAsync({
            hash,
            file,
            prevHtml,
            sys,
            input,
            uiFramework,
            chartLibrary,
            contentType,
            model,
            temperature,
            layout,
            missing: miss,
          });
        }, 200);

        return JSON.stringify({
          url,
          hash,
          status: 'pending',
          requires_human,
          missing: miss,
        });
      },
      {
        name: 'frontend_finalize',
        description:
          'Generate static HTML only (no code fences, no markdown). All data must be loaded via POST /fc/mongo/search. Use schema_search to determine collections/fields, then embed the constructed API request (collection, filter, projection, limit, sort) in page script and render combined data. Returns external URL JSON {url, hash, status}.',
        schema: z.object({
          input: z
            .string()
            .describe('User requirement with optional #url to modify'),
          uiFramework: z
            .enum([
              'native',
              'antd',
              'element-ui',
              'mui',
              'tailwind',
              'bootstrap',
            ])
            .optional()
            .describe('UI framework to use'),
          chartLibrary: z
            .enum(['echarts', 'acharts'])
            .optional()
            .describe('Chart library to use'),
          model: z.string().optional().describe('Model name'),
          temperature: z.number().optional().describe('Sampling temperature'),
          contentType: z
            .enum(['markdown', 'chart', 'table'])
            .optional()
            .describe('Page content type'),
          baseUrl: z
            .string()
            .optional()
            .describe('Backend baseUrl for API calls'),
          targetUrl: z
            .string()
            .optional()
            .describe('Existing external URL to modify'),
          sessionId: z
            .string()
            .describe('Context sessionId associated with this job'),
          layout: z
            .enum(['single', 'two_column', 'grid', 'dashboard'])
            .optional()
            .describe('Layout to enforce or modify'),
        }),
      },
    );

    return [plan, finalize];
  }

  /**
   * @title 异步生成HTML Generate HTML Async
   * @description 脱离工具句柄的异步生成逻辑，避免子Agent事件透传到顶层流。
   * @keywords-cn 异步生成, HTML, 去耦合
   * @keywords-en async generate, html, decouple
   * @param params 生成参数集合
   */
  private async generateHtmlAsync(params: {
    hash: string;
    file: string;
    prevHtml: string;
    sys: string;
    input: string;
    uiFramework?: string;
    chartLibrary?: string;
    contentType?: string;
    model?: string;
    temperature?: number;
    layout?: string;
    missing: string[];
  }): Promise<void> {
    try {
      if (Array.isArray(params.missing) && params.missing.length > 0) {
        await this.db.collection('frontend_jobs').updateOne(
          { hash: params.hash },
          {
            $set: {
              status: 'error',
              updated_at: new Date(),
              error: { hitl_required: true, missing: params.missing },
            },
          },
        );
        return;
      }

      const config: AgentConfig = {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: params.temperature ?? 0.3,
        system: params.sys,
        nonStreaming: true,
        tools: this.schemaTools.getHandle(),
      };
      const baseReq = `${params.input}\n类型:${params.contentType ?? 'chart'} 框架:${params.uiFramework ?? 'antd'} 布局:${params.layout ?? 'dashboard'}`;
      const userContent = params.prevHtml
        ? `现有HTML如下（请基于此进行修改并返回完整HTML）：\n${params.prevHtml}\n\n修改需求：\n${baseReq}`
        : baseReq;
      const messages = this.agent.toMessages([
        { role: 'system', content: params.sys },
        { role: 'user', content: userContent },
      ]);
      console.log('加载表格html中');

      // 直接构建模型并运行，显式传递空回调和新信号以彻底脱离父上下文
      const agentRun = this.agent.buildChatModel(config);
      // 使用 AsyncResource 在全新的异步上下文中执行，彻底切断与 SSE/Parent Request 的联系
      const state = await new AsyncResource(
        'detached-agent-run',
      ).runInAsyncScope(async () => {
        return await agentRun.invoke(
          { messages },
          {
            // 显式覆盖所有可能继承的配置
            signal: new AbortController().signal,
            callbacks: [],
            runId: randomBytes(16).toString('hex'),
            configurable: {
              thread_id: `frontend:${params.hash}`,
              checkpoint_ns: 'frontend',
              checkpoint_id: 'root',
            },
          },
        );
      });

      // 手动提取 AI 消息
      let ai: any = { content: '' };
      if (state && state.messages && Array.isArray(state.messages)) {
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const msg = state.messages[i];
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if ((msg as any)._getType() === 'ai') {
            ai = msg;
            break;
          }
        }
      }

      const text = (ai as unknown as { content: unknown }).content;
      const raw = typeof text === 'string' ? text : JSON.stringify(text);
      const html = sanitizeHtmlOutput(raw);
      await fs.writeFile(params.file, html, 'utf8');
      await this.db.collection('frontend_jobs').updateOne(
        { hash: params.hash },
        {
          $set: {
            status: params.prevHtml ? 'updated' : 'done',
            updated_at: new Date(),
          },
        },
      );
    } catch (e) {
      console.error(e);
      await this.db.collection('frontend_jobs').updateOne(
        { hash: params.hash },
        {
          $set: {
            status: 'error',
            updated_at: new Date(),
            error: String(e instanceof Error ? e.message : e),
          },
        },
      );
    }
  }
}

function sanitizeHtmlOutput(raw: string): string {
  const trimmed = raw.trim();
  const fenceHtml = trimmed.match(/^```html\s*([\s\S]*?)\s*```$/i);
  if (fenceHtml) return fenceHtml[1];
  const fenceAny = trimmed.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fenceAny) {
    const inner = fenceAny[1];
    if (/^\s*<!DOCTYPE html>|<html[\s\S]*?>/i.test(inner)) return inner;
    return minimalHtml();
  }
  if (/^\s*<!DOCTYPE html>|<html[\s\S]*?>/i.test(trimmed)) return trimmed;
  return minimalHtml();
}

function minimalHtml(): string {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>内容生成中</title><style>body{background:#f7f7f7;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;}#ph{background:#fff;border:1px solid #f0f0f0;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.03);padding:16px;text-align:center}</style></head><body><div id="ph">内容生成中，请稍后刷新。</div><button id="refresh-btn" style="margin-top:12px">刷新</button><script>document.getElementById("refresh-btn").addEventListener("click",function(){location.reload()})</script></body></html>';
}

function getDefaultTemplate(
  ui: string,
  lib: string,
  layout: string,
  meta: { title: string; description: string },
): string {
  const useAntd = ui === 'antd';
  const useElement = ui === 'element-ui';
  const useEcharts = lib === 'echarts';
  const useAcharts = lib === 'acharts';
  const cssAntd = useAntd
    ? '<link rel="stylesheet" href="https://unpkg.com/antd@5.12.8/dist/reset.css"><link rel="stylesheet" href="https://unpkg.com/antd@5.12.8/dist/antd.css">'
    : '';
  const cssElement = useElement
    ? '<link rel="stylesheet" href="https://unpkg.com/element-plus/dist/index.css">'
    : '';
  const jsAntd = useAntd
    ? '<script src="https://unpkg.com/antd@5.12.8/dist/antd.min.js"></script>'
    : '';
  const jsElement = useElement
    ? '<script src="https://unpkg.com/element-plus/dist/index.full.js"></script>'
    : '';
  const jsEcharts = useEcharts
    ? '<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>'
    : '';
  const jsAcharts = useAcharts
    ? '<script src="https://unpkg.com/@antv/g2@5.1.5/dist/g2.min.js"></script>'
    : '';
  const containerStyle =
    layout === 'dashboard'
      ? 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;'
      : layout === 'grid'
        ? 'display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:24px;'
        : layout === 'masonry'
          ? 'column-count:3;column-gap:24px;'
          : 'display:block;';
  const card =
    '<div class="card" style="background:#fff;border:1px solid #f0f0f0;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.03);padding:16px;">生成中…</div>';
  const bodyCards =
    layout === 'masonry'
      ? `<div style="${containerStyle}">${card}${card}${card}${card}${card}</div>`
      : `<div style="${containerStyle}">${card}${card}${card}${card}</div>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${meta.title}</title>${cssAntd}${cssElement}${jsAntd}${jsElement}${jsEcharts}${jsAcharts}<style>body{background:#f7f7f7;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;}h1{margin:0;color:#262626;font-size:22px}p{margin:8px 0 16px;color:#8c8c8c}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}</style></head><body><div class="topbar"><h1>${meta.title}</h1><button id="refresh-btn">刷新</button></div><p>${meta.description}</p>${bodyCards}<script>document.getElementById('refresh-btn').addEventListener('click',function(){location.reload()});</script></body></html>`;
}
