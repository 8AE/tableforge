import { uid } from './board';

export const dungeonTileSize = 50;
export const dungeonTools = ['wall', 'door', 'stairs', 'difficult', 'water', 'erase'];

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
    tiles: Array.isArray(raw.tiles) ? raw.tiles : [],
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

export function paintDungeonAt(dungeon, tool, point) {
  const next = structuredClone(dungeon);
  const cell = {
    x: Math.max(0, Math.min(next.gridSize.width - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(next.gridSize.height - 1, Math.floor(point.y))),
  };

  if (tool === 'erase') return removeAt(next, point, cell);
  if (tool === 'wall') return setWall(next, point, cell);
  if (tool === 'door') return setDoor(next, point, cell);
  if (tool === 'stairs') return setCellTile(next, { x: cell.x, y: cell.y, type: 'stairs', direction: point.localY < 0.5 ? 'up' : 'down' });
  if (tool === 'water' || tool === 'difficult') return setTerrain(next, { x: cell.x, y: cell.y, type: tool });
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
      snapWallsToGrid: true,
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
    drawings: terrainToDrawings(normalized),
    dungeonMetadata: {
      dungeonId: normalized.id,
      terrain: normalized.terrain,
      tiles: normalized.tiles,
      lightingGeometry: normalized.lightingGeometry,
    },
  };
}

export function generateLightingGeometry(dungeon) {
  const walls = new Set();
  const wallCells = new Set();
  const doors = [];

  for (const tile of dungeon.tiles || []) {
    if (tile.type === 'wall') {
      if (tile.edge) walls.add(edgeKey(tile.edge));
      else wallCells.add(tileKey(tile.x, tile.y));
    }
    if (tile.type === 'door') doors.push(tile);
  }

  const segments = [];
  const addEdge = (x, y, orientation, type = 'wall', id = null, blocksLight = true) => {
    const points = edgePoints({ x, y, orientation });
    segments.push({ type, ...(id ? { id } : {}), points, blocksLight });
  };

  wallCells.forEach((key) => {
    const [x, y] = key.split(',').map(Number);
    if (!wallCells.has(tileKey(x, y - 1))) addEdge(x, y, 'h');
    if (!wallCells.has(tileKey(x, y + 1))) addEdge(x, y + 1, 'h');
    if (!wallCells.has(tileKey(x - 1, y))) addEdge(x, y, 'v');
    if (!wallCells.has(tileKey(x + 1, y))) addEdge(x + 1, y, 'v');
  });

  walls.forEach((key) => {
    const [x, y, orientation] = key.split(',');
    addEdge(Number(x), Number(y), orientation);
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
  context.fillStyle = '#222b37';
  context.fillRect(offsetX, offsetY, dungeon.gridSize.width * scale, dungeon.gridSize.height * scale);

  dungeon.terrain.forEach((terrain) => {
    context.fillStyle = terrain.type === 'water' ? '#1f6f8b' : '#766235';
    context.fillRect(offsetX + terrain.x * scale, offsetY + terrain.y * scale, scale, scale);
  });

  dungeon.tiles.forEach((tile) => {
    if (tile.type === 'wall' && !tile.edge) {
      context.fillStyle = '#635b4a';
      context.fillRect(offsetX + tile.x * scale, offsetY + tile.y * scale, scale, scale);
    }
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
  dungeon.tiles = dungeon.tiles.filter((tile) => {
    if (tile.x !== cell.x || tile.y !== cell.y) return true;
    if (tile.edge) return edgeKey(tile.edge) !== edgeKey(edge);
    return false;
  });
  dungeon.terrain = dungeon.terrain.filter((terrain) => terrain.x !== cell.x || terrain.y !== cell.y);
  dungeon.lightingGeometry = generateLightingGeometry(dungeon);
  return dungeon;
}

function setWall(dungeon, point, cell) {
  if (point.nearEdge) {
    const edge = nearestEdge(point, cell);
    return setCellTile(dungeon, { x: cell.x, y: cell.y, type: 'wall', edge });
  }
  return setCellTile(dungeon, { x: cell.x, y: cell.y, type: 'wall' });
}

function setDoor(dungeon, point, cell) {
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
    if (tile.edge || item.edge) return edgeKey(item.edge || {}) !== edgeKey(tile.edge || {});
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
    `<rect width="${width}" height="${height}" fill="#222b37"/>`,
    ...dungeon.terrain.map((terrain) => `<rect x="${terrain.x * dungeonTileSize}" y="${terrain.y * dungeonTileSize}" width="${dungeonTileSize}" height="${dungeonTileSize}" fill="${terrain.type === 'water' ? '#1f6f8b' : '#766235'}"/>`),
    ...dungeon.tiles.filter((tile) => tile.type === 'wall' && !tile.edge).map((tile) => `<rect x="${tile.x * dungeonTileSize}" y="${tile.y * dungeonTileSize}" width="${dungeonTileSize}" height="${dungeonTileSize}" fill="#635b4a"/>`),
  ];
  const lines = dungeon.lightingGeometry.map((segment) => `<line x1="${segment.points[0][0]}" y1="${segment.points[0][1]}" x2="${segment.points[1][0]}" y2="${segment.points[1][1]}" stroke="${segment.type === 'door' ? '#f2c94c' : '#f5f3ed'}" stroke-width="${segment.type === 'door' ? 7 : 5}" stroke-linecap="square"/>`);
  const grid = `<defs><pattern id="grid" width="${dungeonTileSize}" height="${dungeonTileSize}" patternUnits="userSpaceOnUse"><path d="M ${dungeonTileSize} 0 L 0 0 0 ${dungeonTileSize}" fill="none" stroke="rgba(245,243,237,0.18)" stroke-width="1"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#grid)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects.join('')}${grid}${lines.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
