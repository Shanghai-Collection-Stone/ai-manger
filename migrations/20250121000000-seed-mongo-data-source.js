/**
 * 迁移：初始化主 MongoDB 数据源
 * 向 data_sources 集合插入主数据库记录
 */

module.exports = {
  async up(db, client) {
    const collection = db.collection('data_sources');

    // 删除旧的 'mongo' 记录（如果存在）
    await collection.deleteOne({ code: 'mongo' });

    // 检查是否已存在 main-mongo
    const exists = await collection.findOne({ code: 'main-mongo' });
    if (exists) {
      console.log('[Migration] main-mongo data source already exists, skipping...');
      return;
    }

    const description = [
      'AI Manager 系统主 MongoDB 数据库，包含用户、会话、消息等核心数据。',
      '支持灵活的 JSON 文档存储、聚合查询、全文搜索和向量搜索。',
      '提供 data_source_query（查询）、schema_search（Schema搜索）等工具。',
    ].join('');

    // 关键词和向量嵌入为空，需要通过 API 触发生成
    const now = new Date();
    await collection.insertOne({
      code: 'main-mongo',
      name: 'AI系统主数据库',
      description,
      embedding: [], // 将由 API 触发生成
      moduleRef: 'sources/mongo',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // 创建索引
    await collection.createIndex({ code: 1 }, { unique: true });
    await collection.createIndex({ status: 1 });
    await collection.createIndex({ moduleRef: 1 });

    console.log('[Migration] main-mongo data source seeded successfully');
  },

  async down(db, client) {
    await db.collection('data_sources').deleteOne({ code: 'main-mongo' });
    console.log('[Migration] main-mongo data source removed');
  },
};
