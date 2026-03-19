/**
 * @description 看板配置验证脚本
 * @keyword-en dashboard config validation script
 */

import fs from 'fs';
import path from 'path';

const DASHBOARD_CONFIG_DIR = path.join(process.cwd(), 'config', 'dashboards');

/**
 * 验证单个配置文件
 */
function validateDashboardConfig(filePath) {
  const errors = [];
  const warnings = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    let config;

    try {
      config = JSON.parse(content);
    } catch (e) {
      errors.push(`❌ JSON 解析失败: ${e.message}`);
      return { errors, warnings };
    }

    // 验证顶层字段
    if (!config.dashboardCode) {
      errors.push('❌ 缺少必需字段: dashboardCode');
    } else if (typeof config.dashboardCode !== 'string') {
      errors.push('❌ dashboardCode 必须是字符串');
    }

    if (!config.version) {
      errors.push('❌ 缺少必需字段: version');
    } else if (!Number.isInteger(config.version)) {
      errors.push('❌ version 必须是整数');
    }

    if (!config.title) {
      errors.push('❌ 缺少必需字段: title');
    } else if (typeof config.title !== 'string') {
      errors.push('❌ title 必须是字符串');
    }

    if (!Array.isArray(config.tabs)) {
      errors.push('❌ tabs 必须是数组');
      return { errors, warnings };
    }

    if (config.tabs.length === 0) {
      warnings.push('⚠️  tabs 为空数组');
    }

    // 验证每个 Tab
    config.tabs.forEach((tab, tabIdx) => {
      if (!tab.id) {
        errors.push(`❌ Tab #${tabIdx}: 缺少 id`);
      } else if (typeof tab.id !== 'string') {
        errors.push(`❌ Tab #${tabIdx}: id 必须是字符串`);
      }

      if (!tab.label) {
        errors.push(`❌ Tab #${tabIdx}: 缺少 label`);
      } else if (typeof tab.label !== 'string') {
        errors.push(`❌ Tab #${tabIdx}: label 必须是字符串`);
      }

      // 验证 layout
      if (tab.layout) {
        if (tab.layout.cols && (!Number.isInteger(tab.layout.cols) || tab.layout.cols < 1 || tab.layout.cols > 6)) {
          errors.push(`❌ Tab "${tab.id}": cols 必须是 1-6 之间的整数`);
        }
        if (tab.layout.gap && (!Number.isInteger(tab.layout.gap) || tab.layout.gap < 0 || tab.layout.gap > 48)) {
          errors.push(`❌ Tab "${tab.id}": gap 必须是 0-48 之间的整数`);
        }
      }

      // 验证 blocks
      if (!Array.isArray(tab.blocks)) {
        warnings.push(`⚠️  Tab "${tab.id}": blocks 不是数组或缺失`);
        return;
      }

      tab.blocks.forEach((block, blockIdx) => {
        if (!block.id) {
          errors.push(`❌ Tab "${tab.id}" Block #${blockIdx}: 缺少 id`);
        } else if (typeof block.id !== 'string') {
          errors.push(`❌ Tab "${tab.id}" Block "${block.id}": id 必须是字符串`);
        }

        if (!block.type) {
          errors.push(`❌ Tab "${tab.id}" Block #${blockIdx}: 缺少 type`);
        } else if (typeof block.type !== 'string') {
          errors.push(`❌ Tab "${tab.id}" Block #${blockIdx}: type 必须是字符串`);
        }

        // 验证 layout
        if (block.layout) {
          if (block.layout.colSpan && (!Number.isInteger(block.layout.colSpan) || block.layout.colSpan < 1 || block.layout.colSpan > 6)) {
            errors.push(`❌ Block "${block.id}": colSpan 必须是 1-6 之间的整数`);
          }
          if (block.layout.rowSpan && (!Number.isInteger(block.layout.rowSpan) || block.layout.rowSpan < 1 || block.layout.rowSpan > 20)) {
            errors.push(`❌ Block "${block.id}": rowSpan 必须是 1-20 之间的整数`);
          }
        }

        // 验证 query（可选）
        if (block.query && typeof block.query !== 'string') {
          errors.push(`❌ Block "${block.id}": query 必须是字符串`);
        }
      });
    });

    return { errors, warnings };
  } catch (e) {
    errors.push(`❌ 文件读取失败: ${e.message}`);
    return { errors, warnings };
  }
}

/**
 * 验证所有配置文件
 */
function validateAllConfigs() {
  console.log('🔍 开始验证看板配置文件...\n');

  if (!fs.existsSync(DASHBOARD_CONFIG_DIR)) {
    console.log(`❌ 配置目录不存在: ${DASHBOARD_CONFIG_DIR}`);
    return;
  }

  const files = fs.readdirSync(DASHBOARD_CONFIG_DIR).filter((f) => f.endsWith('.json'));

  if (files.length === 0) {
    console.log(`⚠️  未找到任何 .json 配置文件`);
    return;
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  files.forEach((file) => {
    const filePath = path.join(DASHBOARD_CONFIG_DIR, file);
    const { errors, warnings } = validateDashboardConfig(filePath);

    console.log(`📄 ${file}`);
    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ 通过验证\n');
    } else {
      if (errors.length > 0) {
        errors.forEach((err) => console.log(`  ${err}`));
        totalErrors += errors.length;
      }
      if (warnings.length > 0) {
        warnings.forEach((warn) => console.log(`  ${warn}`));
        totalWarnings += warnings.length;
      }
      console.log('');
    }
  });

  // 总结
  console.log('━'.repeat(50));
  console.log(`总文件数: ${files.length}`);
  console.log(`❌ 错误: ${totalErrors}`);
  console.log(`⚠️  警告: ${totalWarnings}`);

  if (totalErrors === 0) {
    console.log('✅ 所有配置文件验证通过！');
  } else {
    console.log('\n请修复上述错误后重试。');
    process.exit(1);
  }
}

// 运行验证
validateAllConfigs();
