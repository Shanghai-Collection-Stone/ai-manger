# Dashboard Tabs Refactor

## 任务描述
改造看板（Dashboard）模块，支持多类型看板切换，并隐藏顶部搜索功能。

## 任务步骤
1.  [x] 修改 `web/src/ui/AiCommander/AiCommanderBento.jsx`：
    -   隐藏顶部的搜索按钮。
2.  [x] 修改 `web/src/ui/AiCommander/DashboardView.jsx`：
    -   添加状态管理 `activeTab` (如：'总览', '客流', '销售')。
    -   顶部添加横向文本标题栏（Tabs），用于切换看板类型。
    -   将原有内容封装为“总览”视图。
    -   新增“客流”和“销售”视图的简单实现（复用样式，展示不同数据）。
3.  [x] 验证访问和交互。

## 进度跟踪
- [x] 初始化
- [x] 搜索功能隐藏完成
- [x] 多看板切换逻辑实现完成
- [x] 代码修改完成
