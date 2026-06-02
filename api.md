# 财务系统对外接入 API · v1

> **目标读者**:外部系统开发者 / 接入 LLM Agent
> **接口前缀**:`/api/v1`
> **版本**:v1
> **数据格式**:JSON,UTF-8

本系统是一个**多租户财务数据中台**,接收外部系统(银行、ERP、飞书审批、POS、票务等)推送的业务数据,在内部计算损益表/现金流/账龄/预测等指标。

外部系统作为**数据源**,通过本文档定义的 REST API 把数据推送到本系统。本系统**不主动拉**外部数据,所有数据由外部系统主动推送。

**核心模型**:统一的"财务事件"(`financial_event`)抽象 — 银行流水、报销审批、应收挂账、应付付款 都是同一张表里不同 stage 的事件。详见 §6。

---

## 0. 快速开始

```bash
# 0. 拿到管理员发给你的 API Key,形如:
#    fa_a1b2c3d4e5f6.K9mP2qR8sT4vXwYz0AbCdEfGhIjKlMnOpQrStUvW
#
# 1. 验证凭证(返回 keyName / scopes / expiresAt / lastUsedAt 等)
curl https://your-server.example.com/api/v1/me \
  -H "Authorization: Bearer fa_a1b2c3d4e5f6.K9mP2qR8sT4vXwYz0AbCdEfGhIjKlMnOpQrStUvW"
# → { "ok": true, "data": { "apiKeyId": "...", "keyName": "...", "scopes": [...], ... } }

# 2. 推一笔银行流水(stage='settled' 即时落账)
curl -X POST https://your-server.example.com/api/v1/events/upsert \
  -H "Authorization: Bearer fa_xxx.yyy" \
  -H "Content-Type: application/json" \
  -d '[{
    "externalId": "wybank_2025_12_001",
    "flow": "in",
    "stage": "settled",
    "party": "美团网络",
    "partyType": "counterparty",
    "amount": "12500.00",
    "category": "门店收入",
    "occurredAt": "2025-12-15",
    "attributedPeriod": "2025-12",
    "settledAt": "2025-12-15",
    "bankAccount": "招商银行"
  }]'
# → { "ok": true, "data": [ { "id": "evt_...", ... } ] }
```

---

## 1. 鉴权(Authentication)

### Header

每次请求必须携带 API Key:

```
Authorization: Bearer fa_<keyId>.<keySecret>
```

或者(等价):

```
X-API-Key: fa_<keyId>.<keySecret>
```

### Key 格式

- 完整 key:`fa_<12 位 keyId>.<40 位 keySecret>`
- `keyId` 公开,可入日志
- `keySecret` 仅在创建时显示一次,服务端只存 SHA-256 哈希
- 同一 key 仅能访问其绑定 tenant 的数据,**不存在跨 tenant 越权可能**

### Scope(权限作用域)

每个 key 持有若干 scope,接口按需校验:

| Scope 模式                                          | 含义                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `event:read` / `event:write` / `event:delete`       | 财务事件(覆盖原 bank/expense/receivable/payable 四类) |
| `store:read` / `store:write` / `store:delete`       | 门店                                                  |
| `company:read` / `company:write` / `company:delete` | 法人公司                                              |
| `*`                                                 | 全权限(慎用,通常给内部集成用)                         |

**约定**:`xxx:write` 隐含 `xxx:read`。

---

## 2. 统一响应格式

### 成功

```json
{
  "ok": true,
  "data": <资源对象 | 数组>,
  "meta": {
    "page": 1,
    "page_size": 50,
    "total": 1234
  }
}
```

`meta` 仅在分页接口存在。

