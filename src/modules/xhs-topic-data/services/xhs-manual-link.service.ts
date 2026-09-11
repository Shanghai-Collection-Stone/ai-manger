import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { ArticleLibraryService } from '../../article-library/services/article-library.service.js';
import { ArticleService } from '../../article-library/services/article.service.js';
import type { ArticleEntity } from '../../article-library/entities/article.entity.js';
import { XhsTopicRepositoryService } from '../../xhs-topic/services/xhs-topic-repository.service.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';

/**
 * @description 小红书笔记 ID 形态：24 位十六进制。
 * @keyword-cn 小红书笔记ID, 链接解析
 * @keyword-en xhs-note-id, link-parse
 */
export const XHS_NOTE_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * @description 从小红书笔记链接里解析 NoteId。支持 `/explore/{id}`、`/discovery/item/{id}`、
 *   `/user/profile/{userId}/{id}` 以及 `noteId` / `note_id` 查询参数；`xhslink.com` 短链不带 NoteId，解析不到返回 null。
 * @keyword-cn 解析笔记ID, 链接解析
 * @keyword-en parse-note-id, link-parse
 * @param link 用户粘贴的链接或分享文本。
 * @returns {string | null} 小写 NoteId；解析不到时为 null。
 */
export function parseXhsNoteId(link: string): string | null {
  const text = String(link ?? '').trim();
  if (!text) return null;
  // ID 后面不能再紧跟字母数字，避免把更长的串截出 24 位；空格、参数、结尾都允许（兼容分享文本）
  const patterns = [
    /\/explore\/([0-9a-f]{24})(?![0-9a-z])/i,
    /\/discovery\/item\/([0-9a-f]{24})(?![0-9a-z])/i,
    /\/user\/profile\/[0-9a-z]+\/([0-9a-f]{24})(?![0-9a-z])/i,
    /[?&]note_?id=([0-9a-f]{24})(?![0-9a-z])/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] && XHS_NOTE_ID_PATTERN.test(match[1])) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

/**
 * @description 数据监控手动添加笔记链接：解析 NoteId、校验文章库归属与重复，再建独立子选题并以已发布状态入库，
 *   入库即触发发布驱动的抓取调度，之后与选题工作台发出的文章走同一条监控链路。
 * @keyword-cn 手动添加链接, 数据监控
 * @keyword-en manual-note-link, data-monitor
 */
@Injectable()
export class XhsManualLinkService {
  private readonly articles: Collection<ArticleEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly libraryService: ArticleLibraryService,
    private readonly articleService: ArticleService,
    private readonly repository: XhsTopicRepositoryService,
  ) {
    this.articles = db.collection<ArticleEntity>('articles');
  }

  /**
   * @description 创建一条手动添加的已发布笔记记录；链接里解析不到 NoteId、文章库不存在或该库已有同一笔记时拒绝。
   * @keyword-cn 手动添加链接, 解析笔记ID, 重复笔记拦截
   * @keyword-en manual-note-link, parse-note-id, duplicate-note-guard
   * @param input 目标文章库、标题与链接。
   * @param user 当前后台用户：选题按 ObjectId 归属，文章按用户名归属。
   * @returns {Promise<{ article: ArticleEntity; topic: XhsTopicEntity }>} 新文章与独立子选题。
   * @throws {BadRequestException} XHS_NOTE_ID_NOT_FOUND / XHS_MANUAL_LINK_TITLE_REQUIRED。
   * @throws {NotFoundException} LIBRARY_NOT_FOUND。
   * @throws {ConflictException} XHS_NOTE_ALREADY_EXISTS。
   */
  async create(
    input: { libraryId: number; title: string; url: string },
    user: { tenantId?: string; userId: string; username: string },
  ): Promise<{ article: ArticleEntity; topic: XhsTopicEntity }> {
    const title = String(input.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) throw new BadRequestException('XHS_MANUAL_LINK_TITLE_REQUIRED');
    const url = String(input.url ?? '').trim();
    const noteId = parseXhsNoteId(url);
    if (!noteId) throw new BadRequestException('XHS_NOTE_ID_NOT_FOUND');
    const library = await this.libraryService.get(
      input.libraryId,
      user.tenantId,
    );
    if (!library) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const duplicate = await this.articles.findOne(
      {
        libraryId: input.libraryId,
        'meta.NoteId': { $in: [noteId, noteId.toUpperCase()] },
      },
      { projection: { id: 1 } },
    );
    if (duplicate) throw new ConflictException('XHS_NOTE_ALREADY_EXISTS');

    const topic = await this.repository.createManualLinkTopic(
      { title },
      { tenantId: user.tenantId, userId: user.userId },
    );
    try {
      const article = await this.articleService.create({
        libraryId: input.libraryId,
        userId: user.username,
        tenantId: user.tenantId,
        title,
        // 走 xhs-topic 来源，发布状态变化才会通知抓取调度表
        source: 'xhs-topic',
        publishStatus: 'published',
        meta: {
          xhsTopicId: topic.id,
          NoteId: noteId,
          noteUrl: url.slice(0, 2000),
          manualLink: true,
        },
      });
      return { article, topic };
    } catch (error) {
      await this.repository.deleteMany([topic.id], {
        tenantId: user.tenantId,
        userId: user.userId,
      });
      throw error;
    }
  }
}
