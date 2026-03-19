# Dashboard Config Module - 模块设计文档

## 📋 模块概述

`dashboard-config` 是一个完整的、JSON 驱动的看板配置系统，支持：
- **JSON 配置驱动** - 将看板内容完全配置化
- **多租户隔离** - 每个租户拥有独立的看板配置
- **动态渲染** - 前端根据 JSON 自动渲染 Tab 和 Block
- **零代码定制** - 租户只需修改 JSON 配置即可定制看板

---

## 🏗️ 模块架构

```
dashboard-config/
├── types/
│   └── dashboard-config.types.ts       # 类型定义
├── services/
│   └── dashboard-config.service.ts     # 核心业务逻辑
├── controller/
│   ├── dashboard-config.controller.ts  # 用户端 API
│   ├── admin-dashboard-config.controller.ts  # 管理端 API
│   └── dashboard-config.dto.ts        # DTO 类
└── dashboard-config.module.ts          # 模块定义
```

---

## 📡 API 接口

### 用户端 API

#### GET `/dashboard-config/current`

获取当前租户/用户的看板配置

**请求**:
```
GET /dashboard-config/current?dashboardCode=ai-commander
Authorization: Bearer <token>
```

**响应**:
```json
{
  "dashboardCode": "ai-commander",
  "tenantId": "super-party",
  "filePath": "config/dashboards/super-party.dashboard.json",
  "config": {
    "dashboardCode": "ai-commander",
    "version": 1,
    "title": "超级派对看板",
    "tabs": [
      {
        "id": "overview",
        "label": "总览",
        "blocks": [...]
      }
    ]
  }
}
```

**认证**: 
- Bearer Token（可选）- 如有，返回对应租户的配置
- 无认证 - 返回母平台默认配置

**错误**:
- `404` - 看板配置不存在
- `500` - 配置文件加载失败

---

### 管理端 API

#### GET `/admin/dashboard-config/mappings`

列出配置映射

**请求**:
```
GET /admin/dashboard-config/mappings
Authorization: Bearer <admin-token>
```

**响应**:
```json
{
  "rows": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "dashboardCode": "ai-commander",
      "tenantId": "super-party",
      "filePath": "config/dashboards/super-party.dashboard.json",
      "enabled": true,
      "createdAt": "2025-03-05T10:00:00Z",
      "updatedAt": "2025-03-05T10:00:00Z"
    }
  ]
}
```

**权限**:
- 平台账号：查看所有映射
- 租户账号：仅查看本租户映射

---

#### POST `/admin/dashboard-config/mappings`

创建或更新配置映射

**请求**:
```
POST /admin/dashboard-config/mappings
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "dashboardCode": "ai-commander",
  "tenantId": "new-tenant",
  "filePath": "config/dashboards/new-tenant.dashboard.json",
  "enabled": true
}
```

**验证**:
- `dashboardCode` 必需，仅允许字母数字、下划线、连字符
- `filePath` 必需，必须在 `config/dashboards/` 目录下
- `tenantId` 可选，为空表示母平台配置
- `enabled` 可选，默认 true

**响应**:
```json
{
  "row": {
    "_id": "507f1f77bcf86cd799439011",
    "dashboardCode": "ai-commander",
    "tenantId": "new-tenant",
    "filePath": "config/dashboards/new-tenant.dashboard.json",
    "enabled": true,
    "createdAt": "2025-03-05T10:00:00Z",
    "updatedAt": "2025-03-05T10:00:00Z"
  }
}
```

**错误**:
- `400` - 请求参数验证失败
- `403` - 跨租户禁止（租户账号试图修改其他租户配置）
- `401` - 未认证

---

#### DELETE `/admin/dashboard-config/mappings/:id`

删除配置映射

**请求**:
```
DELETE /admin/dashboard-config/mappings/507f1f77bcf86cd799439011
Authorization: Bearer <admin-token>
```

**响应**:
```json
{
  "success": true
}
```

**错误**:
- `400` - 无效的 ID 格式
- `401` - 未认证

---

## 🔄 数据流

### 看板加载流程

```
┌─ 用户访问看板页面
│
├─ 前端调用 getCurrentDashboardConfig('ai-commander')
│
├─ 发送 GET /dashboard-config/current?dashboardCode=ai-commander
│  (带上 Bearer Token)
│
├─ 后端解析请求：
│  1. 从 Authorization 头提取 token
│  2. 查询用户/租户信息
│  3. 从 token 获取 tenantId
│
├─ 查询配置映射：
│  1. 查找 (dashboardCode='ai-commander', tenantId=<user's tenantId>)
│  2. 如果不存在，查找 (dashboardCode='ai-commander', tenantId=null)
│  3. 返回对应的 filePath
│
├─ 加载配置文件：
│  1. 解析文件路径（防止目录遍历）
│  2. 从文件系统读取 JSON
│  3. 解析 JSON
│
├─ 返回完整配置给前端
│
└─ 前端根据 JSON 动态渲染 Tab 和 Block
```

