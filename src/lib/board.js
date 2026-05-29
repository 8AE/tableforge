export const STORAGE_KEY = 'tableforge-board-state';
export const CHANNEL_KEY = 'tableforge-board-sync';
export const tileFeet = 5;
export const defaultLighting = {
  enabled: false,
  darkness: 1,
  snapWallsToGrid: true,
  reveals: [],
  hiddenReveals: [],
  walls: [],
};
export const entityCapabilities = {
  token: { selectable: true, movable: true, deletable: true, editable: true, contextMenu: true },
  drawing: { selectable: true, movable: true, deletable: true, editable: true, contextMenu: true },
  wall: { selectable: true, movable: true, deletable: true, editable: true, contextMenu: true },
  door: { selectable: true, movable: true, deletable: true, editable: true, contextMenu: true },
};

export function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeBoard(name = 'Blackstone Crossing') {
  return {
    id: uid('board'),
    name,
    columns: 24,
    rows: 16,
    tileSize: 42,
    background: {
      src: '',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 0.72,
      fitToBoard: false,
    },
    lighting: { ...defaultLighting },
    doors: [],
    tokens: [
      { id: 'hero-1', x: 5, y: 7, label: 'Kara', color: '#3ea7ff', layer: 'player', size: 1, visible: true, visionEnabled: true },
      { id: 'hero-2', x: 7, y: 8, label: 'Brom', color: '#f2c94c', layer: 'player', size: 1, visible: true, visionEnabled: true },
      { id: 'gm-1', x: 15, y: 5, label: 'Owlbear', color: '#df5d52', layer: 'dm', size: 2, visible: true, visionEnabled: true },
    ],
    drawings: [
      {
        id: 'draw-1',
        type: 'shape',
        shape: 'rect',
        layer: 'player',
        color: '#36d399',
        fill: 'rgba(54, 211, 153, 0.13)',
        strokeWidth: 3,
        start: { x: 3, y: 3 },
        end: { x: 9, y: 6 },
        visible: true,
      },
    ],
  };
}

const firstBoard = makeBoard();

export const defaultState = {
  boards: [firstBoard],
  activeBoardId: firstBoard.id,
  playerBoardId: firstBoard.id,
  tokenLibrary: [],
  fiveEToolsBaseUrl: 'https://5e.tools/',
};

