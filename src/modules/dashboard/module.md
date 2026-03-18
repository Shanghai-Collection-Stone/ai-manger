# Dashboard Module

## 模块描述
看板模块：提供 AI Commander 看板数据接口与指标聚合逻辑。
文件路径: `src/modules/dashboard`

## 功能描述及关键词

### dashboard.controller.ts
看板控制器。
- **关键词**: dashboard, controller, overview, stats
- **函数**:
  - `getRevenueOverview`: 营收总览/revenue overview
  - `getDailyRevenue`: 日营收/daily revenue
  - `getPeopleStats`: 人数统计/people stats
  - `getDemandChannel`: 需求渠道/demand channel
  - `getEvents`: 活动与类型/events
  - `getSales`: 销售与客户/sales

### dashboard.service.ts
看板业务服务。
- **关键词**: dashboard, service, metrics, feishu
- **函数**:
  - `getBeijingDate`: 北京日期/get beijing date
  - `parseTimeRange`: 时间范围解析/parse time range
  - `num`: 数值安全解析/parse number
  - `str`: 字符串解析/parse string
  - `arr`: 数组解析/parse array
  - `fetchAll`: 拉取全部记录/fetch all
  - `getRevenueOverview`: 营收总览/revenue overview
  - `getDailyRevenue`: 日营收/daily revenue
  - `getPeopleStats`: 人数统计/people stats
  - `getDemandChannel`: 需求渠道/demand channel
  - `getEvents`: 活动与类型/events
  - `getSales`: 销售与客户/sales

### dashboard.module.ts
模块定义。
- **关键词**: module