### 数据更新流程

```
用户改变时间范围
  ↓
前端识别所有需要的 Query
  ↓
去重并合并相同的 Query 请求
  ↓
发送多个请求给各个 /dashboard/* 端点
  ↓
后端根据 timeRange 参数查询数据
  ↓
返回数据给前端
  ↓
前端更新所有 Block
```

---

## 🗄️ 数据库设计

### Collection: `dashboard_config_mappings`

```javascript
{
  _id: ObjectId,
  dashboardCode: string,      // e.g., "ai-commander"
  tenantId: string | null,    // null 表示母平台
  filePath: string,           // e.g., "config/dashboards/platform.dashboard.json"
  customConfig: object | null, // AI 工具修改后的配置快照（优先于文件），null 时回退文件
  enabled: boolean,           // 是否启用此映射
  createdAt: Date,
  updatedAt: Date
}
```

> **customConfig 优先级**: `getScopedConfig` 中若 `customConfig` 非空，则直接返回该字段而不读取文件。
> AI 工具 `dashboard_config_patch` 写入此字段（JSON Merge Patch），`resetConfig` 清除此字段回退到文件。

### 索引

```javascript
// 唯一索引：确保 (dashboardCode, tenantId) 组合唯一
db.dashboard_config_mappings.createIndex(
  { dashboardCode: 1, tenantId: 1 },
  { unique: true, name: 'uniq_dashboard_tenant' }
);

// 普通索引：便于按更新时间查询
db.dashboard_config_mappings.createIndex(
  { updatedAt: -1 },
  { name: 'idx_updated_at' }
);

// 普通索引：便于按启用状态查询
db.dashboard_config_mappings.createIndex(
  { enabled: 1 },
  { name: 'idx_enabled' }
);
```

---

## 🔐 安全机制

### 1. 路径限制

所有配置文件必须位于 `config/dashboards/` 目录下，防止目录遍历攻击：

```typescript
private resolveConfigAbsPath(filePath: string): string {
  const abs = path.resolve(process.cwd(), filePath);
  const base = DASHBOARD_CONFIG_BASE_DIR + path.sep;
  
  if (!abs.startsWith(base)) {
    throw new BadRequestException('CONFIG_FILE_PATH_OUT_OF_SCOPE');
  }
  
  return abs;
}
```

### 2. 租户隔离

租户账号只能修改自己租户的配置：

```typescript
if (user.tenantId && body.tenantId && body.tenantId !== user.tenantId) {
  throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
}
```

### 3. 认证检查

所有管理 API 需要 Bearer Token 认证：

```typescript
@UseGuards(AdminAuthGuard)
export class AdminDashboardConfigController {}
```

### 4. 输入验证

```typescript
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
```

---

## 📊 性能考虑

### 1. 配置文件缓存

建议在生产环境中缓存配置文件内容：

```typescript
private configCache = new Map<string, any>();

async getScopedConfig(...) {
  if (this.configCache.has(filePath)) {
    return this.configCache.get(filePath);
  }
  
  const config = await this.loadConfigJson(filePath);
  this.configCache.set(filePath, config);
  return config;
}
```

### 2. 索引优化

确保 `(dashboardCode, tenantId)` 上有唯一索引，查询效率 O(1)。

### 3. 配置文件大小

建议单个配置文件不超过 100KB。如果超过，考虑：
- 拆分成多个配置文件
- 使用分层配置系统
- 实现配置版本控制

---

## 🧪 测试用例

### 单元测试

```typescript
describe('DashboardConfigService', () => {
  describe('getScopedConfig', () => {
    it('应该返回租户专属配置', async () => {
      const result = await service.getScopedConfig({
        tenantId: 'super-party',
        dashboardCode: 'ai-commander',
      });
      
      expect(result.tenantId).toBe('super-party');
      expect(result.config.dashboardCode).toBe('ai-commander');
    });

    it('当租户配置不存在时应该返回母平台配置', async () => {
      const result = await service.getScopedConfig({
        tenantId: 'unknown-tenant',
        dashboardCode: 'ai-commander',
      });
      
      expect(result.tenantId).toBeUndefined();
      expect(result.config).toBeDefined();
    });

    it('应该拒绝超出范围的文件路径', async () => {
      await expect(
        service.getScopedConfig({
          filePath: '../../etc/passwd',
        }),
      ).rejects.toThrow('CONFIG_FILE_PATH_OUT_OF_SCOPE');
    });
  });

  describe('upsertMapping', () => {
    it('租户账号不能修改其他租户配置', async () => {
      await expect(
        service.upsertMapping({
          dashboardCode: 'ai-commander',
          tenantId: 'other-tenant',
          filePath: 'config/dashboards/other.json',
        }, { tenantId: 'my-tenant' }),
      ).rejects.toThrow('CROSS_TENANT_FORBIDDEN');
    });
  });
});
```

### 集成测试