export function makeProject(name = 'New Campaign') {
  const board = makeBoard();
  return {
    id: uid('project'),
    name,
    state: {
      boards: [board],
      activeBoardId: board.id,
      playerBoardId: board.id,
      tokenLibrary: [],
      fiveEToolsBaseUrl: 'https://5e.tools/',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function migrateState(raw) {
  if (raw?.boards?.length) {
    return {
      ...raw,
      fiveEToolsBaseUrl: raw.fiveEToolsBaseUrl || 'https://5e.tools/',
      tokenLibrary: (raw.tokenLibrary || []).map((token) => normalizeLibraryToken(token)),
      boards: raw.boards.map((board) => ({
        ...board,
        lighting: {
          ...defaultLighting,
          ...board.lighting,
          hiddenReveals: board.lighting?.hiddenReveals || [],
          walls: (board.lighting?.walls || []).map((wall) => normalizeWall(wall)),
        },
        tokens: (board.tokens || []).map((token) => normalizeBoardToken(token)),
        drawings: (board.drawings || []).map((drawing) => normalizeDrawing(drawing)),
        doors: normalizeDoors(board.doors || board.dungeonMetadata?.doors || []),
      })),
      playerBoardId: raw.playerBoardId || raw.activeBoardId || raw.boards[0].id,
    };
  }

  if (raw?.board) {
    const migrated = {
      id: uid('board'),
      ...raw.board,
      background: {
        src: raw.board.background || '',
        x: 0,
        y: 0,
        scale: raw.board.backgroundScale || 1,
        opacity: raw.board.backgroundOpacity ?? 0.72,
        fitToBoard: false,
      },
      lighting: { ...defaultLighting },
      doors: [],
      tokens: (raw.tokens || []).map((token) => normalizeBoardToken(token)),
      drawings: (raw.drawings || []).map((drawing) => normalizeDrawing(drawing)),
    };
    return { boards: [migrated], activeBoardId: migrated.id, playerBoardId: migrated.id, tokenLibrary: [], fiveEToolsBaseUrl: 'https://5e.tools/' };
  }

  return defaultState;
}

export function normalizeLibraryToken(token = {}) {
  return {
    id: token.id || uid('library-token'),
    label: token.label || 'Token',
    color: token.color || '#df5d52',
    image: token.image || '',
    layer: token.layer || 'player',
    size: Number(token.size) || 1,
    visible: token.visible ?? true,
    visionFeet: Number(token.visionFeet) || 0,
    visionBrightFeet: Number(token.visionBrightFeet ?? token.visionFeet) || 0,
    visionDimFeet: Number(token.visionDimFeet ?? token.visionFeet) || 0,
    lightBrightFeet: Number(token.lightBrightFeet) || 0,
    lightDimFeet: Number(token.lightDimFeet) || 0,
    visionMode: token.visionMode || 'darkvision',
    visionEnabled: token.visionEnabled ?? true,
  };
}

export function normalizeBoardToken(token = {}) {
  return {
    ...entityBase('token', token),
    visionFeet: 0,
    visionBrightFeet: Number(token.visionBrightFeet ?? token.visionFeet) || 0,
    visionDimFeet: Number(token.visionDimFeet ?? token.visionFeet) || 0,
    lightBrightFeet: Number(token.lightBrightFeet) || 0,
    lightDimFeet: Number(token.lightDimFeet) || 0,
    visionMode: 'darkvision',
    visionEnabled: true,
    ...token,
    ...entityCapabilities.token,
    entityType: 'token',
  };
}

export function normalizeDrawing(drawing = {}) {
  return {
    ...entityBase('drawing', drawing),
    ...drawing,
    ...entityCapabilities.drawing,
    entityType: 'drawing',
    visible: drawing.visible ?? true,
  };
}

export function normalizeWall(wall = {}) {
  return {
    ...entityBase('wall', wall),
    ...wall,
    ...entityCapabilities.wall,
    entityType: 'wall',
  };
}

export function normalizeDoors(doors = []) {
  if (!Array.isArray(doors)) return [];
  return doors
    .filter((door) => door && typeof door === 'object')
    .map((door) => ({
      ...entityBase('door', door),
      id: door.id || uid('door'),
      type: 'door',
      position: {
        x: Number(door.position?.x ?? door.x ?? 0),
        y: Number(door.position?.y ?? door.y ?? 0),
      },
      edge: door.edge || 'north',
      state: ['open', 'closed', 'locked'].includes(door.state) ? door.state : 'closed',
      isLocked: Boolean(door.isLocked || door.state === 'locked'),
      lightingSegment: normalizeDoorSegment(door.lightingSegment),
      ...entityCapabilities.door,
      entityType: 'door',
    }));
}

export function entityBase(entityType, item = {}) {
  return {
    id: item.id || uid(entityType),
    entityType,
    ...(entityCapabilities[entityType] || {}),
  };
}

function normalizeDoorSegment(segment) {
  if (!Array.isArray(segment) || segment.length < 2) return [[0, 0], [0, 0]];
  return [
    [Number(segment[0]?.[0]) || 0, Number(segment[0]?.[1]) || 0],
    [Number(segment[1]?.[0]) || 0, Number(segment[1]?.[1]) || 0],
  ];
}

export function readInitialState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? migrateState(JSON.parse(stored)) : defaultState;
  } catch {
    return defaultState;
  }
}

export function getBoard(state, id) {
  return state.boards.find((board) => board.id === id) || state.boards[0];
}

export function updateActiveBoard(state, updater) {
  return {
    ...state,
    boards: state.boards.map((board) => board.id === state.activeBoardId ? updater(board) : board),
  };
}

export function normalizeBackground(background) {
  if (typeof background === 'string') {
    return { src: background, x: 0, y: 0, scale: 1, opacity: 0.72, fitToBoard: false };
  }
  return { src: '', x: 0, y: 0, scale: 1, opacity: 0.72, fitToBoard: false, ...background };
}

export function snapToTile(point, board) {
  return {
    x: Math.max(0, Math.min(board.columns - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(board.rows - 1, Math.floor(point.y))),
  };
}

export function feetBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * tileFeet);
}

export function shapeBox(drawing) {
  if (drawing.shape === 'square') {
    const size = Math.max(Math.abs(drawing.end.x - drawing.start.x), Math.abs(drawing.end.y - drawing.start.y)) + 1;
    const x = drawing.end.x >= drawing.start.x ? drawing.start.x : drawing.start.x - size + 1;
    const y = drawing.end.y >= drawing.start.y ? drawing.start.y : drawing.start.y - size + 1;
    return { x, y, w: size, h: size };
  }
  const x = Math.min(drawing.start.x, drawing.end.x);
  const y = Math.min(drawing.start.y, drawing.end.y);
  const w = Math.abs(drawing.end.x - drawing.start.x) + 1;
  const h = Math.abs(drawing.end.y - drawing.start.y) + 1;
  return { x, y, w, h };
}

