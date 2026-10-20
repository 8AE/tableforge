import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { parseInkarnate, readInkarnateDocument, replayInkarnateHistory, prepareInkarnateMap, makeInkarnateBoard } from '../src/lib/inkarnate.js';
import { cutInkarnatePortals, flattenInkarnatePath } from '../src/lib/inkarnateGeometry.js';
import { migrateState, pointLightPolygons } from '../src/lib/board.js';

const reference = fs.readFileSync(new URL('./fixtures/inkarnate-reference.ink', import.meta.url));
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const add = (...entities) => ({ cmdType: 'cmd-entity-add', items: entities.map((entity) => ({ layerId: 'objects', entity })) });
const stamp = (id, name, x = 1500, y = 1500) => ({ entityId: id, entityType: 'stamp', name, x, y, scale: 1 });
const path = (id, options = {}) => ({ entityId: id, entityType: 'path-v2', x: 0, y: 2000, paths: 'M0 0L4000 0', wallEnabled: true, blockLights: true, ...options });
const backup = (commands = []) => ({ version: 3, title: 'Test Map', scene: { majorVersion: 3, normSceneSize: { w: 4000, h: 4000 } }, preview: pixel, previewDimensions: { w: 1, h: 1 }, history: [
  { cmdType: 'cmd-layer-add', layerId: 'objects', layerData: { isVisible: true, opacity: 1 } },
  add({ entityType: 'grid', entityId: 1, style: { kind: 'square', size: 1000, offset: { x: 0, y: 0 } } }), ...commands,
] });
const mapFrom = (commands, options) => prepareInkarnateMap(readInkarnateDocument(backup(commands)), options);

test('actual Inkarnate reference preserves the exact PNG, 40×30 grid and all 17 tree centres', () => {
  const source = JSON.parse(strFromU8(gunzipSync(reference)));
  const parsed = parseInkarnate(reference, 'Forest.ink');
  const map = prepareInkarnateMap(parsed);
  assert.deepEqual([map.columns, map.rows, map.imageWidth, map.imageHeight], [40, 30, 2048, 1536]);
  assert.equal(map.image, source.preview);
  assert.equal(map.objectCount, 17);
  assert.equal(map.estimates.length, 17);
  assert.equal(map.walls.length, 136);
  assert.equal(map.lights.length, 0);
  for (const estimate of map.estimates) {
    const original = source.history.flatMap((cmd) => cmd.items || []).find((item) => item.entity.entityId === estimate.id).entity;
    assert.ok(Math.abs(estimate.x - original.x / 204.8) < 1e-6);
    assert.ok(Math.abs(estimate.y - original.y / 204.8) < 1e-6);
    assert.equal(estimate.radius, 0.18);
  }
  assert.equal(prepareInkarnateMap(parsed, { estimateObjects: false }).walls.length, 0);
});

test('reads gzip and JSON backups and rejects damaged gzip checksums/truncation', () => {
  const bytes = strToU8(JSON.stringify(backup()));
  assert.equal(parseInkarnate(bytes).name, 'Test Map');
  const compressed = gzipSync(bytes);
  assert.equal(parseInkarnate(compressed).name, 'Test Map');
  const corrupt = compressed.slice(); corrupt[corrupt.length - 8] ^= 255;
  assert.throws(() => parseInkarnate(corrupt), /damaged/);
  assert.throws(() => parseInkarnate(compressed.subarray(0, compressed.length - 4)), /damaged/);
  assert.throws(() => parseInkarnate(strToU8('not json')), /valid Inkarnate/);
  assert.throws(() => parseInkarnate(new Uint8Array()), /empty/);
});

test('replays edits, removals, composite commands and hidden layers before deriving geometry', () => {
  const map = mapFrom([
    add(stamp(2, 'Tree'), stamp(3, 'Tree'), stamp(4, 'Torch')),
    { cmdType: 'cmd-composite', cmds: [
      { cmdType: 'cmd-entity-update', items: [{ entityId: 2, update: { x: 3000 } }, { entityId: 4, update: { isVisible: false } }] },
      { cmdType: 'cmd-entity-remove', entityIds: [3] },
    ] },
  ]);
  assert.equal(map.estimates.length, 1); assert.equal(map.estimates[0].x, 3); assert.equal(map.lights.length, 0);
  assert.equal(mapFrom([add(stamp(2, 'Tree')), { cmdType: 'cmd-layer-update-visibility', layerId: 'objects', isVisible: false }]).estimates.length, 0);
  assert.equal(mapFrom([add(stamp(2, 'Tree')), { cmdType: 'cmd-entity-flatten', entityIds: [2] }]).estimates.length, 0);
});

