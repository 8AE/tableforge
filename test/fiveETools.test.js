import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenFiveEToolsMapData,
  getFiveEToolsMapBoardDimensions,
  getFiveEToolsMapBooks,
  getFiveEToolsMapRegionWalls,
  makeFiveEToolsMapBoard,
} from '../src/lib/fiveETools.js';

const mapCatalog = {
  RoT: {
    id: 'RoT',
    name: 'Rise of Tiamat',
    source: 'RoT',
    prop: 'adventure',
    chapters: [
      {
        name: 'The Cult Strikes Back',
        ix: 1,
        images: [
          {
            id: 'dm-map',
            imageType: 'map',
            title: 'Dragon Hatchery',
            href: { type: 'internal', path: 'adventure/RoT/Dragon Hatchery.webp' },
            width: 1000,
            height: 800,
            grid: { type: 'square', size: 100 },
            mapRegions: [
              { area: '1', points: [[0, 0], [1000, 0], [1000, 800], [0, 800]] },
            ],
          },
          {
            imageType: 'mapPlayer',
            title: 'Player Version',
            href: { type: 'internal', path: 'adventure/RoT/Dragon Hatchery Player.webp' },
            width: 500,
            height: 400,
            grid: { type: 'square', size: 50 },
            mapParent: { id: 'dm-map' },
          },
        ],
      },
    ],
  },
};

test('groups campaign books and keeps DM and player maps selectable', () => {
  const books = getFiveEToolsMapBooks(mapCatalog, 'https://example.test/5etools');
  assert.equal(books.length, 1);
  assert.equal(books[0].name, 'Rise of Tiamat');
  assert.equal(books[0].maps.length, 2);
  assert.deepEqual(books[0].maps.map((map) => map.imageType), ['map', 'mapPlayer']);
  assert.equal(books[0].maps[1].displayTitle, 'Dragon Hatchery (Player)');
  assert.equal(books[0].maps[1].mapRegions.length, 1);
  assert.equal(books[0].maps[0].imageUrl, 'https://example.test/5etools/img/adventure/RoT/Dragon%20Hatchery.webp');
});

test('flattens maps into searchable campaign and chapter records', () => {
  const maps = flattenFiveEToolsMapData(mapCatalog, 'https://5e.tools/');
  assert.equal(maps.length, 2);
  assert.ok(maps.every((map) => map.searchText.includes('rise of tiamat')));
  assert.ok(maps.every((map) => map.searchText.includes('cult strikes back')));
});

test('creates a fitted board with inherited map walls and source metadata', () => {
  const [map] = getFiveEToolsMapBooks(mapCatalog, 'https://5e.tools/')[0].maps;
  const dimensions = getFiveEToolsMapBoardDimensions(map);
  assert.deepEqual(dimensions, { columns: 10, rows: 8 });
  assert.equal(getFiveEToolsMapRegionWalls(map, dimensions).length, 4);

  const board = makeFiveEToolsMapBoard(map, '/api/projects/project-1/assets/images/map.webp');
  assert.equal(board.name, 'Dragon Hatchery');
  assert.equal(board.background.src, '/api/projects/project-1/assets/images/map.webp');
  assert.equal(board.background.fitToBoard, true);
  assert.equal(board.lighting.walls.length, 4);
  assert.deepEqual(board.tokens, []);
  assert.deepEqual(board.drawings, []);
  assert.equal(board.fiveETools.sourceId, 'RoT');
  assert.equal(board.fiveETools.imageType, 'map');
});
