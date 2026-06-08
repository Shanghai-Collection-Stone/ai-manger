import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { ArticleLibraryService } from '../../article-library/services/article-library.service.js';
import { ArticleService } from '../../article-library/services/article.service.js';
import type { ArticleCreateInput } from '../../article-library/entities/article.entity.js';
import type {
  FeaturedArticleAuthScope,
  FeaturedArticleImageMode,
  FeaturedArticleImageRef,
  FeaturedArticlePage,
  FeaturedArticlePageInput,
  FeaturedArticleWorkspaceCreateInput,
  FeaturedArticleWorkspaceEntity,
  FeaturedArticleWorkspaceSummary,
  FeaturedArticleWorkspaceUpdateInput,
} from '../entities/featured-article.entity.js';
import { FEATURED_ARTICLE_IMAGE_SLOT_SIZE } from '../entities/featured-article.entity.js';

/**
 * @description Featured article workspace service for CRUD, page editing, and article-library handoff.
 * @keyword-en featured-article, workspace-service
 * @keyword-cn 精选文章, 工作区服务
 */
@Injectable()
export class FeaturedArticleService {
  private readonly workspaces: Collection<FeaturedArticleWorkspaceEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly COUNTER_KEY = 'featured_article_workspaces';

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly articleLibraryService: ArticleLibraryService,
    private readonly articleService: ArticleService,
  ) {
    this.workspaces = db.collection<FeaturedArticleWorkspaceEntity>(
      'featured_article_workspaces',
    );
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description Ensure MongoDB indexes and counter document for featured article workspaces.
   * @keyword-en featured-article, ensure-indexes
   * @keyword-cn 精选文章, 索引
   */
  async ensureIndexes(): Promise<void> {
    await this.workspaces.createIndex({ id: 1 }, { unique: true });
    await this.workspaces.createIndex({ scopeId: 1, updatedAt: -1 });
    await this.workspaces.createIndex({ tenantId: 1, updatedAt: -1 });
    await this.workspaces.createIndex({ userId: 1, updatedAt: -1 });
    await this.counters.updateOne(
      { _id: this.COUNTER_KEY },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
  }

  /**
   * @description Generate the next numeric workspace id.
   * @keyword-en featured-article, next-workspace-id
   * @keyword-cn 精选文章, 工作区编号
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: this.COUNTER_KEY },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description Resolve tenant-level or user-level scope id.
   * @keyword-en featured-article, resolve-scope-id
   * @keyword-cn 精选文章, 作用域
   */
  private resolveScopeId(scope: FeaturedArticleAuthScope): string {
    const tenantId = String(scope.tenantId ?? '').trim();
    if (tenantId) return tenantId;
    return `user:${String(scope.userId ?? '').trim()}`;
  }

  /**
   * @description Normalize workspace name with a safe fallback.
   * @keyword-en featured-article, normalize-workspace
   * @keyword-cn 精选文章, 工作区规范化
   */
  private normalizeWorkspaceName(input: unknown, fallback: string): string {
    const name = String(input ?? '').trim();
    return name || fallback;
  }

  /**
   * @description Normalize one image reference stored on a featured article page.
   * @keyword-en featured-article, normalize-image-reference
   * @keyword-cn 精选文章, 图片引用规范化
   */
  private normalizeImageRef(input: unknown): FeaturedArticleImageRef | null {
    if (!input || typeof input !== 'object') return null;
    const record = input as Record<string, unknown>;
    const id = Number(record.id);
    const url = String(record.url ?? '').trim();
    const thumbUrl = String(record.thumbUrl ?? '').trim();
    const originalName = String(record.originalName ?? '').trim();
    const tags = Array.isArray(record.tags)
      ? record.tags
          .map((tag) => String(tag ?? '').trim())
          .filter(Boolean)
          .slice(0, 32)
      : undefined;
    const source = String(record.source ?? '').trim();
    const out: FeaturedArticleImageRef = {};
    if (Number.isFinite(id)) out.id = id;
    if (url) out.url = url;
    if (thumbUrl) out.thumbUrl = thumbUrl;
    if (originalName) out.originalName = originalName;
    if (tags?.length) out.tags = tags;
    if (source) out.source = source;
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * @description Normalize image mode to one of the supported page modes.
   * @keyword-en featured-article, normalize-image-mode
   * @keyword-cn 精选文章, 图片模式
   */
  private normalizeImageMode(input: unknown): FeaturedArticleImageMode {
    if (input === 'gallery-stack' || input === 'collage') return input;
    return 'empty';
  }

  /**
   * @description Normalize page input into a persisted page document.
   * @keyword-en featured-article, normalize-page
   * @keyword-cn 精选文章, 页面规范化
   */
  private normalizePageInput(
    input: FeaturedArticlePageInput | undefined,
    index: number,
    now = new Date(),
  ): FeaturedArticlePage {
    const images = Array.isArray(input?.images)
      ? input.images
          .map((image) => this.normalizeImageRef(image))
          .filter((image): image is FeaturedArticleImageRef => Boolean(image))
          .slice(0, 18)
      : [];
    const collageUrl = String(input?.collageUrl ?? '').trim();
    const imageMode =
      collageUrl || images.length > 0
        ? this.normalizeImageMode(input?.imageMode ?? 'gallery-stack')
        : 'empty';
    return {
      id:
        typeof input?.id === 'string' && input.id.trim()
          ? input.id.trim()
          : `page-${now.getTime()}-${Math.random().toString(16).slice(2)}`,
      topic: String(input?.topic ?? '').trim(),
      imageMode,
      images,
      collageUrl: collageUrl || undefined,
      imagePrompt: String(input?.imagePrompt ?? '').trim() || undefined,
      title: String(input?.title ?? '').trim(),
      body: String(input?.body ?? ''),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * @description Apply a partial patch to an existing page and keep immutable fields.
   * @keyword-en featured-article, patch-page
   * @keyword-cn 精选文章, 页面更新
   */
  private patchPage(
    current: FeaturedArticlePage,
    patch: FeaturedArticlePageInput,
  ): FeaturedArticlePage {
    const next = this.normalizePageInput(
      { ...current, ...patch, id: current.id },
      1,
      current.createdAt,
    );
    return {
      ...next,
      storedLibraryId: current.storedLibraryId,
      storedArticleId: current.storedArticleId,
      storedAt: current.storedAt,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    };
  }

  /**
   * @description Build a workspace picker summary from a workspace document.
   * @keyword-en featured-article, workspace-summary
   * @keyword-cn 精选文章, 工作区摘要
   */
  private toSummary(
    workspace: FeaturedArticleWorkspaceEntity,
  ): FeaturedArticleWorkspaceSummary {
    return {
      ...workspace,
      articleCount: Array.isArray(workspace.pages) ? workspace.pages.length : 0,
    };
  }

  /**
   * @description List featured article workspaces for the current scope.
   * @keyword-en featured-article, list-workspaces
   * @keyword-cn 精选文章, 工作区列表
   */
  async listWorkspaces(params: {
    scope: FeaturedArticleAuthScope;
    limit?: number;
    offset?: number;
  }): Promise<{ items: FeaturedArticleWorkspaceSummary[]; total: number }> {
    const scopeId = this.resolveScopeId(params.scope);
    const limit = Math.max(1, Math.min(params.limit ?? 100, 200));
    const offset = Math.max(0, params.offset ?? 0);
    const [items, total] = await Promise.all([
      this.workspaces
        .find({ scopeId })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.workspaces.countDocuments({ scopeId }),
    ]);
    return { items: items.map((item) => this.toSummary(item)), total };
  }

  /**
   * @description Create a featured article workspace.
   * @keyword-en featured-article, create-workspace
   * @keyword-cn 精选文章, 创建工作区
   */
  async createWorkspace(
    scope: FeaturedArticleAuthScope,
    input: FeaturedArticleWorkspaceCreateInput,
  ): Promise<FeaturedArticleWorkspaceSummary> {
    const now = new Date();
    const scopeId = this.resolveScopeId(scope);
    const pages = Array.isArray(input.pages)
      ? input.pages.map((page, index) =>
          this.normalizePageInput(page, index + 1, now),
        )
      : [];
    const doc: FeaturedArticleWorkspaceEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      scope: scope.tenantId ? 'tenant' : 'user',
      scopeId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      name: this.normalizeWorkspaceName(input.name, '精选工作区'),
      pages,
      createdAt: now,
      updatedAt: now,
    };
    await this.workspaces.insertOne(doc);
    return this.toSummary(doc);
  }

  /**
   * @description Get one featured article workspace by id and scope.
   * @keyword-en featured-article, get-workspace
   * @keyword-cn 精选文章, 工作区详情
   */
  async getWorkspace(
    scope: FeaturedArticleAuthScope,
    id: number,
  ): Promise<FeaturedArticleWorkspaceSummary | null> {
    const workspace = await this.workspaces.findOne({
      id,
      scopeId: this.resolveScopeId(scope),
    });
    return workspace ? this.toSummary(workspace) : null;
  }

  /**
   * @description Update featured article workspace metadata.
   * @keyword-en featured-article, update-workspace
   * @keyword-cn 精选文章, 更新工作区
   */
  async updateWorkspace(
    scope: FeaturedArticleAuthScope,
    id: number,
    input: FeaturedArticleWorkspaceUpdateInput,
  ): Promise<FeaturedArticleWorkspaceSummary | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      set.name = input.name.trim();
    }
    const res = await this.workspaces.findOneAndUpdate(
      { id, scopeId: this.resolveScopeId(scope) },
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ? this.toSummary(res.value) : null;
  }

  /**
   * @description Delete one featured article workspace.
   * @keyword-en featured-article, delete-workspace
   * @keyword-cn 精选文章, 删除工作区
   */
  async deleteWorkspace(
    scope: FeaturedArticleAuthScope,
    id: number,
  ): Promise<boolean> {
    const res = await this.workspaces.deleteOne({
      id,
      scopeId: this.resolveScopeId(scope),
    });
    return res.deletedCount === 1;
  }

  /**
   * @description Add a new page to a workspace.
   * @keyword-en featured-article, create-page
   * @keyword-cn 精选文章, 创建页面
   */
  async createPage(
    scope: FeaturedArticleAuthScope,
    workspaceId: number,
    input?: FeaturedArticlePageInput,
  ): Promise<{
    workspace: FeaturedArticleWorkspaceSummary;
    page: FeaturedArticlePage;
  } | null> {
    const workspace = await this.getWorkspace(scope, workspaceId);
    if (!workspace) return null;
    const page = this.normalizePageInput(
      input,
      (workspace.pages?.length || 0) + 1,
    );
    const nextPages = [...(workspace.pages || []), page];
    const res = await this.workspaces.findOneAndUpdate(
      { id: workspaceId, scopeId: this.resolveScopeId(scope) },
      { $set: { pages: nextPages, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) return null;
    return { workspace: this.toSummary(res.value), page };
  }

  /**
   * @description Patch one page inside a workspace.
   * @keyword-en featured-article, update-page
   * @keyword-cn 精选文章, 更新页面
   */
  async updatePage(
    scope: FeaturedArticleAuthScope,
    workspaceId: number,
    pageId: string,
    patch: FeaturedArticlePageInput,
  ): Promise<{
    workspace: FeaturedArticleWorkspaceSummary;
    page: FeaturedArticlePage;
  } | null> {
    const workspace = await this.getWorkspace(scope, workspaceId);
    if (!workspace) return null;
    const current = workspace.pages.find((page) => page.id === pageId);
    if (!current) return null;
    const page = this.patchPage(current, patch);
    const nextPages = workspace.pages.map((item) =>
      item.id === pageId ? page : item,
    );
    const res = await this.workspaces.findOneAndUpdate(
      { id: workspaceId, scopeId: this.resolveScopeId(scope) },
      { $set: { pages: nextPages, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.value) return null;
    return { workspace: this.toSummary(res.value), page };
  }

  /**
   * @description Delete one page from a workspace.
   * @keyword-en featured-article, delete-page
   * @keyword-cn 精选文章, 删除页面
   */
  async deletePage(
    scope: FeaturedArticleAuthScope,
    workspaceId: number,
    pageId: string,
  ): Promise<FeaturedArticleWorkspaceSummary | null> {
    const workspace = await this.getWorkspace(scope, workspaceId);
    if (!workspace) return null;
    const nextPages = workspace.pages.filter((page) => page.id !== pageId);
    if (nextPages.length === workspace.pages.length) return null;
    const res = await this.workspaces.findOneAndUpdate(
      { id: workspaceId, scopeId: this.resolveScopeId(scope) },
      { $set: { pages: nextPages, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ? this.toSummary(res.value) : null;
  }

  /**
   * @description Read the display image url from an image reference.
   * @keyword-en featured-article, image-url
   * @keyword-cn 精选文章, 图片地址
   */
  private readImageUrl(image: FeaturedArticleImageRef): string {
    return String(image.url || image.thumbUrl || '').trim();
  }

  /**
   * @description Convert a featured article page into an article-library create payload.
   * @keyword-en featured-article, article-library-payload
   * @keyword-cn 精选文章, 文章库载荷
   */
  private buildArticlePayload(params: {
    workspace: FeaturedArticleWorkspaceSummary;
    page: FeaturedArticlePage;
    libraryId: number;
    scope: FeaturedArticleAuthScope;
  }): ArticleCreateInput {
    const { workspace, page, libraryId, scope } = params;
    const imageUrls = page.collageUrl
      ? [page.collageUrl]
      : page.images.map((image) => this.readImageUrl(image)).filter(Boolean);
    const imageIds = page.images
      .map((image) => Number(image.id))
      .filter((id) => Number.isFinite(id));
    const title =
      String(page.title || '').trim() ||
      String(page.topic || '').trim() ||
      '未命名精选文章';
    const text = String(page.body || '').trim();
    const tags = [page.topic, workspace.name, '精选文章']
      .map((tag) => String(tag ?? '').trim())
      .filter(Boolean)
      .slice(0, 32);
    return {
      libraryId,
      userId: scope.userId,
      tenantId: scope.tenantId,
      title,
      tags,
      contentJson: {
        markdown: text,
        topic: page.topic,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        pageId: page.id,
        imageMode: page.imageMode,
        imageSlot: FEATURED_ARTICLE_IMAGE_SLOT_SIZE,
        source: 'featured-article',
      },
      text,
      imageUrls,
      imageIds,
      publishStatus: 'unpublished',
      source: 'featured-article',
      sourceRef: {
        featuredWorkspaceId: workspace.id,
        featuredPageId: page.id,
      },
    };
  }

  /**
   * @description Store one featured article page into an article library and record the target article id.
   * @keyword-en featured-article, store-to-library
   * @keyword-cn 精选文章, 存入文章库
   */
  async storePageToLibrary(params: {
    scope: FeaturedArticleAuthScope;
    workspaceId: number;
    pageId: string;
    libraryId: number;
  }) {
    const workspace = await this.getWorkspace(params.scope, params.workspaceId);
    if (!workspace) return null;
    const page = workspace.pages.find((item) => item.id === params.pageId);
    if (!page) return null;
    const library = await this.articleLibraryService.get(
      params.libraryId,
      params.scope.tenantId,
    );
    if (!library) throw new BadRequestException('LIBRARY_NOT_FOUND');
    const article = await this.articleService.create(
      this.buildArticlePayload({
        workspace,
        page,
        libraryId: params.libraryId,
        scope: params.scope,
      }),
    );
    const now = new Date();
    const nextPages = workspace.pages.map((item) =>
      item.id === params.pageId
        ? {
            ...item,
            storedLibraryId: params.libraryId,
            storedArticleId: article.id,
            storedAt: now,
            updatedAt: now,
          }
        : item,
    );
    const res = await this.workspaces.findOneAndUpdate(
      { id: params.workspaceId, scopeId: this.resolveScopeId(params.scope) },
      { $set: { pages: nextPages, updatedAt: now } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return {
      article,
      workspace: res.value ? this.toSummary(res.value) : workspace,
    };
  }
}
