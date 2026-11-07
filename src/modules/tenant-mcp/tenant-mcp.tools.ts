import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

/** @keyword-en mcp-schema, input-validation */
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** @keyword-en mcp-schema, input-validation */
const text = z.string().trim().min(1).max(200);
/** @keyword-en mcp-schema, pagination */
const pagination = {
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(100000).default(0),
};
/** @keyword-en mcp-schema, article-content */
const content = {
  title: text,
  text: z.string().max(100000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  imageUrls: z
    .array(
      z
        .string()
        .max(2000)
        .regex(/^(https?:\/\/|\/static\/uploads\/)/),
    )
    .max(30)
    .optional(),
};

/** @keyword-en mcp-schema, douyin-topic */
const topicId = id.describe('脚本（子选题）ID，来自 douyin_workspace');
/** @keyword-en mcp-schema, douyin-segment */
const segmentId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/)
  .describe('探店分段 ID，来自 douyin_topic_get');
/** @keyword-en mcp-schema, douyin-shot */
const shotId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('分镜 ID，来自 douyin_topic_get');

/** @keyword-en mcp-tools, tool-permission */
export const TENANT_MCP_TOOLS = {
  gallery_search: {
    title: '图库搜索',
    description:
      '搜索本租户图库。query 为语义搜索，tags 为标签过滤；不传 query 则列出最近图片。',
    schema: z
      .object({
        query: z.string().trim().min(1).max(500).optional(),
        tags: z.array(text).max(32).optional(),
        limit: pagination.limit,
        cursorId: id.optional(),
      })
      .strict(),
  },
  image_upload: {
    title: '图片上传',
    description:
      '上传 base64 图片到本租户图库，支持 JPEG、PNG、WebP，最多 10 MiB。base64 不含 data URI 前缀。',
    schema: z
      .object({
        base64: z.string().min(4).max(13981016),
        originalName: text,
        tags: z.array(text).max(32).optional(),
        description: z.string().max(2000).optional(),
      })
      .strict(),
  },
  library_list: {
    title: '文章库列表',
    description: '分页列出本租户文章库。',
    schema: z.object({ ...pagination, type: text.optional() }).strict(),
  },
  library_get: {
    title: '文章库详情',
    description: '获取本租户文章库详情与文章统计。',
    schema: z.object({ libraryId: id }).strict(),
  },
  library_create: {
    title: '新增文章库',
    description: '为本租户创建文章库。',
    schema: z
      .object({ name: text, type: z.string().max(100).default('') })
      .strict(),
  },
  library_update: {
    title: '修改文章库',
    description: '修改本租户文章库名称或类型。',
    schema: z
      .object({
        libraryId: id,
        name: text.optional(),
        type: z.string().max(100).optional(),
      })
      .strict(),
  },
  article_publish: {
    title: '发布文章到文章库',
    description:
      '把标题、正文与图片存入指定文章库，状态为未发布，等待扫码发布。此操作不会直接发布到小红书。',
    schema: z.object({ libraryId: id, ...content }).strict(),
  },
  article_upload: {
    title: '上传文章到文章库',
    description:
      '上传 UTF-8 JSON 文件的 base64 内容到文章库。文件结构为 {title,text?,tags?,imageUrls?}，最多 1 MiB。',
    schema: z
      .object({ libraryId: id, base64: z.string().min(4).max(1398104) })
      .strict(),
  },
  article_get: {
    title: '文章详情',
    description: '读取本租户单篇文章。',
    schema: z.object({ articleId: id }).strict(),
  },
  article_update: {
    title: '修改文章',
    description: '修改本租户文章的标题、正文、标签或图片。',
    schema: z
      .object({ articleId: id, ...content, title: text.optional() })
      .strict(),
  },
  article_list: {
    title: '文章列表',
    description: '分页读取指定文章库文章，可按发布状态过滤。',
    schema: z
      .object({
        libraryId: id,
        status: z.enum(['all', 'published', 'unpublished']).default('all'),
        ...pagination,
      })
      .strict(),
  },
  article_list_published: {
    title: '已发布文章列表',
    description: '分页获取指定文章库内已发布文章。',
    schema: z.object({ libraryId: id, ...pagination }).strict(),
  },
  article_list_unpublished: {
    title: '未发布文章列表',
    description: '分页获取指定文章库内未发布文章。',
    schema: z.object({ libraryId: id, ...pagination }).strict(),
  },
  library_publish_qr: {
    title: '文章库发布二维码',
    description:
      '获取文章库扫码发布二维码内容与小红书短链，此工具会授予扫码领取能力。',
    schema: z.object({ libraryId: id }).strict(),
  },
  article_recent_data: {
    title: '文章近期抓取数据',
    description:
      '获取本租户已发布文章最近 days 天的抓取数据，可按 taskId 查询某次抓取结果。',
    schema: z
      .object({
        articleId: id,
        taskId: id.optional(),
        days: z.number().int().min(1).max(90).default(7),
        ...pagination,
      })
      .strict(),
  },
  article_crawl: {
    title: '抓取文章数据',
    description:
      '立即抓取带有效小红书 NoteId 的已发布文章，首次抓取自动补建监控绑定。沿用现有采集渠道，可能抓取同选题的多篇文章；返回目标文章数据。同步完成返回终态，异步返回 taskId，可通过 article_recent_data 轮询。',
    schema: z.object({ articleId: id }).strict(),
  },
  douyin_workspace: {
    title: '抖音工作台概览',
    description:
      '列出抖音工作台的母选题和下面的脚本（子选题），每条脚本带模式（探店 / 分镜）与一句话制作进度。做视频前先看这里拿脚本 ID。',
    schema: z.object({}).strict(),
  },
  douyin_topic_get: {
    title: '脚本详情与进度',
    description:
      '读取一条脚本的完整状态：探店的门店、出镜方式、人物、音色、脚本正文与各段（台词、场景、出片状态），或分镜的各镜（文案、配图、出片），成片地址、出片前还差什么、下一步建议。出片和拼接是异步的，用它轮询进度；状态 waiting-desktop 表示在等桌面端续段。',
    schema: z.object({ topicId }).strict(),
  },
  douyin_topic_create: {
    title: '新建抖音母选题',
    description:
      '新建母选题。productionMode 为 store-visit（探店：按门店实拍点位配图出片）时会自动带出一条脚本；为 storyboard（分镜：AI 写候选脚本、分镜、配图后出片）时再用 douyin_storyboard_children_generate 生成候选脚本。knowledgeIds 来自 douyin_knowledge_list，AI 写脚本会照着引用知识写。',
    schema: z
      .object({
        title: z.string().trim().min(2).max(100),
        productionMode: z.enum(['storyboard', 'store-visit']),
        knowledgeIds: z
          .array(z.string().regex(/^[a-f\d]{24}$/i))
          .max(20)
          .optional(),
      })
      .strict(),
  },
  douyin_topic_update: {
    title: '修改脚本内容',
    description:
      '修改脚本标题、探店脚本正文（改了正文要重新生成台词）、探店某几段台词或念法 delivery（这段怎么念：情绪、语速、重音，40 字内，配音时作为情感指令），或分镜某几镜的口播 narration / 画面描述 visual。只改给出的项，分段与分镜 ID 来自 douyin_topic_get。',
    schema: z
      .object({
        topicId,
        title: z.string().trim().min(1).max(100).optional(),
        script: z.string().max(5000).optional(),
        segments: z
          .array(
            z
              .object({
                id: segmentId,
                lines: z.string().trim().min(1).max(1000).optional(),
                delivery: z.string().trim().max(40).optional(),
              })
              .strict(),
          )
          .max(40)
          .optional(),
        shots: z
          .array(
            z
              .object({
                id: shotId,
                narration: z.string().max(2000).optional(),
                visual: z.string().max(2000).optional(),
              })
              .strict(),
          )
          .max(60)
          .optional(),
      })
      .strict(),
  },
  douyin_topic_delete: {
    title: '删除选题',
    description: '删除一条脚本，或删除母选题连同下面的全部脚本，不可恢复。',
    schema: z.object({ topicId }).strict(),
  },
  douyin_video_options: {
    title: '视频节点概况',
    description:
      '查看整片 / 分镜出片通道与可选时长，以及探店三个节点（音色、画面视频、人物）是否已配好；没配好时出片会失败，需要管理员先在后台配置。',
    schema: z.object({}).strict(),
  },
  douyin_personas: {
    title: '预设出镜人物',
    description:
      '列出可选的预设出镜人物与有没有可用形象图（探店「开头有人打招呼」必须选有形象图的人物）。',
    schema: z.object({}).strict(),
  },
  douyin_knowledge_list: {
    title: '引用知识列表',
    description:
      '列出本账号的引用知识（门店介绍、团购价、卖点等），可按关键词搜索；新建母选题时把 ID 填进 knowledgeIds。',
    schema: z
      .object({ keyword: z.string().trim().max(100).optional() })
      .strict(),
  },
  douyin_video_merge: {
    title: '请求拼接成片',
    description:
      '打开「全部出片后自动拼接」。拼接由桌面端完成：需要同一账号打开桌面端「视频制作」页，全部片段出片后自动拼成一条成片，用 douyin_topic_get 查看成片地址。',
    schema: z.object({ topicId }).strict(),
  },
  douyin_store_list: {
    title: '门店列表',
    description:
      '列出门店（租户内共享）和每个门店的点位（游乐设备、打卡点、招牌菜、门头等），带图片 ID、描述与精细度打分。',
    schema: z.object({}).strict(),
  },
  douyin_store_create: {
    title: '新建门店',
    description:
      '新建门店（同名直接返回已有门店）。description 写位置、人均、营业时间等整体说明，AI 写台词会用到。',
    schema: z
      .object({
        name: z.string().trim().min(1).max(50),
        description: z.string().trim().max(2000).optional(),
      })
      .strict(),
  },
  douyin_store_photo_upload: {
    title: '上传门店照片',
    description:
      '上传一张门店实拍照片（base64，JPEG / PNG / WebP，最多 10 MiB，不含 data URI 前缀）到图库「场景图库」，返回 imageId；传完用 douyin_store_spots_classify 让 AI 归类成点位。',
    schema: z
      .object({
        storeId: id,
        base64: z.string().min(4).max(13981016),
        originalName: text,
      })
      .strict(),
  },
  douyin_store_spots_classify: {
    title: 'AI 归类门店照片',
    description:
      'AI 看图把一批门店照片（每次最多 16 张）归类到点位并直接保存：能归到已有点位的归进去，否则新建点位（名称由 AI 起，可用 douyin_store_spots_save 改名）。会调用视觉模型并产生费用；返回没认出的图片 ID。',
    schema: z
      .object({
        storeId: id,
        imageIds: z.array(id).min(1).max(16),
      })
      .strict(),
  },
  douyin_store_spots_save: {
    title: '保存门店点位',
    description:
      '整体保存门店的全部点位：改名、改说明、调整图片归属与打分（1～10）。已有点位要带 id，没列出的已有点位会被删除；先用 douyin_store_list 读出完整点位再改。',
    schema: z
      .object({
        storeId: id,
        spots: z
          .array(
            z
              .object({
                id: z.string().max(40).optional(),
                name: z.string().trim().min(1).max(30),
                description: z.string().max(500).optional(),
                opening: z.boolean().optional(),
                images: z
                  .array(
                    z
                      .object({
                        imageId: id,
                        description: z.string().max(300).optional(),
                        score: z.number().min(1).max(10).optional(),
                      })
                      .strict(),
                  )
                  .max(40),
                videos: z
                  .array(
                    z
                      .object({
                        videoId: id,
                        description: z.string().max(500).optional(),
                      })
                      .strict(),
                  )
                  .max(6)
                  .optional(),
              })
              .strict(),
          )
          .max(40),
      })
      .strict(),
  },
  douyin_store_visit_set_store: {
    title: '探店：选门店',
    description:
      '给探店脚本选门店。换店会清掉已配的场景，需要重新生成台词和配场景；脚本正文保留。',
    schema: z.object({ topicId, storeId: id }).strict(),
  },
  douyin_store_visit_write_script: {
    title: '探店：AI 写脚本',
    description:
      'AI 读引用知识写探店脚本正文并保存，同时附对照引用知识的自检结果；keepCast 为假时一并定出镜方式、预设人物与音色。门店还没选时只返回 AI 的门店确认问题（needsStore）。带 issues 时按自检问题修改。会调用大模型并产生费用。',
    schema: z
      .object({
        topicId,
        prompt: z.string().trim().max(500).optional(),
        keepCast: z.boolean().optional(),
        issues: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
      })
      .strict(),
  },
  douyin_store_visit_generate_lines: {
    title: '探店：按脚本生成台词',
    description:
      '按已保存的脚本正文生成分段画面与口播台词并保存（已有台词和场景会被替换）。会调用大模型并产生费用。',
    schema: z
      .object({ topicId, prompt: z.string().trim().max(500).optional() })
      .strict(),
  },
  douyin_store_visit_voices: {
    title: '探店：音色库',
    description:
      '列出音色库里按风格分类的预置音色（男女声、特质、方言），把 voiceId 用在 douyin_store_visit_set_cast。',
    schema: z.object({}).strict(),
  },
  douyin_store_visit_set_cast: {
    title: '探店：定出镜与音色',
    description:
      '设定出镜方式 template（voiceover 只配解说 / opening 开头有人打招呼）、预设人物 personaId（要有形象图）、音色：voiceId 选音色库音色，或 voiceDesignPrompt 用一句声音描述定制（调用百炼声音设计，会产生费用）。只改给出的项。',
    schema: z
      .object({
        topicId,
        template: z.enum(['voiceover', 'opening']).optional(),
        personaId: id.optional(),
        voiceId: z.string().trim().min(1).max(100).optional(),
        voiceDesignPrompt: z.string().trim().min(5).max(500).optional(),
        voiceName: z.string().trim().max(30).optional(),
      })
      .strict(),
  },
  douyin_store_visit_match_scenes: {
    title: '探店：AI 配场景',
    description:
      'AI 按脚本从门店点位给每段配 1～3 张实拍图（或实拍视频）并保存，已配的场景会被替换。需要先生成好台词。会调用大模型并产生费用。',
    schema: z.object({ topicId }).strict(),
  },
  douyin_store_visit_generate: {
    title: '探店：出片',
    description:
      '启动 AI 导演一段一段地出片，会按段扣生视频费用。先检查台词、出镜、人物、音色与场景是否齐全（不齐不提交），人物镜头自动先生成首帧；前一段出完才接下一段，有段已出片时只接着生成没出片的段，all 为真时全部重做；某段失败时导演暂停，需用 douyin_store_visit_pipeline（resume）手动继续。全部出完自动拼接。同点位续段、统一音色与拼接成片要桌面端同一账号打开「视频制作」页完成；之后用 douyin_topic_get 轮询。',
    schema: z
      .object({
        topicId,
        all: z.boolean().optional(),
        unifiedVoice: z.boolean().optional(),
      })
      .strict(),
  },
  douyin_store_visit_regenerate_segment: {
    title: '探店：重做某一段',
    description:
      '让 AI 导演重做探店某一段（以及接它尾帧的后续段），会扣生视频费用：清掉这段的出片结果，由导演按顺序重做；导演还没开始时直接开始生成，暂停中时要用 douyin_store_visit_pipeline（resume）继续。',
    schema: z
      .object({
        topicId,
        segmentId,
        unifiedVoice: z.boolean().optional(),
      })
      .strict(),
  },
  douyin_store_visit_pipeline: {
    title: '探店：控制 AI 导演',
    description:
      '控制探店 AI 导演的一段一段出片：pause 暂停（不再提交下一段，在跑的段跑完为止）；resume 继续（某段失败或改完内容后必须手动继续，从第一个没出片的段接着生成）；redo 重做 segmentId 这段（清掉它及接它尾帧的续段的出片结果，排进重做，会扣费；暂停中不会自动开跑）。',
    schema: z
      .object({
        topicId,
        action: z.enum(['pause', 'resume', 'redo']),
        segmentId: segmentId.optional(),
      })
      .strict(),
  },
  douyin_storyboard_children_generate: {
    title: '分镜：AI 生成候选脚本',
    description:
      '按母选题让 AI 生成若干候选脚本（后台任务，立即返回 job）。用 douyin_generation_jobs 等任务完成拿到候选，再用 douyin_storyboard_drafts_confirm 挑选入库。会调用大模型并产生费用。',
    schema: z
      .object({
        motherTopicId: id,
        prompt: z.string().trim().max(1000).optional(),
        personaId: id.optional(),
        scriptStyle: z.string().trim().max(40).optional(),
      })
      .strict(),
  },
  douyin_generation_jobs: {
    title: '分镜：后台任务',
    description:
      '查看运行中与最近 24 小时的后台任务（生成候选脚本、生成分镜），含待确认的候选脚本 drafts 与生成出的脚本 ID。',
    schema: z.object({}).strict(),
  },
  douyin_storyboard_drafts_confirm: {
    title: '分镜：确认候选脚本',
    description:
      '把挑中的候选脚本入库（可改标题与正文），每条新脚本自动开始生成分镜与配图（后台任务）。',
    schema: z
      .object({
        jobId: z
          .string()
          .regex(/^[0-9a-f-]{8,64}$/i)
          .describe('任务 ID，来自 douyin_generation_jobs'),
        items: z
          .array(
            z
              .object({
                key: z.string().trim().min(1).max(100),
                title: z.string().trim().max(100).optional(),
                script: z.string().max(5000).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict(),
  },
  douyin_storyboard_generate: {
    title: '分镜：重新生成分镜',
    description:
      '让 AI 重新生成这条脚本的分镜与配图（后台任务，已有分镜会被替换）。会调用大模型与生图并产生费用。',
    schema: z
      .object({ topicId, prompt: z.string().trim().max(1000).optional() })
      .strict(),
  },
  douyin_storyboard_shot_image: {
    title: '分镜：重新生成某镜配图',
    description:
      '按画面描述重新生成某一镜的竖屏配图并绑定到这一镜。会调用生图并产生费用。',
    schema: z
      .object({
        topicId,
        shotId,
        prompt: z.string().trim().max(1000).optional(),
      })
      .strict(),
  },
  douyin_storyboard_shot_video: {
    title: '分镜：出片',
    description:
      '分镜出片，会扣生视频费用。默认逐镜出片（不给 shotIds 时只出还没出片的镜头），并打开全部出片后自动拼接（拼接要桌面端打开「视频制作」页）；full 为真时整条分镜一次生成一条完整视频。',
    schema: z
      .object({
        topicId,
        shotIds: z.array(shotId).min(1).max(60).optional(),
        full: z.boolean().optional(),
        prompt: z.string().trim().max(1000).optional(),
      })
      .strict(),
  },
} as const;

/** @keyword-en mcp-tools, tool-permission */
export type TenantMcpToolName = keyof typeof TENANT_MCP_TOOLS;

/**
 * @description 抖音工作台工具名（`douyin_` 开头），由 `TenantMcpDouyinToolsService` 分发。
 * @keyword-cn 抖音工具名, 工具分发
 * @keyword-en douyin-tool-name, tool-dispatch
 */
export type TenantMcpDouyinToolName = Extract<
  TenantMcpToolName,
  `douyin_${string}`
>;

/**
 * @description 每个工具的分组（后台按组勾选权限）与 MCP 提示标记：只读、会改动或删除数据、会访问外部平台。按工具名全覆盖，漏写编译不过。
 * @keyword-cn 工具分组, 工具提示标记
 * @keyword-en tool-group, tool-annotations
 */
export const TENANT_MCP_TOOL_META: Record<
  TenantMcpToolName,
  {
    group: string;
    readOnly?: boolean;
    destructive?: boolean;
    openWorld?: boolean;
  }
> = {
  gallery_search: { group: '图库与文章', readOnly: true },
  image_upload: { group: '图库与文章' },
  library_list: { group: '图库与文章', readOnly: true },
  library_get: { group: '图库与文章', readOnly: true },
  library_create: { group: '图库与文章' },
  library_update: { group: '图库与文章', destructive: true },
  article_publish: { group: '图库与文章' },
  article_upload: { group: '图库与文章' },
  article_get: { group: '图库与文章', readOnly: true },
  article_update: { group: '图库与文章', destructive: true },
  article_list: { group: '图库与文章', readOnly: true },
  article_list_published: { group: '图库与文章', readOnly: true },
  article_list_unpublished: { group: '图库与文章', readOnly: true },
  library_publish_qr: { group: '图库与文章' },
  article_recent_data: { group: '图库与文章', readOnly: true },
  article_crawl: { group: '图库与文章', openWorld: true },
  douyin_workspace: { group: '抖音 · 通用', readOnly: true },
  douyin_topic_get: { group: '抖音 · 通用', readOnly: true },
  douyin_topic_create: { group: '抖音 · 通用' },
  douyin_topic_update: { group: '抖音 · 通用', destructive: true },
  douyin_topic_delete: { group: '抖音 · 通用', destructive: true },
  douyin_video_options: { group: '抖音 · 通用', readOnly: true },
  douyin_personas: { group: '抖音 · 通用', readOnly: true },
  douyin_knowledge_list: { group: '抖音 · 通用', readOnly: true },
  douyin_video_merge: { group: '抖音 · 通用' },
  douyin_store_list: { group: '抖音 · 门店点位', readOnly: true },
  douyin_store_create: { group: '抖音 · 门店点位' },
  douyin_store_photo_upload: { group: '抖音 · 门店点位' },
  douyin_store_spots_classify: { group: '抖音 · 门店点位', destructive: true },
  douyin_store_spots_save: { group: '抖音 · 门店点位', destructive: true },
  douyin_store_visit_set_store: { group: '抖音 · 探店', destructive: true },
  douyin_store_visit_write_script: { group: '抖音 · 探店', destructive: true },
  douyin_store_visit_generate_lines: {
    group: '抖音 · 探店',
    destructive: true,
  },
  douyin_store_visit_voices: { group: '抖音 · 探店', readOnly: true },
  douyin_store_visit_set_cast: { group: '抖音 · 探店' },
  douyin_store_visit_match_scenes: { group: '抖音 · 探店', destructive: true },
  douyin_store_visit_generate: { group: '抖音 · 探店' },
  douyin_store_visit_regenerate_segment: { group: '抖音 · 探店' },
  douyin_store_visit_pipeline: { group: '抖音 · 探店' },
  douyin_storyboard_children_generate: { group: '抖音 · 分镜' },
  douyin_generation_jobs: { group: '抖音 · 分镜', readOnly: true },
  douyin_storyboard_drafts_confirm: { group: '抖音 · 分镜' },
  douyin_storyboard_generate: { group: '抖音 · 分镜', destructive: true },
  douyin_storyboard_shot_image: { group: '抖音 · 分镜' },
  douyin_storyboard_shot_video: { group: '抖音 · 分镜' },
};

/** @keyword-en article-upload, input-validation */
export const MCP_ARTICLE_CONTENT_SCHEMA = z.object(content).strict();

/** @keyword-en base64-validation, upload-limit */
export function decodeMcpBase64(value: string, maxBytes: number): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new BadRequestException('INVALID_BASE64');
  const buffer = Buffer.from(value, 'base64');
  if (
    !buffer.length ||
    buffer.length > maxBytes ||
    buffer.toString('base64') !== value
  )
    throw new BadRequestException('INVALID_UPLOAD_SIZE_OR_BASE64');
  return buffer;
}
