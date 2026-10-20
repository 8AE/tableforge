import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { makeDungeonScrawlBoard, parseDungeonScrawl, readDungeonScrawlDocument } from '../src/lib/dungeonScrawl.js';
import { doorBounds, migrateState, pointLightPolygons, visionPolygonPoints } from '../src/lib/board.js';

const reference = fs.readFileSync(new URL('./fixtures/dungeon-scrawl-reference.ds', import.meta.url));
const source = () => JSON.parse(new TextDecoder().decode(unzipSync(reference).map));
const pageOf = (save) => save.state.document.nodes[save.state.document.nodes.document.children[0]];
const rectangle = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const fixture = () => ({ version: 1, state: { document: { documentNodeId: 'doc', nodes: {
  doc: { id: 'doc', type: 'DOCUMENT', children: ['page'] },
  page: { id: 'page', type: 'PAGE', name: 'Fixture', grid: { type: 'square', cellDiameter: 36 }, children: ['shape'] },
  shape: { id: 'shape', type: 'GEOMETRY', geometryId: 'geo', children: ['floor', 'walls'] },
  floor: { id: 'floor', type: 'MULTIPOLYGON', fill: { visible: true, colour: { colour: 0xf0ece0 } } },
  walls: { id: 'walls', type: 'MULTIPOLYGON', stroke: { visible: true, width: 5 } },
} } }, data: { geometry: { geo: { polygons: [[rectangle(0, 0, 360, 288)]], polylines: [] } }, assets: {} } });

test('decodes the actual reference .ds, including grid scale, exact wall outline and open doorway', () => {
  const [map] = parseDungeonScrawl(reference, 'dungeon.ds').maps;
  assert.equal(map.walls.length, 16);
  assert.equal(map.columns, 21);
  assert.equal(map.rows, 10);
  assert.equal(map.cell, 36);
  assert.deepEqual(map.origin, [432, 108]);
  assert.equal(map.lights.length, 0);
  assert.equal(map.doors.length, 0); // An opening is not an invented closed door.
  assert.match(map.svg, /#f0ece0/);
  assert.match(map.svg, /pattern/);
  const board = makeDungeonScrawlBoard(map, '/map.png');
  const ray = (y) => visionPolygonPoints({ x: 8.5, y: y - 0.5 }, board.lighting.walls, 1, 100, board).split(' ')[0].split(',').map(Number);
  assert.ok(Math.abs(ray(3.5)[0] - 18.99972) < 0.001, 'light crosses the doorway and hallway');
  assert.ok(Math.abs(ray(5.5)[0] - 9.99972) < 0.001, 'solid room wall stops the same ray');
});

test('reads stored and deflated ZIPs and the current JSON envelope', () => {
  const json = strToU8(JSON.stringify(source()));
  for (const input of [json, zipSync({ map: json }, { level: 9 }), zipSync({ map: json, '../ignored': strToU8('ignored') })]) {
    assert.equal(parseDungeonScrawl(input).maps[0].walls.length, 16);
  }
});

test('rings, holes and open polylines block light without joining disconnected endpoints', () => {
  const save = fixture();
  save.data.geometry.geo.polygons[0].push(rectangle(72, 72, 72, 72));
  save.data.geometry.geo.polylines.push([[36, 36], [72, 36], [72, 54]]);
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.equal(map.walls.length, 10);
  assert.match(map.svg, /fill-rule="evenodd"/);
  const duplicate = structuredClone(save);
  duplicate.data.geometry.geo.polylines.push([[72, 36], [36, 36]]);
  assert.equal(readDungeonScrawlDocument(duplicate).maps[0].walls.length, 10);
});

test('honours hidden ancestors and light-pass geometry; preserves negative coordinates and group transforms', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  nodes.group = { id: 'group', type: 'ASSET_GROUP', transform: [0, 1, -1, 0, -36, 72], children: ['shape'] };
  nodes.page.children = ['group'];
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.deepEqual(map.origin, [-360, 36]);
  assert.deepEqual(map.walls[0].start, { x: 9, y: 1 });
  assert.deepEqual(map.walls[0].end, { x: 9, y: 11 });
  nodes.shape.allowsLightToPass = true;
  assert.equal(readDungeonScrawlDocument(save).maps[0].walls.length, 0);
  nodes.hidden = { id: 'hidden', type: 'FOLDER', visible: false, children: ['does-not-exist'] };
  nodes.page.children.push('hidden');
  assert.equal(readDungeonScrawlDocument(save).maps[0].walls.length, 0);
});

test('converts transformed doors into interactive segments and stairs into decoration', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  nodes.page.children.push('door', 'stairs');
  nodes.door = { id: 'door', type: 'DUNGEON_ASSET', kind: 'door', transform: [0, 1, -1, 0, 144, 72], children: ['door-geo'] };
  nodes['door-geo'] = { id: 'door-geo', type: 'GEOMETRY', geometryId: 'door-geometry', children: [] };
  save.data.geometry['door-geometry'] = { polygons: [[rectangle(0, -3, 36, 6)]], polylines: [] };
  nodes.stairs = { id: 'stairs', type: 'DUNGEON_ASSET', name: 'Stairs 1', children: ['stairs-geo'] };
  nodes['stairs-geo'] = { id: 'stairs-geo', type: 'GEOMETRY', geometryId: 'stairs-geometry', children: [] };
  save.data.geometry['stairs-geometry'] = { polygons: [], polylines: [[[0, 0], [36, 0]], [[0, 5], [36, 5]]] };
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.equal(map.walls.length, 4);
  assert.equal(map.doors.length, 1);
  assert.deepEqual(map.doors[0].lightingSegment, [[5, 3], [5, 4]]);
  assert.equal(map.doors[0].rotation, 90);
  const board = makeDungeonScrawlBoard(map, '/map.png');
  assert.equal(board.doors[0].source, 'dungeon-scrawl');
  assert.deepEqual(doorBounds(board.doors[0]), { x: 4.75, y: 2.75, w: 0.5, h: 1.5 });
});

