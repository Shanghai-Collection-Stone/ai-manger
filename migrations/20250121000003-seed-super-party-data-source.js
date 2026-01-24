/**
 * 迁移：添加超级派对数据源
 * 向 data_sources 集合插入 super_party MongoDB 数据源记录
 */

module.exports = {
  async up(db, client) {
    const collection = db.collection('data_sources');

    // 检查是否已存在
    const exists = await collection.findOne({ code: 'super-party' });
    if (exists) {
      console.log('[Migration] super-party data source already exists, skipping...');
      return;
    }

    const description = [
      '超级派对 MongoDB 数据库，包含小程序核心业务数据。',
      '用于派对活动管理、用户互动、订单处理等场景。',
      '支持活动数据查询、用户行为分析、订单统计等功能。',
    ].join('');

    // 关键词和向量嵌入为空，需要通过 API 触发生成
    const now = new Date();
    await collection.insertOne({
      code: 'super-party',
      name: '超级派对数据库',
      description,
      embedding: [], // 将由 API 触发生成
      moduleRef: 'sources/super-party',
      status: 'active',
      // 连接配置（应用层读取）
      config: {
        host: '211.149.248.140',
        port: 27017,
        database: 'super_party',
        username: 'super_party',
        // 注意：生产环境应使用环境变量或密钥管理
        authSource: 'super_party',
      },
      createdAt: now,
      updatedAt: now,
    });

    console.log('[Migration] super-party data source seeded successfully');
  },

  async down(db, client) {
    await db.collection('data_sources').deleteOne({ code: 'super-party' });
    console.log('[Migration] super-party data source removed');
  },
};
