import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { DouyinWorkbenchAgentService } from '../../douyin-workbench/services/douyin-workbench-agent.service.js';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import {
  TENANT_MCP_TOOLS,
  type TenantMcpDouyinToolName,
} from '../tenant-mcp.tools.js';
import { saveMcpImageFile } from './tenant-mcp-image.js';

/**
 * @description 抖音工作台 MCP 工具的分发：每个工具用自己的严格 schema 解析入参，身份只取密钥（租户 + 密钥创建人），
 *   交给 `DouyinWorkbenchAgentService` 完成一步并落库；返回里站内相对地址补成可访问的完整地址。
 * @keyword-cn 抖音MCP工具, 工具分发
 * @keyword-en douyin-mcp-tools, tool-dispatch
 */
@Injectable()
export class TenantMcpDouyinToolsService {
  /**
   * @description 注入抖音工作台编排服务与配置（补完整地址用）。
   * @keyword-cn 抖音MCP工具依赖, 编排服务
   * @keyword-en douyin-mcp-dependencies, agent-service
   */
  constructor(
    private readonly agent: DouyinWorkbenchAgentService,
    private readonly config: ConfigService,
  ) {}

  /**
   * @description 把返回里 `url` 字段的站内相对地址补成带 APP_URL 的完整地址，其余原样。
   * @keyword-cn 补完整地址, 站内地址
   * @keyword-en absolute-urls, site-relative-url
   * @param {unknown} value 工具返回。
   * @returns {unknown} 补好地址的返回。
   */
  private absolute(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.absolute(item));
    if (!value || typeof value !== 'object' || value instanceof Date)
      return value;
    const base = String(this.config.get<string>('APP_URL') || '').replace(
      /\/+$/,
      '',
    );
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'url' && typeof item === 'string' && item.startsWith('/')
          ? `${base}${item}`
          : this.absolute(item),
      ]),
    );
  }

  /**
   * @description 解析入参并执行一个抖音工具；不接受入参里的租户或用户，调用身份固定为密钥的租户与创建人。
   * @keyword-cn 执行抖音工具, 调用身份
   * @keyword-en execute-douyin-tool, caller-identity
   * @param {TenantMcpPrincipal} principal MCP 密钥身份。
   * @param {TenantMcpDouyinToolName} name 工具名。
   * @param {unknown} raw 入参。
   * @returns {Promise<unknown>} 工具返回。
   */
  async execute(
    principal: TenantMcpPrincipal,
    name: TenantMcpDouyinToolName,
    raw: unknown,
  ): Promise<unknown> {
    return this.absolute(await this.run(principal, name, raw));
  }

  /**
   * @description 按工具名分发到编排服务的对应一步。
   * @keyword-cn 抖音工具分支, 编排一步
   * @keyword-en douyin-tool-switch, agent-step
   */
  private async run(
    principal: TenantMcpPrincipal,
    name: TenantMcpDouyinToolName,
    raw: unknown,
  ): Promise<unknown> {
    const scope = { tenantId: principal.tenantId, userId: principal.userId };
    const tools = TENANT_MCP_TOOLS;
    switch (name) {
      case 'douyin_workspace':
        tools.douyin_workspace.schema.parse(raw);
        return this.agent.workspace(scope);
      case 'douyin_topic_get': {
        const input = tools.douyin_topic_get.schema.parse(raw);
        return this.agent.topicDetail(input.topicId, scope);
      }
      case 'douyin_topic_create':
        return this.agent.createTopic(
          tools.douyin_topic_create.schema.parse(raw),
          scope,
        );
      case 'douyin_topic_update': {
        const { topicId, ...input } =
          tools.douyin_topic_update.schema.parse(raw);
        return this.agent.updateTopic(topicId, input, scope);
      }
      case 'douyin_topic_delete': {
        const input = tools.douyin_topic_delete.schema.parse(raw);
        return this.agent.deleteTopic(input.topicId, scope);
      }
      case 'douyin_video_options':
        tools.douyin_video_options.schema.parse(raw);
        return this.agent.videoOptions();
      case 'douyin_personas':
        tools.douyin_personas.schema.parse(raw);
        return this.agent.personaList(scope);
      case 'douyin_knowledge_list': {
        const input = tools.douyin_knowledge_list.schema.parse(raw);
        return this.agent.knowledgeList(input.keyword, scope);
      }
      case 'douyin_video_merge': {
        const input = tools.douyin_video_merge.schema.parse(raw);
        return this.agent.requestMerge(input.topicId, scope);
      }
      case 'douyin_store_list':
        tools.douyin_store_list.schema.parse(raw);
        return this.agent.storeList(scope);
      case 'douyin_store_create':
        return this.agent.createStore(
          tools.douyin_store_create.schema.parse(raw),
          scope,
        );
      case 'douyin_store_photo_upload': {
        const input = tools.douyin_store_photo_upload.schema.parse(raw);
        const file = await saveMcpImageFile(input.base64);
        try {
          return await this.agent.registerStorePhoto(
            input.storeId,
            { ...file, originalName: input.originalName },
            scope,
            principal.username,
          );
        } catch (error) {
          await fs.unlink(file.absPath).catch(() => undefined);
          throw error;
        }
      }
      case 'douyin_store_spots_classify': {
        const input = tools.douyin_store_spots_classify.schema.parse(raw);
        return this.agent.classifyStorePhotos(
          input.storeId,
          input.imageIds,
          scope,
        );
      }
      case 'douyin_store_spots_save': {
        const input = tools.douyin_store_spots_save.schema.parse(raw);
        return this.agent.saveStoreSpots(input.storeId, input.spots, scope);
      }
      case 'douyin_store_visit_set_start': {
        const input = tools.douyin_store_visit_set_start.schema.parse(raw);
        return this.agent.setStart(input.topicId, input.start, scope);
      }
      case 'douyin_store_visit_pick_pictures': {
        const input = tools.douyin_store_visit_pick_pictures.schema.parse(raw);
        return this.agent.pickPictures(input.topicId, scope);
      }
      case 'douyin_store_visit_generate_pictures': {
        const { topicId, ...input } =
          tools.douyin_store_visit_generate_pictures.schema.parse(raw);
        return this.agent.generatePictures(topicId, input, scope);
      }
      case 'douyin_store_visit_set_store': {
        const input = tools.douyin_store_visit_set_store.schema.parse(raw);
        return this.agent.setStore(input.topicId, input.storeId, scope);
      }
      case 'douyin_store_visit_write_script': {
        const { topicId, ...input } =
          tools.douyin_store_visit_write_script.schema.parse(raw);
        return this.agent.writeScript(topicId, input, scope);
      }
      case 'douyin_store_visit_generate_lines': {
        const input = tools.douyin_store_visit_generate_lines.schema.parse(raw);
        return this.agent.generateLines(input.topicId, input.prompt, scope);
      }
      case 'douyin_store_visit_voices':
        tools.douyin_store_visit_voices.schema.parse(raw);
        return this.agent.voices();
      case 'douyin_store_visit_set_cast': {
        const { topicId, ...input } =
          tools.douyin_store_visit_set_cast.schema.parse(raw);
        return this.agent.setCast(topicId, input, scope);
      }
      case 'douyin_store_visit_match_scenes': {
        const input = tools.douyin_store_visit_match_scenes.schema.parse(raw);
        return this.agent.matchScenes(input.topicId, scope);
      }
      case 'douyin_store_visit_generate': {
        const { topicId, ...input } =
          tools.douyin_store_visit_generate.schema.parse(raw);
        return this.agent.generateStoreVisit(topicId, input, scope);
      }
      case 'douyin_store_visit_regenerate_segment': {
        const { topicId, segmentId, ...input } =
          tools.douyin_store_visit_regenerate_segment.schema.parse(raw);
        return this.agent.regenerateStoreVisitSegment(
          topicId,
          segmentId,
          input,
          scope,
        );
      }
      case 'douyin_store_visit_pipeline': {
        const { topicId, ...input } =
          tools.douyin_store_visit_pipeline.schema.parse(raw);
        return this.agent.controlStoreVisitPipeline(topicId, input, scope);
      }
      case 'douyin_storyboard_children_generate': {
        const { motherTopicId, ...input } =
          tools.douyin_storyboard_children_generate.schema.parse(raw);
        return this.agent.generateChildren(motherTopicId, input, scope);
      }
      case 'douyin_generation_jobs':
        tools.douyin_generation_jobs.schema.parse(raw);
        return this.agent.generationJobList(scope);
      case 'douyin_storyboard_drafts_confirm': {
        const input = tools.douyin_storyboard_drafts_confirm.schema.parse(raw);
        return this.agent.confirmDrafts(input.jobId, input.items, scope);
      }
    }
  }
}
