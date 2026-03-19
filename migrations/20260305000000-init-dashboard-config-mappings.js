/**
 * @description 初始化看板配置映射
 * @keyword-en initialize dashboard config mappings
 */

const { ObjectId } = require('mongodb');

module.exports = {
  async up(db) {
    const mappings = db.collection('dashboard_config_mappings');

    // 确保索引
    await mappings.createIndexes([
      {
        key: { dashboardCode: 1, tenantId: 1 },
        unique: true,
        name: 'uniq_dashboard_tenant',
      },
      { key: { updatedAt: -1 }, name: 'idx_updated_at' },
      { key: { enabled: 1 }, name: 'idx_enabled' },
    ]);

    // 母平台默认配置
    await mappings.updateOne(
      {
        dashboardCode: 'ai-commander',
        tenantId: null,
      },
      {
        $set: {
          filePath: 'config/dashboards/platform.dashboard.json',
          enabled: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    // 超级派对租户配置（示例）
    await mappings.updateOne(
      {
        dashboardCode: 'ai-commander',
        tenantId: 'super-party',
      },
      {
        $set: {
          filePath: 'config/dashboards/super-party.dashboard.json',
          enabled: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log('✓ Dashboard config mappings initialized');
  },

  async down(db) {
    const mappings = db.collection('dashboard_config_mappings');
    await mappings.deleteMany({
      dashboardCode: 'ai-commander',
    });
    console.log('✓ Dashboard config mappings cleared');
  },
};
