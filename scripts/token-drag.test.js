import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID_HEX_50FT, cellCenterPixels, tokenPixelBox } from '../src/lib/board.js';
import { getTokenDragPlacement } from '../src/lib/tokenDrag.js';

const squareBoard = { columns: 12, rows: 10, tileSize: 40 };
const token = { x: 2, y: 3, size: 1 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

test('preview stays centered on the exact pointer and moves smoothly inside one cell', () => {
  const first = getTokenDragPlacement(token, squareBoard, { px: 157.25, py: 203.75 });
  const next = getTokenDragPlacement(token, squareBoard, { px: 157.5, py: 204 });
  assert.deepEqual(first.previewBox, { left: 137.25, top: 183.75, width: 40, height: 40 });
  assert.deepEqual(first.drop, { x: 3, y: 5 });
  assert.equal(next.previewBox.left - first.previewBox.left, 0.25);
  assert.equal(next.previewBox.top - first.previewBox.top, 0.25);
  assert.deepEqual(next.drop, first.drop);
  assert.deepEqual(first.pixelDelta, { x: 57.25, y: 63.75 });
  // The same pointer produces the same preview regardless of a token's original grab point.
  const fromElsewhere = getTokenDragPlacement({ ...token, x: 8, y: 1 }, squareBoard, { px: 157.25, py: 203.75 });
  assert.deepEqual(fromElsewhere.previewBox, first.previewBox);
  assert.deepEqual(fromElsewhere.drop, first.drop);
});

test('square drops use the closest legal origin for odd and even footprints', () => {
  for (const [size, pointer, expected] of [
    [1, { px: 179, py: 219 }, { x: 4, y: 5 }],
    [2, { px: 179, py: 219 }, { x: 3, y: 4 }],
    [3, { px: 179, py: 219 }, { x: 3, y: 4 }],
  ]) {
    const result = getTokenDragPlacement({ ...token, size }, squareBoard, pointer);
    assert.deepEqual(result.drop, expected);
    close(result.previewBox.left + result.previewBox.width / 2, pointer.px);
    close(result.previewBox.top + result.previewBox.height / 2, pointer.py);
  }
});

test('rectangular vehicles center their rotated footprints and snap each axis', () => {
  for (const [rotation, width, height, expected] of [
    [0, 160, 80, { x: 3, y: 5 }],
    [90, 80, 160, { x: 4, y: 4 }],
    [180, 160, 80, { x: 3, y: 5 }],
    [270, 80, 160, { x: 4, y: 4 }],
  ]) {
    const result = getTokenDragPlacement({ ...token, tokenKind: 'vehicle', vehicle: { width: 4, height: 2, rotation } }, squareBoard, { px: 200, py: 240 });
    assert.deepEqual(result.previewBox, { left: 200 - width / 2, top: 240 - height / 2, width, height });
    assert.deepEqual(result.drop, expected);
  }
});

test('board edges clamp only the eventual drop while the preview remains under the cursor', () => {
  const largeToken = { ...token, size: 3 };
  const outsideTop = getTokenDragPlacement(largeToken, squareBoard, { px: -12.5, py: -8 });
  assert.deepEqual(outsideTop.drop, { x: 0, y: 0 });
  assert.deepEqual(outsideTop.previewBox, { left: -72.5, top: -68, width: 120, height: 120 });
  const outsideBottom = getTokenDragPlacement(largeToken, squareBoard, { px: 900, py: 900 });
  assert.deepEqual(outsideBottom.drop, { x: 9, y: 7 });
  assert.deepEqual(getTokenDragPlacement({ ...token, size: 20 }, squareBoard, { px: 900, py: 900 }).drop, { x: 0, y: 0 });
});

test('hex previews follow subcell movement and drops retain odd/even row centers', () => {
  const board = { ...squareBoard, grid: { mode: GRID_HEX_50FT } };
  for (const cell of [{ x: 4, y: 2 }, { x: 4, y: 3 }]) {
    const center = cellCenterPixels(cell, board);
    const pointer = { px: center.x + 2.25, py: center.y - 1.75 };
    const moving = { x: 1, y: 1, tokenKind: 'hex50' };
    const result = getTokenDragPlacement(moving, board, pointer);
    close(result.previewBox.left + result.previewBox.width / 2, pointer.px);
    close(result.previewBox.top + result.previewBox.height / 2, pointer.py);
    assert.deepEqual(result.drop, cell);
    const original = tokenPixelBox(moving, board);
    close(original.left + result.pixelDelta.x, result.previewBox.left);
    close(original.top + result.pixelDelta.y, result.previewBox.top);
  }
});

test('hex drops choose the adjacent nearest cell and stay legal beyond every board edge', () => {
  const board = { columns: 6, rows: 6, tileSize: 40, grid: { mode: GRID_HEX_50FT } };
  const moving = { x: 1, y: 1, tokenKind: 'hex50' };
  const oddCenter = cellCenterPixels({ x: 3, y: 3 }, board);
  assert.deepEqual(getTokenDragPlacement(moving, board, { px: oddCenter.x + 10, py: oddCenter.y + 2 }).drop, { x: 3, y: 3 });
  for (const [pointer, expected] of [
    [{ px: -1000, py: -1000 }, { x: 0, y: 0 }],
    [{ px: 1000, py: -1000 }, { x: 5, y: 0 }],
    [{ px: -1000, py: 1000 }, { x: 0, y: 5 }],
    [{ px: 1000, py: 1000 }, { x: 5, y: 5 }],
  ]) {
    const result = getTokenDragPlacement(moving, board, pointer);
    assert.deepEqual(result.drop, expected);
    assert.ok(Number.isInteger(result.drop.x) && Number.isInteger(result.drop.y));
    close(result.previewBox.left + result.previewBox.width / 2, pointer.px);
    close(result.previewBox.top + result.previewBox.height / 2, pointer.py);
  }
});

test('drag calculations never mutate token or board state or commit fractional coordinates', () => {
  const sourceToken = Object.freeze({ ...token, size: 2 });
  const board = Object.freeze({ ...squareBoard });
  for (let index = 0; index < 50; index += 1) {
    const result = getTokenDragPlacement(sourceToken, board, { px: index * 10.125, py: index * 8.75 });
    assert.ok(Number.isInteger(result.drop.x) && Number.isInteger(result.drop.y));
    assert.ok(result.drop.x >= 0 && result.drop.x <= 10);
    assert.ok(result.drop.y >= 0 && result.drop.y <= 8);
  }
  assert.deepEqual(sourceToken, { x: 2, y: 3, size: 2 });
  assert.deepEqual(board, squareBoard);
});