### 失败

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION",
    "message": "入参校验失败",
    "details": [
      {
        "path": ["0", "stage"],
        "message": "Invalid enum value",
        "code": "invalid_enum_value"
      }
    ]
  }
}
```

`details` 仅在 `VALIDATION` 错误中有值,内容是 zod issues 数组,可定位到具体字段。

### 错误码 → HTTP 状态

| code           | HTTP | 说明                            |
| -------------- | ---- | ------------------------------- |
| `AUTH_MISSING` | 401  | 未携带 Authorization 头         |
| `AUTH_INVALID` | 401  | Key 不存在或签名错误            |
| `AUTH_EXPIRED` | 401  | Key 已过期                      |
| `AUTH_REVOKED` | 401  | Key 已被吊销                    |
| `SCOPE_DENIED` | 403  | 该 Key 不包含本接口要求的 scope |
| `VALIDATION`   | 400  | 入参格式不符,见 `details`       |
| `NOT_FOUND`    | 404  | 资源不存在                      |
| `CONFLICT`     | 409  | 唯一约束冲突                    |
| `RATE_LIMIT`   | 429  | 限流(默认未启用)                |
| `INTERNAL`     | 500  | 服务端异常                      |

---

## 3. 分页 / 增量拉取

所有列表接口支持以下 query 参数:

| 参数        | 类型              | 默认 | 说明                                |
| ----------- | ----------------- | ---- | ----------------------------------- |
| `page`      | int               | 1    | 页码,从 1 开始                      |
| `page_size` | int               | 50   | 每页数量,最大 500                   |
| `since`     | ISO 8601 datetime | —    | 仅返回 `updated_at >= since` 的记录 |

**增量同步推荐**:外部系统记住上次拉取的最大 `updated_at`,下次以该值作为 `since`。

---

## 4. 幂等机制(数据写入必读)

### 强制 `externalId`

财务事件写入时**必须**带 `externalId` 字段。这是你侧业务系统里该条记录的稳定主键。

数据库对 `(tenant_id, external_id)` 设有 UNIQUE 约束。

### 推荐用 `/upsert` 接口

```
POST /api/v1/events/upsert
```

行为:

- 若 `(tenant_id, external_id)` 已存在 → 更新业务字段(包括 stage 推进)
- 若不存在 → 创建新记录

**结果**:你可以放心地每 N 分钟把"全量数据"推过来,或者只推增量,都不会产生重复行。

### 与 POST /events 的区别

`POST /api/v1/events` 是单纯的**新建**,不做幂等检查。如果你的源数据已经按 externalId 去重过,可以用它。生产环境推荐统一用 `/upsert`。

### 批量语义:**整批拒收(all-or-nothing)**

当 `/upsert` 数组中**任意一条**不通过 schema 校验(必填缺失、类型错、枚举非法),整个请求被拒绝(400 + `VALIDATION` + `details` 数组),**没有任何记录写入数据库**。当前实现**不支持** `207 Partial`,也不返回逐条 `{ ok, externalId, error }` 列表。

调用方处理建议:

- 推送前在你侧先做基本校验(必填、枚举、日期格式)
- 如果某次推送被拒,定位坏数据后剔除,再整批重推
- 别用"先推一批看哪条挂"的策略 —— 整批挂

如果你的业务确实需要"99 条入 + 1 条丢"的部分成功语义,在你侧把数组按 chunk 拆细(例如 1 条/次)再串行推送。

---

## 5. 数据层级

```
tenant (租户/SaaS 客户)
  └─ company (法人公司)
       └─ store (门店/经营单位)
            └─ financial_event (银行流水 / 报销 / 应收 / 应付)
