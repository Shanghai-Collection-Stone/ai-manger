import { Injectable } from '@nestjs/common';
import { Agent, type Dispatcher } from 'undici';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
  OpensourceVideoCreateInput,
  OpensourceVideoJob,
  OpensourceVideoRuntime,
} from '../entities/opensource-video.entity.js';

/** @description 配音等待显卡期间允许较长响应头等待。 @keyword-cn 配音请求连接, 排队超时 @keyword-en speech-http-dispatcher, queue-timeout */
const speechDispatcher = new Agent({
  headersTimeout: 9 * 60 * 1000,
  bodyTimeout: 60 * 1000,
});

/**
 * @description 自建 MiniMax-H3 视频服务的 HTTP 客户端：提交任务、查询任务、带 Key 下载成片。连接信息由调用方从后台提供商配置传入；
 *   所有请求带 `Authorization: Bearer <Key>`，非 2xx 抛 `OPENSOURCE_VIDEO_HTTP_<状态码>:<响应体>`，网络错误抛 `OPENSOURCE_VIDEO_NETWORK_ERROR:<原因>`。
 * @keyword-cn 自建视频客户端, 视频接口调用
 * @keyword-en opensource-video-client, video-api-call
 */
@Injectable()
export class OpensourceVideoClientService {
  /**
   * @description 自建 Qwen3-TTS 合成完整台词，支持声音描述或样本；返回 PCM WAV，排队与推理共最多九分钟。
   * @keyword-cn 自建台词配音, 配音先行
   * @keyword-en synthesize-opensource-speech, speech-first-generation
   */
  async synthesizeSpeech(
    runtime: OpensourceVideoRuntime,
    input: {
      input: string;
      instructions: string;
      reference_audio?: string;
      reference_text?: string;
    },
  ): Promise<Buffer> {
    const response = await this.request(runtime, '/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(9 * 60 * 1000),
      dispatcher: speechDispatcher,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('OPENSOURCE_VIDEO_HTTP_404:'))
        throw new Error('自建配音接口尚未部署，请先更新 GPU 视频服务');
      if (message.startsWith('OPENSOURCE_VIDEO_HTTP_503:')) {
        let detail = message.split('OPENSOURCE_VIDEO_HTTP_503:')[1];
        try {
          detail = String(
            (JSON.parse(detail) as { detail?: string }).detail || detail,
          );
        } catch {}
        throw new Error(`自建配音失败：${detail}`);
      }
      throw error;
    });
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * @description 提交一个生成任务（`POST /v1/videos`），服务端受理后返回 202 与排队中的任务。
   * @keyword-cn 提交自建视频任务, 生成视频
   * @keyword-en submit-opensource-video-job, create-video
   * @param runtime 连接信息。
   * @param input 请求体。
   * @returns {Promise<OpensourceVideoJob>} 新任务。
   */
  async createVideo(
    runtime: OpensourceVideoRuntime,
    input: OpensourceVideoCreateInput,
  ): Promise<OpensourceVideoJob> {
    const response = await this.request(runtime, '/v1/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    return (await response.json()) as OpensourceVideoJob;
  }

  /**
   * @description 查询任务（`GET /v1/videos/{id}`），服务端在查询时与 ComfyUI 同步状态。
   * @keyword-cn 查询自建视频任务, 任务状态
   * @keyword-en get-opensource-video-job, job-status
   * @param runtime 连接信息。
   * @param jobId 任务 ID。
   * @returns {Promise<OpensourceVideoJob>} 最新任务。
   */
  async getVideo(
    runtime: OpensourceVideoRuntime,
    jobId: string,
  ): Promise<OpensourceVideoJob> {
    const response = await this.request(
      runtime,
      `/v1/videos/${encodeURIComponent(jobId)}`,
      { method: 'GET', signal: AbortSignal.timeout(60 * 1000) },
    );
    return (await response.json()) as OpensourceVideoJob;
  }

  /**
   * @description 带 Key 下载成片 mp4（`GET /v1/videos/{id}/content`）并流式写到本机文件，10 分钟超时；未成功的任务服务端返回 409。
   * @keyword-cn 下载自建视频成片, 流式写文件
   * @keyword-en download-opensource-video, stream-to-file
   * @param runtime 连接信息。
   * @param jobId 任务 ID。
   * @param target 本机目标文件路径。
   */
  async downloadVideo(
    runtime: OpensourceVideoRuntime,
    jobId: string,
    target: string,
  ): Promise<void> {
    const response = await this.request(
      runtime,
      `/v1/videos/${encodeURIComponent(jobId)}/content`,
      { method: 'GET', signal: AbortSignal.timeout(10 * 60 * 1000) },
    );
    if (!response.body) throw new Error('OPENSOURCE_VIDEO_EMPTY_BODY');
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      createWriteStream(target),
    );
  }

  /**
   * @description 发起一次带 Bearer 的请求：校验 Base URL 与 Key，网络错误与非 2xx 转成带前缀的错误并保留对端响应体（最多 2000 字）。
   * @keyword-cn 自建视频HTTP请求, 错误体保留
   * @keyword-en opensource-video-http, preserve-error-body
   * @param runtime 连接信息。
   * @param path 接口路径。
   * @param init fetch 参数。
   * @returns {Promise<Response>} 2xx 响应。
   */
  private async request(
    runtime: OpensourceVideoRuntime,
    path: string,
    init: RequestInit & { dispatcher?: Dispatcher },
  ): Promise<Response> {
    const baseUrl = String(runtime.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, '');
    const apiKey = String(runtime.apiKey ?? '').trim();
    if (!baseUrl) throw new Error('OPENSOURCE_VIDEO_BASE_URL_NOT_CONFIGURED');
    if (!apiKey) throw new Error('OPENSOURCE_VIDEO_API_KEY_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      throw new Error(
        `OPENSOURCE_VIDEO_NETWORK_ERROR:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `OPENSOURCE_VIDEO_HTTP_${response.status}:${text.slice(0, 2000)}`,
      );
    }
    return response;
  }
}
