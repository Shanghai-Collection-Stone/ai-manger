# 抖音扫码发布与抓取配置

在部署 `ai-manger` 的服务器环境中配置下列变量，修改后重启或重新部署服务。本机 `.env` 被 Git 忽略，不会随代码推送到服务器。

| 变量 | 配置 | 作用 |
| --- | --- | --- |
| DOUYIN_MINIAPP_APP_ID | ttd8d9ae6446a0257001 | 与会客厅抖音小程序一致 |
| DOUYIN_MINIAPP_APP_SECRET | 在服务器填写对应小程序 AppSecret | 获取 client_token 并生成可扫码的 Schema；仅放服务端 |
| DOUYIN_MINIAPP_VERSION_TYPE | current 正式版（默认）；latest 开发测试版 | 由后端统一决定所有发布库二维码打开的版本，软件端不可覆盖；修改后重启服务 |
| DOUYIN_MINIAPP_PUBLISH_PAGE | pages/publish/index | 扫码直接打开独立发布页，默认首页仍为会客厅 |
| DOUYIN_PUBLISH_WEBHOOK_ENABLED | 权限和回调配置完成后设为 true；默认关闭 | 为每件作品创建拍抖音长期任务，并将 taskIds 返回小程序发布器 |
| DOUYIN_PUBLISH_WEBHOOK_SECRET | 平台 Webhooks 页面提供的验签秘钥 | 对原始请求体执行 SHA1(secret + body) 验签；仅放服务端，勿填写扫码 token |
| TIKHUB_API_KEY | 可选环境兜底 | 抓取所需 Key；后台「小红书采集」的采集设置已配置有效 Key 时可共用，不必重复填环境变量 |
| DOUYIN_DATA_CRAWL_INTERVAL_MINUTES | 可选，默认 360 | 抓取间隔，允许 30–1440 分钟 |

不使用沙盒时保留默认 `DOUYIN_OPEN_API_BASE=https://open.douyin.com`。配置 AppID 与 AppSecret 后走官方 Schema，不需要额外配置 `DOUYIN_PUBLISH_QR_LINK_TEMPLATE`。

小程序版本只在 ai-manger 后端设置：DOUYIN_MINIAPP_VERSION_TYPE=current 打开线上正式版（默认）；需要测试时才改为 latest，打开平台已上传的开发测试版。非法值会明确报错。修改服务器环境变量后重启或重新部署服务，再在工作台刷新二维码。软件端仅显示后端返回的当前版本，没有版本选择控件，也不提交版本参数；旧客户端即使传 versionType 查询参数也不能覆盖服务器设置。

两种版本分别缓存，切换后端设置后复用对应入口。GET /api/douyin-publish/libraries/:id/qr 返回实际 versionType；两种二维码使用同一发布库 token 和租户参数，发布、ID回写、Webhook与抓取仍归原发布库。本机 .env 已设置为 current 正式版，未配置时也默认正式版；本机环境文件被 Git 忽略，服务器环境需单独设置。

本地测试时生成或刷新发布库二维码，后端终端会打印 `[qr] entry_json`，下一行 JSON 可直接粘贴到小程序「视频发布 → 载入生成的视频」。格式为 `{"token":"发布库扫码token","tenantId":"租户ID"}`；token 必填，tenantId 可省略或为空。需要指定作品时增加 `"workId":"作品ID"`，否则领取该库下一条待发布视频。命中二维码缓存时也会打印。该日志仅在 NODE_ENV 未设置或为 development / dev 时启用，production、test 及其他环境不输出入口凭证。

测试前需上传新版测试包，并将扫码账号加入平台测试账号。latest 不会读取电脑上未上传的代码，视频发布仍使用真实抖音能力。使用本项目 AppID 调用官方接口生成测试版链接已成功，真机发布及通知投递仍需账号与权限齐备。官方接口：[生成 SchemaV2](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/basic-abilities/url-and-qrcode/schema/generate-schema-v2)。

平台侧需开通 Schema（ma.share.schema）、发布视频和短视频挂载能力，并使用具备挂载权限的抖音号真机验证。配置后端 HTTPS 域名为小程序 request 合法域名，视频域名配置到 downloadFile 合法域名。小程序只携带发布库扫码凭证，AppSecret 与 TikHub Key 均不进入客户端。

桌面端 `xhs-manger` 使用已登录后台的 Bearer token，调用已有 `/api/douyin-publish` 与 `/api/douyin-data` 接口。发布库列表返回 `crawlTarget`，用于区分 ID 已就绪和待补作品链接；后台尚未生成可打开小程序的入口时，不将普通 JSON 二维码展示为可扫码入口。

视频发布完成后，数字 ID 可直接供抓取使用；原生回调为加密 ID 或漏返 ID 时，可在小程序发布页补分享链接，也可在桌面「抓取数据」绑定作品链接。桌面绑定会补齐缺失的发布库抓取身份，保留回调原始 ID。ID 就绪后须开启该作品监控，才进入原有立即抓取和定时抓取流程。未开启监控不会自动调用 TikHub。

