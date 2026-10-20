import { Gunzip, strFromU8 } from 'fflate';
import svgpath from 'svgpath';
import { makeBoard, normalizeWall, uid } from './board.js';
import { clipInkarnateWall, cutInkarnatePortals, flattenInkarnatePath, inkarnateWorldPoint } from './inkarnateGeometry.js';

export const MAX_INK_BYTES = 100 * 1024 * 1024;
const MAX_JSON_BYTES = 160 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const round = (n) => Math.round(n * 1000000) / 1000000;
const validId = (id) => (typeof id === 'string' && id.length < 160) || Number.isSafeInteger(id);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i += 1) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

export function parseInkarnate(input, filename = 'Map.ink') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) fail('This Inkarnate backup is empty.');
  if (bytes.length > MAX_INK_BYTES) fail('Choose an Inkarnate backup smaller than 100 MB.');
  let decoded = bytes;
  if (bytes[0] === 31 && bytes[1] === 139) {
    const chunks = [];
    let size = 0;
    try {
      // Bound actual expanded output; the gzip trailer size is not trustworthy.
      const inflater = new Gunzip((chunk) => {
        size += chunk.length;
        if (size > MAX_JSON_BYTES) fail('The expanded Inkarnate backup exceeds the 160 MB limit.');
        chunks.push(chunk);
      });
      for (let i = 0; i < bytes.length; i += 4096) inflater.push(bytes.subarray(i, i + 4096), i + 4096 >= bytes.length);
      decoded = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.length; }
      if (bytes.length < 18) throw new Error('Truncated gzip');
      const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
      let crc = 0xffffffff;
      for (const byte of decoded) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      if (trailer.getUint32(4, true) !== size || trailer.getUint32(0, true) !== ((crc ^ 0xffffffff) >>> 0)) throw new Error('Invalid gzip checksum');
    } catch (error) {
      if (/limit/.test(error.message)) throw error;
      fail('This .ink backup is damaged. Save a new offline backup in Inkarnate.');
    }
  }
  let document;
  try { document = JSON.parse(strFromU8(decoded)); } catch { fail('This file does not contain valid Inkarnate backup JSON.'); }
  return readInkarnateDocument(document, filename);
}

