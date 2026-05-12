import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  AgentRunInput,
  AgentConfig,
  AgentRunMessagesInput,
} from '../types/agent.types';
import type { AgentRunStreamInput } from '../types/agent.types';
import {
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
  SystemMessage,
  AIMessageChunk,
  coerceMessageLikeToMessage,
  isBaseMessage,
  AIMessage,
} from '@langchain/core/messages';
import { StructuredTool, isStructuredTool } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { CreateAgentParams } from 'langchain';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { SubAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import type * as z3 from 'zod/v3';
import type * as z4 from 'zod/v4/core';
import type * as z4Classic from 'zod/v4';
import { createDeepAgent } from 'deepagents';
import { AgentStreamEvent, type AgentStreamOption } from '../types/agent.types';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AntiDetectionService } from '../../image-anti-detection/services/anti-detection.service.js';

type DeepAgentReturn = Awaited<ReturnType<typeof createDeepAgent>>;
type InteropZodObject =
  | z3.ZodObject<any, any, any, any, any>
  | z4.$ZodObject
  | z4Classic.ZodObject<any, any>;

/**
 * @title Agent服务 Agent Service
 * @description 使用LangChain构建与运行Agent，支持Gemini/DeepSeek/GLM国际端(z.ai)等OpenAI兼容协议。
 * @keywords-cn Agent服务, LangChain, Gemini, DeepSeek, GLM, z.ai, 智谱
 * @keywords-en agent service, LangChain, Gemini, DeepSeek, GLM, z.ai, zhipu
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly checkpointer: MongoDBSaver;

  constructor(
    @Inject('CTX_MONGO_CLIENT') client: MongoClient,
    config: ConfigService,
    private readonly adminService: AdminService,
    private readonly antiDetection: AntiDetectionService,
  ) {
    const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
    const isDev = env === 'development' || env === 'dev';
    let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
    if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
    this.checkpointer = new MongoDBSaver({ client, dbName });

    // Monkey-patch to fix empty bulkWrite error in langgraph-checkpoint-mongodb
    const originalPutWrites = this.checkpointer.putWrites.bind(
      this.checkpointer,
    );
    this.checkpointer.putWrites = async (config, writes, taskId) => {
      if (!writes || writes.length === 0) {
        return; // Skip empty writes to avoid MongoDB Invalid BulkOperation error
      }
      return originalPutWrites(config, writes, taskId);
    };
  }

  /**
   * @title 构建聊天模型 Build Chat Model
   * @description 根据提供方返回对应的LangChain聊天模型。GLM国际端(z.ai)走OpenAI兼容协议，baseUrl必填。
   * @keywords-cn 构建模型, Gemini, DeepSeek, GLM, z.ai
   * @keywords-en build model, Gemini, DeepSeek, GLM, z.ai
   */
  async buildChatModel(config: AgentConfig): Promise<DeepAgentReturn> {
    const llm = await this.buildLLM(config);
    const mergedSystem = await this.mergeSystemWithPlatformSupplement(
      config.system,
      config,
    );

    const options = {
      model: llm,
      systemPrompt: mergedSystem,
      tools: this.normalizeTools(config.tools),
      contextSchema: this.normalizeContextSchema(config.contextSchema),
      responseFormat: config.responseFormat,
      checkpointer: this.checkpointer,
      subagents: this.normalizeSubagents(config.subagents),
    };
    return createDeepAgent(options) as DeepAgentReturn;
  }

  async buildLLM(config: AgentConfig): Promise<BaseChatModel> {
    const runtime = await this.resolveDefaultRuntime();
    const provider = String(runtime.providerCode).trim().toLowerCase();
    const rawModel = String(runtime.model ?? '').trim();
    if (!rawModel) throw new Error('AI_MODEL_NOT_CONFIGURED');
    const m = /^(openai|google-genai|anthropic):(.+)$/.exec(rawModel);
    const modelProvider = m?.[1];
    const modelName = (m?.[2] ?? rawModel).trim();
    if (!modelName) throw new Error('AI_MODEL_NOT_CONFIGURED');

    const protocol =
      provider === 'gemini'
        ? 'google-genai'
        : provider === 'minimax' ||
            provider === 'anthropic' ||
            provider === 'claude'
          ? 'anthropic'
          : 'openai';
    if (modelProvider && modelProvider !== protocol) {
      throw new Error('AI_MODEL_PROVIDER_MISMATCH');
    }

    const temperature =
      typeof config.temperature === 'number' &&
      Number.isFinite(config.temperature)
        ? config.temperature
        : undefined;

    if (protocol === 'google-genai') {
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        temperature,
        streaming: !config.nonStreaming,
      });
    }
    if (protocol === 'anthropic') {
      return new ChatAnthropic({
        model: modelName,
        apiKey: runtime.apiKey,
        anthropicApiUrl: runtime.baseUrl,
        temperature,
        streaming: !config.nonStreaming,
      });
    }
    return new ChatOpenAI({
      model: modelName,
      apiKey: runtime.apiKey,
      temperature,
      streaming: !config.nonStreaming,
      useResponsesApi: false,
      configuration: runtime.baseUrl ? { baseURL: runtime.baseUrl } : undefined,
    });
  }

  /**
   * @title 解析默认运行时 Resolve Default Runtime
   * @description 从管理配置中解析默认AI运行时信息。
   * @keywords-cn 运行时, 默认配置
   * @keywords-en runtime, default config
   */
  private async resolveDefaultRuntime(): Promise<{
    providerCode: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultAiProviderRuntime();
    const providerCode = String(runtime?.providerCode ?? '').trim();
    const model = String(runtime?.model ?? '').trim();
    if (!providerCode) throw new Error('AI_PROVIDER_RUNTIME_NOT_CONFIGURED');
    if (!model) throw new Error('AI_MODEL_NOT_CONFIGURED');

    const provider = providerCode.toLowerCase();
    const apiKey = String(runtime?.apiKey ?? '').trim() || undefined;
    const baseUrl =
      String(runtime?.baseUrl ?? '').trim() ||
      this.resolveProviderDefaultBaseUrl(provider);

    if (!apiKey) throw new Error('AI_API_KEY_NOT_CONFIGURED');

    return { providerCode, model, apiKey, baseUrl };
  }

  /**
   * @description 厂商默认 baseUrl 兜底（管理员留空时使用），OpenAI/Gemini 走 SDK 默认。
   * @keyword-en resolve provider default base url
   */
  private resolveProviderDefaultBaseUrl(provider: string): string | undefined {
    switch (provider) {
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'nvidia':
        return 'https://integrate.api.nvidia.com/v1';
      case 'minimax':
        return 'https://api.minimax.chat/v1';
      // GLM 国际端(z.ai) Coding Plan 订阅入口；按量付费可手动改回 https://api.z.ai/api/paas/v4；
      // 国内端可改为 https://open.bigmodel.cn/api/paas/v4
      case 'glm':
        return 'https://api.z.ai/api/coding/paas/v4';
      default:
        return undefined;
    }
  }

  /**
   * @description 解析默认生图运行时配置。
   * @keyword-en resolve default image runtime config
   */
  private async resolveDefaultImageRuntime(): Promise<{
    providerCode: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultImageProviderRuntime();
    const providerCode = String(runtime?.providerCode ?? '').trim();
    const model = String(runtime?.model ?? '').trim();
    const apiKey = String(runtime?.apiKey ?? '').trim();
    const baseUrl = String(runtime?.baseUrl ?? '').trim() || undefined;

    if (!providerCode) throw new Error('IMAGE_PROVIDER_RUNTIME_NOT_CONFIGURED');
    if (!model) throw new Error('IMAGE_MODEL_NOT_CONFIGURED');
    if (!apiKey) throw new Error('IMAGE_API_KEY_NOT_CONFIGURED');

    return { providerCode, model, apiKey, baseUrl };
  }

  /**
   * @description 解析可用的默认生图运行时；缺失关键配置时返回 null。
   * @returns {Promise<{ providerCode: string; model: string; apiKey: string; baseUrl?: string } | null>} 运行时或 null。
   * @keyword-en resolve available default image runtime
   */
  private async resolveAvailableDefaultImageRuntime(): Promise<{
    providerCode: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  } | null> {
    const runtime = await this.adminService.getDefaultImageProviderRuntime();
    const providerCode = String(runtime?.providerCode ?? '').trim();
    const model = String(runtime?.model ?? '').trim();
    const apiKey = String(runtime?.apiKey ?? '').trim();
    const baseUrl = String(runtime?.baseUrl ?? '').trim() || undefined;
    if (!providerCode || !model || !apiKey) return null;
    return { providerCode, model, apiKey, baseUrl };
  }

  /**
   * @description 根据 mimeType 解析图片扩展名。
   * @param {string | undefined} mimeType - 媒体类型。
   * @returns {string} 扩展名。
   * @keyword-en resolve image extension from mime type
   */
  private resolveImageExtFromMimeType(mimeType?: string): string {
    const mt = String(mimeType ?? '').toLowerCase();
    if (mt.includes('png')) return '.png';
    if (mt.includes('webp')) return '.webp';
    if (mt.includes('gif')) return '.gif';
    if (mt.includes('bmp')) return '.bmp';
    if (mt.includes('jpg') || mt.includes('jpeg')) return '.jpg';
    return '.png';
  }

  /**
   * @description 根据图片路径/URL推断 mimeType。
   * @param {string} fileLikePath - 路径或URL。
   * @returns {string} mimeType。
   * @keyword-en resolve image mime type by path
   */
  private resolveImageMimeTypeByPath(fileLikePath: string): string {
    const target = String(fileLikePath ?? '').trim();
    const lower = target.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return 'image/png';
  }

  /**
   * @description 读取运行时图片编辑输入，返回二进制与mime信息。
   * @param {string} imageInput - 本地路径或URL。
   * @returns {Promise<{ buffer: Buffer; mimeType: string; fileName: string }>} 输入图片信息。
   * @keyword-en load runtime edit image input
   */
  private async loadRuntimeEditImageInput(imageInput: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  }> {
    const source = String(imageInput ?? '').trim();
    if (!source) throw new Error('IMAGE_EDIT_BASE_IMAGE_REQUIRED');

    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`IMAGE_EDIT_BASE_IMAGE_DOWNLOAD_FAILED:${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const headerMime = String(response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const urlObj = (() => {
        try {
          return new URL(source);
        } catch {
          return null;
        }
      })();
      const pathname = String(urlObj?.pathname ?? '').trim();
      const fallbackName = `runtime-edit${this.resolveImageExtFromMimeType(headerMime || this.resolveImageMimeTypeByPath(pathname))}`;
      const fileName = path.basename(pathname || fallbackName) || fallbackName;
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType:
          headerMime || this.resolveImageMimeTypeByPath(pathname || fileName),
        fileName,
      };
    }

    const absPath = this.resolveExistingLocalFilePath(source);
    if (!absPath) {
      const fallbackPath = path.isAbsolute(source)
        ? source
        : path.resolve(process.cwd(), source);
      throw new Error(`IMAGE_EDIT_BASE_IMAGE_NOT_FOUND:${fallbackPath}`);
    }
    const buffer = await readFile(absPath);
    return {
      buffer,
      mimeType: this.resolveImageMimeTypeByPath(absPath),
      fileName: path.basename(absPath),
    };
  }

  /**
   * @description 将二进制图片保存到本地 uploads 目录并返回静态路径。
   * 在落盘前经 AntiDetectionService 处理（元数据剥离 / 像素扰动 / 噪点 / 重采样 / gamma），
   * 降低被 AI 生图检测器识别的概率。处理失败自动降级为原始 buffer。
   * @param {Buffer} buffer - 图片二进制。
   * @param {string | undefined} mimeType - 图片 mimeType。
   * @returns {Promise<string>} 静态访问路径。
   * @keyword-en persist generated image buffer to local upload with anti detection
   */
  private async saveGeneratedImageBuffer(
    buffer: Buffer,
    mimeType?: string,
  ): Promise<string> {
    const processed = await this.antiDetection.process(buffer, {
      strength: 'standard',
      outputFormat: 'keep',
      tag: 'ai-agent.saveGeneratedImageBuffer',
    });
    const finalBuffer = processed.buffer;
    const finalMime = processed.processed ? processed.mimeType : mimeType;
    const ext = this.resolveImageExtFromMimeType(finalMime);
    const dir = path.join(process.cwd(), 'public', 'uploads', 'ai-generated');
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const absPath = path.join(dir, fileName);
    await writeFile(absPath, finalBuffer);
    return `/static/uploads/ai-generated/${fileName}`;
  }

  /**
   * @description 保存 base64 图片并返回静态路径。
   * @param {string} base64 - base64 字符串。
   * @param {string | undefined} mimeType - 图片 mimeType。
   * @returns {Promise<string>} 静态路径。
   * @keyword-en persist base64 image to local upload
   */
  private async saveGeneratedImageBase64(
    base64: string,
    mimeType?: string,
  ): Promise<string> {
    const clean = String(base64 ?? '')
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');
    if (!clean) throw new Error('IMAGE_BASE64_EMPTY');
    const buf = Buffer.from(clean, 'base64');
    if (!buf || buf.length === 0) throw new Error('IMAGE_BASE64_INVALID');
    return this.saveGeneratedImageBuffer(buf, mimeType);
  }

  /**
   * @description 下载远端图片到本地并返回静态路径。
   * @param {string} url - 图片 URL。
   * @returns {Promise<string>} 静态路径。
   * @keyword-en download remote generated image
   */
  private async downloadGeneratedImage(url: string): Promise<string> {
    const target = String(url ?? '').trim();
    if (!target) throw new Error('IMAGE_URL_EMPTY');
    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`IMAGE_DOWNLOAD_FAILED:${response.status}`);
    }
    const mimeType = response.headers.get('content-type') ?? undefined;
    const arrayBuffer = await response.arrayBuffer();
    return this.saveGeneratedImageBuffer(Buffer.from(arrayBuffer), mimeType);
  }

  /**
   * @description 使用指定默认生图运行时发送提示词并返回本地图片路径。
   * @param {{ providerCode: string; model: string; apiKey: string; baseUrl?: string }} runtime - 生图运行时。
    * @param {{ prompt: string; size?: string; baseImagePath?: string; baseImageCandidates?: string[] }} input - 生图请求。
   * @returns {Promise<{ providerCode: string; model: string; imagePath: string }>} 生图结果。
   * @keyword-en generate image by configured provider runtime
   */
  private async generateImageByRuntime(
    runtime: {
      providerCode: string;
      model: string;
      apiKey: string;
      baseUrl?: string;
    },
    input: {
      prompt: string;
      size?: string;
      baseImagePath?: string;
      baseImageCandidates?: string[];
    },
  ): Promise<{
    providerCode: string;
    model: string;
    imagePath: string;
  }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('IMAGE_PROMPT_REQUIRED');
    const hasRuntimeEditInput =
      String(input.baseImagePath ?? '').trim().length > 0 ||
      (Array.isArray(input.baseImageCandidates) &&
        input.baseImageCandidates.some((x) => String(x ?? '').trim().length > 0));
    const runtimeBaseImage = hasRuntimeEditInput
      ? this.resolveMeituEditableBaseImage({
          baseImagePath: input.baseImagePath,
          baseImageCandidates: input.baseImageCandidates,
        })
      : null;
    const runtimeEditImage = runtimeBaseImage
      ? await this.loadRuntimeEditImageInput(runtimeBaseImage)
      : null;

    const provider = runtime.providerCode.toLowerCase();

    if (provider === 'gemini') {
      const endpointBase = runtime.baseUrl?.trim() || 'https://generativelanguage.googleapis.com';
      const endpoint = `${endpointBase.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
      const parts: Array<Record<string, unknown>> = runtimeEditImage
        ? [
            {
              inlineData: {
                mimeType: runtimeEditImage.mimeType,
                data: runtimeEditImage.buffer.toString('base64'),
              },
            },
            { text: prompt },
          ]
        : [{ text: prompt }];
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const requestType = runtimeEditImage ? 'EDIT' : 'REQUEST';
        throw new Error(
          `IMAGE_GEMINI_${requestType}_FAILED:${response.status}:${errorText.slice(0, 300)}`,
        );
      }
      const json = (await response.json()) as Record<string, unknown>;
      const candidates = Array.isArray(json['candidates'])
        ? (json['candidates'] as unknown[])
        : [];
      for (const candidate of candidates) {
        const content =
          candidate && typeof candidate === 'object'
            ? (candidate as Record<string, unknown>)['content']
            : undefined;
        const parts =
          content &&
          typeof content === 'object' &&
          Array.isArray((content as Record<string, unknown>)['parts'])
            ? ((content as Record<string, unknown>)['parts'] as unknown[])
            : [];
        for (const part of parts) {
          if (!part || typeof part !== 'object') continue;
          const rec = part as Record<string, unknown>;
          const inlineData =
            rec['inlineData'] && typeof rec['inlineData'] === 'object'
              ? (rec['inlineData'] as Record<string, unknown>)
              : rec['inline_data'] && typeof rec['inline_data'] === 'object'
                ? (rec['inline_data'] as Record<string, unknown>)
                : undefined;
          const data = inlineData?.['data'];
          if (typeof data !== 'string' || data.trim().length === 0) continue;
          const mimeType =
            typeof inlineData?.['mimeType'] === 'string'
              ? (inlineData['mimeType'] as string)
              : typeof inlineData?.['mime_type'] === 'string'
                ? (inlineData['mime_type'] as string)
                : 'image/png';
          const imagePath = await this.saveGeneratedImageBase64(data, mimeType);
          return {
            providerCode: runtime.providerCode,
            model: runtime.model,
            imagePath,
          };
        }
      }
      throw new Error('IMAGE_GEMINI_RESULT_EMPTY');
    }

    if (provider === 'doubao' || provider === 'volcengine' || provider === 'ark') {
      // ark Seedream 5.0 lite：文生图 / 图生图 共用 /images/generations endpoint（ark 无 /images/edits）。
      // 图生图时 body 追加 image 字段（单字符串，URL 或 data:<mime>;base64,<b64>）。
      // size 支持 2K / 4K / 比例(3:4) / 像素(1728x2304)；5.0 lite 像素下限 2560x1440，
      // 低于此值的像素用 resolveMeituRatioBySize 换算为比例。watermark 默认关闭。
      const endpointBase = runtime.baseUrl?.trim() || 'https://ark.cn-beijing.volces.com/api/v3';
      const endpoint = `${endpointBase.replace(/\/$/, '')}/images/generations`;
      // Seedream 5.0 lite size 接受两种格式（互斥）：
      //   1) 档位 '2K' | '3K'
      //   2) 'WIDTHxHEIGHT' 像素串：总像素 ∈ [3,686,400, 10,404,496]，宽高比 ∈ [1/16, 16]
      // 上游传入的小缩略尺寸(如 640x853)按宽高比匹配官方推荐 2K 档位像素值，
      // 既保证落在合法区间又对齐官方推荐档（避免奇形怪状的边缘像素值）。
      const SEED_2K_TABLE: Array<{ ratio: number; size: string }> = [
        { ratio: 1 / 1, size: '2048x2048' },
        { ratio: 4 / 3, size: '2304x1728' },
        { ratio: 3 / 4, size: '1728x2304' },
        { ratio: 16 / 9, size: '2848x1600' },
        { ratio: 9 / 16, size: '1600x2848' },
        { ratio: 3 / 2, size: '2496x1664' },
        { ratio: 2 / 3, size: '1664x2496' },
        { ratio: 21 / 9, size: '3136x1344' },
      ];
      const SEED_DEFAULT = '2048x2048';
      const SEED_MIN_PIXELS = 3_686_400;
      const SEED_MAX_PIXELS = 10_404_496;
      const matchSeedream2KByRatio = (w: number, h: number): string => {
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          return SEED_DEFAULT;
        }
        const target = w / h;
        let best = SEED_2K_TABLE[0];
        let minDiff = Math.abs(target - best.ratio);
        for (const entry of SEED_2K_TABLE) {
          const diff = Math.abs(target - entry.ratio);
          if (diff < minDiff) {
            minDiff = diff;
            best = entry;
          }
        }
        return best.size;
      };
      const sizeRaw =
        typeof input.size === 'string' ? input.size.trim() : '';
      const qualityTier = /^(2k|3k)$/i.exec(sizeRaw)?.[0]?.toUpperCase();
      const pixelMatch = /^(\d{2,5})x(\d{2,5})$/i.exec(sizeRaw);
      const normalizedSize = (() => {
        if (qualityTier) return qualityTier;
        if (pixelMatch) {
          const w = Number(pixelMatch[1]);
          const h = Number(pixelMatch[2]);
          const total = w * h;
          const ratio = w / h;
          // 已是合法像素 → 透传；否则按比例匹配 2K 档推荐值
          if (
            total >= SEED_MIN_PIXELS &&
            total <= SEED_MAX_PIXELS &&
            ratio >= 1 / 16 &&
            ratio <= 16
          ) {
            return `${w}x${h}`;
          }
          return matchSeedream2KByRatio(w, h);
        }
        return SEED_DEFAULT;
      })();
      const body: Record<string, unknown> = {
        model: runtime.model,
        prompt,
        size: normalizedSize,
        output_format: 'png',
        watermark: false,
      };
      if (runtimeEditImage) {
        const mimeType = runtimeEditImage.mimeType || 'image/png';
        const base64 = Buffer.from(runtimeEditImage.buffer).toString('base64');
        body['image'] = `data:${mimeType};base64,${base64}`;
      }
      // 请求信息打印：api key 遮蔽；image 只打 data URI 头部前缀 + 总长度
      const imageField = typeof body['image'] === 'string' ? body['image'] : '';
      const imagePreview = imageField
        ? `${imageField.slice(0, 64)}...<total=${imageField.length}>`
        : '(none)';
      this.logger.log(
        `[ai-cover][doubao] request endpoint=${endpoint} model=${runtime.model} size=${String(body['size'])} output_format=${String(body['output_format'])} watermark=${String(body['watermark'])} promptLen=${prompt.length} authLen=${String(runtime.apiKey ?? '').length} image=${imagePreview}`,
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const requestType = runtimeEditImage ? 'EDIT' : 'GENERATE';
        throw new Error(
          `IMAGE_DOUBAO_${requestType}_FAILED:${response.status}:${errorText.slice(0, 300)}`,
        );
      }
      const json = (await response.json()) as Record<string, unknown>;
      const dataArr = Array.isArray(json['data'])
        ? (json['data'] as unknown[])
        : [];
      const first =
        dataArr.length > 0 && dataArr[0] && typeof dataArr[0] === 'object'
          ? (dataArr[0] as Record<string, unknown>)
          : undefined;
      if (typeof first?.['b64_json'] === 'string') {
        const imagePath = await this.saveGeneratedImageBase64(
          first['b64_json'] as string,
          typeof first['mime_type'] === 'string'
            ? (first['mime_type'] as string)
            : 'image/png',
        );
        return {
          providerCode: runtime.providerCode,
          model: runtime.model,
          imagePath,
        };
      }
      if (typeof first?.['url'] === 'string') {
        const imagePath = await this.downloadGeneratedImage(first['url'] as string);
        return {
          providerCode: runtime.providerCode,
          model: runtime.model,
          imagePath,
        };
      }
      throw new Error('IMAGE_DOUBAO_RESULT_EMPTY');
    }

    if (provider === 'openai') {
      // OpenAI gpt-image-1 / gpt-image-2：
      //  - 文生图: POST /v1/images/generations
      //  - 图生图(底图编辑): POST /v1/images/edits（multipart，image=底图二进制）
      // size 接受 1024x1024 / 1024x1536 / 1536x1024 / auto；其它尺寸按宽高比就近映射。
      const endpointBase = runtime.baseUrl?.trim() || 'https://api.openai.com/v1';
      const sizeRaw =
        typeof input.size === 'string' ? input.size.trim() : '';
      const pixelMatch = /^(\d{2,5})x(\d{2,5})$/i.exec(sizeRaw);
      const normalizedSize = (() => {
        if (/^auto$/i.test(sizeRaw)) return 'auto';
        if (pixelMatch) {
          const w = Number(pixelMatch[1]);
          const h = Number(pixelMatch[2]);
          if (w === h) return '1024x1024';
          if (w > h) return '1536x1024';
          return '1024x1536';
        }
        return '1024x1024';
      })();

      if (runtimeEditImage) {
        const endpoint = `${endpointBase.replace(/\/$/, '')}/images/edits`;
        const form = new FormData();
        form.append('model', runtime.model);
        form.append('prompt', prompt);
        form.append('size', normalizedSize);
        form.append(
          'image',
          new Blob([new Uint8Array(runtimeEditImage.buffer)], {
            type: runtimeEditImage.mimeType || 'image/png',
          }),
          'base.png',
        );
        this.logger.log(
          `[ai-cover][openai] edit endpoint=${endpoint} model=${runtime.model} size=${normalizedSize} promptLen=${prompt.length} authLen=${String(runtime.apiKey ?? '').length} imageBytes=${runtimeEditImage.buffer.byteLength}`,
        );
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${runtime.apiKey}` },
          body: form,
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `IMAGE_OPENAI_EDIT_FAILED:${response.status}:${errorText.slice(0, 300)}`,
          );
        }
        const json = (await response.json()) as Record<string, unknown>;
        const dataArr = Array.isArray(json['data']) ? (json['data'] as unknown[]) : [];
        const first =
          dataArr.length > 0 && dataArr[0] && typeof dataArr[0] === 'object'
            ? (dataArr[0] as Record<string, unknown>)
            : undefined;
        if (typeof first?.['b64_json'] === 'string') {
          const imagePath = await this.saveGeneratedImageBase64(
            first['b64_json'] as string,
            'image/png',
          );
          return { providerCode: runtime.providerCode, model: runtime.model, imagePath };
        }
        if (typeof first?.['url'] === 'string') {
          const imagePath = await this.downloadGeneratedImage(first['url'] as string);
          return { providerCode: runtime.providerCode, model: runtime.model, imagePath };
        }
        throw new Error('IMAGE_OPENAI_EDIT_RESULT_EMPTY');
      }

      const endpoint = `${endpointBase.replace(/\/$/, '')}/images/generations`;
      const body: Record<string, unknown> = {
        model: runtime.model,
        prompt,
        size: normalizedSize,
        n: 1,
      };
      this.logger.log(
        `[ai-cover][openai] generate endpoint=${endpoint} model=${runtime.model} size=${normalizedSize} promptLen=${prompt.length} authLen=${String(runtime.apiKey ?? '').length}`,
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `IMAGE_OPENAI_GENERATE_FAILED:${response.status}:${errorText.slice(0, 300)}`,
        );
      }
      const json = (await response.json()) as Record<string, unknown>;
      const dataArr = Array.isArray(json['data']) ? (json['data'] as unknown[]) : [];
      const first =
        dataArr.length > 0 && dataArr[0] && typeof dataArr[0] === 'object'
          ? (dataArr[0] as Record<string, unknown>)
          : undefined;
      if (typeof first?.['b64_json'] === 'string') {
        const imagePath = await this.saveGeneratedImageBase64(
          first['b64_json'] as string,
          'image/png',
        );
        return { providerCode: runtime.providerCode, model: runtime.model, imagePath };
      }
      if (typeof first?.['url'] === 'string') {
        const imagePath = await this.downloadGeneratedImage(first['url'] as string);
        return { providerCode: runtime.providerCode, model: runtime.model, imagePath };
      }
      throw new Error('IMAGE_OPENAI_GENERATE_RESULT_EMPTY');
    }

    throw new Error(`IMAGE_PROVIDER_NOT_SUPPORTED:${runtime.providerCode}`);
  }

  /**
   * @description 为 meitu image-edit 构建封面编辑提示词。上层只传入"选题/标题/副标题"
   * 等 meta 骨架，本函数补齐所有硬性规格约束（任务/要求/文案/装饰/风格/尺寸），
   * 并强化为明确的"硬性规格-必须严格遵守"指令，最大化底图保真度与可读性。
   * @param {{ prompt: string; size?: string }} input - 编辑上下文。
   * @returns {string} 增强后的编辑提示词。
   * @keyword-en build meitu image edit prompt with hard constraints
   */
  private buildMeituEditPrompt(input: {
    prompt: string;
    size?: string;
  }): string {
    const basePrompt = String(input.prompt ?? '').replace(/\s+/g, ' ').trim();
    const size = String(input.size ?? '').trim();
    const sizeLine =
      size && /^\d{2,5}x\d{2,5}$/i.test(size)
        ? `尺寸规格:竖版封面 ${size}，严禁输出横版或方版`
        : '尺寸规格:竖版封面，严禁输出横版或方版';

    const metaBlock = basePrompt.length > 0 ? `【封面元信息】\n${basePrompt}` : '';

    const hardBlock = [
      '【硬性规格 - 必须严格遵守，违反即判为失败】',
      '1. 任务:基于所提供底图做二次编辑/重绘，鼓励大胆做风格化转换(写实→插画/卡通/3D/手绘/赛博等)与装饰夸张化处理；但严禁完全脱离底图生成无关画面，主体与场景的识别度必须保留(看得出"是谁/是什么/在哪/在做什么")。',
      '2. 底图识别度:主体身份、场景关系、核心姿态/构图占位需可识别；允许风格化重绘、表情与动作适度夸张化、局部动画化处理；严禁替换主体身份、严禁抹除主体使其消失。',
      '3. 文案呈现:必须将上文"封面主标题/封面副标题"以浮动文字形式清晰排版在画面中；主标题字号显著大于副标题；严禁被人物/物体/背景遮挡；严禁出现错别字、乱码、重复字、残缺字。',
      '4. 装饰元素:鼓励叠加贴纸类装饰(光斑、彩带、箭头、气泡、星芒、胶带、涂鸦、漫画对话框、拟声词等)提升封面活力与点击率；装饰不得遮盖主标题、副标题、主体面部。',
      '5. 风格:小红书爆款封面质感——清晰明快、生活方式感、高对比、画面饱满、适合移动端竖屏浏览；可走插画/卡通/3D/赛博等动画化方向；杜绝灰暗脏污、低分辨率、过度滤镜、保守复制无改造感。',
      `6. ${sizeLine}`,
      '7. 输出:仅输出最终编辑后的封面图本体，严禁在画面中加入水印、平台 logo、网址、二维码、无关文字。',
    ].join('\n');

    return [metaBlock, hardBlock].filter((x) => x.length > 0).join('\n\n');
  }

  /**
   * @description 将 WxH 尺寸映射为 meitu image-edit ratio 参数。
   * @param {string | undefined} size - 尺寸（如 640x853）。
   * @returns {string | undefined} ratio（如 3:4）。
   * @keyword-en resolve meitu ratio by size
   */
  private resolveMeituRatioBySize(size?: string): string | undefined {
    const s = String(size ?? '').trim();
    if (!/^\d{2,5}x\d{2,5}$/i.test(s)) return undefined;
    const [wRaw, hRaw] = s.toLowerCase().split('x');
    const width = Number(wRaw);
    const height = Number(hRaw);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return undefined;
    }
    const target = width / height;
    const ratioCandidates: Array<{ name: string; value: number }> = [
      { name: '1:1', value: 1 },
      { name: '2:3', value: 2 / 3 },
      { name: '3:2', value: 3 / 2 },
      { name: '3:4', value: 3 / 4 },
      { name: '4:3', value: 4 / 3 },
      { name: '4:5', value: 4 / 5 },
      { name: '5:4', value: 5 / 4 },
      { name: '9:16', value: 9 / 16 },
      { name: '16:9', value: 16 / 9 },
      { name: '21:9', value: 21 / 9 },
    ];

    let best = ratioCandidates[0];
    let minDiff = Math.abs(target - best.value);
    for (const candidate of ratioCandidates) {
      const diff = Math.abs(target - candidate.value);
      if (diff < minDiff) {
        best = candidate;
        minDiff = diff;
      }
    }
    return minDiff <= 0.12 ? best.name : undefined;
  }

  /**
   * @description 将输入图片候选转换为 meitu 可识别的路径或 URL。
   * @param {string} candidate - 图片候选（URL、静态路径或本地路径）。
   * @returns {string} 规范化后的图片输入。
   * @keyword-en normalize meitu image input candidate
   */
  private normalizeMeituImageInputCandidate(candidate: string): string {
    const raw = String(candidate ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;

    const normalized = raw.replace(/\\/g, '/');
    if (normalized.startsWith('/static/uploads/')) {
      return path.join(
        process.cwd(),
        'public',
        'uploads',
        normalized.slice('/static/uploads/'.length),
      );
    }
    if (normalized.startsWith('/uploads/')) {
      return path.join(process.cwd(), 'public', normalized.slice(1));
    }
    // NOTE: 对其他 / 开头路径（含 Linux 绝对路径如 /app/public/uploads/xxx）直接原样返回，
    // 由 resolveExistingLocalFilePath 通过 remapAbsolutePublicPath 做映射；
    // 以前此处强制拼 {cwd}/public 会把 /app/public/uploads/xxx 变成 {cwd}/public/app/public/uploads/xxx 永远找不到。
    if (normalized.startsWith('/')) {
      return raw;
    }
    return path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)
      ? raw
      : path.resolve(process.cwd(), raw);
  }

  /**
   * @description 将任意绝对路径中的 /public/... 段映射到当前工作区 public 目录。
   * @param {string} absolutePath - 绝对路径。
   * @returns {string | null} 映射后的工作区路径。
   * @keyword-en remap absolute public path to workspace
   */
  private remapAbsolutePublicPathToWorkspace(absolutePath: string): string | null {
    const normalized = String(absolutePath ?? '').trim().replace(/\\/g, '/');
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    const marker = '/public/';
    const markerIndex = lower.indexOf(marker);
    if (markerIndex < 0) return null;

    const relative = normalized
      .slice(markerIndex + marker.length)
      .replace(/^\/+/, '');
    return relative
      ? path.join(process.cwd(), 'public', relative)
      : path.join(process.cwd(), 'public');
  }

  /**
   * @description 在区分大小写的文件系统上，按目录逐层执行不区分大小写匹配。
   * @param {string} targetPath - 待匹配的绝对路径。
   * @returns {string | null} 命中的真实路径。
   * @keyword-en resolve existing path by case-insensitive walk
   */
  private resolveCaseInsensitiveExistingPath(targetPath: string): string | null {
    const raw = String(targetPath ?? '').trim();
    if (!raw) return null;
    const absPath = path.resolve(raw);
    if (fs.existsSync(absPath)) return absPath;

    const parsed = path.parse(absPath);
    if (!parsed.root) return null;
    const segments = absPath
      .slice(parsed.root.length)
      .split(path.sep)
      .filter((x) => x.length > 0);

    let current = parsed.root;
    for (const segment of segments) {
      const exactPath = path.join(current, segment);
      if (fs.existsSync(exactPath)) {
        current = exactPath;
        continue;
      }
      let children: string[] = [];
      try {
        children = fs.readdirSync(current);
      } catch {
        return null;
      }
      const matched = children.find(
        (name) => name.toLowerCase() === segment.toLowerCase(),
      );
      if (!matched) return null;
      current = path.join(current, matched);
    }

    return fs.existsSync(current) ? current : null;
  }

  /**
   * @description 解析并匹配本地可用文件路径（支持 /public 映射与大小写容错）。
   * @param {string} filePath - 候选文件路径。
   * @returns {string | null} 可用文件绝对路径。
   * @keyword-en resolve existing local file path with docker fallback
   */
  private resolveExistingLocalFilePath(filePath: string): string | null {
    const raw = String(filePath ?? '').trim();
    if (!raw) return null;

    const normalized = raw.replace(/\\/g, '/');
    const isWindowsAbs = /^[a-zA-Z]:\//.test(normalized);
    const basePath =
      path.isAbsolute(raw) || isWindowsAbs
        ? raw
        : path.resolve(process.cwd(), raw);

    const candidates: string[] = [basePath];
    const remapped = this.remapAbsolutePublicPathToWorkspace(basePath);
    if (remapped && !candidates.some((x) => x === remapped)) {
      candidates.push(remapped);
    }

    this.logger.log(
      `[meitu][file-resolve] input=${raw} basePath=${basePath} remapped=${remapped ?? 'none'} candidates=${JSON.stringify(candidates)}`,
    );

    for (const candidate of candidates) {
      const exists = fs.existsSync(candidate);
      this.logger.log(`[meitu][file-resolve] existsSync(${candidate})=${exists}`);
      if (exists) return candidate;
      const byInsensitiveWalk = this.resolveCaseInsensitiveExistingPath(candidate);
      this.logger.log(
        `[meitu][file-resolve] caseInsensitive(${candidate})=${byInsensitiveWalk ?? 'null'}`,
      );
      if (byInsensitiveWalk) return byInsensitiveWalk;
    }
    return null;
  }

  /**
   * @description 从候选图中匹配可用底图，供 meitu image-edit 使用。
   * @param {{ baseImagePath?: string; baseImageCandidates?: string[] }} input - 底图候选输入。
   * @returns {string} 可用底图路径或 URL。
   * @keyword-en resolve meitu editable base image
   */
  private resolveMeituEditableBaseImage(input: {
    baseImagePath?: string;
    baseImageCandidates?: string[];
  }): string {
    const direct = String(input.baseImagePath ?? '').trim();
    const fromList = Array.isArray(input.baseImageCandidates)
      ? input.baseImageCandidates
          .map((x) => String(x ?? '').trim())
          .filter((x) => x.length > 0)
      : [];
    const candidates = [direct, ...fromList].filter((x) => x.length > 0);

    this.logger.log(
      `[meitu][base-image] resolve_start cwd=${process.cwd()} candidates(${candidates.length})=${JSON.stringify(candidates)}`,
    );

    for (const candidate of candidates) {
      const normalized = this.normalizeMeituImageInputCandidate(candidate);
      this.logger.log(
        `[meitu][base-image] candidate=${candidate} normalized=${normalized}`,
      );
      if (!normalized) continue;
      if (/^https?:\/\//i.test(normalized)) {
        this.logger.log(`[meitu][base-image] hit=url url=${normalized}`);
        return normalized;
      }
      const localPath = this.resolveExistingLocalFilePath(normalized);
      if (localPath) {
        this.logger.log(`[meitu][base-image] hit=local resolved=${localPath}`);
        return localPath;
      }
      this.logger.warn(`[meitu][base-image] miss candidate=${candidate} normalized=${normalized}`);
    }

    const summary = candidates.join('|').slice(0, 260);
    this.logger.error(`[meitu][base-image] not_found cwd=${process.cwd()} summary=${summary}`);
    throw new Error(`MEITU_BASE_IMAGE_NOT_FOUND:${summary}`);
  }

  /**
   * @description 从文本中尽力提取 JSON 对象。
   * @param {string} text - CLI 输出文本。
   * @returns {Record<string, unknown> | null} 解析结果。
   * @keyword-en parse loose json object from text
   */
  private tryParseJsonObject(text: string): Record<string, unknown> | null {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      void 0;
    }
    const lines = raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .reverse();
    for (const line of lines) {
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        void 0;
      }
    }
    return null;
  }

  /**
   * @description 兜底解析 meitu-cli 的扁平 key-value 文本（"code: 0 message: success result: https://... progress: 1"）。
   * 即使传了 --json，meitu-cli 实际仍可能输出这种空格串，JSON.parse 必然失败；
   * 本方法按"key: " 切分，value 截止到下一个 key 前，容忍 URL 中的 ":"。
   * @param {string} text - CLI 原始 stdout。
   * @returns {Record<string, unknown> | null} 解析后的键值对，无效时返回 null。
   * @keyword-en parse meitu cli flat key value text
   */
  private parseMeituKeyValueText(
    text: string,
  ): Record<string, unknown> | null {
    const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const keyRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*/g;
    const hits: Array<{ key: string; start: number; valueStart: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(raw)) !== null) {
      hits.push({ key: m[1], start: m.index, valueStart: keyRe.lastIndex });
    }
    if (hits.length === 0) return null;
    const out: Record<string, unknown> = {};
    for (let i = 0; i < hits.length; i++) {
      const cur = hits[i];
      const end = i + 1 < hits.length ? hits[i + 1].start : raw.length;
      const valStr = raw.slice(cur.valueStart, end).trim();
      const num = Number(valStr);
      out[cur.key] =
        valStr !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(valStr)
          ? num
          : valStr;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * @description 从 meitu 返回对象里提取首个本地下载文件路径。
   * @param {Record<string, unknown>} payload - meitu JSON 响应。
   * @returns {string | null} 本地文件路径。
   * @keyword-en resolve meitu downloaded file path
   */
  private resolveMeituDownloadedPath(payload: Record<string, unknown>): string | null {
    const roots: Record<string, unknown>[] = [payload];
    const data = payload['data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      roots.push(data as Record<string, unknown>);
    }
    const result = payload['result'];
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      roots.push(result as Record<string, unknown>);
    }
    for (const root of roots) {
      const downloadedFiles = root['downloaded_files'];
      if (Array.isArray(downloadedFiles)) {
        for (const item of downloadedFiles) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const candidates = [
            rec['saved_path'],
            rec['savedPath'],
            rec['file_path'],
            rec['filePath'],
            rec['local_path'],
            rec['localPath'],
            rec['path'],
          ];
          const p = candidates.find((x) => typeof x === 'string') as
            | string
            | undefined;
          if (p && p.trim().length > 0) return p.trim();
        }
      }
      const topPathCandidates = [
        root['saved_path'],
        root['savedPath'],
        root['file_path'],
        root['filePath'],
        root['local_path'],
        root['localPath'],
      ];
      const topPath = topPathCandidates.find((x) => typeof x === 'string') as
        | string
        | undefined;
      if (topPath && topPath.trim().length > 0) return topPath.trim();
    }
    return null;
  }

  /**
   * @description 从 meitu 返回对象里提取首个输出 URL。
   * @param {Record<string, unknown>} payload - meitu JSON 响应。
   * @returns {string | null} URL。
   * @keyword-en resolve meitu media url
   */
  private resolveMeituMediaUrl(payload: Record<string, unknown>): string | null {
    const roots: Record<string, unknown>[] = [payload];
    const data = payload['data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      roots.push(data as Record<string, unknown>);
    }
    const result = payload['result'];
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      roots.push(result as Record<string, unknown>);
    }
    for (const root of roots) {
      const mediaUrls = root['media_urls'];
      if (Array.isArray(mediaUrls)) {
        const first = mediaUrls.find((x) => typeof x === 'string') as
          | string
          | undefined;
        if (first && first.trim().length > 0) return first.trim();
      }
      const directCandidates = [
        root['media_url'],
        root['mediaUrl'],
        root['image_url'],
        root['imageUrl'],
        root['output_url'],
        root['outputUrl'],
        root['url'],
      ];
      const direct = directCandidates.find((x) => typeof x === 'string') as
        | string
        | undefined;
      if (direct && direct.trim().length > 0) return direct.trim();
      // meitu-cli 扁平输出下 result 直接是一个 URL 字符串（http(s) 才认，避免与对象型 result 冲突）
      const resultField = root['result'];
      if (
        typeof resultField === 'string' &&
        /^https?:\/\//i.test(resultField.trim())
      ) {
        return resultField.trim();
      }
    }
    return null;
  }

  /**
   * @description 将 meitu 生成的本地文件复制入统一上传目录并返回静态路径。
   * @param {string} filePath - 本地文件路径。
   * @returns {Promise<string>} 静态路径。
   * @keyword-en persist meitu local file to upload
   */
  private async persistMeituGeneratedFile(filePath: string): Promise<string> {
    const p = String(filePath ?? '').trim();
    if (!p) throw new Error('MEITU_OUTPUT_FILE_EMPTY');
    const absPath = this.resolveExistingLocalFilePath(p);
    if (!absPath) {
      throw new Error('MEITU_OUTPUT_FILE_NOT_FOUND');
    }
    const ext = path.extname(absPath).toLowerCase();
    const mimeType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.bmp'
              ? 'image/bmp'
              : 'image/png';
    const buffer = await readFile(absPath);
    return this.saveGeneratedImageBuffer(buffer, mimeType);
  }

  /**
   * @description 构建 meitu 可执行命令候选列表（兼容 Windows 全局安装路径）。
   * @returns {string[]} 可执行命令候选。
   * @keyword-en build meitu cli candidates
   */
  private buildMeituCliCandidates(): string[] {
    const configured = String(process.env.MEITU_CLI_BIN ?? '').trim();
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string | undefined): void => {
      const val = String(raw ?? '').trim();
      if (!val) return;
      const key = process.platform === 'win32' ? val.toLowerCase() : val;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(val);
    };

    if (configured) {
      push(configured);
      if (process.platform === 'win32' && !/\.(cmd|exe|bat)$/i.test(configured)) {
        push(`${configured}.cmd`);
      }
    }

    push('meitu');
    if (process.platform === 'win32') {
      push('meitu.cmd');

      const pnpmHome = String(process.env.PNPM_HOME ?? '').trim();
      if (pnpmHome) {
        push(path.join(pnpmHome, 'meitu.cmd'));
        push(path.join(pnpmHome, 'meitu'));
      }

      const appData = String(process.env.APPDATA ?? '').trim();
      if (appData) {
        push(path.join(appData, 'npm', 'meitu.cmd'));
        push(path.join(appData, 'npm', 'meitu'));
      }

      const userProfile = String(process.env.USERPROFILE ?? '').trim();
      if (userProfile) {
        push(path.join(userProfile, 'AppData', 'Roaming', 'npm', 'meitu.cmd'));
        push(path.join(userProfile, 'AppData', 'Roaming', 'npm', 'meitu'));
      }
    }

    return out;
  }

  /**
   * @description 执行 meitu CLI 命令并返回 stdout/stderr（Windows 使用 shell 兼容 .cmd）。
   * @param {string} cliBin - 可执行命令。
   * @param {string[]} args - 参数列表。
    * @returns {Promise<{ stdout: string; stderr: string; exitCode: number }>} 输出结果。
   * @keyword-en run meitu cli command
   */
  private async runMeituCli(
    cliBin: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
      (resolve, reject) => {
        const child = spawn(cliBin, args, {
          shell: process.platform === 'win32',
          env: process.env,
          windowsHide: true,
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {
            void 0;
          }
          reject(new Error('MEITU_CLI_TIMEOUT'));
        }, 120_000);

        child.stdout.on('data', (chunk: Buffer | string) => {
          const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          stdout += s;
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
          const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          stderr += s;
        });

        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode:
              typeof code === 'number' && Number.isFinite(code) ? code : -1,
          });
        });
      },
    );
  }

  /**
   * @description 使用 meitu skill（meitu-cli）执行 image-edit 并返回静态路径。
   * @param {{ prompt: string; size?: string; baseImagePath?: string; baseImageCandidates?: string[] }} input - 编辑请求。
   * @returns {Promise<{ providerCode: string; model: string; imagePath: string }>} 生图结果。
   * @keyword-en generate image by meitu image-edit fallback
   */
  private async generateImageByMeituSkill(input: {
    prompt: string;
    size?: string;
    baseImagePath?: string;
    baseImageCandidates?: string[];
  }): Promise<{
    providerCode: string;
    model: string;
    imagePath: string;
  }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('IMAGE_PROMPT_REQUIRED');
    const baseImage = this.resolveMeituEditableBaseImage({
      baseImagePath: input.baseImagePath,
      baseImageCandidates: input.baseImageCandidates,
    });

    const cliCandidates = this.buildMeituCliCandidates();
    const outputDir = path.join(process.cwd(), 'public', 'uploads', 'ai-generated', 'meitu');
    await mkdir(outputDir, { recursive: true });

    const finalPrompt = prompt;
    const ratio = this.resolveMeituRatioBySize(input.size);
    this.logger.log(
      `[ai-cover][meitu] start candidates=${cliCandidates.join('|')} promptLen=${finalPrompt.length} size=${String(input.size ?? '') || 'default'} ratio=${ratio ?? 'auto'} baseImage=${baseImage} outputDir=${outputDir}`,
    );
    let stdoutText = '';
    let stderrText = '';
    let executedCli = '';
    let lastEnoent = false;
    for (const cliBin of cliCandidates) {
      let commandForLog = cliBin;
      try {
        const quoteWinPathArg = (value: string): string => {
          const raw = String(value ?? '').trim();
          if (process.platform !== 'win32') return raw;
          const escaped = raw.replace(/"/g, '\\"');
          return `"${escaped}"`;
        };
        const imageArg = quoteWinPathArg(baseImage);
        const downloadDirArg = quoteWinPathArg(outputDir);

        const args = ['image-edit', '--image', imageArg, '--prompt', finalPrompt];
        if (ratio) args.push('--ratio', ratio);
        args.push('--json', '--download-dir', downloadDirArg);
        const quoteArg = (value: string): string => {
          const s = String(value ?? '');
          if (s.length === 0) return '""';
          if (s.startsWith('"') && s.endsWith('"')) return s;
          if (/^[^\s"'`]+$/.test(s)) return s;
          return `"${s.replace(/"/g, '\\"')}"`;
        };
        commandForLog = [cliBin, ...args].map((x) => quoteArg(x)).join(' ');
        this.logger.log(`[ai-cover][meitu] cli_exec command=${commandForLog}`);

        const result = await this.runMeituCli(cliBin, args);
        stdoutText = String(result.stdout ?? '');
        stderrText = String(result.stderr ?? '');

        if (result.exitCode !== 0) {
          const payload =
            this.tryParseJsonObject(stdoutText) ??
            this.tryParseJsonObject(stderrText);
          if (payload) {
            const errName =
              typeof payload['error_name'] === 'string'
                ? payload['error_name']
                : typeof payload['errorName'] === 'string'
                  ? payload['errorName']
                  : '';
            const errMsg =
              typeof payload['message'] === 'string'
                ? payload['message']
                : typeof payload['error_message'] === 'string'
                  ? payload['error_message']
                  : '';
            this.logger.error(
              `[ai-cover][meitu] cli_failed cli=${cliBin} code=${result.exitCode} command=${commandForLog} errorName=${errName} message=${String(errMsg).slice(0, 220)}`,
            );
            if (errName === 'CONFIGURATION_ERROR') {
              throw new Error(
                `MEITU_CREDENTIALS_NOT_CONFIGURED:${String(errMsg || 'credentials not configured')}`,
              );
            }
            if (errName || errMsg) {
              throw new Error(
                `MEITU_SKILL_FAILED:${errName}:${String(errMsg).slice(0, 220)}`,
              );
            }
          }

          const stdoutSnippet = stdoutText.replace(/\s+/g, ' ').trim().slice(0, 220);
          const stderrSnippet = stderrText.replace(/\s+/g, ' ').trim().slice(0, 220);
          this.logger.error(
            `[ai-cover][meitu] cli_failed cli=${cliBin} code=${result.exitCode} command=${commandForLog} stdout=${stdoutSnippet} stderr=${stderrSnippet}`,
          );
          throw new Error(
            `MEITU_SKILL_CALL_FAILED:MEITU_CLI_EXIT_NON_ZERO:${result.exitCode}:${stderrSnippet || stdoutSnippet}`,
          );
        }

        executedCli = cliBin;
        this.logger.log(
          `[ai-cover][meitu] cli_done cli=${executedCli} command=${commandForLog} stdoutLen=${stdoutText.length} stderrLen=${stderrText.length}`,
        );
        lastEnoent = false;
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isEnoent = msg.includes('ENOENT');
        if (isEnoent) {
          lastEnoent = true;
          this.logger.warn(
            `[ai-cover][meitu] cli_not_found candidate=${cliBin} command=${commandForLog}`,
          );
          continue;
        }
        this.logger.error(
          `[ai-cover][meitu] cli_failed cli=${cliBin} command=${commandForLog} message=${msg.slice(0, 300)}`,
        );
        throw new Error(`${msg.slice(0, 300)}`);
      }
    }

    if (!executedCli) {
      if (lastEnoent) {
        throw new Error(
          `MEITU_CLI_NOT_FOUND:Install meitu-cli and configure credentials first (candidates=${cliCandidates.join('|')})`,
        );
      }
      throw new Error('MEITU_SKILL_CALL_FAILED:NO_CLI_EXECUTED');
    }

    const payload =
      this.tryParseJsonObject(stdoutText) ??
      this.tryParseJsonObject(stderrText) ??
      this.parseMeituKeyValueText(stdoutText) ??
      this.parseMeituKeyValueText(stderrText);
    if (!payload) {
      const stdoutSnippet = stdoutText.replace(/\s+/g, ' ').slice(0, 800);
      const stderrSnippet = stderrText.replace(/\s+/g, ' ').slice(0, 400);
      this.logger.error(
        `[ai-cover][meitu] result_invalid_json cli=${executedCli} stdoutLen=${stdoutText.length} stderrLen=${stderrText.length} stdout=${stdoutSnippet} stderr=${stderrSnippet}`,
      );
      throw new Error(
        `MEITU_SKILL_RESULT_INVALID_JSON:stdoutLen=${stdoutText.length}:${stdoutSnippet.slice(0, 200)}`,
      );
    }

    const savedPath = this.resolveMeituDownloadedPath(payload);
    if (savedPath) {
      const imagePath = await this.persistMeituGeneratedFile(savedPath);
      this.logger.log(
        `[ai-cover][meitu] success_by_saved_path source=${savedPath} imagePath=${imagePath}`,
      );
      return {
        providerCode: 'meitu-skill',
        model: 'meitu-image-edit',
        imagePath,
      };
    }

    const mediaUrl = this.resolveMeituMediaUrl(payload);
    if (mediaUrl) {
      const imagePath = await this.downloadGeneratedImage(mediaUrl);
      this.logger.log(
        `[ai-cover][meitu] success_by_media_url imagePath=${imagePath}`,
      );
      return {
        providerCode: 'meitu-skill',
        model: 'meitu-image-edit',
        imagePath,
      };
    }

    const errName =
      typeof payload['error_name'] === 'string'
        ? payload['error_name']
        : typeof payload['errorName'] === 'string'
          ? payload['errorName']
          : '';
    const errMsg =
      typeof payload['error_message'] === 'string'
        ? payload['error_message']
        : typeof payload['message'] === 'string'
          ? payload['message']
          : '';
    if (errName || errMsg) {
      this.logger.error(
        `[ai-cover][meitu] result_failed errorName=${errName} errorMsg=${String(errMsg).slice(0, 200)}`,
      );
      throw new Error(`MEITU_SKILL_FAILED:${errName}:${errMsg}`);
    }
    this.logger.error('[ai-cover][meitu] result_empty');
    throw new Error('MEITU_SKILL_RESULT_EMPTY');
  }

  /**
   * @description AI封面生成工具：优先本地默认 image 运行时；无可用配置时回退 meitu skill。
   * @param {{ prompt: string; size?: string; baseImagePath?: string; baseImageCandidates?: string[] }} input - 生图请求。
   * @returns {Promise<{ providerCode: string; model: string; imagePath: string }>} 生图结果。
   * @keyword-en ai cover generate tool
   */
  private async runAiCoverGenerateTool(input: {
    prompt: string;
    size?: string;
    baseImagePath?: string;
    baseImageCandidates?: string[];
  }): Promise<{
    providerCode: string;
    model: string;
    imagePath: string;
  }> {
    const finalPrompt = this.buildMeituEditPrompt({
      prompt: input.prompt,
      size: input.size,
    });

    const runtime = await this.resolveAvailableDefaultImageRuntime();
    const hasEditBaseImage =
      String(input.baseImagePath ?? '').trim().length > 0 ||
      (Array.isArray(input.baseImageCandidates) &&
        input.baseImageCandidates.some((x) => String(x ?? '').trim().length > 0));
    if (runtime) {
      this.logger.log(
        `[ai-cover][tool] use_default_runtime provider=${runtime.providerCode} model=${runtime.model}`,
      );
      try {
        return await this.generateImageByRuntime(runtime, {
          prompt: finalPrompt,
          size: input.size,
          baseImagePath: input.baseImagePath,
          baseImageCandidates: input.baseImageCandidates,
        });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error ?? '');
        if (msg.includes('IMAGE_PROVIDER_NOT_SUPPORTED')) {
          if (hasEditBaseImage) {
            throw new Error(
              `IMAGE_EDIT_PROVIDER_NOT_SUPPORTED:${runtime.providerCode}`,
            );
          }
          this.logger.warn(
            `[ai-cover][tool] runtime_provider_not_supported provider=${runtime.providerCode}, fallback=meitu`,
          );
          return this.generateImageByMeituSkill({
            prompt: finalPrompt,
            size: input.size,
            baseImagePath: input.baseImagePath,
            baseImageCandidates: input.baseImageCandidates,
          });
        }
        // provider 侧调用失败（如 429/404/502、鉴权失败、额度耗尽等），不让生图流程判死，
        // 统一降级到 meitu-cli。错误模式：IMAGE_<PROVIDER>_(EDIT|GENERATE)_FAILED:...
        if (/^IMAGE_[A-Z]+_(EDIT|GENERATE)_FAILED/.test(msg)) {
          this.logger.warn(
            `[ai-cover][tool] runtime_call_failed provider=${runtime.providerCode} fallback=meitu message=${msg.slice(0, 200)}`,
          );
          return this.generateImageByMeituSkill({
            prompt: finalPrompt,
            size: input.size,
            baseImagePath: input.baseImagePath,
            baseImageCandidates: input.baseImageCandidates,
          });
        }
        throw error;
      }
    }
    this.logger.warn('[ai-cover][tool] default_image_runtime_missing, fallback=meitu');
    return this.generateImageByMeituSkill({
      prompt: finalPrompt,
      size: input.size,
      baseImagePath: input.baseImagePath,
      baseImageCandidates: input.baseImageCandidates,
    });
  }

  /**
   * @description 使用 AI 封面生成工具发送提示词并返回本地图片路径。
   * @param {{ prompt: string; size?: string; baseImagePath?: string; baseImageCandidates?: string[] }} input - 生图请求。
   * @returns {Promise<{ providerCode: string; model: string; imagePath: string }>} 生图结果。
   * @keyword-en send prompt for image generation
   */
  async sendPrompt(input: {
    prompt: string;
    size?: string;
    baseImagePath?: string;
    baseImageCandidates?: string[];
  }): Promise<{
    providerCode: string;
    model: string;
    imagePath: string;
  }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('IMAGE_PROMPT_REQUIRED');
    return this.runAiCoverGenerateTool({
      prompt,
      size: input.size,
      baseImagePath: input.baseImagePath,
      baseImageCandidates: input.baseImageCandidates,
    });
  }

  /**
   * @title 运行Agent Run Agent
   * @description 使用配置与历史消息执行一次对话，返回AI消息。
   * @keywords-cn 运行Agent, 对话
   * @keywords-en run agent, chat
   */
  async run(input: AgentRunInput): Promise<AIMessage> {
    const messages: BaseMessage[] = [];
    for (let i = 0; i < input.history.length; i++) {
      messages.push(input.history[i]);
    }
    messages.push(new HumanMessage(input.input));
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    const callback: Callbacks = [
      {
        handleLLMNewToken(token: string) {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer(token);
            } catch {
              // ignore
            }
          }
        },
        handleLLMStart() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMStart]');
            } catch {
              // ignore
            }
          }
        },
        handleLLMEnd() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMEnd]');
            } catch {
              // ignore
            }
          }
        },
      },
    ];
    const state: unknown = await agent.invoke(
      {
        messages: extracted.messages,
      },
      input.config.nonStreaming ? undefined : { callbacks: callback },
    );
    const stateMessages = this.extractStateMessages(state);
    for (let i = stateMessages.length - 1; i >= 0; i--) {
      const msg = stateMessages[i];
      if (msg instanceof AIMessage) {
        return msg;
      }
    }
    return new AIMessage('');
  }

  /**
   * @title 运行Agent（消息） Run Agent With Messages
   * @description 使用消息列表执行Agent并返回最后一条AI消息。
   * @keywords-cn 运行, 消息, 调用
   * @keywords-en run, messages, invoke
   */
  async runWithMessages(input: AgentRunMessagesInput): Promise<AIMessage> {
    const callback: Callbacks = [
      {
        handleLLMNewToken() {},
        handleLLMStart() {},
        handleLLMEnd() {},
      },
    ];
    // 确保 configurable 字段始终存在
    const defaultConfigurable = {
      thread_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      checkpoint_ns: 'default',
      checkpoint_id: 'root',
    };
    const preOption: () => AgentRunMessagesInput['callOption'] = () => {
      const option: any = {
        ...input.callOption,
      };
      // 将 configurable 与默认值合并
      const existingConfigurable =
        (input.callOption as Record<string, unknown>)?.configurable ?? {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.configurable = { ...defaultConfigurable, ...existingConfigurable };

      if (input.config.nonStreaming) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        option.callbacks = callback;
      }

      if (input.config.noPostHook) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        option.tags = ['subagent'];
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.context = input.config.context;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return option;
    };
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(input.messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    const state: unknown = await agent.invoke(
      { messages: extracted.messages },
      { ...preOption() },
    );
    const stateMessages = this.extractStateMessages(state);
    for (let i = stateMessages.length - 1; i >= 0; i--) {
      const msg = stateMessages[i];
      if (msg instanceof AIMessage) {
        return msg;
      }
      if (msg instanceof AIMessageChunk) {
        return this.coerceAIMessageFromChunk(msg);
      }
    }

    return new AIMessage('');
  }

  /**
   * @title 运行子代理（消息） Run SubAgent With Messages
   * @description 以子代理模式运行消息，默认开启 noPostHook 与 nonStreaming。
   * @keywords-cn 子代理, 消息, 调用
   * @keywords-en subagent, messages, invoke
   */
  async runSubAgentWithMessages(
    input: AgentRunMessagesInput,
  ): Promise<AIMessage> {
    return await this.runWithMessages({
      ...input,
      config: {
        ...input.config,
        noPostHook: true,
        nonStreaming: true,
      },
    });
  }

  /**
   * @description 解析流式模式配置，默认同时开启 messages+updates。
   * @param {AgentConfig['streamMode']} streamMode - 流模式配置。
   * @returns {Array<'messages' | 'updates'>} 可传给 LangChain 的 streamMode 列表。
   * @keyword-en resolve stream modes
   */
  private resolveStreamModes(
    streamMode?: AgentConfig['streamMode'],
  ): Array<'messages' | 'updates'> {
    if (streamMode === 'messages') return ['messages'];
    if (streamMode === 'updates') return ['updates'];
    return ['messages', 'updates'];
  }

  /**
   * @title 流式运行Agent Stream Agent
   * @description 以双模式流(messages+updates)返回 token、tool、subagent 等完整事件流。
   * @keywords-cn 流式, 令牌, 事件, 深度思考, 函数调用, 子代理
   * @keywords-en stream, token, events, deep thinking, function call, subagent
   */
  async *stream(input: AgentRunStreamInput): AsyncIterable<AgentStreamEvent> {
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(input.messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    // 确保 configurable 字段始终存在
    const defaultConfigurable = {
      thread_id: `stream_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      checkpoint_ns: 'default',
      checkpoint_id: 'root',
    };
    const existingConfigurable =
      typeof input.callOption?.configurable === 'object' &&
      input.callOption?.configurable !== null
        ? input.callOption.configurable
        : {};
    const mergedConfigurable = {
      ...defaultConfigurable,
      ...existingConfigurable,
    };
    yield { type: 'start', data: { input: extracted.messages } };

    const streamSubgraphs = input.config.streamSubgraphs ?? true;
    const callOption: NonNullable<AgentStreamOption> = {
      configurable: mergedConfigurable,
      recursionLimit: input.config.recursionLimit,
      context: input.config.context,
      subgraphs: streamSubgraphs,
    };
    if (input.callOption) Object.assign(callOption, input.callOption);

    let fullText = '';
    const toolCalls: unknown[] = [];
    const toolResults: { name?: unknown; output?: unknown }[] = [];

    try {
      const streamModes = this.resolveStreamModes(input.config.streamMode);
      const stream = await agent.stream(
        { messages: extracted.messages },
        { ...callOption, streamMode: streamModes },
      );

      const logFilePath = path.join(process.cwd(), 'llm-chunk.log');
      try {
        fs.writeFileSync(logFilePath, '');
      } catch {
        // ignore
      }

      /**
       * 双模式流返回三元组: [namespace, mode, data]
       * - mode='messages': data=[message, metadata] — LLM token / tool result
       * - mode='updates':  data={nodeName: nodeData}  — 子代理生命周期
       */
      const isStreamMode = (
        value: unknown,
      ): value is 'messages' | 'updates' =>
        value === 'messages' || value === 'updates';

      for await (const tuple of stream) {
        const rawTuple: unknown = tuple;
        if (!Array.isArray(rawTuple) || rawTuple.length < 2) continue;

        let namespace: string[] = [];
        let mode: 'messages' | 'updates' | null = null;
        let data: unknown = undefined;

        const first = rawTuple[0];
        const second = rawTuple[1];

        // 兼容 [mode, data] 与 [namespace, mode, data] 两种返回形态
        if (isStreamMode(first)) {
          mode = first;
          data = second;
        } else if (isStreamMode(second)) {
          mode = second;
          namespace = Array.isArray(first)
            ? first.filter((item): item is string => typeof item === 'string')
            : [];
          data = rawTuple[2];
        } else {
          continue;
        }

        // 命名空间里如果包含典型的子代理标记，或者层级深入且包含子代名字，则认为是 subagent
        // 比如可能出现 'task', 'analysis_subagent' 等，或者存在多次 'tools'
        let graphNode: unknown = undefined;
        if (Array.isArray(data) && data.length > 1) graphNode = data[1];
        const graphNodeRec =
          graphNode && typeof graphNode === 'object'
            ? (graphNode as Record<string, unknown>)
            : undefined;
        const isMainLLM = !graphNodeRec?.['lc_agent_name'];
        const isSubagent = isMainLLM
          ? Array.isArray(namespace) &&
            namespace.some(
              (s: string) => typeof s === 'string' && s.startsWith('tools:'),
            )
          : true;
        try {
          fs.appendFileSync(
            logFilePath,
            JSON.stringify(tuple, null, 2) +
              '\n Subagent: ' +
              isSubagent +
              '\n isMainLLM: ' +
              isMainLLM +
              '\n lc_agent_name:' +
              (typeof graphNodeRec?.['lc_agent_name'] === 'string'
                ? graphNodeRec['lc_agent_name']
                : '') +
              '\n\n====================\n\n',
          );
        } catch {
          // ignore
        }

        // ─── messages 模式：token 流 / tool_call 流 / tool 结果 ───
        if (mode === 'messages') {
          const messageArr = Array.isArray(data) ? data : [data];
          const message = messageArr[0] as Record<string, unknown> | undefined;
          if (!message) continue;

          const msgType = message['type'] as string | undefined;
          const isAIChunk =
            msgType === 'AIMessageChunk' ||
            msgType === 'ai' ||
            (message['_getType'] && typeof message['_getType'] === 'function');

          // tool_call_chunks — 工具调用流
          const tcChunks = message['tool_call_chunks'] as
            | Array<Record<string, unknown>>
            | undefined;
          if (isAIChunk && Array.isArray(tcChunks) && tcChunks.length > 0) {
            for (const tc of tcChunks) {
              const name = tc['name'] as string | undefined;
              const id = tc['id'] as string | undefined;
              const args = tc['args'] as string | undefined;
              const index = tc['index'] as number | undefined;
              if (name) {
                // 首次出现 name 视为 tool_start
                yield {
                  type: 'tool_start',
                  data: { id, name, input: undefined },
                };
              }
              if (args) {
                yield {
                  type: 'tool_chunk',
                  data: { id: id ?? '', name, args, index },
                };
              }
            }
            continue;
          }

          // ToolMessage — 工具结果
          const isToolMsg =
            msgType === 'tool' ||
            msgType === 'ToolMessage' ||
            (message['tool_call_id'] && !isAIChunk);
          if (isToolMsg) {
            const toolName = (message['name'] ?? '') as string;
            const toolCallId = (message['tool_call_id'] ?? '') as string;
            const content = message['content'] ?? message['text'] ?? '';
            toolResults.push({ name: toolName, output: content });
            yield {
              type: 'tool_end',
              data: { id: toolCallId, name: toolName, output: content },
            };
            continue;
          }

          if (isAIChunk) {
            const text = (message['text'] ??
              message['content'] ??
              '') as string;
            const textStr = typeof text === 'string' ? text : '';
            if (textStr) {
              if (!isSubagent) {
                fullText += textStr;
                yield { type: 'token', data: { text: textStr } };
              } else {
                yield { type: 'tool_narration', data: { text: textStr } };
              }
            }
            continue;
          }
        }

        // ─── updates 模式：子代理生命周期 ───
        if (mode === 'updates') {
          const chunk =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)
              : undefined;
          if (!chunk) continue;

          for (const [nodeName, nodeData] of Object.entries(chunk)) {
            // 主代理 model_request — 检测 task tool_call（子代理启动）
            if (!isSubagent && nodeName === 'model_request') {
              const nd = nodeData as { messages?: unknown[] } | undefined;
              for (const msg of nd?.messages ?? []) {
                const m = msg as Record<string, unknown>;
                const tcs = m['tool_calls'] as
                  | Array<Record<string, unknown>>
                  | undefined;
                for (const tc of tcs ?? []) {
                  if (tc['name'] === 'task') {
                    const args = tc['args'] as
                      | Record<string, unknown>
                      | undefined;
                    toolCalls.push(tc);
                    yield {
                      type: 'tool_start',
                      data: {
                        id: tc['id'] as string | undefined,
                        name: (args?.['subagent_type'] as string) ?? 'task',
                        input: args,
                      },
                    };
                  }
                }
              }
            }

            // 主代理 tools 节点 — 子代理完成返回结果
            if (!isSubagent && nodeName === 'tools') {
              const nd = nodeData as { messages?: unknown[] } | undefined;
              for (const msg of nd?.messages ?? []) {
                const m = msg as Record<string, unknown>;
                if (m['type'] === 'tool') {
                  const toolCallId = (m['tool_call_id'] ?? '') as string;
                  const name = (m['name'] ?? 'task') as string;
                  const content = m['content'] ?? '';
                  toolResults.push({ name, output: content });
                  yield {
                    type: 'tool_end',
                    data: { id: toolCallId, name, output: content },
                  };
                }
              }
            }

            // 子代理 tools 节点 — 透传同时汇总真实工具输出（用于上层后处理）
            if (isSubagent && nodeName === 'tools') {
              const nd = nodeData as { messages?: unknown[] } | undefined;
              for (const msg of nd?.messages ?? []) {
                const m = msg as Record<string, unknown>;
                if (m['type'] !== 'tool') continue;
                const toolCallId = (m['tool_call_id'] ?? '') as string;
                const name = (m['name'] ?? '') as string;
                const content = m['content'] ?? '';
                toolResults.push({ name, output: content });
                yield {
                  type: 'tool_end',
                  data: { id: toolCallId, name, output: content },
                };
              }
            }

            // 子代理事件 — 透传
            if (isSubagent) {
              yield {
                type: 'subagent',
                data: {
                  namespace,
                  event: { [nodeName]: nodeData },
                },
              };
            }
          }
        }
      }

      yield {
        type: 'end',
        data: {
          text: fullText,
          tool_calls:
            toolCalls.length > 0
              ? (toolCalls as AIMessage['tool_calls'])
              : undefined,
          tool_results: toolResults.length > 0 ? toolResults : undefined,
        },
      };
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(err);
      const normalized = this.normalizeStreamError(e);
      console.error(
        '[AgentService.stream] ERROR',
        normalized.code,
        normalized.message,
      );
      const outErr = new Error(normalized.message) as Error & {
        code?: string;
      };
      outErr.name = normalized.code;
      outErr.code = normalized.code;
      yield { type: 'error', data: { error: outErr } };
    }
  }

  private normalizeStreamError(error: Error): {
    code: string;
    message: string;
  } {
    const raw = String(error.message || '').trim();
    if (!raw) return { code: 'STREAM_ERROR', message: 'STREAM_ERROR' };
    if (/invalid chat setting|\(2013\)/i.test(raw)) {
      return {
        code: 'MODEL_CHAT_SETTING_INVALID',
        message:
          '当前模型/网关不支持 chat 调用或 baseUrl 不兼容。若使用 MiniMax OpenAI 兼容接口，请将 baseUrl 设置为 https://api.minimax.io/v1（海外）或 https://api.minimaxi.com/v1（国内），并选择 MiniMax-M2.5/M2.1 等聊天模型。',
      };
    }
    if (raw.includes('ARTICLE_DRAFT_INVALID')) {
      return {
        code: 'ARTICLE_DRAFT_INVALID',
        message: '本次生成未通过发布质量校验，请缩小话题范围后重试。',
      };
    }
    const m = /^([A-Z0-9_]+):?\s*/.exec(raw);
    const code = m?.[1] ? m[1] : 'STREAM_ERROR';
    return { code, message: raw.slice(0, 240) };
  }

  /**
   * @description 合并系统提示词与平台 AI 补充说明（统一注入入口）。
   * @param {string | undefined} system - 原系统提示词。
   * @param {AgentConfig} config - Agent 配置。
   * @returns {Promise<string | undefined>} 合并后的系统提示词。
   * @keyword-en merge system prompt with platform ai supplement
   */
  private async mergeSystemWithPlatformSupplement(
    system: string | undefined,
    config: AgentConfig,
  ): Promise<string | undefined> {
    const base = String(system ?? '').trim();
    const supplementText = await this.resolvePlatformSupplementText(config);
    if (!supplementText) return base.length > 0 ? base : undefined;

    const block = this.buildPlatformSupplementBlock(supplementText);
    if (base.length === 0) return block;
    if (this.hasPlatformSupplement(base, block)) return base;
    return `${base}\n\n${block}`;
  }

  /**
   * @description 解析平台 AI 补充说明文本（显式传入优先，缺省按 tenantId 查询）。
   * @param {AgentConfig} config - Agent 配置。
   * @returns {Promise<string>} 补充说明文本。
   * @keyword-en resolve platform ai supplement text
   */
  private async resolvePlatformSupplementText(
    config: AgentConfig,
  ): Promise<string> {
    const direct = String(config.platformAiPromptSupplement ?? '').trim();
    if (direct.length > 0) return direct;

    const tenantId = String(config.tenantId ?? '').trim();
    if (!tenantId) return '';
    try {
      return await this.adminService.getTenantPlatformAiPromptSupplement(
        tenantId,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      this.logger.warn(
        `[platform-ai-supplement] resolve_failed tenantId=${tenantId} error=${msg.slice(0, 120)}`,
      );
      return '';
    }
  }

  /**
   * @description 构建标准化的平台 AI 补充说明块。
   * @param {string} text - 补充说明文本。
   * @returns {string} 标准化文本块。
   * @keyword-en build platform ai supplement block
   */
  private buildPlatformSupplementBlock(text: string): string {
    const body = String(text ?? '').trim();
    return body.length > 0 ? `【平台AI补充说明】\n${body}` : '';
  }

  /**
   * @description 判断文本中是否已包含平台 AI 补充说明，避免重复注入。
   * @param {string} text - 待检测文本。
   * @param {string} supplementBlock - 标准补充块。
   * @returns {boolean} 是否已包含。
   * @keyword-en detect duplicated platform supplement
   */
  private hasPlatformSupplement(text: string, supplementBlock: string): boolean {
    const src = String(text ?? '').trim();
    if (!src) return false;
    if (src.includes(supplementBlock)) return true;
    const raw = supplementBlock.replace(/^【平台AI补充说明】\s*/u, '').trim();
    return raw.length > 0 && src.includes(raw);
  }

  /**
   * @description 规范消息为 BaseMessage 数组
   * @keyword-en normalize messages
   */
  private normalizeMessages(input: unknown): BaseMessage[] {
    if (Array.isArray(input)) {
      return input.map((m) =>
        isBaseMessage(m) ? m : coerceMessageLikeToMessage(m as BaseMessageLike),
      );
    }
    return [
      isBaseMessage(input)
        ? input
        : coerceMessageLikeToMessage(input as BaseMessageLike),
    ];
  }

  private extractSystemTextFromMessages(messages: BaseMessage[]): {
    systemText: string;
    messages: BaseMessage[];
  } {
    const kept: BaseMessage[] = [];
    const systemParts: string[] = [];
    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        const content = (msg as unknown as { content?: unknown }).content;
        const text =
          typeof content === 'string' ? content : JSON.stringify(content ?? '');
        if (text.trim().length > 0) systemParts.push(text.trim());
        continue;
      }
      kept.push(msg);
    }
    return { systemText: systemParts.join('\n\n'), messages: kept };
  }

  /**
   * @description 提取运行状态中的消息列表
   * @keyword-en extract state messages
   */
  private extractStateMessages(state: unknown): BaseMessage[] {
    if (isBaseMessage(state)) return [state];
    if (!state || typeof state !== 'object') return [];
    const messages = (state as { messages?: unknown }).messages;
    if (messages && !Array.isArray(messages)) {
      return [
        isBaseMessage(messages)
          ? messages
          : coerceMessageLikeToMessage(messages as BaseMessageLike),
      ];
    }
    if (!Array.isArray(messages)) return [];
    const normalized: BaseMessage[] = [];
    for (const item of messages) {
      if (isBaseMessage(item)) {
        normalized.push(item);
        continue;
      }
      if (item) {
        normalized.push(coerceMessageLikeToMessage(item as BaseMessageLike));
      }
    }
    return normalized;
  }

  private coerceAIMessageFromChunk(chunk: AIMessageChunk<any>): AIMessage {
    return new AIMessage({
      id: chunk.id,
      name: chunk.name,
      content: chunk.content,
      additional_kwargs: chunk.additional_kwargs,
      response_metadata: chunk.response_metadata,
      tool_calls: chunk.tool_calls,
      invalid_tool_calls: chunk.invalid_tool_calls,
      usage_metadata:
        chunk.usage_metadata as unknown as AIMessage['usage_metadata'],
    });
  }

  /**
   * @description 过滤并规范工具列表
   * @keyword-en normalize tools
   */
  private normalizeTools(
    tools: AgentConfig['tools'],
  ): CreateAgentParams['tools'] | undefined {
    if (!Array.isArray(tools)) return undefined;
    return tools;
  }

  /**
   * @description 规范子代理配置（确保 tools 为 StructuredTool[]）
   */
  private normalizeSubagents(
    subagents: AgentConfig['subagents'],
  ): SubAgent[] | undefined {
    if (!Array.isArray(subagents)) return undefined;
    return subagents.map((subagent) => {
      if (!Array.isArray(subagent.tools)) return subagent;
      const tools = subagent.tools.filter((t): t is StructuredTool =>
        isStructuredTool(t),
      );
      return { ...subagent, tools };
    });
  }

  /**
   * @description 规范上下文Schema
   * @keyword-en normalize context schema
   */
  private normalizeContextSchema(
    schema: AgentConfig['contextSchema'],
  ): InteropZodObject | undefined {
    if (!schema || typeof schema !== 'object') return undefined;
    const rec = schema as {
      safeParse?: unknown;
      parse?: unknown;
      _def?: unknown;
    };
    if (
      typeof rec.safeParse === 'function' &&
      typeof rec.parse === 'function'
    ) {
      return schema as InteropZodObject;
    }
    return undefined;
  }

  /**
   * @title 构造历史 Construct History
   * @description 将纯文本历史转换为LangChain消息对象数组。
   * @keywords-cn 历史转换, 消息对象
   * @keywords-en history convert, message objects
   */
  toMessages(
    history: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[],
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];
    for (const h of history) {
      const content =
        typeof h.content === 'string'
          ? h.content
          : JSON.stringify(h.content ?? '');
      if (h.role === 'system') {
        messages.push(new SystemMessage(content));
      } else if (h.role === 'assistant') {
        messages.push(new AIMessage(content));
      } else {
        messages.push(new HumanMessage(content));
      }
    }
    return messages;
  }
}
