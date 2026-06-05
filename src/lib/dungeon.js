import { uid } from './board';

export const dungeonTileSize = 50;
export const dungeonTools = ['floor', 'door', 'stairs', 'difficult', 'water', 'erase'];

export function makeDungeon(name = 'New Dungeon', width = 20, height = 20) {
  const id = uid('dungeon');
  return {
    id,
    name,
    gridSize: {
      width: clampGridSize(width),
      height: clampGridSize(height),
    },
    tiles: [],
    terrain: [],
    lightingGeometry: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeDungeon(raw = {}) {
  const dungeon = {
    ...raw,
    id: raw.id || uid('dungeon'),
    name: raw.name || 'Untitled Dungeon',
    gridSize: {
      width: clampGridSize(raw.gridSize?.width || 20),
      height: clampGridSize(raw.gridSize?.height || 20),
    },
    tiles: normalizeDungeonTiles(raw.tiles),
    terrain: Array.isArray(raw.terrain) ? raw.terrain : [],
    lightingGeometry: Array.isArray(raw.lightingGeometry) ? raw.lightingGeometry : [],
  };
  return {
    ...dungeon,
    lightingGeometry: generateLightingGeometry(dungeon),
  };
}

export function clampGridSize(value) {
  return Math.max(5, Math.min(100, Number(value) || 20));
}

export function tileKey(x, y) {
  return `${x},${y}`;
}

export function edgeKey(edge) {
  return `${edge.x},${edge.y},${edge.orientation}`;
}

export function inBounds(dungeon, x, y) {
  return x >= 0 && y >= 0 && x < dungeon.gridSize.width && y < dungeon.gridSize.height;
}

function normalizeDungeonTiles(tiles = []) {
  if (!Array.isArray(tiles)) return [];
  const normalized = [];
  const floors = new Set();

  for (const tile of tiles) {
    if (!tile || typeof tile !== 'object') continue;
    if ((tile.type === 'floor' || (tile.type === 'wall' && !tile.edge)) && Number.isFinite(Number(tile.x)) && Number.isFinite(Number(tile.y))) {
      const floor = { x: Number(tile.x), y: Number(tile.y), type: 'floor' };
      const key = tileKey(floor.x, floor.y);
      if (!floors.has(key)) {
        floors.add(key);
        normalized.push(floor);
      }
      continue;
    }
    if (tile.type === 'door' && tile.edge) {
      normalized.push({ ...tile, state: tile.state || 'closed' });
      continue;
    }
    if (tile.type === 'stairs') normalized.push(tile);
  }

  return normalized;
}

export function paintDungeonAt(dungeon, tool, point) {
  const next = structuredClone(dungeon);
  const cell = {
    x: Math.max(0, Math.min(next.gridSize.width - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(next.gridSize.height - 1, Math.floor(point.y))),
  };

  if (tool === 'erase') return removeAt(next, point, cell);
  if (tool === 'floor' || tool === 'wall') return carveFloor(next, cell);
  if (tool === 'door') return setDoor(next, point, cell);
  if (tool === 'stairs') return setCellTile(carveFloor(next, cell), { x: cell.x, y: cell.y, type: 'stairs', direction: point.localY < 0.5 ? 'up' : 'down' });
  if (tool === 'water' || tool === 'difficult') return setTerrain(carveFloor(next, cell), { x: cell.x, y: cell.y, type: tool });
  return next;
}

export function resizeDungeon(dungeon, width, height) {
  const next = structuredClone(dungeon);
  next.gridSize = { width: clampGridSize(width), height: clampGridSize(height) };
  next.tiles = next.tiles.filter((tile) => inBounds(next, tile.x, tile.y));
  next.terrain = next.terrain.filter((terrain) => inBounds(next, terrain.x, terrain.y));
  next.lightingGeometry = generateLightingGeometry(next);
  return next;
}

export function dungeonToBoard(dungeon) {
  const normalized = normalizeDungeon(dungeon);
  return {
    id: uid('board'),
    name: normalized.name,
    columns: normalized.gridSize.width,
    rows: normalized.gridSize.height,
    tileSize: 42,
    background: {
      src: dungeonBackgroundDataUrl(normalized),
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      fitToBoard: true,
    },
    lighting: {
      enabled: true,
      darkness: 0.86,
      snapWallsToGrid: false,
      reveals: [],
      hiddenReveals: [],
      walls: normalized.lightingGeometry
        .filter((segment) => segment.blocksLight !== false)
        .map((segment) => ({
          id: segment.id || uid('wall'),
          start: {
            x: segment.points[0][0] / dungeonTileSize,
            y: segment.points[0][1] / dungeonTileSize,
          },
          end: {
            x: segment.points[1][0] / dungeonTileSize,
            y: segment.points[1][1] / dungeonTileSize,
          },
          freeform: true,
          source: 'dungeon-builder',
          sourceType: segment.type,
        })),
    },
    tokens: [],
    doors: normalized.tiles
      .filter((tile) => tile.type === 'door' && tile.edge)
      .map((door) => doorToBoardDoor(door)),
    drawings: terrainToDrawings(normalized),
    dungeonMetadata: {
      dungeonId: normalized.id,
      terrain: normalized.terrain,
      tiles: normalized.tiles,
      doors: normalized.tiles
        .filter((tile) => tile.type === 'door' && tile.edge)
        .map((door) => doorToBoardDoor(door)),
      lightingGeometry: normalized.lightingGeometry,
    },
  };
}

function doorToBoardDoor(door) {
  const points = edgePoints(door.edge);
  return {
    id: door.id || uid('door'),
    type: 'door',
    position: {
      x: ((points[0][0] + points[1][0]) / 2) / dungeonTileSize,
      y: ((points[0][1] + points[1][1]) / 2) / dungeonTileSize,
    },
    edge: door.edge,
    state: door.state || 'closed',
    isLocked: door.state === 'locked',
    lightingSegment: points.map(([x, y]) => [x / dungeonTileSize, y / dungeonTileSize]),
  };
}

export function generateLightingGeometry(dungeon) {
  const floorCells = new Set();
  const doors = [];
  const doorEdges = new Set();

  for (const tile of dungeon.tiles || []) {
    if (tile.type === 'floor') floorCells.add(tileKey(tile.x, tile.y));
    if (tile.type === 'door') {
      doors.push(tile);
      doorEdges.add(edgeKey(tile.edge));
    }
  }

  const segments = [];
  const addEdge = (x, y, orientation, type = 'wall', id = null, blocksLight = true) => {
    const points = edgePoints({ x, y, orientation });
    segments.push({ type, ...(id ? { id } : {}), points, blocksLight });
  };

  floorCells.forEach((key) => {
    const [x, y] = key.split(',').map(Number);
    if (!floorCells.has(tileKey(x, y - 1)) && !doorEdges.has(edgeKey({ x, y, orientation: 'h' }))) addEdge(x, y, 'h');
    if (!floorCells.has(tileKey(x, y + 1)) && !doorEdges.has(edgeKey({ x, y: y + 1, orientation: 'h' }))) addEdge(x, y + 1, 'h');
    if (!floorCells.has(tileKey(x - 1, y)) && !doorEdges.has(edgeKey({ x, y, orientation: 'v' }))) addEdge(x, y, 'v');
    if (!floorCells.has(tileKey(x + 1, y)) && !doorEdges.has(edgeKey({ x: x + 1, y, orientation: 'v' }))) addEdge(x + 1, y, 'v');
  });

  doors.forEach((door) => {
    addEdge(door.edge.x, door.edge.y, door.edge.orientation, 'door', door.id, door.state !== 'open');
  });

  return mergeCollinearSegments(segments);
}

export function renderDungeonThumbnailDataUrl(dungeon, width = 520, height = 360) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  drawDungeonToContext(context, normalizeDungeon(dungeon), width, height);
  return canvas.toDataURL('image/png');
}

export function drawDungeonToContext(context, dungeon, width, height) {
  const scale = Math.min(width / dungeon.gridSize.width, height / dungeon.gridSize.height);
  const offsetX = (width - dungeon.gridSize.width * scale) / 2;
  const offsetY = (height - dungeon.gridSize.height * scale) / 2;
  context.fillStyle = '#141923';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#111722';
  context.fillRect(offsetX, offsetY, dungeon.gridSize.width * scale, dungeon.gridSize.height * scale);

  dungeon.tiles.filter((tile) => tile.type === 'floor').forEach((tile) => {
    context.fillStyle = '#2b3340';
    context.fillRect(offsetX + tile.x * scale, offsetY + tile.y * scale, scale, scale);
  });

  dungeon.terrain.forEach((terrain) => {
    context.fillStyle = terrain.type === 'water' ? '#1f6f8b' : '#766235';
    context.fillRect(offsetX + terrain.x * scale, offsetY + terrain.y * scale, scale, scale);
  });

  dungeon.tiles.forEach((tile) => {
    if (tile.type === 'stairs') {
      context.fillStyle = '#a67c52';
      context.fillRect(offsetX + tile.x * scale + scale * 0.12, offsetY + tile.y * scale + scale * 0.12, scale * 0.76, scale * 0.76);
      context.fillStyle = '#f5f3ed';
      context.font = `${Math.max(9, scale * 0.28)}px sans-serif`;
      context.textAlign = 'center';
      context.fillText(tile.direction === 'up' ? 'UP' : 'DN', offsetX + (tile.x + 0.5) * scale, offsetY + (tile.y + 0.58) * scale);
    }
  });

  context.strokeStyle = 'rgba(245, 243, 237, 0.16)';
  context.lineWidth = 1;
  for (let x = 0; x <= dungeon.gridSize.width; x += 1) {
    context.beginPath();
    context.moveTo(offsetX + x * scale, offsetY);
    context.lineTo(offsetX + x * scale, offsetY + dungeon.gridSize.height * scale);
    context.stroke();
  }
  for (let y = 0; y <= dungeon.gridSize.height; y += 1) {
    context.beginPath();
    context.moveTo(offsetX, offsetY + y * scale);
    context.lineTo(offsetX + dungeon.gridSize.width * scale, offsetY + y * scale);
    context.stroke();
  }

  dungeon.lightingGeometry.forEach((segment) => {
    context.strokeStyle = segment.type === 'door' ? '#f2c94c' : '#f5f3ed';
    context.lineWidth = segment.type === 'door' ? 5 : 4;
    context.beginPath();
    context.moveTo(offsetX + (segment.points[0][0] / dungeonTileSize) * scale, offsetY + (segment.points[0][1] / dungeonTileSize) * scale);
    context.lineTo(offsetX + (segment.points[1][0] / dungeonTileSize) * scale, offsetY + (segment.points[1][1] / dungeonTileSize) * scale);
    context.stroke();
  });
}

function removeAt(dungeon, point, cell) {
  const edge = nearestEdge(point, cell);
  const hasDoorOnEdge = point.nearEdge && dungeon.tiles.some((tile) => (
    tile.type === 'door'
    && tile.x === cell.x
    && tile.y === cell.y
    && edgeKey(tile.edge) === edgeKey(edge)
  ));
  dungeon.tiles = dungeon.tiles.filter((tile) => {
    if (tile.x !== cell.x || tile.y !== cell.y) return true;
    if (tile.type === 'door') return !hasDoorOnEdge || edgeKey(tile.edge) !== edgeKey(edge);
    return hasDoorOnEdge;
  });
  dungeon.terrain = dungeon.terrain.filter((terrain) => terrain.x !== cell.x || terrain.y !== cell.y);
  dungeon.lightingGeometry = generateLightingGeometry(dungeon);
  return dungeon;
}

function carveFloor(dungeon, cell) {
  if (!dungeon.tiles.some((tile) => tile.type === 'floor' && tile.x === cell.x && tile.y === cell.y)) {
    dungeon.tiles.push({ x: cell.x, y: cell.y, type: 'floor' });
  }
  dungeon.lightingGeometry = generateLightingGeometry(dungeon);
  return dungeon;
}

function setDoor(dungeon, point, cell) {
  carveFloor(dungeon, cell);
  const edge = nearestEdge(point, cell);
  const existingDoor = dungeon.tiles.find((tile) => tile.type === 'door' && tile.edge && edgeKey(tile.edge) === edgeKey(edge));
  if (existingDoor) {
    dungeon.tiles = dungeon.tiles.map((tile) => (
      tile === existingDoor ? { ...tile, state: tile.state === 'open' ? 'closed' : 'open' } : tile
    ));
    dungeon.lightingGeometry = generateLightingGeometry(dungeon);
    return dungeon;
  }
  return setCellTile(dungeon, {
    id: uid('door'),
    x: cell.x,
    y: cell.y,
    type: 'door',
    state: 'closed',
    edge,
  });
}

function setCellTile(dungeon, tile) {
  dungeon.tiles = dungeon.tiles.filter((item) => {
    if (item.x !== tile.x || item.y !== tile.y) return true;
    if (tile.type === 'stairs') return item.type !== 'stairs';
    if (tile.edge || item.edge) return item.type !== tile.type || edgeKey(item.edge || {}) !== edgeKey(tile.edge || {});
    return item.type !== tile.type;
  });
  dungeon.tiles.push(tile);
  dungeon.lightingGeometry = generateLightingGeometry(dungeon);
  return dungeon;
}

function setTerrain(dungeon, terrain) {
  dungeon.terrain = dungeon.terrain.filter((item) => item.x !== terrain.x || item.y !== terrain.y || item.type !== terrain.type);
  dungeon.terrain.push(terrain);
  return dungeon;
}

function nearestEdge(point, cell) {
  const distances = [
    { orientation: 'h', x: cell.x, y: cell.y, distance: point.localY },
    { orientation: 'h', x: cell.x, y: cell.y + 1, distance: 1 - point.localY },
    { orientation: 'v', x: cell.x, y: cell.y, distance: point.localX },
    { orientation: 'v', x: cell.x + 1, y: cell.y, distance: 1 - point.localX },
  ];
  return distances.sort((a, b) => a.distance - b.distance)[0];
}

function edgePoints(edge) {
  if (edge.orientation === 'h') {
    return [[edge.x * dungeonTileSize, edge.y * dungeonTileSize], [(edge.x + 1) * dungeonTileSize, edge.y * dungeonTileSize]];
  }
  return [[edge.x * dungeonTileSize, edge.y * dungeonTileSize], [edge.x * dungeonTileSize, (edge.y + 1) * dungeonTileSize]];
}

function mergeCollinearSegments(segments) {
  const doors = segments.filter((segment) => segment.type === 'door');
  const walls = segments.filter((segment) => segment.type !== 'door');
  const groups = new Map();
  walls.forEach((segment) => {
    const horizontal = segment.points[0][1] === segment.points[1][1];
    const key = horizontal ? `h:${segment.points[0][1]}` : `v:${segment.points[0][0]}`;
    const start = horizontal ? segment.points[0][0] : segment.points[0][1];
    const end = horizontal ? segment.points[1][0] : segment.points[1][1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ horizontal, start: Math.min(start, end), end: Math.max(start, end), fixed: horizontal ? segment.points[0][1] : segment.points[0][0] });
  });

  const merged = [];
  groups.forEach((items) => {
    items.sort((a, b) => a.start - b.start);
    let active = null;
    items.forEach((item) => {
      if (!active || item.start > active.end) {
        if (active) merged.push(edgeSegment(active));
        active = { ...item };
        return;
      }
      active.end = Math.max(active.end, item.end);
    });
    if (active) merged.push(edgeSegment(active));
  });

  return [...merged, ...doors];
}

function edgeSegment(item) {
  return item.horizontal
    ? { type: 'wall', points: [[item.start, item.fixed], [item.end, item.fixed]], blocksLight: true }
    : { type: 'wall', points: [[item.fixed, item.start], [item.fixed, item.end]], blocksLight: true };
}

function terrainToDrawings(dungeon) {
  return dungeon.terrain.map((terrain) => ({
    id: uid('drawing'),
    type: 'shape',
    shape: 'rect',
    layer: 'player',
    color: terrain.type === 'water' ? '#3ea7ff' : '#f2c94c',
    fill: terrain.type === 'water' ? 'rgba(62, 167, 255, 0.25)' : 'rgba(242, 201, 76, 0.24)',
    strokeWidth: 1,
    start: { x: terrain.x, y: terrain.y },
    end: { x: terrain.x, y: terrain.y },
    visible: true,
    movementModifier: terrain.type,
  }));
}

function dungeonBackgroundDataUrl(dungeon) {
  const width = dungeon.gridSize.width * dungeonTileSize;
  const height = dungeon.gridSize.height * dungeonTileSize;
  const rects = [
    `<rect width="${width}" height="${height}" fill="#111722"/>`,
    ...dungeon.tiles.filter((tile) => tile.type === 'floor').map((tile) => `<rect x="${tile.x * dungeonTileSize}" y="${tile.y * dungeonTileSize}" width="${dungeonTileSize}" height="${dungeonTileSize}" fill="#2b3340"/>`),
    ...dungeon.terrain.map((terrain) => `<rect x="${terrain.x * dungeonTileSize}" y="${terrain.y * dungeonTileSize}" width="${dungeonTileSize}" height="${dungeonTileSize}" fill="${terrain.type === 'water' ? '#1f6f8b' : '#766235'}"/>`),
  ];
  const lines = dungeon.lightingGeometry.map((segment) => `<line x1="${segment.points[0][0]}" y1="${segment.points[0][1]}" x2="${segment.points[1][0]}" y2="${segment.points[1][1]}" stroke="${segment.type === 'door' ? '#f2c94c' : '#f5f3ed'}" stroke-width="${segment.type === 'door' ? 7 : 5}" stroke-linecap="square"/>`);
  const grid = `<defs><pattern id="grid" width="${dungeonTileSize}" height="${dungeonTileSize}" patternUnits="userSpaceOnUse"><path d="M ${dungeonTileSize} 0 L 0 0 0 ${dungeonTileSize}" fill="none" stroke="rgba(245,243,237,0.18)" stroke-width="1"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#grid)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects.join('')}${grid}${lines.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