```

`company` 和 `store` 通常由系统管理员在后台预先建好。外部系统推业务数据时,把 `companyId` 和 `storeId`(可选)填上,做到主体归属精确。

也可以**不填**`companyId` / `storeId`(留空),业务数据就只挂在 `tenant` 层级 — 后续在前端可以再分配归属。

---

## 6. 资源:财务事件(`/events`)

### 设计哲学

一张表(`financial_events`)承载四类业务,通过 **flow + stage + partyType** 三个字段区分:

| 业务类型       | flow  | partyType      | 典型 stage 流转                                                       |
| -------------- | ----- | -------------- | --------------------------------------------------------------------- |
| 银行流水(收入) | `in`  | `counterparty` | 直接 `settled`(occurredAt = settledAt, attributedPeriod 按实际归属月) |
| 银行流水(支出) | `out` | `counterparty` | 直接 `settled`                                                        |
| 报销单         | `out` | `employee`     | `intent` → `committed` → `settled`(已付) / `dead`(拒)                 |
| 应收账款       | `in`  | `customer`     | `committed`(挂账) → `settled`(已收)                                   |
| 应付账款       | `out` | `supplier`     | `committed`(挂账) → `settled`(已付)                                   |

### stage 状态机

| stage       | 语义                     | 何时用                                    |
| ----------- | ------------------------ | ----------------------------------------- |
| `intent`    | 审批/草稿,可被批准或拒绝 | 报销提交、采购申请                        |
| `committed` | 已确认未结算,挂账中      | 报销已批未付、应收/应付挂账               |
| `settled`   | 现金已动                 | 已付款、已收款、银行流水即时落账          |
| `dead`      | 已废                     | 审批拒绝、单据撤销、作废(配 `deadReason`) |

> **派生态**:`overdue` 不存数据库 — 由 `stage='committed' && dueAt < today` 派生。
> **初版规则**:不强制状态机推进顺序,允许直接推 `settled`(纯流水场景),允许 `settled → committed` 倒退(改单)。

### 字段

| 字段               | 类型                                                          | 必填 | 说明                                                                  |
| ------------------ | ------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `externalId`       | string                                                        | ✓    | 你侧业务 ID,(tenant, externalId) 幂等                                 |
| `flow`             | `'in'` / `'out'`                                              | ✓    | 现金方向                                                              |
| `stage`            | `'intent'` / `'committed'` / `'settled'` / `'dead'`           | ✓    | 生命周期阶段                                                          |
| `deadReason`       | `'rejected'` / `'cancelled'` / `'voided'`                     | ✗    | `stage='dead'` 时填                                                   |
| `party`            | string                                                        | ✓    | 对方主体名(供应商/客户/员工/支付通道)                                 |
| `partyType`        | `'supplier'` / `'customer'` / `'employee'` / `'counterparty'` | ✓    | 主体分类                                                              |
| `amount`           | decimal(string 推荐)                                          | ✓    | 绝对值,正负看 flow                                                    |
| `category`         | string                                                        | ✓    | 业务分类(差旅费 / 采购成本 / 门店收入 ...)                            |
| `occurredAt`       | `YYYY-MM-DD`                                                  | ✓    | 交易/业务发生日期                                                     |
| `attributedPeriod` | `YYYY-MM`                                                     | ✓    | 归属年月。用于损益、经营报表、月度归集;与交易日期、现金流日期分开维护 |
| `dueAt`            | `YYYY-MM-DD`                                                  | ✗    | 到期日(应收/应付才有)                                                 |
| `settledAt`        | `YYYY-MM-DD`                                                  | ✗    | 实际现金流日(`stage='settled'` 时填)                                  |
| `bankAccount`      | string                                                        | ✗    | 银行账户名(银行流水类高频)                                            |
| `department`       | string                                                        | ✗    | 部门(报销类高频)                                                      |
| `companyId`        | string                                                        | ✗    | 归属法人公司 ID                                                       |
| `storeId`          | string                                                        | ✗    | 归属门店 ID                                                           |
| `memo`             | string                                                        | ✗    | 备注                                                                  |
| `meta`             | object                                                        | ✗    | 任意 JSON,存原始字段透传                                              |

> **重要**:`occurredAt`(交易/业务发生日) ≠ `attributedPeriod`(实际归属年月) ≠ `settledAt`(现金流日)。
> 损益/经营报表优先按 `attributedPeriod` 汇总(看真实归属月份);交易明细按 `occurredAt` 看发生日;现金流表按 `settledAt` 汇总(看真实资金流动)。务必分开维护。

### 端点

| 方法     | 路径                        | 必需 scope               |
| -------- | --------------------------- | ------------------------ |
| GET      | `/api/v1/events`            | `event:read`             |
| POST     | `/api/v1/events`            | `event:write`            |
| **POST** | **`/api/v1/events/upsert`** | **`event:write`** ★ 推荐 |
| GET      | `/api/v1/events/:id`        | `event:read`             |
| PUT      | `/api/v1/events/:id`        | `event:write`            |
| DELETE   | `/api/v1/events/:id`        | `event:delete`           |

### 示例 1:银行流水(stage 一步到位)

```bash
curl -X POST https://your-server/api/v1/events/upsert \
  -H "Authorization: Bearer fa_xxx.yyy" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "externalId": "wybank_C0347BT0001NGMZ",
      "flow": "in",
      "stage": "settled",
      "party": "上海富友支付服务股份有限公司",
      "partyType": "counterparty",
      "amount": "157.40",
      "category": "门店收入",
      "occurredAt": "2025-12-31",
      "attributedPeriod": "2025-12",
      "settledAt": "2025-12-31",
      "bankAccount": "招商银行",
      "storeId": "sto_jhshjksabd",
      "memo": "收钱吧特约商户结算",
      "meta": { "原始流水号": "C0347BT0001NGMZ" }
    },
    {
      "externalId": "wybank_C0347BU0001GVRZ",
      "flow": "in",
      "stage": "settled",
      "party": "上海富友支付服务股份有限公司",
      "partyType": "counterparty",
      "amount": "1393.67",
      "category": "门店收入",
      "occurredAt": "2026-01-01",
      "attributedPeriod": "2026-01",
      "settledAt": "2026-01-01",
      "bankAccount": "招商银行",
      "storeId": "sto_jhshjksabd"
    }
  ]'
