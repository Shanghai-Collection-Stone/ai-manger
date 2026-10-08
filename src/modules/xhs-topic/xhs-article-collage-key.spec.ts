import { computeXhsCollageRenderKey } from './xhs-article-collage-key.js';
import type { XhsArticleCanvasCollage } from './entities/xhs-topic.entity.js';

// 与工作台 test/collage-render-key.test.cjs 使用同一组样例与期望值，任一侧改了算法都会在这里失配
const generated: XhsArticleCanvasCollage = {
  width: 640,
  height: 853,
  cells: [
    {
      src: 'https://cdn.example.com/a.jpg',
      imageId: 1,
      x: 0,
      y: 0,
      width: 640,
      height: 426,
      objectFit: 'cover',
    },
    {
      src: 'https://cdn.example.com/b.jpg',
      imageId: 2,
      x: 0,
      y: 426,
      width: 640,
      height: 427,
      objectFit: 'cover',
    },
  ],
};

describe('computeXhsCollageRenderKey', () => {
  it('matches the workbench implementation for a generated collage', () => {
    expect(computeXhsCollageRenderKey(generated)).toBe('c1-7552d59fd201d');
  });

  it('treats missing crop values the same as explicit defaults', () => {
    const explicit = {
      ...generated,
      cells: generated.cells.map((cell) => ({
        ...cell,
        focusX: 50,
        focusY: 50,
        zoom: 1,
      })),
    };
    expect(computeXhsCollageRenderKey(explicit)).toBe('c1-7552d59fd201d');
  });

  it('changes when a cell is re-cropped and ignores sub-0.01 float noise', () => {
    const edited = {
      ...generated,
      cells: [{ ...generated.cells[0], focusX: 37.28491 }, generated.cells[1]],
    };
    const rounded = {
      ...generated,
      cells: [{ ...generated.cells[0], focusX: 37.28 }, generated.cells[1]],
    };
    expect(computeXhsCollageRenderKey(edited)).toBe('c1-5c838fd4850d3');
    expect(computeXhsCollageRenderKey(rounded)).toBe('c1-5c838fd4850d3');
  });
});