function mergeFields(original, update, depth = 0) {
  if (depth > 24) fail('An Inkarnate object is nested too deeply.');
  const result = { ...original };
  for (const [key, value] of Object.entries(update || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('The backup contains invalid object fields.');
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeFields(result[key], value, depth + 1) : value;
  }
  return result;
}

// Backups contain a command log rather than a final entity array. Coordinates
// are world coordinates, even inside groups. Group edits propagate to children.
export function replayInkarnateHistory(history) {
  if (!Array.isArray(history) || history.length > 100000) fail('The backup has an invalid or oversized object history.');
  const entities = new Map(), layers = new Map(), warnings = new Set();
  let commands = 0;
  const children = (id) => [...entities.values()].filter((e) => e.groupId === id);
  const remove = (id, depth = 0) => {
    if (depth > 64) fail('The map contains circular object groups.');
    for (const child of children(id)) remove(child.entityId, depth + 1);
    entities.delete(id);
  };
  const anchor = (entity, depth = 0) => {
    if (depth > 64) fail('The map contains circular object groups.');
    if (entity.entityType !== 'group') return { x: finite(entity.x), y: finite(entity.y) };
    const points = children(entity.entityId).map((e) => anchor(e, depth + 1));
    return points.length ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length } : { x: finite(entity.x), y: finite(entity.y) };
  };
  const updateEntity = (id, update, depth = 0) => {
    const entity = entities.get(id);
    if (!entity) return;
    if (depth > 64) fail('The map contains circular object groups.');
    if (entity.entityType === 'group') {
      if (Array.isArray(update.entityIds)) {
        for (const child of children(id)) child.groupId = undefined;
        for (const childId of update.entityIds) if (entities.has(childId)) entities.get(childId).groupId = id;
      }
      const before = anchor(entity), angleDelta = finite(update.angle, finite(entity.angle)) - finite(entity.angle);
      const ratio = finite(update.scale, finite(entity.scale, 1)) / (entity.scale || 1);
      const pivot = Number.isFinite(update.oX) && Number.isFinite(update.oY) ? { x: update.oX, y: update.oY } : before;
      if ((angleDelta || ratio !== 1) && (!Number.isFinite(update.oX) || !Number.isFinite(update.oY))) warnings.add('A group transform has no saved pivot; its object centres are used. Review the geometry overlay.');
      for (const child of children(id)) {
        const p = anchor(child);
        if (angleDelta || ratio !== 1) {
          const moved = inkarnateWorldPoint({ x: p.x - pivot.x, y: p.y - pivot.y }, { ...pivot, scale: ratio, angle: angleDelta });
          updateEntity(child.entityId, { ...moved, scale: (child.scale ?? 1) * ratio, angle: finite(child.angle) + angleDelta, oX: pivot.x, oY: pivot.y }, depth + 1);
        } else if (update.x != null || update.y != null) updateEntity(child.entityId, { x: p.x + finite(update.x, before.x) - before.x, y: p.y + finite(update.y, before.y) - before.y }, depth + 1);
      }
    } else if (entity.entityType === 'path-v2' && update.paths == null && entity.paths) {
      const flipX = update.flipX != null && update.flipX !== (entity.flipX ?? false);
      const flipY = update.flipY != null && update.flipY !== (entity.flipY ?? false);
      if (flipX || flipY) entity.paths = svgpath(entity.paths).scale(flipX ? -1 : 1, flipY ? -1 : 1).toString();
    }
    entities.set(id, mergeFields(entity, update));
  };
  const apply = (cmd, depth = 0) => {
    if (++commands > 100000 || depth > 64) fail('The backup contains too many nested history commands.');
    if (!cmd || typeof cmd.cmdType !== 'string') fail('The backup contains an invalid history command.');
    const items = cmd.items || [];
    if (!Array.isArray(items) || items.length > 20000) fail('The backup contains an invalid object list.');
    switch (cmd.cmdType) {
      case 'cmd-composite':
        if (!Array.isArray(cmd.cmds)) fail('The backup contains an invalid history group.');
        cmd.cmds.forEach((c) => apply(c, depth + 1)); break;
      case 'cmd-layer-add': layers.set(cmd.layerId, { ...cmd.layerData, id: cmd.layerId }); break;
      case 'cmd-layer-remove':
        layers.delete(cmd.layerId);
        for (const e of [...entities.values()]) if (e.layerId === cmd.layerId) remove(e.entityId);
        break;
      case 'cmd-layer-update-visibility': case 'cmd-layer-update-opacity': case 'cmd-layer-update-name':
        if (layers.has(cmd.layerId)) Object.assign(layers.get(cmd.layerId), Object.fromEntries(['isVisible', 'opacity', 'name'].filter((k) => k in cmd).map((k) => [k, cmd[k]])));
        break;
      case 'cmd-layer-update-z-visibility':
        if (layers.has(cmd.layerId)) { const layer = layers.get(cmd.layerId); layer.zVisibility = { ...layer.zVisibility, [cmd.z]: cmd.isVisible }; }
        break;
      case 'cmd-entity-add':
        for (const item of items) {
          if (!item.entity || !validId(item.entity.entityId)) fail('The backup contains an invalid object identifier.');
          entities.set(item.entity.entityId, { ...mergeFields({}, item.entity), layerId: item.layerId });
        }
        if (entities.size > 20000) fail('Import a map with at most 20,000 objects.');
        break;
      case 'cmd-entity-update': for (const item of items) updateEntity(item.entityId, item.update); break;
      case 'cmd-entity-remove': case 'cmd-entity-flatten': case 'cmd-entity-filter-flatten':
        if (!Array.isArray(cmd.entityIds)) fail('The backup contains an invalid removal command.');
        cmd.entityIds.forEach((id) => remove(id)); break;
      case 'cmd-entity-group':
        if (!Array.isArray(cmd.entityIds) || !validId(cmd.groupId)) fail('The backup contains an invalid group.');
        entities.set(cmd.groupId, { entityId: cmd.groupId, entityType: 'group', groupId: cmd.parentGroupId, layerId: entities.get(cmd.entityIds[0])?.layerId, scale: 1, angle: 0 });
        for (const id of cmd.entityIds) if (entities.has(id)) entities.get(id).groupId = cmd.groupId;
        break;
      case 'cmd-entity-ungroup':
        for (const id of cmd.entityIds || []) { const parent = entities.get(id)?.groupId; for (const child of children(id)) child.groupId = parent; entities.delete(id); }
        break;
      case 'cmd-entity-move-to-group': for (const id of cmd.entityIds || []) if (entities.has(id)) entities.get(id).groupId = cmd.groupId; break;
      case 'cmd-entity-move-to-layer': {
        const move = (id, depth = 0) => { if (depth > 64) fail('The map contains circular object groups.'); const e = entities.get(id); if (e) { e.layerId = cmd.targetLayerId; for (const child of children(id)) move(child.entityId, depth + 1); } };
        for (const id of cmd.entityIds || []) move(id);
        break;
      }
      default:
        if (/^cmd-(?:entity|layer|scene)-(?!reorder|update-blend-mode|update-layer-shadows|update-mask|update-clip|add-mask|remove-mask|copy-mask|clone-brush)/.test(cmd.cmdType)) warnings.add(`Geometry may need review: ${cmd.cmdType.replace(/^cmd-/, '')} is not supported.`);
    }
  };
  history.forEach((cmd) => apply(cmd));
  const visible = (e) => {
    const seen = new Set();
    while (e) {
      if (seen.has(e.entityId) || seen.size > 64) fail('The map contains circular object groups.');
      seen.add(e.entityId);
      const layer = layers.get(e.layerId);
      if (e.isVisible === false || e.opacity === 0 || layer?.isVisible === false || layer?.opacity === 0 || layer?.zVisibility?.[e.z] === false) return false;
      e = e.groupId == null ? null : entities.get(e.groupId);
    }
    return true;
  };
  return { entities: [...entities.values()], visibleEntities: [...entities.values()].filter(visible), layers, warnings: [...warnings] };
}

