import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * @description 解析模拟发文脚本的命令行选项。
 * @keyword-cn 解析模拟参数, 发文脚本选项
 * @keyword-en parse-simulation-args, publish-script-options
 */
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) continue;
    const [name, inlineValue] = raw.slice(2).split('=', 2);
    const next = argv[index + 1];
    const value =
      inlineValue ?? (next && !next.startsWith('--') ? next : 'true');
    result[name] = value;
    if (inlineValue === undefined && value === next) index += 1;
  }
  return result;
}

/**
 * @description 调用本地 HTTP JSON 接口并把非成功响应转换成可读错误。
 * @keyword-cn 调用模拟接口, HTTP错误解析
 * @keyword-en call-simulation-api, http-error-parsing
 */
async function requestJson(baseUrl, path, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const detail =
      typeof data?.message === 'string'
        ? data.message
        : raw || response.statusText;
    throw new Error(
      `${options.method ?? 'GET'} ${path} -> ${response.status} ${detail}`,
    );
  }
  return data;
}

/**
 * @description 使用显式 Token 或本地管理员凭据取得模拟调用 Token。
 * @keyword-cn 获取模拟令牌, 管理员登录
 * @keyword-en acquire-simulation-token, admin-login
 */
async function acquireAdminToken(baseUrl, args) {
  const explicitToken =
    args.token || process.env.SIMULATE_PUBLISH_ADMIN_TOKEN || '';
  if (explicitToken.trim()) return explicitToken.trim();
  const username =
    args.username ||
    process.env.SIMULATE_PUBLISH_USERNAME ||
    process.env.ADMIN_BOOTSTRAP_USERNAME ||
    'admin';
  const password =
    args.password ||
    process.env.SIMULATE_PUBLISH_PASSWORD ||
    process.env.ADMIN_BOOTSTRAP_PASSWORD ||
    'admin123456';
  try {
    const result = await requestJson(baseUrl, '/admin/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    if (!result?.token) throw new Error('登录响应缺少 token');
    return result.token;
  } catch (error) {
    throw new Error(
      `${String(error)}\n请设置 SIMULATE_PUBLISH_USERNAME / SIMULATE_PUBLISH_PASSWORD，或传 --token。`,
    );
  }
}

/**
 * @description 把交互输入或命令行值校验为正整数业务 ID。
 * @keyword-cn 校验业务ID, 正整数参数
 * @keyword-en validate-business-id, positive-integer-argument
 */
function readPositiveId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return id;
}

/**
 * @description 校验 NOTE_CHANGE 回调携带的小红书笔记 ID。
 * @keyword-cn 校验小红书笔记ID, 发布回调笔记
 * @keyword-en validate-xhs-note-id, publish-callback-note
 */
function readNoteId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('NoteId 不能为空');
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error('NoteId 只能包含字母、数字、下划线或连字符');
  }
  return raw;
}

/**
 * @description 从数据看板选题中选择指定或首个处于抓取中的子选题。
 * @keyword-cn 选择模拟选题, 抓取中子题
 * @keyword-en select-simulation-topic, crawling-child-topic
 */
function selectTopic(groups, requestedTopicId) {
  const children = (Array.isArray(groups) ? groups : []).flatMap((group) =>
    Array.isArray(group?.children) ? group.children : [],
  );
  if (requestedTopicId !== undefined) {
    const id = readPositiveId(requestedTopicId, 'topicId');
    const selected = children.find((item) => Number(item?.id) === id);
    if (!selected) throw new Error(`当前账号下找不到子选题 #${id}`);
    if (selected.crawlStatus === 'cancelled') {
      throw new Error(`子选题 #${id} 已取消抓取，请先恢复抓取状态`);
    }
    return selected;
  }
  const selected = children.find((item) => item?.crawlStatus !== 'cancelled');
  if (!selected) {
    throw new Error('当前账号没有可用于模拟的抓取中子选题，请传 --topic-id');
  }
  return selected;
}

/**
 * @description 轮询抓取任务列表，确认发布回调已生成新的单次 Todo。
 * @keyword-cn 等待单次抓取任务, 发布回调验证
 * @keyword-en wait-single-crawl-task, verify-publish-callback
 */