```

### 示例 2:报销审批(三阶段推进)

```bash
# 1. 飞书审批提交 → 推 intent
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{
    "externalId": "feishu_approval_72345",
    "flow": "out",
    "stage": "intent",
    "party": "张三",
    "partyType": "employee",
    "amount": "2350.00",
    "category": "差旅费",
    "occurredAt": "2026-01-12",
    "attributedPeriod": "2026-01",
    "department": "运营部",
    "memo": "出差北京 — 1月10-12",
    "storeId": "sto_jhshjksabd"
  }]'

# 2. 审批通过 → 同 externalId 推 committed
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{ "externalId": "feishu_approval_72345", "stage": "committed" }]'

# 3. 实际付款 → 推 settled + settledAt
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{ "externalId": "feishu_approval_72345", "stage": "settled", "settledAt": "2026-01-20" }]'

# 拒绝场景:推 dead + deadReason
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{ "externalId": "feishu_approval_99999", "stage": "dead", "deadReason": "rejected" }]'
```

### 示例 3:应付挂账 → 付款

```bash
# 1. 合同签订 / 收到发票 → committed 挂账
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{
    "externalId": "po_2026_001",
    "flow": "out",
    "stage": "committed",
    "party": "XX 餐饮供应商",
    "partyType": "supplier",
    "amount": "85000.00",
    "category": "采购成本",
    "occurredAt": "2026-01-05",
    "attributedPeriod": "2026-01",
    "dueAt": "2026-02-05",
    "memo": "1月食材采购"
  }]'

# 2. 付款 → settled + settledAt
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{ "externalId": "po_2026_001", "stage": "settled", "settledAt": "2026-02-03" }]'
```

### 示例 4:应收挂账(类似应付,flow=in,partyType=customer)

```bash
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{
    "externalId": "rcv_meituan_202512",
    "flow": "in",
    "stage": "committed",
    "party": "大众点评",
    "partyType": "customer",
    "amount": "82956.00",
    "category": "门票分账",
    "occurredAt": "2025-12-25",
    "attributedPeriod": "2025-12",
    "dueAt": "2026-01-15",
    "storeId": "sto_jhshjksabd"
  }]'

# 收款时
curl -X POST https://your-server/api/v1/events/upsert ... \
  -d '[{ "externalId": "rcv_meituan_202512", "stage": "settled", "settledAt": "2026-01-10" }]'
