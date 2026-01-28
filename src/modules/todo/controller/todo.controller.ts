import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TodoService } from '../services/todo.service.js';
import type {
  TodoCreateInput,
  TodoUpdateInput,
} from '../entities/todo.entity.js';

/**
 * @description 待办控制器，提供REST接口
 * @keyword todo, controller, rest
 * @since 2026-01-27
 */
@Controller('todo')
export class TodoController {
  constructor(private readonly todo: TodoService) {}

  /**
   * @description 创建待办
   * @param {TodoCreateInput} input - 创建输入
   * @returns {Promise<Record<string, unknown>>} 创建结果
   * @keyword todo, create
   * @since 2026-01-27
   */
  @Post()
  async create(
    @Body() input: TodoCreateInput,
  ): Promise<Record<string, unknown>> {
    const doc = await this.todo.create(input);
    return { todo: { ...doc, _id: undefined } };
  }

  /**
   * @description 列出待办，支持按用户过滤
   * @param {string} [userId] - 指定用户
   * @returns {Promise<Record<string, unknown>>} 列表
   * @keyword todo, list, user
   * @since 2026-01-27
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.todo.list(userId);
    return { todos: rows };
  }

  /**
   * @description 获取待办
   * @param {string} id - 序号ID
   * @returns {Promise<Record<string, unknown>>} 单条
   * @keyword todo, get
   * @since 2026-01-27
   */
  @Get(':id')
  async get(@Param('id') id: string): Promise<Record<string, unknown>> {
    const doc = await this.todo.get(Number(id));
    return { todo: doc };
  }

  /**
   * @description 更新待办
   * @param {string} id - 序号ID
   * @param {TodoUpdateInput} input - 更新输入
   * @returns {Promise<Record<string, unknown>>} 更新结果
   * @keyword todo, update
   * @since 2026-01-27
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() input: TodoUpdateInput,
  ): Promise<Record<string, unknown>> {
    const doc = await this.todo.update({ ...input, id: Number(id) });
    return { todo: doc };
  }

  /**
   * @description 删除待办
   * @param {string} id - 序号ID
   * @returns {Promise<Record<string, unknown>>} 删除结果
   * @keyword todo, delete
   * @since 2026-01-27
   */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Record<string, unknown>> {
    const ok = await this.todo.delete(Number(id));
    return { ok };
  }
}