test('imports saved wall paths with scaled doorway gaps and light-pass flags', () => {
  const map = mapFrom([add(path(2, { portals: [{ anchor: { x: 2000, y: 0 }, width: 1000 }] }), path(3, { blockLights: false }), path(4, { wallEnabled: false }))], { estimateObjects: false });
  assert.deepEqual(map.walls.map(({ start, end }) => [start, end]), [[{ x: 0, y: 2 }, { x: 1.5, y: 2 }], [{ x: 2.5, y: 2 }, { x: 4, y: 2 }]]);
  const rotated = mapFrom([add(path(2, { paths: 'M0 0L1000 0', x: 2000, y: 0, angle: 90, scale: 2 }))]);
  assert.deepEqual(rotated.walls[0].end, { x: 2, y: 2 });
});

test('curves, arcs, holes and disconnected paths stay separate; corner portal gaps wrap', () => {
  const paths = flattenInkarnatePath('M0 0h100v100h-100z M25 25L25 75L75 75L75 25Z M200 0q50 100 100 0t100 0 M500 0a50 50 0 0 1 100 0', 0.1);
  assert.equal(paths.length, 4);
  assert.equal(paths[0].closed, true); assert.equal(paths[2].closed, false);
  assert.ok(paths[2].points.length > 5); assert.ok(paths[3].points.length > 5);
  const cut = cutInkarnatePortals([paths[0]], [{ anchor: ['Point', 0, 0], width: 20 }]);
  assert.deepEqual(cut[0][0], { x: 10, y: 0 });
  assert.deepEqual(cut.at(-1)[1], { x: 0, y: 10 });
  assert.throws(() => flattenInkarnatePath('M hello'), /invalid SVG/);
});

test('saved flips are baked into paths; later flip commands mirror once', () => {
  const first = path(2, { paths: 'M0 0L1000 0', x: 2000, y: 2000, flipX: true });
  assert.equal(mapFrom([add(first)]).walls[0].end.x, 3);
  assert.equal(mapFrom([add(first), { cmdType: 'cmd-entity-update', items: [{ entityId: 2, update: { flipX: false } }] }]).walls[0].end.x, 1);
});

test('group movement and explicit-pivot rotation update world positions once; group visibility survives ungroup', () => {
  const history = [add(stamp(2, 'Tree', 1000, 1000), stamp(3, 'Torch', 3000, 1000)),
    { cmdType: 'cmd-entity-group', groupId: 4, entityIds: [2, 3] },
    { cmdType: 'cmd-entity-update', items: [{ entityId: 4, update: { x: 2000, y: 2000 } }] },
    { cmdType: 'cmd-entity-update', items: [{ entityId: 4, update: { angle: 90, oX: 2000, oY: 2000 } }] },
  ];
  const map = mapFrom(history);
  assert.deepEqual([map.estimates[0].x, map.estimates[0].y, map.lights[0].x, map.lights[0].y], [2, 1, 2, 3]);
  const hidden = [...history, { cmdType: 'cmd-entity-update', items: [{ entityId: 4, update: { isVisible: false } }] }];
  assert.equal(mapFrom(hidden).estimates.length, 0);
  assert.equal(mapFrom([...hidden, { cmdType: 'cmd-entity-ungroup', entityIds: [4] }]).estimates.length, 1);
});

test('estimates only recognizable visible stamps and lets users disable all estimates', () => {
  const commands = [add(stamp(2, 'Tree'), stamp(3, 'Rock'), stamp(4, 'Torch'), stamp(5, 'Unlit lantern'), stamp(6, 'Campfire'), stamp(7, 'Table'), stamp(8, 'Door'))];
  const map = mapFrom(commands);
  assert.equal(map.estimates.length, 2); assert.equal(map.lights.length, 2);
  assert.deepEqual(map.lights.map((l) => l.radiusFeet), [30, 40]);
  assert.ok(map.warnings.some((w) => w.includes('collision geometry')));
  const noEstimates = mapFrom(commands, { estimateObjects: false });
  assert.equal(noEstimates.walls.length, 0); assert.equal(noEstimates.lights.length, 0);
});