async function waitForCrawlTask(baseUrl, token, topicId, startedAfter) {
  const timeoutAt = Date.now() + 75_000;
  let lastResult;
  while (Date.now() < timeoutAt) {
    const result = await requestJson(
      baseUrl,
      `/api/xhs-topic-data/${topicId}/crawl-tasks?page=1&pageSize=20`,
      { token },
    );
    lastResult = result;
    const task = (result?.items ?? []).find(
      (item) => new Date(item?.startedAt).getTime() >= startedAfter - 1_000,
    );
    if (task) return { task, diagnostic: result };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return { task: undefined, diagnostic: lastResult };
}

/**
 * @description 创建模拟小红书文章、调用真实扫码回调并验证调度生成单次 Todo。
 * @keyword-cn 模拟发文回调, 创建单次任务
 * @keyword-en simulate-publish-callback, create-single-task
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    console.log(`用法：
  pnpm simulate:publish
  pnpm simulate:publish --library-id 1 --note-id 你的NoteId
  pnpm simulate:publish --library-id 1 --topic-id 123 --note-id 你的NoteId

可选环境变量：
  APP_URL
  SIMULATE_PUBLISH_ADMIN_TOKEN
  SIMULATE_PUBLISH_USERNAME
  SIMULATE_PUBLISH_PASSWORD
  SIMULATE_PUBLISH_NOTE_ID
  SIMULATE_PUBLISH_APP_ID
  SIMULATE_PUBLISH_OPEN_ID`);
    return;
  }
  const baseUrl = String(
    args['base-url'] || process.env.APP_URL || 'http://localhost:3011',
  ).replace(/\/+$/, '');
  const readline = createInterface({ input, output });
  try {
    const rawLibraryId =
      args['library-id'] || (await readline.question('文章库 ID：'));
    const libraryId = readPositiveId(rawLibraryId, 'libraryId');
    const rawNoteId =
      args['note-id'] ||
      process.env.SIMULATE_PUBLISH_NOTE_ID ||
      (await readline.question('小红书回调 NoteId：'));
    const noteId = readNoteId(rawNoteId);
    const callbackAppId = String(
      args['app-id'] ||
        process.env.SIMULATE_PUBLISH_APP_ID ||
        'simulate-xhs-miniapp',
    ).trim();
    const callbackOpenId = String(
      args['open-id'] ||
        process.env.SIMULATE_PUBLISH_OPEN_ID ||
        'simulate-open-id',
    ).trim();
    const token = await acquireAdminToken(baseUrl, args);

    const libraryResult = await requestJson(
      baseUrl,
      `/api/article-library/${libraryId}`,
      { token },
    );
    const topicsResult = await requestJson(
      baseUrl,
      '/api/xhs-topic-data/topics',
      { token },
    );
    const topic = selectTopic(topicsResult?.groups, args['topic-id']);
    const simulatedAt = new Date().toISOString();

    console.log(
      `准备模拟：文章库 #${libraryId}「${libraryResult.library?.name ?? ''}」 -> 子选题 #${topic.id}「${topic.title}」`,
    );
    const created = await requestJson(
      baseUrl,
      `/api/article-library/${libraryId}/articles`,
      {
        method: 'POST',
        token,
        body: {
          article: {
            title: `[模拟发文] ${topic.title} ${simulatedAt}`,
            text: `用于验证发布回调与单次抓取 Todo 的模拟文章，创建于 ${simulatedAt}。`,
            tags: ['模拟发文'],
            source: 'xhs-topic',
            publishStatus: 'unpublished',
            meta: {
              xhsTopicId: topic.id,
              simulatedPublish: true,
              simulatedAt,
            },
          },
        },
      },
    );
    const article = created?.items?.[0];
    if (!article?.id) throw new Error('创建模拟文章失败：响应缺少 article id');

    const qr = await requestJson(
      baseUrl,
      `/api/article-library/${libraryId}/push-qr`,
      { token },
    );
    const callbackToken = qr?.qrPayload?.token;
    if (!callbackToken) throw new Error('文章库推送配置缺少二维码 Token');

    const callbackStartedAt = Date.now();
    const callbackMeta = {
      xhsTopicId: topic.id,
      simulatedPublish: true,
      simulatedAt,
      Event: 'NOTE_CHANGE',
      NoteId: noteId,
      AppId: callbackAppId,
      OpenId: callbackOpenId,
      PublishTime: simulatedAt,
    };
    const callback = await requestJson(
      baseUrl,
      `/task-api/article-library/articles/${article.id}/status`,
      {
        method: 'PATCH',
        body: {
          token: callbackToken,
          articleLibraryId: libraryId,
          status: 'published',
          meta: JSON.stringify(callbackMeta),
        },
      },
    );
    if (!callback?.ok) throw new Error('发布回调返回 ok=false');
    if (callback?.article?.meta?.NoteId !== noteId) {
      throw new Error('发布回调成功，但 NoteId 未正确落库');
    }
    console.log(
      `发布回调成功：articleId=${article.id} Event=NOTE_CHANGE NoteId=${noteId}`,
    );
    console.log('等待调度器创建单次 Todo（最多约 75 秒）...');

    const observation = await waitForCrawlTask(
      baseUrl,
      token,
      topic.id,
      callbackStartedAt,
    );
    const crawlTask = observation.task;
    if (!crawlTask) {
      const schedule = observation.diagnostic?.schedule;
      console.warn(
        `回调已成功，但暂未观察到新抓取 Todo。agentAvailable=${String(
          observation.diagnostic?.agentAvailable,
        )} schedule=${schedule?.status ?? 'missing'} nextRunAt=${
          schedule?.nextRunAt ?? 'unknown'
        } lastError=${schedule?.lastError ?? 'none'}`,
      );
      process.exitCode = 2;
      return;
    }
    console.log(
      `验证成功：taskId=${crawlTask.id} todoId=${crawlTask.todoId} type=单次抓取 status=${crawlTask.status}`,
    );
  } finally {
    readline.close();
  }
}

await main().catch((error) => {
  console.error(
    `模拟失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
