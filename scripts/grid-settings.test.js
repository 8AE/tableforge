import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultGridAppearance,
  GRID_HEX_50FT,
  GRID_SQUARE_5FT,
  makeBoard,
  makeProject,
  migrateState,
  normalizeBoard,
  normalizeGrid,
} from '../src/lib/board.js';

test('new boards and legacy boards receive visible, backwards-compatible grid defaults', () => {
  const square = { mode: GRID_SQUARE_5FT, shape: 'square', feetPerCell: 5, orientation: 'orthogonal', ...defaultGridAppearance };
  assert.deepEqual(makeBoard().grid, square);
  assert.deepEqual(makeProject().state.boards[0].grid, square);
  assert.deepEqual(normalizeBoard({}).grid, square);
  const legacy = migrateState({ board: { gridMode: GRID_HEX_50FT }, tokens: [], drawings: [] });
  assert.deepEqual(legacy.boards[0].grid, { ...square, mode: GRID_HEX_50FT, shape: 'hex', feetPerCell: 50, orientation: 'pointy-top' });
});

test('invalid appearance is normalized to safe colors, finite thickness and booleans', () => {
  for (const grid of [null, 'invalid', { mode: 'constructor' }, { mode: '__proto__' }]) {
    assert.deepEqual(normalizeGrid(grid), normalizeGrid());
  }
  assert.equal(normalizeGrid({ color: ' #aBc ' }).color, '#aabbcc');
  assert.equal(normalizeGrid({ color: '#ABCDEF' }).color, '#abcdef');
  for (const color of ['red', '#12345', '#12345678', 'url(https://example.org)', {}, null]) {
    assert.equal(normalizeGrid({ color }).color, defaultGridAppearance.color);
  }
  for (const thickness of [undefined, null, '', ' ', 'bad', NaN, Infinity, -Infinity, true, {}]) {
    assert.equal(normalizeGrid({ thickness }).thickness, 1);
  }
  assert.equal(normalizeGrid({ thickness: -5 }).thickness, 0.5);
  assert.equal(normalizeGrid({ thickness: 50 }).thickness, 4);
  assert.equal(normalizeGrid({ thickness: '2.25' }).thickness, 2.25);
  assert.equal(normalizeGrid({ visibleToDm: 'false', visibleToPlayers: 0 }).visibleToDm, true);
  assert.equal(normalizeGrid({ visibleToDm: 'false', visibleToPlayers: 0 }).visibleToPlayers, true);
});

test('board normalization and storage migration preserve appearance through JSON roundtrips', () => {
  const grid = normalizeGrid({ mode: GRID_HEX_50FT, visibleToDm: false, visibleToPlayers: false, color: '#336699', thickness: 3.5 });
  const board = { ...makeBoard(), grid };
  assert.deepEqual(normalizeBoard(board).grid, grid);
  const state = JSON.parse(JSON.stringify({ boards: [board], activeBoardId: board.id }));
  const migrated = migrateState(state);
  assert.deepEqual(migrated.boards[0].grid, grid);
  assert.deepEqual(migrateState(JSON.parse(JSON.stringify(migrated))).boards[0].grid, grid);
  assert.deepEqual(normalizeGrid({ ...grid, mode: GRID_SQUARE_5FT }), {
    ...grid, mode: GRID_SQUARE_5FT, shape: 'square', feetPerCell: 5, orientation: 'orthogonal',
  });
  const playerOnly = normalizeGrid({ ...grid, visibleToPlayers: true });
  assert.equal(playerOnly.visibleToDm, false);
  assert.equal(playerOnly.visibleToPlayers, true);
  const dmOnly = normalizeGrid({ ...grid, visibleToDm: true });
  assert.equal(dmOnly.visibleToDm, true);
  assert.equal(dmOnly.visibleToPlayers, false);
});
