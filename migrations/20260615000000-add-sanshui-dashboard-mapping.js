/**
 * @description 新增三水集团看板配置映射
 * @keyword-en add sanshui dashboard config mapping
 */

const { ObjectId } = require('mongodb');

module.exports = {
  async up(db) {
    const mappings = db.collection('dashboard_config_mappings');

    await mappings.updateOne(
      {
        dashboardCode: 'ai-commander',
        tenantId: '69a912dd3934b0f7363edcc9',
      },
      {
        $set: {
          filePath: 'config/dashboards/sanshui.dashboard.json',
          enabled: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    console.log('✓ 三水集团 dashboard config mapping added');
  },

  async down(db) {
    const mappings = db.collection('dashboard_config_mappings');
    await mappings.deleteOne({
      dashboardCode: 'ai-commander',
      tenantId: '69a912dd3934b0f7363edcc9',
    });
    console.log('✓ 三水集团 dashboard config mapping removed');
  },
};
