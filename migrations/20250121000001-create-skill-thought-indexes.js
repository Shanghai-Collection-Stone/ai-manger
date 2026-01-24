/**
 * 迁移：创建思维链集合索引
 * 为 skill_thoughts 集合创建必要的索引
 */

module.exports = {
  async up(db, client) {
    const collection = db.collection('skill_thoughts');

    // 创建基础索引
    try {
      await collection.createIndex({ keywords: 1 });
      await collection.createIndex({ sessionId: 1 });
      await collection.createIndex({ category: 1 });
      await collection.createIndex({ usageCount: -1 });
      await collection.createIndex({ updatedAt: -1 });
      await collection.createIndex({ createdAt: -1 });

      console.log('[Migration] Skill thought indexes created successfully');
    } catch (error) {
      console.warn('[Migration] Some indexes may already exist:', error.message);
    }

    // 注意：Atlas Vector Search 索引需要在 MongoDB Atlas 控制台手动创建
    // 索引名称: skill_thought_embedding_index
    // 索引配置：
    // {
    //   "fields": [{
    //     "type": "vector",
    //     "path": "embedding",
    //     "numDimensions": 768,
    //     "similarity": "cosine"
    //   }]
    // }
    console.log(
      '[Migration] Note: Vector search index must be created manually in MongoDB Atlas console',
    );
  },

  async down(db, client) {
    const collection = db.collection('skill_thoughts');

    try {
      await collection.dropIndex('keywords_1');
      await collection.dropIndex('sessionId_1');
      await collection.dropIndex('category_1');
      await collection.dropIndex('usageCount_-1');
      await collection.dropIndex('updatedAt_-1');
      await collection.dropIndex('createdAt_-1');

      console.log('[Migration] Skill thought indexes dropped');
    } catch (error) {
      console.warn('[Migration] Some indexes may not exist:', error.message);
    }
  },
};