```

### 示例:增量拉取

```bash
curl "https://your-server/api/v1/events?page=1&page_size=50&since=2026-01-01T00:00:00Z" \
  -H "Authorization: Bearer fa_xxx.yyy"
```

---

## 7. 资源:法人公司(`/companies`)

通常由系统管理员在后台 `/admin/companies` 预建。外部系统**只读**为主。

### 字段

| 字段    | 类型   | 必填 | 说明                 |
| ------- | ------ | ---- | -------------------- |
| `name`  | string | ✓    | 公司全称             |
| `code`  | string | ✓    | 内部代码(租户内唯一) |
| `taxId` | string | ✗    | 税号                 |

### 端点

| 方法   | 路径                    | scope            |
| ------ | ----------------------- | ---------------- |
| GET    | `/api/v1/companies`     | `company:read`   |
| GET    | `/api/v1/companies/:id` | `company:read`   |
| POST   | `/api/v1/companies`     | `company:write`  |
| PUT    | `/api/v1/companies/:id` | `company:write`  |
| DELETE | `/api/v1/companies/:id` | `company:delete` |

⚠ 没有 `/upsert` — 公司数据通常稳定,手工管理。

---

## 8. 资源:门店(`/stores`)

### 字段

| 字段        | 类型   | 必填 | 说明                                |
| ----------- | ------ | ---- | ----------------------------------- |
| `companyId` | string | ✓    | 所属法人公司 ID                     |
| `name`      | string | ✓    | 门店名(月亮湾 / 丽宝 / 梅隆里)      |
| `code`      | string | ✓    | 内部代码                            |
| `type`      | string | ✗    | 类型(门店 / 项目 / 演艺 等自由分类) |

端点同公司,scope = `store:*`,无 `/upsert`。

---

## 9. 元接口

| 方法 | 路径              | 鉴权     | 说明                                                                                                        |
| ---- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| GET  | `/api/v1/health`  | 无       | 健康检查 → `{ service, version, time }`                                                                     |
| GET  | `/api/v1/me`      | API Key  | 当前 Key 自检 → `{ apiKeyId, keyName, tenantId, tenant, scopes, status, expiresAt, lastUsedAt, createdAt }` |
| GET  | `/api/v1/auth/me` | 用户 JWT | 浏览器/UI 用户信息(API Key 调用方不可用,会返 401)                                                           |

---

## 10. 多语言代码示例

### Node.js (fetch)

```js
const API = 'https://your-server.example.com/api/v1';
const KEY = process.env.FINANCE_API_KEY; // 'fa_xxx.yyy'

