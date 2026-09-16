import {
  BadRequestException,
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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../guards/policies.guard.js';
import { RequirePermission } from '../decorators/require-permission.decorator.js';
import { AdminService } from '../services/admin.service.js';
import type { AdminRequest } from '../types/admin-request.types.js';
import { RequireSmsCode } from '../../sms-verification/decorators/require-sms-code.decorator.js';
import type { SmsVerifiedRequest } from '../../sms-verification/entities/sms-verification.entity.js';
import {
  AdminLoginDto,
  AdminLoginIdentifyDto,
  AdminLoginSelectDto,
  AdminRegisterDto,
  AdjustTenantCreditDto,
  CreateAdminUserDto,
  CreateAgentConfigDto,
  CreateApiKeyByAdminDto,
  CreateClawConfigDto,
  CreateDataSourceByAdminDto,
  CreateTenantByAdminDto,
  CreateXhsAccountDto,
  RechargeTenantCreditDto,
  UpdateAgentConfigDto,
  UpdateAiProviderDto,
  UpdateAiServiceCreditDto,
  UpdateAdminUserDto,
  UpdateApiKeyByAdminDto,
  UpdateClawConfigDto,
  UpdateDataSourceByAdminDto,
  UpdateLlmSettingDto,
  UpdateTenantByAdminDto,
  UpdateXhsAccountDto,
  UpsertAiProviderDto,
  UpsertLlmSettingDto,
  UpsertPlatformInfoDto,
} from './admin.dto.js';

/**
 * @description 后台管理控制器
 * @keyword-en admin management controller
 */
@Controller('admin')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * @description 旧版单步登录（用户名 + 租户），公开免鉴权，保留兼容
   * @keyword-cn 兼容登录接口, 用户名登录
   * @keyword-en legacy-login-endpoint, username-login
   */
  @Post('auth/login')
  async login(@Body() body: AdminLoginDto) {
    return this.adminService.login(body);
  }

  /**
   * @description 两步登录第一步（公开免鉴权）：手机号或用户名 + 密码，返回登录票据与已绑定租户
   * @keyword-cn 登录识别接口, 手机号登录
   * @keyword-en login-identify-endpoint, phone-login
   */
  @Post('auth/login/identify')
  async identifyLogin(@Body() body: AdminLoginIdentifyDto) {
    return this.adminService.identifyLogin(body);
  }

  /**
   * @description 两步登录第二步（公开免鉴权，凭登录票据）：选定租户并签发会话
   * @keyword-cn 选择租户接口, 签发会话
   * @keyword-en login-select-endpoint, issue-session
   */
  @Post('auth/login/select')
  async selectLoginTenant(@Body() body: AdminLoginSelectDto) {
    return this.adminService.selectLoginTenant(body);
  }

  /**
   * @description 租户入驻页的业务员微信二维码与提示语（公开免鉴权，只读平台配置）
   * @keyword-cn 业务员二维码接口, 租户入驻
   * @keyword-en sales-contact-endpoint, tenant-onboarding
   */
  @Get('auth/sales-contact')
  async getSalesContact() {
    return this.adminService.getSalesContact();
  }

  /**
   * @description 自助注册（与登录同为公开免鉴权入口，需短信验证码）：以已验证手机号建账号，固定加入默认租户「其他」
   * @keyword-cn 自助注册接口, 默认租户
   * @keyword-en self-register-endpoint, default-tenant
   */
  @Post('auth/register')
  @RequireSmsCode('register')
  async register(
    @Req() req: SmsVerifiedRequest,
    @Body() body: AdminRegisterDto,
  ) {
    const phone = req.smsVerification?.phone;
    if (!phone) throw new BadRequestException('SMS_CODE_REQUIRED');
    return this.adminService.register({ ...body, phone });
  }

  /**
   * @description 获取登录可选租户
   * @keyword-en list auth login tenant options
   */
  @Get('auth/tenants')
  async listLoginTenants() {
    const tenants = await this.adminService.listLoginTenants();
    return { tenants };
  }

  /**
   * @description 获取当前登录用户
   * @keyword-en get admin me endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('auth/me')
  async me(@Req() req: Request) {
    return this.adminService.getMe(this.requireUser(req));
  }

  /**
   * @description 查询当前登录租户自己的 Credit 余额与倒序不可变流水。
   * @keyword-cn 当前Credit账户, 自身流水
   * @keyword-en current-credit-account, own-transaction-list
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'User')
  @Get('auth/credit-account')
  async getCurrentCreditAccount(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
      throw new BadRequestException('CREDIT_LIMIT_INVALID');
    }
    if (parsedBefore && Number.isNaN(parsedBefore.getTime())) {
      throw new BadRequestException('CREDIT_BEFORE_INVALID');
    }
    return this.adminService.getCurrentCreditAccount(this.requireUser(req), {
      limit: parsedLimit,
      before: parsedBefore,
    });
  }

  /**
   * @description 退出登录
   * @keyword-en admin logout endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('auth/logout')
  async logout(@Req() req: Request) {
    const token = (req as AdminRequest).adminToken;
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    await this.adminService.logout(token);
    return { ok: true };
  }

  /**
   * @description 用户管理列表
   * @keyword-en admin users list endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'User')
  @Get('users')
  async listUsers(@Req() req: Request) {
    const users = await this.adminService.listUsers(this.requireUser(req));
    return { users };
  }

  /**
   * @description 用户管理新增
   * @keyword-en admin users create endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('create', 'User')
  @Post('users')
  async createUser(@Req() req: Request, @Body() body: CreateAdminUserDto) {
    const user = await this.adminService.createUser(
      this.requireUser(req),
      body,
    );
    return { user };
  }

  /**
   * @description 用户管理更新
   * @keyword-en admin users update endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'User')
  @Patch('users/:id')
  async updateUser(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateAdminUserDto,
  ) {
    const user = await this.adminService.updateUser(
      this.requireUser(req),
      id,
      body,
    );
    return { user };
  }

  /**
   * @description 用户管理删除
   * @keyword-en admin users delete endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('delete', 'User')
  @Delete('users/:id')
  async deleteUser(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.adminService.deleteUser(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 角色管理列表（静态 RBAC 角色目录及权限矩阵，只读）
   * @keyword-en admin roles list endpoint
   * @keyword-cn 角色管理列表
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'Role')
  @Get('roles')
  listRoles() {
    return { roles: this.adminService.listRoles() };
  }

  /**
   * @description AI提供商配置列表
   * @keyword-en admin ai providers list endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'AiProvider')
  @Get('ai-providers')
  async listAiProviders(@Req() req: Request) {
    const rows = await this.adminService.listAiProviders(this.requireUser(req));
    return { providers: rows };
  }

  /**
   * @description AI提供商配置新增或更新
   * @keyword-en admin ai providers upsert endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('create', 'AiProvider')
  @Post('ai-providers')
  async upsertAiProvider(
    @Req() req: Request,
    @Body() body: UpsertAiProviderDto,
  ) {
    const provider = await this.adminService.upsertAiProvider(
      this.requireUser(req),
      body,
    );
    return { provider };
  }

  /**
   * @description AI提供商配置更新
   * @keyword-en admin ai providers update endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'AiProvider')
  @Patch('ai-providers/:id')
  async updateAiProvider(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateAiProviderDto,
  ) {
    const provider = await this.adminService.updateAiProvider(
      this.requireUser(req),
      id,
      body,
    );
    return { provider };
  }

  /**
   * @description AI提供商配置删除
   * @keyword-en admin ai providers delete endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('delete', 'AiProvider')
  @Delete('ai-providers/:id')
  async deleteAiProvider(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.adminService.deleteAiProvider(
      this.requireUser(req),
      id,
    );
    return { ok };
  }

  /**
   * @description 测试 AI 提供商连通性:GET /models 探活,15 秒超时,不消耗配额。
   *   返回 { ok, status, latencyMs, endpoint, message, modelCount?, sample? }。
   *   主要用于诊断 baseUrl/apiKey 配置或国内直连 OpenAI 网络问题。
   * @keyword-en admin ai providers test connectivity endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'AiProvider')
  @Post('ai-providers/:id/test')
  async testAiProvider(@Req() req: Request, @Param('id') id: string) {
    const result = await this.adminService.testAiProvider(
      this.requireUser(req),
      id,
    );
    return result;
  }

  /**
   * @description 列出代码内固定的收费服务及当前生效 Credit 点数。
   * @keyword-cn 服务管理列表, 生效点数
   * @keyword-en service-management-list, effective-credit
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'AiService')
  @Get('ai-services')
  async listAiServices(@Req() req: Request) {
    const services = await this.adminService.listAiServices(
      this.requireUser(req),
    );
    return { services };
  }

  /**
   * @description 修改固定服务编码的 Credit 消耗点数。
   * @keyword-cn 更新服务点数, 固定服务编码
   * @keyword-en update-service-credit, immutable-service-code
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'AiService')
  @Patch('ai-services/:code')
  async updateAiServiceCredit(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: UpdateAiServiceCreditDto,
  ) {
    const service = await this.adminService.updateAiServiceCredit(
      this.requireUser(req),
      code,
      body.creditCost,
    );
    return { service };
  }

  /**
   * @description 租户管理列表
   * @keyword-en admin tenants list endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'User')
  @Get('tenants')
  async listTenants(@Req() req: Request) {
    const tenants = await this.adminService.listTenants(this.requireUser(req));
    return { tenants };
  }

  /**
   * @description 租户管理新增
   * @keyword-en admin tenants create endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('create', 'User')
  @Post('tenants')
  async createTenant(
    @Req() req: Request,
    @Body() body: CreateTenantByAdminDto,
  ) {
    const tenant = await this.adminService.createTenant(
      this.requireUser(req),
      body,
    );
    return { tenant };
  }

  /**
   * @description 租户管理更新
   * @keyword-en admin tenants update endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'User')
  @Patch('tenants/:id')
  async updateTenant(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateTenantByAdminDto,
  ) {
    const tenant = await this.adminService.updateTenant(
      this.requireUser(req),
      id,
      body,
    );
    return { tenant };
  }

  /**
   * @description 查询租户 Credit 当前余额与倒序不可变流水。
   * @keyword-cn Credit账户查询, 流水查询
   * @keyword-en credit-account-query, transaction-list
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'User')
  @Get('tenants/:id/credits')
  async getTenantCreditAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
      throw new BadRequestException('CREDIT_LIMIT_INVALID');
    }
    if (parsedBefore && Number.isNaN(parsedBefore.getTime())) {
      throw new BadRequestException('CREDIT_BEFORE_INVALID');
    }
    return this.adminService.getTenantCreditAccount(this.requireUser(req), id, {
      limit: parsedLimit,
      before: parsedBefore,
    });
  }

  /**
   * @description 为租户追加一笔 Credit 充值流水并更新余额。
   * @keyword-cn 租户充值接口, 追加流水
   * @keyword-en tenant-recharge-endpoint, append-ledger
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'User')
  @Post('tenants/:id/credits/recharge')
  async rechargeTenantCredit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RechargeTenantCreditDto,
  ) {
    return this.adminService.rechargeTenantCredit(
      this.requireUser(req),
      id,
      body,
    );
  }

  /**
   * @description 为租户追加一笔正数或负数 Credit 人工调账流水。
   * @keyword-cn 人工调账接口, 余额增减
   * @keyword-en credit-adjustment-endpoint, balance-change
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'User')
  @Post('tenants/:id/credits/adjust')
  async adjustTenantCredit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AdjustTenantCreditDto,
  ) {
    return this.adminService.adjustTenantCredit(
      this.requireUser(req),
      id,
      body,
    );
  }

  /**
   * @description 租户管理删除
   * @keyword-en admin tenants delete endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('delete', 'User')
  @Delete('tenants/:id')
  async deleteTenant(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.adminService.deleteTenant(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description Key管理列表
   * @keyword-en admin key list endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('keys')
  async listKeys(@Req() req: Request, @Query('tenantId') tenantId?: string) {
    const keys = await this.adminService.listKeys(
      this.requireUser(req),
      tenantId,
    );
    return { keys };
  }

  /**
   * @description Key管理新增
   * @keyword-en admin key create endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('keys')
  async createKey(@Req() req: Request, @Body() body: CreateApiKeyByAdminDto) {
    const data = await this.adminService.createKey(this.requireUser(req), body);
    return data;
  }

  /**
   * @description Key管理撤销
   * @keyword-en admin key revoke endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('keys/:id/revoke')
  async revokeKey(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.adminService.revokeKey(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description Key管理更新
   * @keyword-en admin key update endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch('keys/:id')
  async updateKey(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateApiKeyByAdminDto,
  ) {
    const key = await this.adminService.updateKey(
      this.requireUser(req),
      id,
      body,
    );
    return { key };
  }

  /**
   * @description Key管理删除
   * @keyword-en admin key delete endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('keys/:id')
  async deleteKey(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.adminService.deleteKey(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 数据源管理列表
   * @keyword-en admin data source list endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('data-sources')
  async listDataSources() {
    const rows = await this.adminService.listDataSources();
    return { sources: rows };
  }

  /**
   * @description 数据源管理新增
   * @keyword-en admin data source create endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('data-sources')
  async createDataSource(@Body() body: CreateDataSourceByAdminDto) {
    const source = await this.adminService.createDataSource(body);
    return { source };
  }

  /**
   * @description 数据源管理状态更新
   * @keyword-en admin data source status update endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch('data-sources/:code')
  async updateDataSource(
    @Param('code') code: string,
    @Body() body: UpdateDataSourceByAdminDto,
  ) {
    const source = await this.adminService.updateDataSource(code, body);
    return { source };
  }

  /**
   * @description 数据源管理删除
   * @keyword-en admin data source delete endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('data-sources/:code')
  async deleteDataSource(@Param('code') code: string) {
    const ok = await this.adminService.deleteDataSource(code);
    return { ok };
  }

  /**
   * @description 获取平台信息（AI补充说明）
   * @keyword-en admin get platform info endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'PlatformSetting')
  @Get('platform-info')
  async getPlatformInfo(@Req() req: Request) {
    return this.adminService.getPlatformInfo(this.requireUser(req));
  }

  /**
   * @description 更新平台信息（AI补充说明）
   * @keyword-en admin upsert platform info endpoint
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', 'PlatformSetting')
  @Put('platform-info')
  async upsertPlatformInfo(
    @Req() req: Request,
    @Body() body: UpsertPlatformInfoDto,
  ) {
    return this.adminService.upsertPlatformInfo(
      this.requireUser(req),
      body.aiPromptSupplement ?? '',
      body.enableAiCover,
      body.xhsArticleGlobalConcurrencyLimit,
      {
        wechatQrCodeUrl: body.salesWechatQrCodeUrl,
        tip: body.salesContactTip,
      },
    );
  }

  // ─── Claw 管理 ─────────────────────────────────────────────────────────────

  /**
   * @description Claw 配置列表
   * @keyword-en admin claw configs list endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('claw-configs')
  async listClawConfigs() {
    const rows = await this.adminService.listClawConfigs();
    return { clawConfigs: rows };
  }

  /**
   * @description 创建 Claw 配置
   * @keyword-en admin claw configs create endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('claw-configs')
  async createClawConfig(@Body() body: CreateClawConfigDto) {
    const config = await this.adminService.createClawConfig(body);
    return { clawConfig: config };
  }

  /**
   * @description 更新 Claw 配置
   * @keyword-en admin claw configs update endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch('claw-configs/:id')
  async updateClawConfig(
    @Param('id') id: string,
    @Body() body: UpdateClawConfigDto,
  ) {
    const config = await this.adminService.updateClawConfig(id, body);
    return { clawConfig: config };
  }

  /**
   * @description 删除 Claw 配置
   * @keyword-en admin claw configs delete endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('claw-configs/:id')
  async deleteClawConfig(@Param('id') id: string) {
    const ok = await this.adminService.deleteClawConfig(id);
    return { ok };
  }

  /**
   * @description 测试 Claw 连通性
   * @keyword-en admin claw configs ping endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('claw-configs/:id/ping')
  async pingClawConfig(@Param('id') id: string) {
    return this.adminService.pingClawConfig(id);
  }

  // ─── Agent 管理 ─────────────────────────────────────────────────────────────

  /**
   * @description Agent 配置列表
   * @keyword-en admin agent configs list endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('agent-configs')
  async listAgentConfigs() {
    const rows = await this.adminService.listAgentConfigs();
    return { agentConfigs: rows };
  }

  /**
   * @description 创建 Agent 配置
   * @keyword-en admin agent configs create endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('agent-configs')
  async createAgentConfig(@Body() body: CreateAgentConfigDto) {
    const config = await this.adminService.createAgentConfig(body);
    return { agentConfig: config };
  }

  /**
   * @description 更新 Agent 配置
   * @keyword-en admin agent configs update endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch('agent-configs/:id')
  async updateAgentConfig(
    @Param('id') id: string,
    @Body() body: UpdateAgentConfigDto,
  ) {
    const config = await this.adminService.updateAgentConfig(id, body);
    return { agentConfig: config };
  }

  /**
   * @description 删除 Agent 配置
   * @keyword-en admin agent configs delete endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete('agent-configs/:id')
  async deleteAgentConfig(@Param('id') id: string) {
    const ok = await this.adminService.deleteAgentConfig(id);
    return { ok };
  }

  // ─── LLM 设置管理 ───────────────────────────────────────────────────────────

  /**
   * @description 获取 LLM 设置
   * @keyword-en admin llm settings get endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Get('llm-settings')
  async getLlmSetting() {
    const setting = await this.adminService.getLlmSetting();
    return { setting };
  }

  /**
   * @description 创建或更新 LLM 设置
   * @keyword-en admin llm settings upsert endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Put('llm-settings')
  async upsertLlmSetting(
    @Req() req: Request,
    @Body() body: UpsertLlmSettingDto,
  ) {
    const setting = await this.adminService.upsertLlmSetting(
      this.requireUser(req),
      body,
    );
    return { setting };
  }

  /**
   * @description 更新 LLM 设置
   * @keyword-en admin llm settings update endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch('llm-settings')
  async updateLlmSetting(
    @Req() req: Request,
    @Body() body: UpdateLlmSettingDto,
  ) {
    const setting = await this.adminService.updateLlmSetting(
      this.requireUser(req),
      body,
    );
    return { setting };
  }

  /**
   * @description 读取当前用户
   * @keyword-en read current user from request
   */
  private requireUser(req: Request) {
    const user = (req as AdminRequest).adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }

  // ─── 小红书账号管理 ───────────────────────────────────

  /**
   * @description 列出自媒体账号（租户隔离，支持 platform 过滤）
   * @keyword-en list social accounts
   */
  @UseGuards(AdminAuthGuard)
  @Get('social-accounts')
  async listXhsAccounts(
    @Req() req: Request,
    @Query('platform') platform?: string,
  ) {
    const user = this.requireUser(req);
    const accounts = await this.adminService.listXhsAccounts(
      user.tenantId,
      platform,
    );
    return { accounts };
  }

  /**
   * @description 创建自媒体账号
   * @keyword-en create social account
   */
  @UseGuards(AdminAuthGuard)
  @Post('social-accounts')
  async createXhsAccount(
    @Req() req: Request,
    @Body() body: CreateXhsAccountDto,
  ) {
    const user = this.requireUser(req);
    const account = await this.adminService.createXhsAccount(
      body,
      user.tenantId,
    );
    return { account };
  }

  /**
   * @description 更新自媒体账号
   * @keyword-en update social account
   */
  @UseGuards(AdminAuthGuard)
  @Patch('social-accounts/:id')
  async updateXhsAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateXhsAccountDto,
  ) {
    const user = this.requireUser(req);
    const account = await this.adminService.updateXhsAccount(
      id,
      body,
      user.tenantId,
    );
    return { account };
  }

  /**
   * @description 删除自媒体账号
   * @keyword-en delete social account
   */
  @UseGuards(AdminAuthGuard)
  @Delete('social-accounts/:id')
  async deleteXhsAccount(@Req() req: Request, @Param('id') id: string) {
    const user = this.requireUser(req);
    const deleted = await this.adminService.deleteXhsAccount(id, user.tenantId);
    return { deleted };
  }

  /**
   * @description 尝试登录自媒体账号（通过 Claw）
   * @keyword-en try login social account via claw
   */
  @UseGuards(AdminAuthGuard)
  @Post('social-accounts/:id/test-login')
  async testLoginXhsAccount(@Req() req: Request, @Param('id') id: string) {
    const user = this.requireUser(req);
    return this.adminService.tryLoginXhsAccount(id, user.tenantId);
  }
}
