import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { SassService } from '../services/sass.service.js';
import type { SassSchemaUpdateInput } from '../entities/sass-schema.entity.js';
import type { SassTenantRequest } from '../types/sass-request.types.js';
import {
  CreateApiKeyDto,
  CreateSchemaDto,
  CreateTenantDto,
  DeleteOneDataDto,
  FindOneDataDto,
  InsertDataDto,
  ListDataDto,
  UpdateOneDataDto,
  UpdateSchemaDto,
} from './sass.dto.js';

/**
 * @description Sass控制器，提供schema、tenant、api-key与租户数据CRUD
 * @keyword-en sass controller
 */
@Controller('sass')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class SassController {
  constructor(private readonly sass: SassService) {}

  /**
   * @description 创建Schema
   * @keyword-en create sass schema
   */
  @Post('schema')
  async createSchema(
    @Body() input: CreateSchemaDto,
  ): Promise<Record<string, unknown>> {
    const schema = await this.sass.createSchema(input);
    return { schema };
  }

  /**
   * @description 列出Schema
   * @keyword-en list sass schema
   */
  @Get('schema')
  async listSchema(): Promise<Record<string, unknown>> {
    const schemas = await this.sass.listSchema();
    return { schemas };
  }

  /**
   * @description 获取Schema详情
   * @keyword-en get sass schema
   */
  @Get('schema/:id')
  async getSchema(@Param('id') id: string): Promise<Record<string, unknown>> {
    const schema = await this.sass.getSchema(id);
    return { schema };
  }

  /**
   * @description 更新Schema
   * @keyword-en update sass schema
   */
  @Patch('schema/:id')
  async updateSchema(
    @Param('id') id: string,
    @Body() input: UpdateSchemaDto,
  ): Promise<Record<string, unknown>> {
    const updateInput: SassSchemaUpdateInput = { ...input, id };
    const schema = await this.sass.updateSchema(updateInput);
    return { schema };
  }

  /**
   * @description 删除Schema
   * @keyword-en delete sass schema
   */
  @Delete('schema/:id')
  async deleteSchema(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const ok = await this.sass.deleteSchema(id);
    return { ok };
  }

  /**
   * @description 创建租户
   * @keyword-en create sass tenant
   */
  @Post('tenant')
  async createTenant(
    @Body() input: CreateTenantDto,
  ): Promise<Record<string, unknown>> {
    const tenant = await this.sass.createTenant(input);
    return { tenant };
  }

  /**
   * @description 列出租户
   * @keyword-en list sass tenant
   */
  @Get('tenant')
  async listTenant(): Promise<Record<string, unknown>> {
    const tenants = await this.sass.listTenant();
    return { tenants };
  }

  /**
   * @description 获取租户详情
   * @keyword-en get sass tenant
   */
  @Get('tenant/:id')
  async getTenant(@Param('id') id: string): Promise<Record<string, unknown>> {
    const tenant = await this.sass.getTenant(id);
    return { tenant };
  }

  /**
   * @description 获取平台信息（AI补充说明）
   * @keyword-en get platform info
   */
  @Get('platform-info')
  async getPlatformInfo(
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const info = await this.sass.getPlatformInfo(tenantId);
    return { platformInfo: info };
  }

  /**
   * @description 更新平台信息（AI补充说明）
   * @keyword-en upsert platform info
   */
  @Put('platform-info')
  async upsertPlatformInfo(
    @Req() req: Request,
    @Body() body: { aiPromptSupplement: string },
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const info = await this.sass.upsertPlatformInfo(tenantId, body.aiPromptSupplement);
    return { platformInfo: info };
  }

  /**
   * @description 创建API Key并返回明文Key
   * @keyword-en create sass api key
   */
  @Post('api-key')
  async createApiKey(
    @Body() input: CreateApiKeyDto,
  ): Promise<Record<string, unknown>> {
    const result = await this.sass.createApiKey(input);
    return {
      apiKey: result.secret,
      apiKeyInfo: result.apiKey,
    };
  }

  /**
   * @description 列出API Key
   * @keyword-en list sass api key
   */
  @Get('api-key')
  async listApiKey(
    @Query('tenantId') tenantId?: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.sass.listApiKey(tenantId);
    return { apiKeys: rows };
  }

  /**
   * @description 撤销API Key
   * @keyword-en revoke sass api key
   */
  @Delete('api-key/:id')
  async revokeApiKey(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const ok = await this.sass.revokeApiKey(id);
    return { ok };
  }

  /**
   * @description 读取中间件注入的tenantId
   * @keyword-en read tenant id from middleware
   */
  private readTenantId(req: Request): string {
    const tenantId = (req as SassTenantRequest).sassTenantId;
    if (typeof tenantId !== 'string' || !tenantId) {
      throw new UnauthorizedException('TENANT_CONTEXT_MISSING');
    }
    return tenantId;
  }

  /**
   * @description 读取中间件注入的keyId
   * @keyword-en read key id from middleware
   */
  private readKeyId(req: Request): string | undefined {
    const keyId = (req as SassTenantRequest).sassKeyId;
    return typeof keyId === 'string' && keyId ? keyId : undefined;
  }

  /**
   * @description 新增租户数据
   * @keyword-en insert sass tenant data
   */
  @Post('data/insert')
  async insertData(
    @Req() req: Request,
    @Body() body: InsertDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const result = await this.sass.insertData(body.schemaId, tenantId, keyId, {
      data: body.data,
    });
    return result;
  }

  /**
   * @description 批量补丁租户数据，存在则更新，不存在则新增
   * @keyword-en patch sass tenant data
   */
  @Post('data/patch')
  async patchData(
    @Req() req: Request,
    @Body() body: InsertDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const result = await this.sass.patchData(body.schemaId, tenantId, keyId, {
      data: body.data,
    });
    return result;
  }

  /**
   * @description 查询租户数据列表
   * @keyword-en list sass tenant data
   */
  @Post('data/list')
  async listData(
    @Req() req: Request,
    @Body() body: ListDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const rows = await this.sass.listData(body.schemaId, tenantId, keyId, body);
    return { rows };
  }

  /**
   * @description 查询租户单条数据
   * @keyword-en find one sass tenant data
   */
  @Post('data/find-one')
  async findOneData(
    @Req() req: Request,
    @Body() body: FindOneDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const row = await this.sass.findOneData(
      body.schemaId,
      tenantId,
      keyId,
      body,
    );
    return { row };
  }

  /**
   * @description 更新租户单条数据
   * @keyword-en update one sass tenant data
   */
  @Post('data/update-one')
  async updateOneData(
    @Req() req: Request,
    @Body() body: UpdateOneDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    return this.sass.updateOneData(body.schemaId, tenantId, keyId, body);
  }

  /**
   * @description 删除租户单条数据
   * @keyword-en delete one sass tenant data
   */
  @Post('data/delete-one')
  async deleteOneData(
    @Req() req: Request,
    @Body() body: DeleteOneDataDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    return this.sass.deleteOneData(body.schemaId, tenantId, keyId, {
      filter: body.filter,
      where: body.where,
    });
  }
}
