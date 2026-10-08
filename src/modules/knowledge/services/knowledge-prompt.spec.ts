import { buildKnowledgePromptBlock } from './knowledge-prompt';

/**
 * @description 引用知识提示词拼接回归测试：空知识不输出、按顺序列出、超预算截断。
 * @keyword-cn 引用知识提示词测试
 * @keyword-en knowledge-prompt-test
 */
describe('buildKnowledgePromptBlock', () => {
  it('没有可用知识时返回空串', () => {
    expect(buildKnowledgePromptBlock([])).toBe('');
    expect(buildKnowledgePromptBlock([{ name: ' ', content: '内容' }])).toBe(
      '',
    );
  });

  it('按顺序列出名称与内容，并包在 reference_knowledge 标签里', () => {
    const block = buildKnowledgePromptBlock([
      { name: '门店信息', content: '集合石上海店在静安区' },
      { name: '价格', content: '周末套餐 199 元' },
    ]);
    expect(block).toContain('<reference_knowledge>');
    expect(block.indexOf('【门店信息】')).toBeLessThan(
      block.indexOf('【价格】'),
    );
    expect(block).toContain('周末套餐 199 元');
  });

  it('超出预算时截断后面的内容', () => {
    const block = buildKnowledgePromptBlock(
      [
        { name: 'A', content: 'x'.repeat(80) },
        { name: 'B', content: 'y'.repeat(80) },
      ],
      120,
    );
    expect(block).toContain('【A】');
    expect(block).toContain('…');
    expect(block).not.toContain('y'.repeat(80));
  });
});