小程序原生 success / fail 仍主动回写 `POST /api/publish-tasks/:id/publish-result`。另外已实现平台任务 Webhook，可在用户没有回到小程序、客户端回写未执行时接收作品状态与 video_id。它需要“拍抖音任务”能力，普通原生发布不会自动产生这类任务通知。

该扩展能力需单独申请，不能仅凭文档或填写回调地址认定当前 AppID 已开通。apps.douyin.task 是接口权限名，控制台对应“拍抖音任务能力”；官方目前指引到“能力 → 能力实验室”。如果该应用看不到入口，需由平台确认开放资格与实际入口；若能申请但事件不可见，应先确认该应用能力已获批，再检查应用的 Webhooks 订阅页。

针对 Webhooks 列表没有任务事件的实际排查：AppID ttd8d9ae6446a0257001 调用 POST /api/apps/v1/douyin/create_task/ 返回 err_no=28001018、err_msg=应用未获得该能力，且未创建任务。请求 log_id 为 202611122223177D8CF42850978EFDE041，可随 AppID 一起提交平台核查 apps.douyin.task 的申请资格或授权状态。该结果确认本次调用时任务能力不可用，不能由订阅页面缺少事件推断全部应用都不支持。获批后仍需完成事件订阅，再开启后端任务开关。

官方2023年申请公告曾列出内测及投稿量条件，该历史公告不能视为当前统一申请门槛。未确认能力和事件订阅前，保持 DOUYIN_PUBLISH_WEBHOOK_ENABLED=false，使用已有原生 success/fail 回写与作品链接补全。启用但无权限会令任务创建失败并阻止作品载入。已签名的历史任务通知仍可按原关联接收。

官方说明：[拍抖音能力与任务能力的区别](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/operation/douyin-video/douyin-task)、[2023年能力申请公告（历史条件）](https://developer.open-douyin.com/forum/bulletin/post/653b28b141dcfdfb21a9d474)。

1. 确认当前 AppID 已获批“拍抖音任务能力”（scope `apps.douyin.task`），且 AppSecret 已配置。
2. 启用平台 Webhooks，把其验签秘钥填入服务器 `DOUYIN_PUBLISH_WEBHOOK_SECRET`，部署后端。
3. 回调地址填写 `https://ai-manger.superboxlink.com/api/douyin-publish/webhook`。网关需允许平台 POST 到此路径，保留原始请求体以及 `X-Douyin-Signature`、`Msg-Id` 请求头，不加后台登录跳转。
4. 平台保存地址时，接口对 `verify_webhook` 返回文本 JSON challenge。地址验证可能不带签名，只回显 challenge；业务事件必须验签并匹配 AppID。
5. 订阅 `douyin_video_task_message`，然后将服务器 `DOUYIN_PUBLISH_WEBHOOK_ENABLED=true` 并重启服务。发布新版小程序，重新载入待发布作品后再发视频；旧版客户端及未带 taskIds 的既往视频不会补发通知。

后端以 `rule_type=2`、`task_type=2`、目标一次视频创建任务，挂载 `/pages/home/index`，不附加话题要求。任务按作品持久复用，创建租约防止多进程重复调用，过期后保留历史关联并新建任务。启用后创建失败会阻止本次作品载入，不能悄悄退回没有平台通知的发布方式。小程序将任务 ID 传入官方 UploadParam.taskIds；这与开放平台分享 SDK 的 share_id/create_video 回调是不同能力。

平台状态 0 表示刚发布未公开，1 表示公开并满足任务条件，2 表示删除、审核失败或未满足条件。回调按任务关联作品，保留原生 douyinVideoId，另外保存平台原始 video_id、状态、时间与 Msg-Id；只有数字 ID 才形成抓取链接，不解密或猜测不透明 ID。重复、旧通知不会覆盖新状态，写入失败不确认消费，平台可重试。失败状态保持作品已提交，避免重新派发造成重发。通知收到数字 ID 后，既有桌面 crawlTarget 和监控流程即可读取；仍需开启该作品监控。若通知 ID 不透明，保留分享链接补全入口。

发布成功后小程序代码不主动跳转。抖音原生发布器结束时的前台位置由宿主客户端决定，需真机确认；服务端 Webhook 不依赖用户返回发布页。返回发布页会刷新结果，也可以手动点“刷新发布结果”。

官方依据：[创建拍抖音任务](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/basic-abilities/share/douyin_task/create-task)、[任务变更推送](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/basic-abilities/share/douyin_task/task-change-webhook)、[小程序 Webhooks 验签](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/tutorial/basic-ability/webhook)。

部署时需同时更新后端、小程序与桌面工作台资源，确保 identity-pending、crawlTarget 与链接补全能力一致。
