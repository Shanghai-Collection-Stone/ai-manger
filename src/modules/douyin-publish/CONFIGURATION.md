# 抖音扫码发布与抓取配置

在部署 `ai-manger` 的服务器环境中配置下列变量，修改后重启或重新部署服务。本机 `.env` 被 Git 忽略，不会随代码推送到服务器。

| 变量 | 配置 | 作用 |
| --- | --- | --- |
| DOUYIN_MINIAPP_APP_ID | ttd8d9ae6446a0257001 | 与会客厅抖音小程序一致 |
| DOUYIN_MINIAPP_APP_SECRET | 在服务器填写对应小程序 AppSecret | 获取 client_token 并生成可扫码的 Schema；仅放服务端 |
| DOUYIN_MINIAPP_PUBLISH_PAGE | pages/publish/index | 扫码直接打开独立发布页，默认首页仍为会客厅 |
| DOUYIN_PUBLISH_WEBHOOK_ENABLED | 权限和回调配置完成后设为 true；默认关闭 | 为每件作品创建拍抖音长期任务，并将 taskIds 返回小程序发布器 |
| DOUYIN_PUBLISH_WEBHOOK_SECRET | 平台 Webhooks 页面提供的验签秘钥 | 对原始请求体执行 SHA1(secret + body) 验签；仅放服务端，勿填写扫码 token |
| TIKHUB_API_KEY | 可选环境兜底 | 抓取所需 Key；后台「小红书采集」的采集设置已配置有效 Key 时可共用，不必重复填环境变量 |
| DOUYIN_DATA_CRAWL_INTERVAL_MINUTES | 可选，默认 360 | 抓取间隔，允许 30–1440 分钟 |

不使用沙盒时保留默认 `DOUYIN_OPEN_API_BASE=https://open.douyin.com`。配置 AppID 与 AppSecret 后走官方 Schema，不需要额外配置 `DOUYIN_PUBLISH_QR_LINK_TEMPLATE`。

平台侧需开通 Schema（ma.share.schema）、发布视频和短视频挂载能力，并使用具备挂载权限的抖音号真机验证。配置后端 HTTPS 域名为小程序 request 合法域名，视频域名配置到 downloadFile 合法域名。小程序只携带发布库扫码凭证，AppSecret 与 TikHub Key 均不进入客户端。

桌面端 `xhs-manger` 使用已登录后台的 Bearer token，调用已有 `/api/douyin-publish` 与 `/api/douyin-data` 接口。发布库列表返回 `crawlTarget`，用于区分 ID 已就绪和待补作品链接；后台尚未生成可打开小程序的入口时，不将普通 JSON 二维码展示为可扫码入口。

视频发布完成后，数字 ID 可直接供抓取使用；原生回调为加密 ID 或漏返 ID 时，可在小程序发布页补分享链接，也可在桌面「抓取数据」绑定作品链接。桌面绑定会补齐缺失的发布库抓取身份，保留回调原始 ID。ID 就绪后须开启该作品监控，才进入原有立即抓取和定时抓取流程。未开启监控不会自动调用 TikHub。

小程序原生 success / fail 仍主动回写 `POST /api/publish-tasks/:id/publish-result`。另外已实现平台任务 Webhook，可在用户没有回到小程序、客户端回写未执行时接收作品状态与 video_id。它需要“拍抖音任务”能力，普通原生发布不会自动产生这类任务通知。

1. 在小程序能力实验室开通“拍抖音任务”（scope `apps.douyin.task`），确认 AppSecret 已配置。
2. 启用平台 Webhooks，把其验签秘钥填入服务器 `DOUYIN_PUBLISH_WEBHOOK_SECRET`，部署后端。
3. 回调地址填写 `https://ai-manger.superboxlink.com/api/douyin-publish/webhook`。网关需允许平台 POST 到此路径，保留原始请求体以及 `X-Douyin-Signature`、`Msg-Id` 请求头，不加后台登录跳转。
4. 平台保存地址时，接口对 `verify_webhook` 返回文本 JSON challenge。地址验证可能不带签名，只回显 challenge；业务事件必须验签并匹配 AppID。
5. 订阅 `douyin_video_task_message`，然后将服务器 `DOUYIN_PUBLISH_WEBHOOK_ENABLED=true` 并重启服务。发布新版小程序，重新载入待发布作品后再发视频；旧版客户端及未带 taskIds 的既往视频不会补发通知。

后端以 `rule_type=2`、`task_type=2`、目标一次视频创建任务，挂载 `/pages/home/index`，不附加话题要求。任务按作品持久复用，创建租约防止多进程重复调用，过期后保留历史关联并新建任务。启用后创建失败会阻止本次作品载入，不能悄悄退回没有平台通知的发布方式。小程序将任务 ID 传入官方 UploadParam.taskIds；这与开放平台分享 SDK 的 share_id/create_video 回调是不同能力。

平台状态 0 表示刚发布未公开，1 表示公开并满足任务条件，2 表示删除、审核失败或未满足条件。回调按任务关联作品，保留原生 douyinVideoId，另外保存平台原始 video_id、状态、时间与 Msg-Id；只有数字 ID 才形成抓取链接，不解密或猜测不透明 ID。重复、旧通知不会覆盖新状态，写入失败不确认消费，平台可重试。失败状态保持作品已提交，避免重新派发造成重发。通知收到数字 ID 后，既有桌面 crawlTarget 和监控流程即可读取；仍需开启该作品监控。若通知 ID 不透明，保留分享链接补全入口。

发布成功后小程序代码不主动跳转。抖音原生发布器结束时的前台位置由宿主客户端决定，需真机确认；服务端 Webhook 不依赖用户返回发布页。返回发布页会刷新结果，也可以手动点“刷新发布结果”。

官方依据：[创建拍抖音任务](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/basic-abilities/share/douyin_task/create-task)、[任务变更推送](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/basic-abilities/share/douyin_task/task-change-webhook)、[小程序 Webhooks 验签](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/tutorial/basic-ability/webhook)。

部署时需同时更新后端、小程序与桌面工作台资源，确保 identity-pending、crawlTarget 与链接补全能力一致。
