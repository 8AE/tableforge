import { test, expect } from '@playwright/test';
import { makeProject } from '../src/lib/board.js';

const shortNames = ['Kara', 'Brom', 'Goblin', 'Scout'];

function labelOf(page, name) {
  return page.getByRole('button', { name, exact: true }).locator('.token-label');
}

async function labelMetrics(locator) {
  return locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const token = node.closest('.map-token').getBoundingClientRect();
    const label = node.getBoundingClientRect();
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    return {
      text: node.textContent,
      lines,
      overflows: node.scrollWidth > node.clientWidth + 1,
      fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
      insideToken: label.left >= token.left - 1 && label.right <= token.right + 1 && label.top >= token.top - 1 && label.bottom <= token.bottom + 1,
    };
  });
}

test('standard token names stay on one line and long names ellipsize', async ({ page, request }) => {
  const project = makeProject('Label campaign');
  project.state.boards[0].tokens = [
    { id: 'kara', x: 1, y: 2, label: 'Kara', color: '#3ea7ff', layer: 'player', size: 1, visible: true },
    { id: 'brom', x: 3, y: 2, label: 'Brom', color: '#f2c94c', layer: 'player', size: 1, visible: true },
    { id: 'goblin', x: 5, y: 2, label: 'Goblin', color: '#df5d52', layer: 'player', size: 1, visible: true },
    { id: 'scout', x: 7, y: 2, label: 'Scout', color: '#36d399', layer: 'player', size: 1, visible: true },
    { id: 'owl', x: 10, y: 2, label: 'Owlbear', color: '#df5d52', layer: 'dm', size: 2, visible: true },
    { id: 'long', x: 14, y: 2, label: 'Ancient Red Dragon', color: '#c084fc', layer: 'player', size: 1, visible: true },
    { id: 'long-large', x: 16, y: 6, label: 'Ancient Red Dragon', color: '#a855f7', layer: 'player', size: 2, visible: true },
  ];
  expect((await request.post('/api/projects', { data: project })).status()).toBe(201);

  await page.goto('/');
  await page.getByRole('button', { name: 'Label campaign', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();

  for (const name of shortNames) {
    const metrics = await labelMetrics(labelOf(page, name));
    expect(metrics.text, name).toBe(name);
    expect(metrics.lines, name).toBe(1);
    expect(metrics.overflows, name).toBe(false);
    expect(metrics.insideToken, name).toBe(true);
  }

  const owlbear = await labelMetrics(labelOf(page, 'Owlbear'));
  const goblin = await labelMetrics(labelOf(page, 'Goblin'));
  expect(owlbear.lines).toBe(1);
  expect(owlbear.overflows).toBe(false);
  expect(owlbear.insideToken).toBe(true);
  expect(owlbear.fontSize).toBeGreaterThan(goblin.fontSize);

  const longLabels = page.locator('.token-label', { hasText: 'Ancient Red Dragon' });
  await expect(longLabels).toHaveCount(2);
  const longMetrics = await longLabels.evaluateAll((nodes) => nodes.map((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const token = node.closest('.map-token').getBoundingClientRect();
    const label = node.getBoundingClientRect();
    return {
      lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
      overflows: node.scrollWidth > node.clientWidth + 1,
      text: node.textContent,
      insideToken: label.left >= token.left - 1 && label.right <= token.right + 1,
      width: Math.round(token.width),
    };
  }));
  for (const metrics of longMetrics) {
    expect(metrics.text).toBe('Ancient Red Dragon');
    expect(metrics.lines).toBe(1);
    expect(metrics.overflows).toBe(true);
    expect(metrics.insideToken).toBe(true);
  }
  expect(longMetrics.map((metrics) => metrics.width).sort((a, b) => a - b)).toEqual([42, 84]);
});

test('player rotate buttons name the direction they turn', async ({ page, request }) => {
  const project = makeProject('Rotate campaign');
  expect((await request.post('/api/projects', { data: project })).status()).toBe(201);
  await page.goto('/?view=player');
  const left = page.getByRole('button', { name: 'Rotate board counter-clockwise', exact: true });
  const right = page.getByRole('button', { name: 'Rotate board clockwise', exact: true });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(left).toHaveText('Rotate left');
  await expect(right).toHaveText('Rotate right');
  await expect(page.getByRole('button', { name: 'Rotate', exact: true })).toHaveCount(0);

  const board = page.locator('.board');
  await expect(board).toHaveAttribute('style', /rotate\(0deg\)/);
  await right.click();
  await expect(board).toHaveAttribute('style', /rotate\(90deg\)/);
  await left.click();
  await expect(board).toHaveAttribute('style', /rotate\(0deg\)/);
});