async function pushEvents(records) {
  const r = await fetch(`${API}/events/upsert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(records),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data.data;
}

// 用法:推一笔银行流水
await pushEvents([
  {
    externalId: 'wybank_C0347BT0001NGMZ',
    flow: 'in',
    stage: 'settled',
    party: '上海富友支付服务股份有限公司',
    partyType: 'counterparty',
    amount: '157.40',
    category: '门店收入',
    occurredAt: '2025-12-31',
    attributedPeriod: '2025-12',
    settledAt: '2025-12-31',
    bankAccount: '招商银行',
  },
]);
```

### Python (requests)

```python
import os
import requests

API = 'https://your-server.example.com/api/v1'
KEY = os.environ['FINANCE_API_KEY']  # 'fa_xxx.yyy'

def push_events(records):
    r = requests.post(
        f'{API}/events/upsert',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        json=records,
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if not data['ok']:
        raise RuntimeError(f"{data['error']['code']}: {data['error']['message']}")
    return data['data']

# 用法
push_events([{
    'externalId': 'wybank_C0347BT0001NGMZ',
    'flow': 'in',
    'stage': 'settled',
    'party': '上海富友支付服务股份有限公司',
    'partyType': 'counterparty',
    'amount': '157.40',
    'category': '门店收入',
    'occurredAt': '2025-12-31',
    'attributedPeriod': '2025-12',
    'settledAt': '2025-12-31',
    'bankAccount': '招商银行',
}])
```

### TypeScript (axios)

```ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://your-server.example.com/api/v1',
  headers: { Authorization: `Bearer ${process.env.FINANCE_API_KEY}` },
  timeout: 30000,
});

interface FinancialEventInput {
  externalId: string;
  flow: 'in' | 'out';
  stage: 'intent' | 'committed' | 'settled' | 'dead';
  deadReason?: 'rejected' | 'cancelled' | 'voided';
  party: string;
  partyType: 'supplier' | 'customer' | 'employee' | 'counterparty';
  amount: string | number;
  category: string;
  occurredAt: string;
  attributedPeriod: string;
  dueAt?: string;
  settledAt?: string;
  bankAccount?: string;
  department?: string;
  storeId?: string;
  companyId?: string;
  memo?: string;
  meta?: Record<string, unknown>;
}

export async function pushEvents(records: FinancialEventInput[]) {
  const { data } = await api.post('/events/upsert', records);
  if (!data.ok) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data.data;
}
```

---

## 11. 接入最佳实践

### 定时同步建议

| 数据类型 | 推荐频率  | stage 用法                                                              |
| -------- | --------- | ----------------------------------------------------------------------- |
| 银行流水 | 30 分钟   | 直接推 `settled`(occurredAt = settledAt, attributedPeriod 按实际归属月) |
| 报销单   | 5-15 分钟 | `intent` → `committed` → `settled`(三次推送)                            |
| 应收     | 每小时    | `committed`(挂账)→ `settled`(收款时)                                    |
| 应付     | 每小时    | `committed`(挂账)→ `settled`(付款时)                                    |

### 分批推送建议

- 单次 `upsert` 数组建议 ≤ **500 条**
- 超出请按时间或业务类别拆批
- 失败重试:幂等接口可放心整批重推

### 重试策略

| HTTP 状态          | 处理                                 |
| ------------------ | ------------------------------------ |
| 200                | ✓ 完成                               |
| 400 (`VALIDATION`) | 修正入参,**不要重试**                |
| 401 / 403          | 检查 Key,**不要重试**                |
| 409 (`CONFLICT`)   | 可能并发冲突,延迟 5s 重试一次        |
| 429 (`RATE_LIMIT`) | 按 `Retry-After` 头退避              |
| 5xx                | 指数退避重试(1s → 2s → 4s,最多 3 次) |

### 增量同步模板

```python
# 维护一个游标(可以存 Redis/文件/数据库)
last_synced = load_cursor() or '2025-01-01T00:00:00Z'

# 拉取增量
records = get(f'/events?since={last_synced}&page_size=500')

# 处理 + 推到下游(如果你是中转)
process(records)

# 保存新游标(取响应里最大 updatedAt)
save_cursor(max(r['updatedAt'] for r in records) if records else last_synced)
```

### 字段命名约定

请求体使用 **camelCase**(`externalId`, `occurredAt`, `attributedPeriod`, `dueAt`, `settledAt`),响应也是 camelCase。

### 时间格式

- 日期字段:`YYYY-MM-DD`(如 `"2025-12-31"`);归属年月字段 `attributedPeriod` 使用 `YYYY-MM`(如 `"2025-12"`)
- 时间戳字段:ISO 8601 `YYYY-MM-DDTHH:mm:ss.sssZ`(如 `"2026-01-01T08:30:00Z"`)
- 时区:服务端按 UTC 存储,展示时按客户端 local time 转换

### 金额精度

- 数据库 `numeric(18, 2)`,小数 2 位,绝对值上限约 ±10^16
- 入参支持 `string` 或 `number`,推荐 **string**(避免浮点丢精度,如 `"12500.00"`)
- 出参为 `string`(JSON 标准的安全做法)
- **始终用绝对值**:正负方向通过 `flow` 表达(`in` / `out`),不要用负数

---

## 12. 联系与变更

- 接口变更通过本文档同步更新,版本前缀 `/api/v1` 保证向后兼容
- 重大不兼容变更会启用新版本(`/api/v2`),旧版至少保留 6 个月
- 问题反馈:联系系统管理员