test('grid offsets pad artwork and walls together without stretching; overrides are validated', () => {
  const parsed = readInkarnateDocument(backup([add(path(2)), { cmdType: 'cmd-entity-update', items: [{ entityId: 1, update: { style: { offset: { x: 200, y: 300 } } } }] }]));
  const map = prepareInkarnateMap(parsed);
  assert.deepEqual([map.columns, map.rows, map.origin.x, map.origin.y], [5, 5, 800, 700]);
  assert.equal(map.imageRect.x, 0.8); assert.equal(map.walls[0].start.x, 0.8);
  assert.deepEqual(prepareInkarnateMap(parsed, { cellsAcross: 8 }).origin, { x: 0, y: 0 });
  assert.throws(() => prepareInkarnateMap(parsed, { cellsAcross: 3 }), /whole number/);
  assert.throws(() => prepareInkarnateMap(parsed, { cellsAcross: 4.5 }), /whole number/);
  assert.throws(() => prepareInkarnateMap(parsed, { cellsAcross: 201 }), /whole number/);
});

test('off-canvas paths are clipped and renamed stamps retain their asset classification', () => {
  const map = mapFrom([add(
    path(2, { paths: 'M-2000 0L6000 0' }),
    path(3, { paths: 'M-2000 -3000L6000 -3000' }),
    { ...stamp(4, 'Entrance'), defaultName: 'Torch' },
    { ...stamp(5, 'Unlit hearth'), defaultName: 'Fireplace' },
    stamp(6, 'Fire'),
    { ...stamp(7, 'Old oak'), defaultName: 'Tree' },
  )]);
  const saved = map.walls.filter((wall) => !wall.estimated);
  assert.deepEqual(saved.map(({ start, end }) => [start, end]), [[{ x: 0, y: 2 }, { x: 4, y: 2 }]]);
  assert.deepEqual(map.lights.map((light) => [light.name, light.radiusFeet]), [['Entrance', 30], ['Fire', 40]]);
  assert.equal(map.estimates.length, 1);
});

test('board migration preserves geometry and estimate provenance; lights are occluded by imported walls', () => {
  const map = mapFrom([add(path(2), stamp(3, 'Torch', 2000, 1000))]);
  const board = makeInkarnateBoard(map, '/background.png');
  const migrated = migrateState({ boards: [board], activeBoardId: board.id, playerBoardId: board.id }).boards[0];
  assert.equal(migrated.importMetadata.source, 'inkarnate'); assert.equal(migrated.lighting.lights[0].estimated, true);
  assert.equal(migrated.lighting.walls[0].source, 'inkarnate'); assert.equal(migrated.grid.visibleToPlayers, false);
  const polygons = pointLightPolygons(migrated.lighting.lights, migrated.lighting.walls, 42, migrated);
  const downwardRay = (poly) => poly.points.split(' ').map((pair) => pair.split(',').map(Number)).find(([x, y]) => Math.abs(x - 84) < 0.001 && y > 42);
  assert.equal(downwardRay(polygons[0])[1], 84);
  assert.equal(downwardRay(pointLightPolygons(migrated.lighting.lights, [], 42, migrated)[0])[1], 294);
});

test('rejects old formats, external previews, excessive images, malformed/cyclic objects and prototype fields', () => {
  assert.throws(() => readInkarnateDocument({ ...backup(), version: 2 }), /Unsupported/);
  assert.throws(() => readInkarnateDocument({ ...backup(), preview: 'https://example.com/map.png' }), /embedded PNG/);
  assert.throws(() => readInkarnateDocument({ ...backup(), previewDimensions: { w: 5000, h: 5000 } }), /inconsistent/);
  assert.throws(() => readInkarnateDocument(backup([add(stamp(2, 'Tree', Infinity))])), /invalid position/);
  assert.throws(() => replayInkarnateHistory([add({ entityId: 2, entityType: 'group', groupId: 2 })]), /circular/);
  assert.throws(() => replayInkarnateHistory([add(JSON.parse('{"entityId":2,"__proto__":{"polluted":true}}'))]), /invalid object fields/);
  assert.equal({}.polluted, undefined);
});