export function shapeMeasurement(drawing) {
  const box = shapeBox(drawing);
  if (drawing.shape === 'circle') {
    return `${Math.max(box.w, box.h) * tileFeet} ft dia`;
  }
  if (drawing.shape === 'cone') {
    return `${feetBetween(drawing.start, drawing.end)} ft cone`;
  }
  if (drawing.shape === 'square') {
    return `${Math.max(box.w, box.h) * tileFeet} ft sq`;
  }
  return `${box.w * tileFeet} x ${box.h * tileFeet} ft`;
}

export function coneTemplate(drawing) {
  const start = { x: drawing.start.x + 0.5, y: drawing.start.y + 0.5 };
  const end = { x: drawing.end.x + 0.5, y: drawing.end.y + 0.5 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const direction = Math.atan2(dy, dx);
  const spread = Math.PI / 2;
  const steps = 20;
  const arc = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = direction - spread / 2 + (spread * index) / steps;
    arc.push({
      x: start.x + Math.cos(angle) * distance,
      y: start.y + Math.sin(angle) * distance,
    });
  }

  return { start, arc, label: { x: start.x + Math.cos(direction) * distance * 0.62, y: start.y + Math.sin(direction) * distance * 0.62 } };
}

export function revealBox(reveal) {
  const x = Math.min(reveal.start.x, reveal.end.x);
  const y = Math.min(reveal.start.y, reveal.end.y);
  const w = Math.abs(reveal.end.x - reveal.start.x) + 1;
  const h = Math.abs(reveal.end.y - reveal.start.y) + 1;
  return { x, y, w, h };
}

export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function selectableBounds(item, type) {
  if (!item) return null;
  if (type === 'token') return { x: item.x, y: item.y, w: item.size, h: item.size };
  if (type === 'drawing') return drawingBounds(item);
  if (type === 'wall') return wallBounds(item);
  if (type === 'door') return doorBounds(item);
  return null;
}

export function offsetEntity(item, type, dx, dy) {
  if (type === 'token') return { ...item, x: Math.max(0, item.x + dx), y: Math.max(0, item.y + dy) };
  if (type === 'drawing') return { ...item, ...offsetDrawing(item, dx, dy) };
  if (type === 'wall') return offsetWall(item, dx, dy);
  if (type === 'door') return offsetDoor(item, dx, dy);
  return item;
}

export function getBoardEntity(board, target) {
  if (!board || !target) return null;
  if (target.type === 'token') return board.tokens.find((token) => token.id === target.id) || null;
  if (target.type === 'drawing') return board.drawings.find((drawing) => drawing.id === target.id) || null;
  if (target.type === 'wall') return board.lighting?.walls?.find((wall) => wall.id === target.id) || null;
  if (target.type === 'door') return board.doors?.find((door) => door.id === target.id) || null;
  return null;
}

export function drawingBounds(drawing) {
  if (!drawing) return null;
  if (drawing.type === 'path') {
    const xs = drawing.points.map((point) => point.x);
    const ys = drawing.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (drawing.type === 'measurement') {
    const x = Math.min(drawing.start.x, drawing.end.x);
    const y = Math.min(drawing.start.y, drawing.end.y);
    return { x, y, w: Math.abs(drawing.end.x - drawing.start.x) + 1, h: Math.abs(drawing.end.y - drawing.start.y) + 1 };
  }
  return shapeBox(drawing);
}

export function wallBounds(wall) {
  if (!wall) return null;
  const offset = wall.freeform ? 0 : 0.5;
  const x1 = wall.start.x + offset;
  const y1 = wall.start.y + offset;
  const x2 = wall.end.x + offset;
  const y2 = wall.end.y + offset;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.max(0.12, Math.abs(x2 - x1)), h: Math.max(0.12, Math.abs(y2 - y1)) };
}

export function doorBounds(door) {
  if (!door?.position) return null;
  return { x: door.position.x - 0.45, y: door.position.y - 0.45, w: 0.9, h: 0.9 };
}

export function offsetWall(wall, dx, dy) {
  return {
    ...wall,
    start: { x: wall.start.x + dx, y: wall.start.y + dy },
    end: { x: wall.end.x + dx, y: wall.end.y + dy },
  };
}

