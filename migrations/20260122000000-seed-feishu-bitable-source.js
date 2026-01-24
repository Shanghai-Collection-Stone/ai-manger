/**
 * 迁移：添加飞书多维表格数据源
 * 向 data_sources 集合插入 feishu-bitable 数据源记录
 */

module.exports = {
  async up(db, client) {
    const collection = db.collection('data_sources');

    // 检查是否已存在
    const exists = await collection.findOne({ code: 'feishu-bitable' });
    if (exists) {
      console.log(
        '[Migration] feishu-bitable data source already exists, skipping...',
      );
      return;
    }

    const description = [
      '飞书多维表格 (Feishu Bitable) 数据源。',
      '支持通过 API 访问飞书多维表格中的数据。',
      '提供列表查询、字段查询和表格元数据获取功能。',
    ].join('');

    // 关键词和向量嵌入为空，需要通过 API 触发生成
    const now = new Date();
    await collection.insertOne({
      code: 'feishu-bitable',
      name: '飞书多维表格',
      description,
      embedding: [], // 将由 API 触发生成
      moduleRef: 'sources/feishu-bitable',
      status: 'active',
      // 配置通常从文件加载，这里仅作记录
      config: {
        apiBase: 'https://open.feishu.cn/open-apis/bitable/v1',
        authType: 'tenant_access_token',
      },
      createdAt: now,
      updatedAt: now,
    });

    console.log('[Migration] feishu-bitable data source seeded successfully');
  },

  async down(db, client) {
    await db.collection('data_sources').deleteOne({ code: 'feishu-bitable' });
    console.log('[Migration] feishu-bitable data source removed');
  },
};