```typescript
describe('DashboardConfig E2E', () => {
  it('应该加载并渲染看板配置', async () => {
    const response = await request(app.getHttpServer())
      .get('/dashboard-config/current?dashboardCode=ai-commander')
      .set('Authorization', 'Bearer ' + validToken)
      .expect(200);

    expect(response.body.config.tabs).toBeDefined();
    expect(response.body.config.tabs.length).toBeGreaterThan(0);
  });

  it('管理 API 应该 CRUD 配置映射', async () => {
    // 创建
    const createRes = await request(app.getHttpServer())
      .post('/admin/dashboard-config/mappings')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        dashboardCode: 'test',
        tenantId: 'test-tenant',
        filePath: 'config/dashboards/test.json',
      })
      .expect(201);

    expect(createRes.body.row._id).toBeDefined();

    // 列表
    const listRes = await request(app.getHttpServer())
      .get('/admin/dashboard-config/mappings')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    expect(listRes.body.rows.length).toBeGreaterThan(0);

    // 删除
    await request(app.getHttpServer())
      .delete(`/admin/dashboard-config/mappings/${createRes.body.row._id}`)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
  });
});
```

---

## 🚀 扩展指南

### 扩展 1: 添加配置版本控制

```typescript
async getScopedConfig(input: {
  version?: number;  // 新增参数
}): Promise<...> {
  // 加载指定版本的配置文件
  const filePath = `${basePath}.v${version}.json`;
  // ...
}
```

### 扩展 2: 支持配置继承

```json
{
  "dashboardCode": "ai-commander",
  "extends": "platform.dashboard.json",
  "overrides": {
    "tabs": [
      { "id": "custom_tab", "label": "自定义" }
    ]
  }
}
```

### 扩展 3: 动态配置（从数据库）

```typescript
async getScopedConfigFromDb(tenantId: string) {
  const config = await this.db
    .collection('dashboard_configs')
    .findOne({ dashboardCode, tenantId });
  
  return config || this.getScopedConfig({ tenantId });
}
```

### 扩展 4: 配置热更新

```typescript
async refreshConfig(filePath: string) {
  // 清除缓存
  this.configCache.delete(filePath);
  
  // 发布事件通知前端重新加载
  this.eventEmitter.emit('config.updated', { filePath });
}
```

---

## 📝 迁移和部署

### 初次部署

```bash
# 1. 初始化数据库
pnpm run migration:up

# 2. 验证配置文件
pnpm run validate:dashboard-config

# 3. 启动应用
pnpm run start:prod
```

### 升级现有系统

```bash
# 1. 创建新迁移
pnpm run migration:create add_dashboard_config_v2

# 2. 编辑迁移文件并测试
pnpm run migration:status

# 3. 部署
pnpm run migration:up
```

### 配置文件管理

```bash
# 1. 编辑配置文件
vim config/dashboards/platform.dashboard.json

# 2. 验证格式
pnpm run validate:dashboard-config

# 3. 提交到版本控制
git add config/dashboards/
git commit -m "Update dashboard config"

# 4. 部署时自动加载新配置
# （无需重启应用）
```

---

## 🔍 监控和告警

### 关键指标

| 指标 | 预警阈值 | 说明 |
|------|---------|------|
| 配置加载失败率 | > 1% | 检查文件系统权限 |
| 配置查询延迟 | > 500ms | 检查 MongoDB 索引 |
| 配置文件大小 | > 100KB | 考虑分片 |
| 映射表行数 | > 10000 | 考虑分区 |

### 日志记录

```typescript
// 关键操作记录
logger.log(`Loaded config from ${filePath}`);
logger.debug(`Query result: ${JSON.stringify(config)}`);
logger.error(`Failed to load config: ${error.message}`);
```

### 健康检查

```typescript
@Get('health')
async health() {
  const configCount = await this.mappings.countDocuments();
  return {
    status: configCount > 0 ? 'healthy' : 'degraded',
    mappings: configCount,
  };
}
```

---

## 📚 相关文档

| 文档 | 位置 | 用途 |
|------|------|------|
| 规范 | `DASHBOARD_CONFIG_SPEC.md` | JSON Schema 和字段定义 |
| 集成指南 | `INTEGRATION_GUIDE.md` | 如何使用该系统 |
| 快速参考 | `QUICK_REFERENCE.md` | 常见任务和命令 |
| 源代码 | `src/modules/dashboard-config/` | 实现细节 |

---

## 🎯 最佳实践

✅ **推荐**
- 为每个主要租户创建专属配置文件
- 在版本控制中追踪配置变更
- 定期备份 `dashboard_config_mappings` 集合
- 使用配置验证脚本检查 JSON 格式
- 为复杂配置添加说明注释

❌ **避免**
- 手动编辑数据库中的映射
- 在 JSON 中包含敏感信息（密钥、令牌）
- 直接修改他人租户的配置
- 创建超大配置文件（>100KB）
- 在生产环境中进行格式不一致的配置

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2025-03-05 | 初始发布 |

---

**最后更新**: 2025-03-05  
**维护者**: AI MVP Team  
**状态**: ✅ 生产就绪

