import { ConfigService } from '@nestjs/config';

/**
 * 从环境变量解析 MongoDB 连接 URI 和库名
 *
 * 优先级：
 * 1. MONGODB_HOST + MONGODB_USER + MONGODB_PASS + MONGODB_DB（通用，生产/开发均可用）
 * 2. DEV_MONGODB_HOST + DEV_MONGODB_USER + ... （向后兼容旧开发配置）
 * 3. MONGODB_URI（完整 URI 直连）
 * 4. 兜底 mongodb://localhost:27017 / ai_system
 *
 * @keyword-en resolve mongo uri from env component vars or full uri
 */
export function resolveMongoUri(config: ConfigService): {
  uri: string;
  dbName: string;
} {
  // 通用组件变量（生产 & 开发均可用）
  const host =
    config.get<string>('MONGODB_HOST') ??
    config.get<string>('DEV_MONGODB_HOST');
  const db =
    config.get<string>('MONGODB_DB') ?? config.get<string>('DEV_MONGODB_DB');
  const user =
    config.get<string>('MONGODB_USER') ??
    config.get<string>('DEV_MONGODB_USER');
  const pass =
    config.get<string>('MONGODB_PASS') ??
    config.get<string>('DEV_MONGODB_PASS');
  const topo = (
    config.get<string>('MONGODB_TOPOLOGY') ??
    config.get<string>('DEV_MONGODB_TOPOLOGY') ??
    ''
  ).toLowerCase();
  const authSource =
    config.get<string>('MONGODB_AUTH_SOURCE') ??
    config.get<string>('DEV_MONGODB_AUTH_SOURCE') ??
    db;
  const port =
    config.get<string>('MONGODB_PORT') ??
    config.get<string>('DEV_MONGODB_PORT') ??
    '27017';

  if (host && db && user && pass) {
    const qp = new URLSearchParams();
    if (authSource) qp.set('authSource', authSource);
    if (topo === 'standalone') qp.set('directConnection', 'true');
    const uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/?${qp.toString()}`;
    return { uri, dbName: db };
  }

  // 兜底：完整 URI
  const uri = config.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017';
  const dbName = db ?? 'ai_system';
  return { uri, dbName };
}