function readPreview(document) {
  const source = document.preview;
  if (typeof source !== 'string' || !source.startsWith('data:image/png;base64,') || source.length > 90 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.slice(22))) fail('This backup has no embedded PNG map preview. Save a new offline backup in Inkarnate with the map fully loaded.');
  let bytes;
  try { bytes = Uint8Array.from(atob(source.slice(22, 66)), (char) => char.charCodeAt(0)); } catch { fail('The embedded map image is invalid.'); }
  if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('The embedded map image is not a valid PNG.');
  const view = new DataView(bytes.buffer), width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 16384 || height > 16384 || width * height > 64_000_000) fail('The embedded map image is too large (64 megapixels maximum).');
  if (document.previewDimensions && (document.previewDimensions.w !== width || document.previewDimensions.h !== height)) fail('The saved map image dimensions are inconsistent. Save a fresh offline backup.');
  return { source, width, height };
}

export function readInkarnateDocument(document, filename = 'Map.ink') {
  if (document?.version !== 3 || document.scene?.majorVersion !== 3) fail('Unsupported Inkarnate backup format. Open the map in the current Inkarnate editor and download a new .ink offline backup.');
  const size = document.scene.normSceneSize;
  if (!size || ![size.w, size.h].every((n) => Number.isFinite(n) && n > 0 && n <= 100000)) fail('The Inkarnate map has invalid dimensions.');
  const preview = readPreview(document);
  if (Math.abs(preview.width / preview.height - size.w / size.h) > 0.002) fail('The backup preview does not match the map aspect ratio. Save a new offline backup.');
  const state = replayInkarnateHistory(document.history);
  const warnings = new Set(state.warnings);
  const grids = state.entities.filter((e) => e.entityType === 'grid');
  const grid = grids[0]?.style;
  let cell = grid?.size, offset = grid?.offset || { x: 0, y: 0 };
  if (grid?.kind !== 'square' || !Number.isFinite(cell) || cell <= 0) {
    cell = Math.max(size.w, size.h) / 40; offset = { x: 0, y: 0 };
    warnings.add('No supported square grid was saved. A 40-cell grid is fitted to the long edge; adjust the grid size before importing.');
  }
  if (grids.length > 1) warnings.add('The first saved grid is used. Additional decorative grids remain in the artwork.');
  const walls = [], stamps = [];
  for (const entity of state.visibleEntities) {
    if (!['path-v2', 'stamp'].includes(entity.entityType)) continue;
    if ([entity.x, entity.y, entity.angle ?? 0, entity.scale ?? 1].some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6) || (entity.scale ?? 1) <= 0) fail('An Inkarnate object has an invalid position or scale.');
    if (entity.entityType === 'stamp') { stamps.push({ id: entity.entityId, x: entity.x, y: entity.y, scale: entity.scale ?? 1, name: String(entity.name || entity.defaultName || 'Stamp').slice(0, 120), assetName: String(entity.defaultName || '').slice(0, 120) }); continue; }
    if (entity.blockLights === false || entity.wallEnabled === false || entity.wallOpacity === 0 || entity.wallType === 'clip') continue;
    const paths = flattenInkarnatePath(entity.paths, cell * 0.002 / (entity.scale ?? 1));
    const segments = cutInkarnatePortals(paths, entity.portals || []);
    for (const [a, b] of segments) walls.push({ start: inkarnateWorldPoint(a, entity), end: inkarnateWorldPoint(b, entity), sourceEntityId: entity.entityId });
    if (walls.length > 4000) fail('This map has more than 4,000 wall segments. Simplify its walls in Inkarnate.');
    if (entity.wallOffset) warnings.add('Offset wall textures are blocked along their saved centre paths; review wall alignment.');
  }
  if (state.visibleEntities.some((e) => e.entityType === 'path')) warnings.add('Older decorative paths remain in the image; convert them to the current Line / Shape tool to import their walls.');
  return {
    name: String(document.title || filename.replace(/(?:-backup-.*)?\.(?:ink|json)$/i, '') || 'Inkarnate Map').slice(0, 120),
    filename, sourceSceneId: document.scene.id, width: size.w, height: size.h,
    image: preview.source, imageWidth: preview.width, imageHeight: preview.height,
    cell, offset: { x: finite(offset.x), y: finite(offset.y) }, walls, stamps, objectCount: state.visibleEntities.filter((e) => !['group', 'grid'].includes(e.entityType)).length,
    warnings: [...warnings],
  };
}

