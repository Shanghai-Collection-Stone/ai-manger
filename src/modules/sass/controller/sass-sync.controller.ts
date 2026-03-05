import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { createDecipheriv } from 'crypto';
import type { Request } from 'express';
import { SassService } from '../services/sass.service.js';
import type { SassTenantRequest } from '../types/sass-request.types.js';
import { SyncOrdersDto, SyncRefundsDto, SyncUsagesDto } from './sass.dto.js';

const DEFAULT_ORDER_SCHEMA_ID = '69a940530bb6fa16ce15e5bf';
const DEFAULT_REFUND_SCHEMA_ID = '69a940890bb6fa16ce15e5c0';
const DEFAULT_USAGE_SCHEMA_ID = '69a940e30bb6fa16ce15e5c1';
const FIXED_PHONE_AES_KEY = 'PR87ARAGbZjBqHifNhT2ve96lC2R38XC';
const FIXED_PHONE_AES_IV = 'u0GF47E3KSsnkJK8';

/**
 * @description 对接同步控制器，接收非租户payload并转换为SaaS入库
 * @keyword-en sass sync controller
 */
@Controller('api/sync')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class SassSyncController {
  constructor(private readonly sass: SassService) {}

  /**
   * @description 同步订单信息
   * @keyword-en sync orders endpoint
   */
  @Post('orders')
  async syncOrders(
    @Req() req: Request,
    @Body() body: SyncOrdersDto,
  ): Promise<Record<string, unknown>> {
    const headerContext = this.readSyncHeaders(req, body.timestamp);
    this.assertDataType(body.dataType, 'order');
    this.assertNonEmptyArray(body.orders, 'EMPTY_ORDERS');
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const rows = body.orders.map((item) => ({
      ...item,
      phone: this.decryptPhone(item.phone),
    }));
    const result = await this.sass.syncOrdersToSchema(
      this.resolveSchemaId(
        process.env.SASS_SYNC_ORDER_SCHEMA_ID,
        DEFAULT_ORDER_SCHEMA_ID,
      ),
      tenantId,
      keyId,
      rows,
    );
    return this.toSyncResponse(result.totalCount, headerContext);
  }

  /**
   * @description 同步订单使用信息
   * @keyword-en sync usages endpoint
   */
  @Post('usages')
  async syncUsages(
    @Req() req: Request,
    @Body() body: SyncUsagesDto,
  ): Promise<Record<string, unknown>> {
    const headerContext = this.readSyncHeaders(req, body.timestamp);
    this.assertDataType(body.dataType, 'usage');
    this.assertNonEmptyArray(body.usages, 'EMPTY_USAGES');
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const result = await this.sass.syncUsagesToSchema(
      this.resolveSchemaId(
        process.env.SASS_SYNC_USAGE_SCHEMA_ID,
        DEFAULT_USAGE_SCHEMA_ID,
      ),
      tenantId,
      keyId,
      body.usages,
    );
    return this.toSyncResponse(result.totalCount, headerContext);
  }

  /**
   * @description 同步订单退单信息
   * @keyword-en sync refunds endpoint
   */
  @Post('refunds')
  async syncRefunds(
    @Req() req: Request,
    @Body() body: SyncRefundsDto,
  ): Promise<Record<string, unknown>> {
    const headerContext = this.readSyncHeaders(req, body.timestamp);
    this.assertDataType(body.dataType, 'refund');
    this.assertNonEmptyArray(body.refunds, 'EMPTY_REFUNDS');
    const tenantId = this.readTenantId(req);
    const keyId = this.readKeyId(req);
    const result = await this.sass.syncRefundsToSchema(
      this.resolveSchemaId(
        process.env.SASS_SYNC_REFUND_SCHEMA_ID,
        DEFAULT_REFUND_SCHEMA_ID,
      ),
      tenantId,
      keyId,
      body.refunds,
    );
    return this.toSyncResponse(result.totalCount, headerContext);
  }

  /**
   * @description 读取中间件注入的tenantId
   * @keyword-en read tenant id from sync middleware
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
   * @keyword-en read key id from sync middleware
   */
  private readKeyId(req: Request): string | undefined {
    const keyId = (req as SassTenantRequest).sassKeyId;
    return typeof keyId === 'string' && keyId ? keyId : undefined;
  }

  /**
   * @description 校验dataType
   * @keyword-en assert sync data type
   */
  private assertDataType(dataType: string, expected: string): void {
    if (dataType !== expected) {
      throw new BadRequestException('INVALID_DATA_TYPE');
    }
  }

  /**
   * @description 校验数组非空
   * @keyword-en assert non empty array
   */
  private assertNonEmptyArray(values: unknown[], code: string): void {
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException(code);
    }
  }

  /**
   * @description 解析schemaId配置
   * @keyword-en resolve sync schema id
   */
  private resolveSchemaId(value: string | undefined, fallback: string): string {
    const schemaId = typeof value === 'string' ? value.trim() : '';
    return schemaId || fallback;
  }

  /**
   * @description 构建同步成功响应体
   * @keyword-en build sync response
   */
  private toSyncResponse(
    receivedCount: number,
    headerContext: { requestId: string; timestamp: string },
  ): Record<string, unknown> {
    return {
      code: 200,
      message: 'success',
      data: {
        receivedCount,
        requestId: headerContext.requestId,
        timestamp: headerContext.timestamp,
      },
    };
  }

  /**
   * @description 读取并处理特供同步请求头
   * @keyword-en read and normalize sync headers
   */
  private readSyncHeaders(
    req: Request,
    fallbackTimestamp: string,
  ): { requestId: string; timestamp: string } {
    this.assertContentType(req);
    const requestId = this.readRequestId(req);
    const timestamp = this.readHeaderTimestamp(req, fallbackTimestamp);
    return { requestId, timestamp };
  }

  /**
   * @description 校验Content-Type为JSON
   * @keyword-en assert content type json
   */
  private assertContentType(req: Request): void {
    const value = req.header('content-type');
    if (typeof value !== 'string' || !value.trim()) {
      return;
    }
    const normalized = value.toLowerCase();
    if (!normalized.includes('application/json')) {
      throw new BadRequestException('INVALID_CONTENT_TYPE');
    }
  }

  /**
   * @description 读取请求头中的请求标识
   * @keyword-en read request id header
   */
  private readRequestId(req: Request): string {
    const value = req.header('x-request-id');
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    throw new BadRequestException('REQUEST_ID_REQUIRED');
  }

  /**
   * @description 读取请求头中的时间戳
   * @keyword-en read timestamp header
   */
  private readHeaderTimestamp(req: Request, fallback: string): string {
    const value = req.header('x-timestamp');
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
      return fallback;
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return new Date(parsed).toISOString();
  }

  /**
   * @description 读取AES配置
   * @keyword-en read aes config
   */
  private readPhoneAesConfig(): { key: Buffer; iv: Buffer } {
    const keyRaw = FIXED_PHONE_AES_KEY;
    const ivRaw = FIXED_PHONE_AES_IV;
    const key = Buffer.from(keyRaw, 'utf8');
    const iv = Buffer.from(ivRaw, 'utf8');
    if (key.length !== 32 || iv.length !== 16) {
      throw new BadRequestException('PHONE_AES_CONFIG_INVALID');
    }
    return { key, iv };
  }

  /**
   * @description 解密手机号密文
   * @keyword-en decrypt phone ciphertext
   */
  private decryptPhone(value: string): string {
    const encrypted = value.trim();
    if (!encrypted) {
      throw new BadRequestException('PHONE_VALUE_EMPTY');
    }
    try {
      const { key, iv } = this.readPhoneAesConfig();
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      const plain = decrypted.trim();
      return plain || encrypted;
    } catch (error) {
      if (error instanceof BadRequestException) {
        const message = this.readBadRequestMessage(error);
        if (
          message === 'PHONE_VALUE_EMPTY' ||
          message === 'PHONE_AES_CONFIG_INVALID'
        ) {
          throw error;
        }
        return encrypted;
      }
      return encrypted;
    }
  }

  /**
   * @description 读取BadRequest异常消息
   * @keyword-en read bad request message
   */
  private readBadRequestMessage(error: BadRequestException): string {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (!response || typeof response !== 'object') {
      return '';
    }
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message) && typeof message[0] === 'string') {
      return message[0];
    }
    return '';
  }
}
