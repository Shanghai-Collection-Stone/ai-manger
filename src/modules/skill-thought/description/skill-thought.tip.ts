/**
 * @description Skill-Thought 模块提示文件：名称、用途、关键词与依赖映射。
 * @keyword skill-thought, module, tip
 * @since 2026-02-04
 */
export const moduleTip = {
  moduleName: 'Skill-Thought',
  purpose: '思维链的存储、检索与相似合并',
  description:
    '该模块基于MongoDB存储思维链（thought），支持向量Embedding相似度检索与阈值合并，并向函数调用层导出工具以便Agent在完成任务后沉淀可复用知识。',
  keywords: [
    'skill-thought',
    'thought',
    'memory',
    'embedding',
    'similarity',
    'merge',
    'retrieval',
    'mongo',
    'tools',
  ],
  dependencies: [
    '@nestjs/common',
    '@nestjs/config',
    'mongodb',
    'embedding module',
    'ai-agent module',
  ],
  lastUpdated: '2026-02-04',
  files: {
    '服务/Service':
      'src/modules/skill-thought/services/skill-thought.service.ts',
    '工具/Tools': 'src/modules/skill-thought/tools/skill-thought.tools.ts',
    '实体/Entity': 'src/modules/skill-thought/entities/skill-thought.entity.ts',
    '模块/Module': 'src/modules/skill-thought/skill-thought.module.ts',
  },
};