export function prepareInkarnateMap(map, { estimateObjects = true, cellsAcross } = {}) {
  if (cellsAcross != null && (!Number.isInteger(Number(cellsAcross)) || Number(cellsAcross) < 4 || Number(cellsAcross) > 200)) fail('Choose a whole number of grid columns between 4 and 200.');
  const cell = cellsAcross == null ? map.cell : map.width / Number(cellsAcross);
  if (!Number.isFinite(cell) || cell <= 0) fail('Choose a valid grid size.');
  const pad = (n) => { const value = ((-n % cell) + cell) % cell; return value < cell * 1e-8 || cell - value < cell * 1e-8 ? 0 : value; };
  const origin = cellsAcross == null ? { x: pad(map.offset.x), y: pad(map.offset.y) } : { x: 0, y: 0 };
  const columns = Math.max(4, Math.ceil((map.width + origin.x) / cell - 1e-8)), rows = Math.max(4, Math.ceil((map.height + origin.y) / cell - 1e-8));
  if (columns > 200 || rows > 200) fail('This grid exceeds 200 × 200 cells. Use fewer columns before importing.');
  const toCell = (p) => ({ x: round((p.x + origin.x) / cell), y: round((p.y + origin.y) / cell) });
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= map.width && p.y <= map.height;
  const walls = map.walls.map((wall) => clipInkarnateWall(wall, map.width, map.height)).filter(Boolean).map((wall) => ({ ...wall, start: toCell(wall.start), end: toCell(wall.end), source: 'inkarnate', freeform: true, estimated: false }));
  const lights = [], estimates = [], warnings = [...map.warnings];
  if (estimateObjects) for (const stamp of map.stamps) {
    if (!inside(stamp)) continue;
    const centre = toCell(stamp), scale = clamp(stamp.scale, 0.25, 4);
    // Backups reference stamp assets by ID without their pixel dimensions or
    // collision shapes. Conservative trunk/prop sizes are explicit estimates.
    const classification = `${stamp.name} ${stamp.assetName || ''}`;
    const tree = /\b(?:tree|palm|oak|pine|fir|willow)\b/i.test(classification);
    const solid = /\b(?:boulder|rock|pillar|column)\b/i.test(classification);
    if (tree || solid) {
      const radius = (tree ? 0.18 : 0.4) * scale;
      const ring = Array.from({ length: 8 }, (_, i) => ({ x: round(centre.x + radius * Math.cos(i * Math.PI / 4)), y: round(centre.y + radius * Math.sin(i * Math.PI / 4)) }));
      ring.forEach((start, i) => walls.push({ start, end: ring[(i + 1) % ring.length], source: 'inkarnate', freeform: true, sourceEntityId: stamp.id, estimated: true }));
      estimates.push({ id: stamp.id, name: stamp.name, kind: tree ? 'Tree trunk' : 'Solid object', ...centre, radius });
    }
    if (/\b(?:torch|lantern|lamp|brazier|campfire|bonfire|fire|fireplace|candle)\b/i.test(classification) && !/\b(?:unlit|extinguished|broken|off)\b/i.test(classification)) {
      const large = /\b(?:bonfire|brazier|campfire|fire|fireplace)\b/i.test(classification), candle = /\bcandle\b/i.test(classification);
      lights.push({ ...centre, name: stamp.name, radiusFeet: candle ? 10 : large ? 40 : 30, brightFeet: candle ? 5 : large ? 20 : 15, intensity: 1, color: '#ffcc80', visible: true, source: 'inkarnate', sourceEntityId: stamp.id, estimated: true });
    }
  }
  if (walls.length > 4000) fail('This import would exceed 4,000 walls. Turn off object estimates or simplify the map.');
  if (lights.length > 64) fail('This import would exceed 64 lights. Turn off object estimates or simplify the map.');
  warnings.push('Inkarnate does not save VTT light radii or stamp collision shapes. Named tree/rock blockers and torch/fire lights are estimates; review them before play.');
  if (map.stamps.some((s) => /\b(?:wall|door|building|house)\b/i.test(`${s.name} ${s.assetName || ''}`))) warnings.push('Wall, door and building stamps are artwork only: the backup does not include their collision geometry. Use the wall tools to trace these after import.');
  if (!lights.length) warnings.push(estimateObjects ? 'No recognizable light-emitting stamps were found. Use daylight, token vision, or add lights after import.' : 'Light estimates are turned off. Use daylight, token vision, or add lights after import.');
  return { ...map, cell, origin, columns, rows, walls, lights, estimates, warnings, imageRect: { x: origin.x / cell, y: origin.y / cell, width: map.width / cell, height: map.height / cell } };
}

export function makeInkarnateBoard(map, backgroundSrc, { name = map.name, lightingEnabled = true } = {}) {
  const board = makeBoard(name.trim() || map.name);
  return {
    ...board, columns: map.columns, rows: map.rows,
    grid: { ...board.grid, visibleToDm: false, visibleToPlayers: false },
    background: { ...board.background, src: backgroundSrc, opacity: 1, fitToBoard: true },
    tokens: [], drawings: [], doors: [],
    lighting: { ...board.lighting, enabled: lightingEnabled, darkness: 1, walls: map.walls.map((wall) => normalizeWall({ ...wall, id: uid('wall') })), lights: map.lights.map((light) => ({ ...light, id: uid('light') })) },
    importMetadata: { source: 'inkarnate', sceneId: map.sourceSceneId, sourceCellSize: map.cell, sourceOrigin: map.origin, sourceImageSize: { width: map.imageWidth, height: map.imageHeight }, objectCount: map.objectCount, estimatedBlockers: map.estimates.length, estimatedLights: map.lights.length, warnings: map.warnings },
  };
}
