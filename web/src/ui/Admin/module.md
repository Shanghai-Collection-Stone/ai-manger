# Admin UI Module

## 模块描述
后台管理前端：提供用户/租户/API Key/数据源等管理能力，并提供看板配置映射管理页面（租户 -> JSON 配置文件路径）。
支持 AI 提供商按模型类型管理（llm/em/image），并支持平台 AI 配置中的“是否开启 AI 封面”开关。
**租户隔离**：`tenant_admin` 不可见 AI 提供商、租户管理 Tab；看板配置映射锁定到自己租户。
文件路径: `web/src/ui/Admin`

## 功能描述及关键词

### AdminApp.jsx
后台管理主应用，包含多Tab管理界面与数据加载逻辑，刷新后保留上次点击Tab。
Tab 按角色过滤（`platformOnly` 标记限制 `super_admin` 才可见）。
- **关键词**: admin ui, tabs, crud, localStorage, dashboard config mapping, tenant isolation, ai provider, image category, ai cover toggle
- **函数**:
  - `toText`: 字符串安全转换/to text
  - `toLower`: 小写转换/to lower
  - `readAdminActiveTab`: 读取当前Tab/read active tab
  - `writeAdminActiveTab`: 写入当前Tab/write active tab
  - `toDateInput`: 时间转输入值/to date input
  - `getRoleLabel`: 角色标签/get role label
  - `hasAdminFullAccess`: 权限判断/check full access
  - `isSuperAdmin`: 母平台管理员判断/check super admin
  - `ALL_TABS`: 全量Tab定义（含 platformOnly 标记）/all admin tabs
  - `buildPagedRows`: 分页计算/build paged rows
  - `renderPager`: 分页组件/render pager
  - `loadData`: 加载数据（租户跳过 providers）/load data
  - `updateForm`: 更新表单/update form
  - `updateFilter`: 更新筛选/update filter
  - `gotoPage`: 翻页/goto page
  - `reloadDashboardConfigs`: 刷新看板配置映射/reload dashboard configs
  - `onSubmitDashboardConfig`: 提交看板配置映射/submit dashboard config
  - `onDeleteDashboardConfig`: 删除看板配置映射/delete dashboard config
  - `onSubmitPlatformInfo`: 提交平台AI配置（含enableAiCover）/submit platform ai config

### AdminLoginApp.jsx
后台登录页：选择租户并登录，写入 token 并跳转。
- **关键词**: admin login, tenant select, token
- **函数**:
  - `hasAdminFullAccess`: 权限判断/check full access
  - `readLoginIntent`: 读取来源/read login intent
  - `resolvePostLoginTarget`: 登录后跳转/resolve post login target

### adminApi.js
后台 API 封装：管理端接口请求、token 存取、页面跳转地址解析。
- **关键词**: api, bearer token, request, redirect
- **函数**:
  - `getAdminToken`: 读取token/get admin token
  - `setAdminToken`: 写入token/set admin token
  - `clearAdminToken`: 清理token/clear admin token
  - `resolveAdminPageHref`: 后台页面地址/resolve admin href
  - `resolveFrontendPageHref`: 前台页面地址/resolve frontend href
  - `resolveLoginPageHref`: 登录页地址/resolve login href
  - `request`: 统一请求/request
  - `adminApi.*`: 后台接口集合/admin api methods