export function offsetDoor(door, dx, dy) {
  const lightingSegment = (door.lightingSegment || [[0, 0], [0, 0]]).map(([x, y]) => [x + dx, y + dy]);
  return {
    ...door,
    position: { x: door.position.x + dx, y: door.position.y + dy },
    edge: door.edge && typeof door.edge === 'object'
      ? { ...door.edge, x: door.edge.x + dx, y: door.edge.y + dy }
      : door.edge,
    lightingSegment,
  };
}

export function wallEndpoints(wall, tile) {
  const offset = wall.freeform ? 0 : 0.5;
  return {
    x1: (wall.start.x + offset) * tile,
    y1: (wall.start.y + offset) * tile,
    x2: (wall.end.x + offset) * tile,
    y2: (wall.end.y + offset) * tile,
  };
}

export function isPointNearWall(point, wall) {
  const offset = wall.freeform ? 0 : 0.5;
  const start = { x: wall.start.x + offset, y: wall.start.y + offset };
  const end = { x: wall.end.x + offset, y: wall.end.y + offset };
  const lengthSquared = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y) <= 0.25;
  const ratio = Math.max(0, Math.min(1, (((point.x - start.x) * (end.x - start.x)) + ((point.y - start.y) * (end.y - start.y))) / lengthSquared));
  const closest = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= 0.28;
}

export function visionPolygonPoints(token, walls, tile, radiusFeet = token.visionFeet) {
  const radius = (Number(radiusFeet) / tileFeet) * tile;
  if (!radius) return '';

  const origin = {
    x: (token.x + token.size / 2) * tile,
    y: (token.y + token.size / 2) * tile,
  };
  const wallSegments = (walls || []).map((wall) => wallEndpoints(wall, tile));
  const angles = [];
  const baseRayCount = 112;

  for (let index = 0; index < baseRayCount; index += 1) {
    angles.push((Math.PI * 2 * index) / baseRayCount);
  }

  wallSegments.forEach((wall) => {
    [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ].forEach((point) => {
      const angle = normalizeAngle(Math.atan2(point.y - origin.y, point.x - origin.x));
      angles.push(angle - 0.0008, angle, angle + 0.0008);
    });
  });

  return angles
    .map(normalizeAngle)
    .sort((a, b) => a - b)
    .map((angle) => {
      const distance = nearestWallDistance(origin, angle, radius, wallSegments);
      return `${origin.x + Math.cos(angle) * distance},${origin.y + Math.sin(angle) * distance}`;
    })
    .join(' ');
}

function normalizeAngle(angle) {
  return (angle + Math.PI * 2) % (Math.PI * 2);
}

function nearestWallDistance(origin, angle, radius, wallSegments) {
  const ray = { x: Math.cos(angle), y: Math.sin(angle) };
  return wallSegments.reduce((nearest, wall) => {
    const hit = raySegmentDistance(origin, ray, wall);
    return hit === null ? nearest : Math.min(nearest, hit);
  }, radius);
}

function raySegmentDistance(origin, ray, wall) {
  const segment = { x: wall.x2 - wall.x1, y: wall.y2 - wall.y1 };
  const denominator = cross(ray, segment);
  if (Math.abs(denominator) < 0.000001) return null;

  const offset = { x: wall.x1 - origin.x, y: wall.y1 - origin.y };
  const rayDistance = cross(offset, segment) / denominator;
  const segmentRatio = cross(offset, ray) / denominator;

  if (rayDistance < 0 || segmentRatio < 0 || segmentRatio > 1) return null;
  return rayDistance;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function isPointInDrawing(point, drawing) {
  if (drawing.type === 'path') {
    return drawing.points.some((pathPoint) => Math.abs(pathPoint.x - point.x) < 0.35 && Math.abs(pathPoint.y - point.y) < 0.35);
  }
  if (drawing.type === 'measurement') {
    const start = { x: drawing.start.x + 0.5, y: drawing.start.y + 0.5 };
    const end = { x: drawing.end.x + 0.5, y: drawing.end.y + 0.5 };
    return distanceToSegment(point, start, end) <= 0.35;
  }
  const box = shapeBox(drawing);
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projection = { x: start.x + ratio * dx, y: start.y + ratio * dy };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

export function offsetDrawing(drawing, dx, dy) {
  if (!drawing) return {};
  if (drawing.type === 'path') {
    return { points: drawing.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  }
  return {
    start: { x: drawing.start.x + dx, y: drawing.start.y + dy },
    end: { x: drawing.end.x + dx, y: drawing.end.y + dy },
  };
}
