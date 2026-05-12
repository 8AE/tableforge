export const STORAGE_KEY = 'tableforge-board-state';
export const CHANNEL_KEY = 'tableforge-board-sync';
export const tileFeet = 5;
export const defaultLighting = {
  enabled: false,
  darkness: 0.86,
  reveals: [],
  hiddenReveals: [],
  walls: [],
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
    },
    lighting: { ...defaultLighting },
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
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function migrateState(raw) {
  if (raw?.boards?.length) {
    return {
      ...raw,
      boards: raw.boards.map((board) => ({
        ...board,
        lighting: {
          ...defaultLighting,
          ...board.lighting,
          hiddenReveals: board.lighting?.hiddenReveals || [],
          walls: board.lighting?.walls || [],
        },
        tokens: (board.tokens || []).map((token) => ({ visionFeet: 0, visionMode: 'darkvision', visionEnabled: true, ...token })),
        drawings: (board.drawings || []).map((drawing) => ({ ...drawing, visible: drawing.visible ?? true })),
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
      },
      lighting: { ...defaultLighting },
      tokens: (raw.tokens || []).map((token) => ({ visionFeet: 0, visionMode: 'darkvision', visionEnabled: true, ...token })),
      drawings: (raw.drawings || []).map((drawing) => ({ ...drawing, visible: drawing.visible ?? true })),
    };
    return { boards: [migrated], activeBoardId: migrated.id, playerBoardId: migrated.id };
  }

  return defaultState;
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
    return { src: background, x: 0, y: 0, scale: 1, opacity: 0.72 };
  }
  return { src: '', x: 0, y: 0, scale: 1, opacity: 0.72, ...background };
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

export function wallEndpoints(wall, tile) {
  return {
    x1: (wall.start.x + 0.5) * tile,
    y1: (wall.start.y + 0.5) * tile,
    x2: (wall.end.x + 0.5) * tile,
    y2: (wall.end.y + 0.5) * tile,
  };
}

export function isPointNearWall(point, wall) {
  const start = { x: wall.start.x + 0.5, y: wall.start.y + 0.5 };
  const end = { x: wall.end.x + 0.5, y: wall.end.y + 0.5 };
  const lengthSquared = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y) <= 0.25;
  const ratio = Math.max(0, Math.min(1, (((point.x - start.x) * (end.x - start.x)) + ((point.y - start.y) * (end.y - start.y))) / lengthSquared));
  const closest = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= 0.28;
}

export function visionPolygonPoints(token, walls, tile) {
  const radius = (Number(token.visionFeet) / tileFeet) * tile;
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
  const box = shapeBox(drawing);
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
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

export function loadImage(event, onLoad) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.readAsDataURL(file);
}
