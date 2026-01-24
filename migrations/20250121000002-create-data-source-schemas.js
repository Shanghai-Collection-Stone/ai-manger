/**
 * 迁移：创建 data_source_schemas 集合和索引
 * 用于存储数据源的表定义和向量嵌入
 */

module.exports = {
  async up(db, client) {
    const collection = db.collection('data_source_schemas');

    // 创建索引
    try {
      await collection.createIndex({ sourceCode: 1 });
      await collection.createIndex(
        { sourceCode: 1, collectionName: 1 },
        { unique: true }
      );
      await collection.createIndex({ keywords: 1 });
      // 创建文本索引用于全文搜索
      await collection.createIndex(
        { collectionName: 'text', nameCn: 'text', keywords: 'text' },
        { name: 'schema_text_index' }
      );
      console.log('[Migration] data_source_schemas indexes created');
    } catch (e) {
      // 索引可能已存在
      console.log('[Migration] data_source_schemas indexes may already exist:', e.message);
    }

    // 注意：Schema 数据将由 API 触发生成
    // keywords 和 embedding 字段为可选，迁移时为空
    console.log('[Migration] data_source_schemas collection ready');
    console.log('[Migration] Run POST /data-source/update-vectors to generate schema vectors');
  },

  async down(db, client) {
    const collection = db.collection('data_source_schemas');
    try {
      await collection.dropIndex('schema_text_index');
    } catch (e) {
      // ignore
    }
    await collection.deleteMany({});
    console.log('[Migration] data_source_schemas cleared');
  },
};
