/**
 * migrate-mongo 配置文件
 * 用于 MongoDB 数据库迁移管理
 */

// 从环境变量读取配置
const env = (process.env.NODE_ENV ?? '').toLowerCase();
const isDev = env === 'development' || env === 'dev';

// 构建 MongoDB URI
function buildMongoUri() {
  if (isDev) {
    const host = process.env.DEV_MONGODB_HOST;
    const db = process.env.DEV_MONGODB_DB;
    const user = process.env.DEV_MONGODB_USER;
    const pass = process.env.DEV_MONGODB_PASS;
    const topo = (process.env.DEV_MONGODB_TOPOLOGY ?? '').toLowerCase();

    if (host && db && user && pass) {
      const qp = new URLSearchParams();
      const authSource = process.env.DEV_MONGODB_AUTH_SOURCE ?? db;
      qp.set('authSource', authSource);
      if (topo === 'standalone') qp.set('directConnection', 'true');
      return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:27017/?${qp.toString()}`;
    }
  }
  return process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
}

function getDbName() {
  if (isDev) {
    return process.env.DEV_MONGODB_DB ?? 'ai_system';
  }
  return process.env.MONGODB_DB ?? 'ai_system';
}

const config = {
  mongodb: {
    url: buildMongoUri(),
    databaseName: getDbName(),
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};

module.exports = config;
