import { defaultHttpInstance } from '@larksuiteoapi/node-sdk';

/**
 * @title 飞书直连 HttpInstance Feishu Direct Http Instance
 * @description 返回飞书 SDK 专用的 axios 实例。复用 SDK 自带的 defaultHttpInstance
 *   (保留其响应解包 interceptor —— TokenManager 直接对 request() 结果解构,依赖该
 *   interceptor 把 axios response 拆成 data),并强制 `proxy = false`。
 *   open.feishu.cn 是境内服务,必须直连;若不禁用代理,axios 会读取 OS 级
 *   HTTP_PROXY / HTTPS_PROXY(如本机 v2ray 设的系统代理),把请求经本地代理
 *   (127.0.0.1:10808)以明文 HTTP 发往 HTTPS 端口,feishu 返回 400 →
 *   tenant_access_token 为空 → SDK 解构 `tenant_access_token` 时崩溃。
 *   注意:这里禁用的是 SDK 共享单例的代理,所有 lark.Client 都会直连飞书(符合预期)。
 * @returns {typeof defaultHttpInstance} 已禁用代理的飞书 axios 实例。
 * @keyword-en feishu lark sdk direct http instance no proxy
 * @keyword-cn 飞书直连 httpInstance, 禁用代理
 */
export function createFeishuHttpInstance(): typeof defaultHttpInstance {
  defaultHttpInstance.defaults.proxy = false;
  return defaultHttpInstance;
}