test('embeds image data and escapes text, keeping group and asset transforms', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  save.data.assets.art = { data: png, asset: { dimensions: [1, 1], scale: [36, 36] } };
  nodes.page.children.push('asset', 'label');
  nodes.asset = { id: 'asset', type: 'ASSET', assetId: 'art', transform: [1, 0, 0, 1, 72, 72] };
  nodes.label = { id: 'label', type: 'TEXT', content: '<script>alert("x")</script>', style: { fontFamily: '" onload="bad', fontSize: 16 } };
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.equal(map.imageCount, 1);
  assert.ok(map.svg.includes(png));
  assert.match(map.svg, /scale\(36 36\)/);
  assert.ok(!map.svg.includes('<script>'));
  assert.ok(!map.svg.includes(' onload="bad'));
  save.data.assets.art.data = 'https://example.test/image.png';
  assert.throws(() => readDungeonScrawlDocument(save), /not an embedded/);
});

test('preserves real radial lights with colour, radius and coordinates through save migration', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  nodes.page.children.push('light');
  nodes.light = { id: 'light', type: 'LIGHT', variant: 'radial', transform: [1, 0, 0, 1, 72, 108], config: { radial: { radius: 6, brightRadius: 2, strength: 0.8 }, shared: { colour: { colour: 0xff0000, alpha: 1 } } } };
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.deepEqual({ ...map.lights[0] }, { x: 3, y: 4, radiusFeet: 30, brightFeet: 10, intensity: 0.8, color: '#ff0000', name: 'Imported light', visible: true });
  const board = makeDungeonScrawlBoard(map, '/assets/map.png');
  const migrated = migrateState(JSON.parse(JSON.stringify({ boards: [board], activeBoardId: board.id })));
  assert.deepEqual(migrated.boards[0].lighting.lights, board.lighting.lights);
  assert.equal(board.tokens.length, 0);
  assert.equal(board.drawings.length, 0);
  assert.equal(board.grid.visibleToPlayers, false);
  assert.equal(board.lighting.enabled, true);
  assert.equal(makeDungeonScrawlBoard(map, 'map', { lightingEnabled: false }).lighting.enabled, false);
});

test('point lights use their exact centre, stop at walls and ignore disabled sources', () => {
  const light = { id: 'torch', x: 1.25, y: 2, radiusFeet: 30, brightFeet: 10 };
  const wall = { start: { x: 3, y: -10 }, end: { x: 3, y: 10 }, freeform: true };
  const [dim, bright] = pointLightPolygons([light], [wall], 42);
  assert.equal(dim.points.split(' ')[0], '126,84');
  assert.equal(bright.points.split(' ')[0], '126,84');
  assert.equal(pointLightPolygons([{ ...light, visible: false }, { ...light, intensity: 0 }], [], 42).length, 0);
  const open = pointLightPolygons([light], [], 42)[0].points.split(' ')[0].split(',').map(Number);
  assert.equal(open[0], (1.25 + 6) * 42);
});

test('isolates pages and reports unavailable maps without silently rendering the wrong one', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  nodes.doc.children.push('other');
  nodes.other = { ...nodes.page, id: 'other', name: 'Hex map', grid: { type: 'hex', cellDiameter: 36 } };
  const maps = readDungeonScrawlDocument(save).maps;
  assert.equal(maps[0].walls.length, 4);
  assert.match(maps[1].error, /square grid/);
});

test('empty styled layers do not spoil the artwork on an otherwise valid map', () => {
  const save = fixture(), nodes = save.state.document.nodes;
  nodes.page.children.push('empty');
  nodes.empty = { id: 'empty', type: 'GEOMETRY', geometryId: 'empty-geometry', children: ['hatch'] };
  nodes.hatch = { id: 'hatch', type: 'HATCHING' };
  save.data.geometry['empty-geometry'] = { polygons: [], polylines: [] };
  const map = readDungeonScrawlDocument(save).maps[0];
  assert.equal(map.walls.length, 4);
  assert.doesNotMatch(map.svg, /Infinity|NaN/);
});

test('rejects damaged, legacy, oversized, cyclic and malformed saves without mutating source data', () => {
  assert.throws(() => parseDungeonScrawl(new Uint8Array()), /empty/);
  assert.throws(() => parseDungeonScrawl(strToU8('hello')), /valid map JSON/);
  assert.throws(() => parseDungeonScrawl(zipSync({ nope: strToU8('{}') })), /does not contain a map/);
  assert.throws(() => readDungeonScrawlDocument({ version: 2 }), /Unsupported/);
  const bad = fixture();
  bad.data.geometry.geo.polygons[0][0][0] = [NaN, 0];
  assert.throws(() => readDungeonScrawlDocument(bad), /invalid geometry/);
  const big = fixture();
  big.data.geometry.geo.polygons = [[rectangle(0, 0, 9000, 36)]];
  assert.throws(() => readDungeonScrawlDocument(big), /200 × 200/);
  const cyclic = fixture();
  cyclic.state.document.nodes.shape.children.push('shape');
  assert.throws(() => readDungeonScrawlDocument(cyclic), /circular/);
  const save = source(), before = JSON.stringify(save);
  readDungeonScrawlDocument(save);
  assert.equal(JSON.stringify(save), before);
});
