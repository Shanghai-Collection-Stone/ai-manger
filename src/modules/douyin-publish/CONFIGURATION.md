# 抖音扫码发布与抓取配置

在部署 `ai-manger` 的服务器环境中配置下列变量，修改后重启或重新部署服务。本机 `.env` 被 Git 忽略，不会随代码推送到服务器。

| 变量 | 配置 | 作用 |
| --- | --- | --- |
| DOUYIN_MINIAPP_APP_ID | ttd8d9ae6446a0257001 | 与会客厅抖音小程序一致 |
| DOUYIN_MINIAPP_APP_SECRET | 在服务器填写对应小程序 AppSecret | 获取 client_token 并生成可扫码的 Schema；仅放服务端 |
| DOUYIN_MINIAPP_PUBLISH_PAGE | pages/publish/index | 扫码直接打开独立发布页，默认首页仍为会客厅 |
| TIKHUB_API_KEY | 可选环境兜底 | 抓取所需 Key；后台「小红书采集」的采集设置已配置有效 Key 时可共用，不必重复填环境变量 |
| DOUYIN_DATA_CRAWL_INTERVAL_MINUTES | 可选，默认 360 | 抓取间隔，允许 30–1440 分钟 |

不使用沙盒时保留默认 `DOUYIN_OPEN_API_BASE=https://open.douyin.com`。配置 AppID 与 AppSecret 后走官方 Schema，不需要额外配置 `DOUYIN_PUBLISH_QR_LINK_TEMPLATE`。

平台侧需开通 Schema（ma.share.schema）、发布视频和短视频挂载能力，并使用具备挂载权限的抖音号真机验证。配置后端 HTTPS 域名为小程序 request 合法域名，视频域名配置到 downloadFile 合法域名。小程序只携带发布库扫码凭证，AppSecret 与 TikHub Key 均不进入客户端。

桌面端 `xhs-manger` 使用已登录后台的 Bearer token，调用已有 `/api/douyin-publish` 与 `/api/douyin-data` 接口。发布库列表返回 `crawlTarget`，用于区分 ID 已就绪和待补作品链接；后台尚未生成可打开小程序的入口时，不将普通 JSON 二维码展示为可扫码入口。

视频发布完成后，数字 ID 可直接供抓取使用；原生回调为加密 ID 或漏返 ID 时，可在小程序发布页补分享链接，也可在桌面「抓取数据」绑定作品链接。桌面绑定会补齐缺失的发布库抓取身份，保留回调原始 ID。ID 就绪后须开启该作品监控，才进入原有立即抓取和定时抓取流程。未开启监控不会自动调用 TikHub。

当前链路使用小程序发布器回调后主动回写 `POST /api/publish-tasks/:id/publish-result`，无需配置额外的发布结果 Webhook 地址。视频审核结果 Webhook 尚未接入。

部署时需同时更新后端、小程序与桌面工作台资源，确保 identity-pending、crawlTarget 与链接补全能力一致。
