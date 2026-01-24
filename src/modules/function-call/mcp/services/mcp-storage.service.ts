import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

interface McpResource {
  id: string;
  name: string;
  path: string;
  size: number;
  mime?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * @description 管理 MCP 专用文件目录，提供资源列表、读取与写入能力。
 * @keyword mcp, storage, resources
 * @since 2026-01-24
 */
@Injectable()
export class McpStorageService {
  /**
   * @description 返回 MCP 文件根目录。优先使用环境变量 MCP_STORAGE_DIR，否则默认到项目内 storage/mcp。
   * @returns {string} 绝对路径
   * @keyword mcp, storage, path
   * @since 2026-01-24
   */
  getRootDir(): string {
    const root =
      process.env.MCP_STORAGE_DIR || path.resolve(process.cwd(), 'storage/mcp');
    return root;
  }

  /**
   * @description 确保 MCP 存储目录存在；若不存在则创建。
   * @returns {Promise<string>} 目录绝对路径
   * @throws {Error} 目录创建失败
   * @keyword mcp, storage, ensure
   * @example
   * await storage.ensureStorageDir();
   * @since 2026-01-24
   */
  async ensureStorageDir(): Promise<string> {
    const dir = this.getRootDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      return dir;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw err;
    }
  }

  /**
   * @description 列出目录下的资源，支持按名称片段过滤。
   * @param {string} [pattern] 名称包含过滤（可选）
   * @returns {Promise<McpResource[]>} 资源列表
   * @throws {Error} 读取失败
   * @keyword mcp, list, resources
   * @example
   * const items = await storage.listResources('report');
   * @since 2026-01-24
   */
  async listResources(pattern?: string): Promise<McpResource[]> {
    const dir = await this.ensureStorageDir();
    const ents = await fs.readdir(dir, { withFileTypes: true });
    const out: McpResource[] = [];
    for (const ent of ents) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (pattern && !name.toLowerCase().includes(pattern.toLowerCase())) {
        continue;
      }
      const full = path.resolve(dir, name);
      const stat = await fs.stat(full);
      const mime = this.inferMime(name);
      out.push({
        id: this.makeId(name),
        name,
        path: full,
        size: stat.size,
        mime,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });
    }
    return out;
  }

  /**
   * @description 读取资源内容，支持按 id 或文件名；若为二进制文件，返回 base64 与 encoding。
   * @param {object} query 查询对象
   * @param {string} [query.id] 资源ID
   * @param {string} [query.name] 文件名
   * @returns {Promise<{ name: string; mime?: string; encoding: 'utf-8'|'base64'; content: string }>} 资源内容
   * @throws {Error} 未找到或读取失败
   * @keyword mcp, read, file
   * @example
   * const data = await storage.readResource({ name: 'note.txt' });
   * @since 2026-01-24
   */
  async readResource(query: { id?: string; name?: string }): Promise<{
    name: string;
    mime?: string;
    encoding: 'utf-8' | 'base64';
    content: string;
  }> {
    const dir = await this.ensureStorageDir();
    const target = await this.resolvePathByQuery(dir, query);
    const name = path.basename(target);
    const mime = this.inferMime(name);
    const buf = await fs.readFile(target);
    const isText = this.isTextMime(mime);
    if (isText) {
      return { name, mime, encoding: 'utf-8', content: buf.toString('utf-8') };
    }
    return {
      name,
      mime,
      encoding: 'base64',
      content: buf.toString('base64'),
    };
  }

  /**
   * @description 将文本或二进制内容写入 MCP 目录（专用文件录入）。
   * @param {string} filename 文件名（不含路径）
   * @param {string} content 内容（utf-8 或 base64）
   * @param {('utf-8'|'base64')} [encoding] 内容编码（默认 utf-8）
   * @returns {Promise<McpResource>} 写入后的资源元信息
   * @throws {Error} 写入失败
   * @keyword mcp, ingest, write
   * @example
   * await storage.ingestFile('doc.txt', '你好', 'utf-8');
   * @since 2026-01-24
   */
  async ingestFile(
    filename: string,
    content: string,
    encoding: 'utf-8' | 'base64' = 'utf-8',
  ): Promise<McpResource> {
    const dir = await this.ensureStorageDir();
    const safe = path.basename(filename);
    const full = path.resolve(dir, safe);
    const buf =
      encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf-8');
    await fs.writeFile(full, buf);
    const stat = await fs.stat(full);
    const mime = this.inferMime(safe);
    return {
      id: this.makeId(safe),
      name: safe,
      path: full,
      size: stat.size,
      mime,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private async resolvePathByQuery(
    dir: string,
    query: { id?: string; name?: string },
  ): Promise<string> {
    const { id, name } = query;
    if (name && name.trim().length > 0) {
      const full = path.resolve(dir, path.basename(name));
      return full;
    }
    if (id && id.trim().length > 0) {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of ents) {
        if (!ent.isFile()) continue;
        const candidate = ent.name;
        if (this.makeId(candidate) === id) {
          return path.resolve(dir, candidate);
        }
      }
    }
    throw new Error('MCP_RESOURCE_NOT_FOUND');
  }

  private makeId(name: string): string {
    return Buffer.from(name).toString('hex').slice(0, 32);
  }

  private inferMime(name: string): string | undefined {
    const lower = name.toLowerCase();
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.ts')) return 'text/typescript';
    if (lower.endsWith('.js')) return 'text/javascript';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return undefined;
  }

  private isTextMime(mime?: string): boolean {
    if (!mime) return true;
    return mime.startsWith('text/') || mime === 'application/json';
  }
}
