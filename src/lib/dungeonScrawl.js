import { unzipSync, strFromU8 } from 'fflate';
import { makeBoard, normalizeDoors, normalizeWall, uid } from './board.js';

// Dungeon Scrawl V2 saves a ZIP with a JSON entry called `map`. The envelope
// version is 1 (it is NOT the editor version). See docs/dungeon-scrawl.md.
export const MAX_DS_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const fail = (message) => { throw new Error(message); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value) => Math.round(value * 100000) / 100000;
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const colour = (value, fallback = 0) => `#${clamp(Math.round(finite(value?.colour, fallback)), 0, 0xffffff).toString(16).padStart(6, '0')}`;
const opacity = (value) => clamp(finite(value, 1), 0, 1);
const paint = (value, fallback) => `fill="${colour(value, fallback)}" fill-opacity="${opacity(value?.alpha)}"`;
const matrixText = (value) => `matrix(${value.map(number).join(' ')})`;

function matrix(value) {
  if (value == null) return IDENTITY;
  if (!Array.isArray(value) || value.length !== 6 || value.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7)) fail('The map contains an invalid object transform.');
  return value;
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transform(point, m) {
  return [point[0] * m[0] + point[1] * m[2] + m[4], point[0] * m[1] + point[1] * m[3] + m[5]];
}

function validateGeometry(raw, budget) {
  const line = (points, minimum) => {
    if (!Array.isArray(points) || points.length < minimum) fail('The map contains an incomplete geometry path.');
    budget.points += points.length;
    if (budget.points > 50000) fail('This map has too much geometry to import (50,000 points maximum).');
    return points.map((p) => {
      if (!Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7)) fail('The map contains invalid geometry coordinates.');
      return p;
    });
  };
  if (!raw || !Array.isArray(raw.polygons) || !Array.isArray(raw.polylines)) fail('The map is missing its saved geometry.');
  return {
    polygons: raw.polygons.map((polygon) => {
      if (!Array.isArray(polygon) || !polygon.length) fail('The map contains an empty polygon.');
      return polygon.map((ring) => line(ring, 3));
    }),
    polylines: raw.polylines.map((points) => line(points, 2)),
  };
}

const pathData = (paths, closed = false) => paths.map((points) => `M${points.map((p) => p.map(number).join(',')).join('L')}${closed ? 'Z' : ''}`).join('');
const geometryPaths = (geometry) => [pathData(geometry.polygons.flat(), true), pathData(geometry.polylines)];
const geometryPoints = (geometry) => [...geometry.polygons.flat(2), ...geometry.polylines.flat()];

function assetKind(node) {
  if (node.type !== 'DUNGEON_ASSET') return null;
  return node.kind || (/^Door(?:\s+\d+)?$/i.test(node.name || '') ? 'door' : /^Stairs(?:\s+\d+)?$/i.test(node.name || '') ? 'stairs' : null);
}

export function parseDungeonScrawl(input, filename = 'Dungeon.ds') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) fail('This .ds file is empty.');
  if (bytes.byteLength > MAX_DS_BYTES) fail('Choose a .ds file smaller than 50 MB.');
  let json;
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const files = unzipSync(bytes, { filter: (entry) => {
        if (entry.name !== 'map') return false;
        if (entry.originalSize > MAX_JSON_BYTES) fail('The expanded map exceeds the 64 MB import limit.');
        return true;
      } });
      if (!files.map) fail('The .ds archive does not contain a map. Save it again in Dungeon Scrawl.');
      json = strFromU8(files.map);
    } else {
      json = strFromU8(bytes);
    }
  } catch (error) {
    if (/limit|archive does not/.test(error.message)) throw error;
    fail('This .ds archive is damaged or uses unsupported compression. Save it again in Dungeon Scrawl.');
  }
  let document;
  try { document = JSON.parse(json); } catch { fail('The .ds file does not contain valid map JSON.'); }
  return readDungeonScrawlDocument(document, filename);
}

export function readDungeonScrawlDocument(document, filename = 'Dungeon.ds') {
  const saved = document?.state?.document;
  if (document?.version !== 1 || !saved?.nodes || !document?.data?.geometry) fail('Unsupported Dungeon Scrawl save format. Open the map in the current Dungeon Scrawl editor and save a new .ds file.');
  const nodes = saved.nodes;
  if (Array.isArray(nodes) || Object.keys(nodes).length > 10000) fail('The map contains too many layers (10,000 maximum).');
  const root = nodes[saved.documentNodeId];
  if (root?.type !== 'DOCUMENT' || !Array.isArray(root.children)) fail('The .ds file is missing its document or maps.');
  if (root.children.length > 50) fail('Import a save with at most 50 maps.');
  const budget = { points: 0 };
  const geometries = new Map();
  const getGeometry = (id) => {
    if (!geometries.has(id)) geometries.set(id, validateGeometry(document.data.geometry[id], budget));
    return geometries.get(id);
  };
  const maps = root.children.map((id, index) => {
    const page = nodes[id];
    if (page?.type !== 'PAGE') fail('The .ds file contains an invalid map reference.');
    try {
      return readPage(page, nodes, document.data.assets || {}, getGeometry, filename, index);
    } catch (error) {
      return { id, name: page.name || `Map ${index + 1}`, error: error.message };
    }
  });
  if (!maps.length) fail('This .ds file contains no maps.');
  if (maps.every((map) => map.error)) fail(maps.length === 1 ? maps[0].error : `None of the maps can be imported: ${maps.map((map) => `${map.name}: ${map.error}`).join(' ')}`);
  return { filename, maps, selectedPageId: root.selectedPage };
}

function readPage(page, nodes, assets, getGeometry, filename, index) {
  if (page.grid?.type !== 'square' || !['default', undefined].includes(page.pageTransform)) fail('This map uses a hexagonal or projected grid. Change it to a standard square grid in Dungeon Scrawl before importing.');
  const cell = page.grid.cellDiameter;
  if (!Number.isFinite(cell) || cell < 1 || cell > 1000) fail('This map has an invalid grid size.');
  const entries = [];
  const visited = new Set();
  const warnings = new Set();
  const points = [];
  let padding = cell;
  const walk = (id, parentMatrix = IDENTITY, inheritedGeometry = null, kind = null, depth = 0, parentAlpha = 1) => {
    if (depth > 64 || visited.has(id)) fail('The map contains a circular or repeated layer reference.');
    visited.add(id);
    const node = nodes[id];
    if (!node) fail('The map references a missing layer.');
    if (node.visible === false || opacity(node.alpha) === 0) return;
    const world = multiply(parentMatrix, matrix(node.transform));
    const geometry = node.type === 'GEOMETRY' ? getGeometry(node.geometryId) : inheritedGeometry;
    const objectKind = assetKind(node) || kind;
    const alpha = parentAlpha * opacity(node.alpha);
    const entry = { node, world, geometry, alpha, kind: objectKind, key: `ds-${entries.length}` };
    entries.push(entry);
    if (node.type === 'GEOMETRY') points.push(...geometryPoints(geometry).map((p) => transform(p, world)));
    if (node.type === 'ASSET') {
      const asset = assets[node.assetId];
      if (!asset?.data || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(asset.data)) fail(`Image “${node.name || node.assetId}” is missing or is not an embedded PNG, JPEG, WebP or GIF. Embed a raster image in Dungeon Scrawl and save again.`);
      const dimensions = asset.asset?.dimensions;
      if (!Array.isArray(dimensions) || dimensions.length !== 2 || dimensions.some((n) => !Number.isFinite(n) || n <= 0 || n > 16384)) fail('An embedded image has invalid dimensions.');
      const scale = asset.asset?.scale || [1, 1];
      if (!Array.isArray(scale) || scale.length !== 2 || scale.some((n) => !Number.isFinite(n) || Math.abs(n) > 1000)) fail('An embedded image has an invalid scale.');
      entry.asset = asset;
      entry.size = [dimensions[0] * scale[0], dimensions[1] * scale[1]];
      points.push(...[[0, 0], [entry.size[0], 0], entry.size, [0, entry.size[1]]].map((p) => transform(p, world)));
    }
    if (node.type === 'TEXT') {
      const size = clamp(finite(node.style?.fontSize, 16), 1, 1000);
      const lines = String(node.content || '').split('\n');
      const width = clamp(finite(node.style?.wordWrapWidth, Math.max(...lines.map((s) => s.length), 1) * size * 0.65), 1, 20000);
      const height = lines.length * size * clamp(finite(node.style?.lineHeight, 1.2), 0.5, 5);
      points.push(...[[0, 0], [width, 0], [width, height], [0, height]].map((p) => transform(p, world)));
      warnings.add('Text uses locally available fonts; custom fonts and wrapping may differ.');
    }
    if (['HATCHING', 'BUFFER_SHADING', 'VORONOI_SHADING', 'ZELDA_WALLS', 'SHADOW'].includes(node.type)) padding = Math.max(padding, clamp(finite(node.sharedOptions?.wallDistance ?? node.wallDistance ?? node.endThickness, 36), 0, 200) * Math.max(Math.hypot(world[0], world[1]), Math.hypot(world[2], world[3])) + cell / 2);
    if (node.children != null && !Array.isArray(node.children)) fail('The map contains an invalid layer list.');
    for (const child of node.children || []) walk(child, world, geometry, objectKind, depth + 1, alpha);
  };
  for (const child of page.children || []) walk(child);
  if (!points.length) fail('This map is empty. Draw a room or add an image in Dungeon Scrawl first.');
  const bounds = points.reduce((b, [x, y]) => ({ minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const origin = [Math.floor((bounds.minX - padding) / cell) * cell, Math.floor((bounds.minY - padding) / cell) * cell];
  const columns = Math.max(4, Math.ceil((bounds.maxX + padding - origin[0]) / cell));
  const rows = Math.max(4, Math.ceil((bounds.maxY + padding - origin[1]) / cell));
  if (!Number.isFinite(columns * rows) || columns > 200 || rows > 200) fail('This map exceeds Tableforge’s 200 × 200 cell limit. Split it into smaller maps in Dungeon Scrawl.');
  const local = (p) => ({ x: number((p[0] - origin[0]) / cell), y: number((p[1] - origin[1]) / cell) });
  const walls = [];
  const doors = [];
  const lights = [];
  const wallKeys = new Set();
  const addWall = (a, b) => {
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001) return;
    const start = local(a), end = local(b);
    const key = [[start.x, start.y].join(','), [end.x, end.y].join(',')].sort().join(':');
    if (wallKeys.has(key)) return;
    wallKeys.add(key);
    walls.push({ start, end, freeform: true, source: 'dungeon-scrawl' });
  };
  for (const { node, geometry, world, kind, alpha } of entries) {
    if (node.type === 'GEOMETRY' && kind === 'door') {
      const segment = doorSegment(geometry).map((p) => local(transform(p, world)));
      const [a, b] = segment;
      doors.push({ type: 'door', state: 'closed', isLocked: false, position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rotation: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, width: Math.hypot(b.x - a.x, b.y - a.y), lightingSegment: segment.map((p) => [p.x, p.y]), source: 'dungeon-scrawl' });
    } else if (node.type === 'GEOMETRY' && kind !== 'stairs' && node.allowsLightToPass !== true) {
      for (const polygon of geometry.polygons) for (const ring of polygon) {
        ring.forEach((p, i) => addWall(transform(p, world), transform(ring[(i + 1) % ring.length], world)));
      }
      for (const line of geometry.polylines) for (let i = 1; i < line.length; i += 1) addWall(transform(line[i - 1], world), transform(line[i], world));
    }
    if (node.type === 'LIGHT') {
      if (node.variant !== 'radial') { warnings.add('A non-radial light could not be imported.'); continue; }
      const config = node.config?.radial || {};
      const radius = finite(config.radius, 4);
      if (radius < 0 || radius > 200) fail('A light has an unsupported radius (maximum 200 cells).');
      lights.push({ ...local(transform([0, 0], world)), radiusFeet: radius * 5, brightFeet: clamp(finite(config.brightRadius, 0), 0, radius) * 5, color: colour(node.config?.shared?.colour, 0xffcc80), intensity: clamp(finite(config.strength, 1) * alpha * opacity(node.config?.shared?.colour?.alpha), 0, 1), visible: true, name: node.name || 'Imported light' });
    }
  }
  if (walls.length > 4000 || lights.length > 64) fail('This map exceeds the lighting limit (4,000 wall segments or 64 lights). Simplify it before importing.');
  if (page.texture?.enabled || page.backgroundTexture?.enabled) warnings.add('Dungeon Scrawl’s paper texture is approximated by its saved background colour.');
  const map = { id: page.id, name: page.name?.trim() || filename.replace(/\.ds$/i, '') || `Map ${index + 1}`, columns, rows, cell, origin, walls, doors, lights, warnings: [], imageCount: entries.filter((entry) => entry.asset).length };
  map.svg = renderPage(page, entries, nodes, map, warnings);
  map.warnings = [...warnings];
  return map;
}

function doorSegment(geometry) {
  const points = geometryPoints(geometry);
  if (points.length < 2) fail('A door is missing its geometry.');
  // Project onto the longest edge, then use the centre of its perpendicular
  // extent. This works for both rectangular doors and two-line door symbols.
  const paths = [...geometry.polygons.flat(), ...geometry.polylines];
  let axis = [1, 0], longest = 0;
  for (const path of paths) for (let i = 1; i < path.length; i += 1) {
    const dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1], length = Math.hypot(dx, dy);
    if (length > longest) { longest = length; axis = [dx / length, dy / length]; }
  }
  const along = points.map(([x, y]) => x * axis[0] + y * axis[1]);
  const across = points.map(([x, y]) => -x * axis[1] + y * axis[0]);
  const middle = (Math.min(...across) + Math.max(...across)) / 2;
  return [Math.min(...along), Math.max(...along)].map((p) => [p * axis[0] - middle * axis[1], p * axis[1] + middle * axis[0]]);
}

function renderPage(page, entries, nodes, map, warnings) {
  const { cell, origin, columns, rows } = map;
  const width = columns * cell, height = rows * cell;
  const defs = [];
  const byId = new Map(entries.map((entry) => [entry.node.id, entry]));
  const pattern = (id, size, content) => { defs.push(`<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${content}</pattern>`); return `url(#${id})`; };
  const grid = (id, variant, options) => {
    const stroke = colour(options?.colour, 0x555555), alpha = opacity(options?.colour?.alpha);
    return pattern(id, cell, variant === 'dots' ? `<circle r="${clamp(finite(options?.radius, 1), 0, 10)}" fill="${stroke}" opacity="${alpha}"/>` : `<path d="M${cell} 0H0V${cell}" fill="none" stroke="${stroke}" opacity="${alpha}" stroke-width="${clamp(finite(options?.width, 1), 0, 20)}"/>`);
  };
  const render = (id) => {
    const entry = byId.get(id);
    if (!entry) return '';
    const { node, geometry, key, kind } = entry;
    const [polygon = '', lines = ''] = geometry ? geometryPaths(geometry) : [];
    const path = polygon + lines;
    let content = '';
    const closedPath = (attributes) => `<path d="${polygon}" fill-rule="evenodd" ${attributes}/>`;
    const allPath = (attributes) => `<path d="${path}" fill-rule="evenodd" ${attributes}/>`;
    switch (node.type) {
      case 'GEOMETRY': case 'TEMPLATE': case 'FOLDER': case 'IMAGES': case 'ASSET_GROUP': case 'DUNGEON_ASSET': {
        content = (node.children || []).map(render).join('');
        if (geometry && node.children?.some((child) => nodes[child]?.mask === true && nodes[child]?.visible !== false)) {
          defs.push(`<clipPath id="${key}-clip">${closedPath('clip-rule="evenodd"')}</clipPath>`);
          content = `<g clip-path="url(#${key}-clip)">${content}</g>`;
        }
        break;
      }
      case 'MULTIPOLYGON': {
        if (node.mask || kind === 'door') break;
        if (!geometry) { warnings.add('A shape without geometry was omitted.'); break; }
        if (node.fill?.visible) content += closedPath(paint(node.fill.colour, 0xffffff));
        if (node.stroke?.visible) content += allPath(`fill="none" stroke="${colour(node.stroke.colour)}" stroke-opacity="${opacity(node.stroke.colour?.alpha)}" stroke-width="${clamp(finite(node.stroke.width, 5), 0, 200)}" stroke-linecap="round" stroke-linejoin="round"`);
        break;
      }
      case 'GRID': {
        if (!geometry) break;
        const options = node.variant === 'dots' ? node.dotsOptions : node.variant === 'rough' ? node.roughOptions : node.cleanOptions;
        content = closedPath(`fill="${grid(key, node.variant, options)}"`);
        break;
      }
      case 'SHADOW': {
        if (!geometry) break;
        defs.push(`<clipPath id="${key}-inside">${closedPath('clip-rule="evenodd"')}</clipPath>`);
        // Sweep each edge by the saved shadow offset, then clip to the floor.
        // A shifted stroke would leave an incorrect gap beside the wall.
        const tx = clamp(finite(node.tx, 12), -200, 200), ty = clamp(finite(node.ty, 9), -200, 200);
        const edges = [];
        for (const ring of geometry.polygons.flat()) ring.forEach((a, i) => edges.push([a, ring[(i + 1) % ring.length]]));
        if (node.castFromInternalLines !== false) for (const line of geometry.polylines) for (let i = 1; i < line.length; i += 1) edges.push([line[i - 1], line[i]]);
        const shadow = pathData(edges.map(([a, b]) => [a, b, [b[0] + tx, b[1] + ty], [a[0] + tx, a[1] + ty]]), true);
        content = `<path d="${shadow}" ${paint(node.colour, 0x888888)} clip-path="url(#${key}-inside)"/>`;
        break;
      }
      case 'HATCHING': {
        if (!geometry || !geometryPoints(geometry).length) break;
        const options = node.sharedOptions || {};
        const distance = clamp(finite(options.wallDistance, 30), 0, 200);
        if (!distance) break;
        const hatch = hatchGeometry(geometry, distance, node.variant === 'square');
        defs.push(`<mask id="${key}-band" maskUnits="userSpaceOnUse" x="${hatch.bounds[0]}" y="${hatch.bounds[1]}" width="${hatch.bounds[2]}" height="${hatch.bounds[3]}"><rect x="${hatch.bounds[0]}" y="${hatch.bounds[1]}" width="${hatch.bounds[2]}" height="${hatch.bounds[3]}" fill="white"/>${closedPath('fill="black"')}</mask>`);
        content = `<path d="${hatch.path}" fill="none" stroke="${colour(options.strokeColour, 0x222222)}" stroke-opacity="${opacity(options.strokeColour?.alpha)}" stroke-width="${clamp(finite(options.strokeWidth, 2.5), 0, 20)}" stroke-linecap="round" mask="url(#${key}-band)"/>`;
        warnings.add('Hatching and hand-drawn strokes are reconstructed and may differ slightly.');
        break;
      }
      case 'BUFFER_SHADING': case 'VORONOI_SHADING': case 'ZELDA_WALLS': {
        if (!geometry) break;
        const distance = clamp(finite(node.wallDistance ?? node.endThickness, 23), 0, 200);
        content = allPath(`fill="none" stroke="${colour(node.fill?.colour || node.endColour, 0x999999)}" stroke-opacity="${opacity(node.fill?.colour?.alpha)}" stroke-width="${distance * 2}" stroke-linejoin="round"`);
        if (node.type !== 'BUFFER_SHADING') warnings.add('Decorative cavern shading is approximated; room geometry is preserved.');
        break;
      }
      case 'WATER_BODY': case 'LAVA_BODY': {
        if (geometry) content = closedPath(paint(node.waterColour?.colour || node.lavaSettings?.mediumColour, node.type === 'WATER_BODY' ? 0x88c3ff : 0xff8000));
        warnings.add('Animated water and lava are imported as still colours.');
        break;
      }
      case 'ASSET': {
        const { asset } = entry;
        const scale = asset.asset.scale || [1, 1];
        content = `<image href="${escapeXml(asset.data)}" width="${asset.asset.dimensions[0]}" height="${asset.asset.dimensions[1]}" transform="scale(${scale.map(number).join(' ')})"/>`;
        break;
      }
      case 'TEXT': {
        const style = node.style || {}, size = clamp(finite(style.fontSize, 16), 1, 1000);
        content = `<text ${paint(style.fill)} font-size="${size}" font-family="${escapeXml(style.fontFamily || 'serif')}" font-weight="${style.bold ? 'bold' : 'normal'}" font-style="${style.italics ? 'italic' : 'normal'}">${String(node.content || '').split('\n').map((line, i) => `<tspan x="0" y="${size + i * size * clamp(finite(style.lineHeight, 1.2), 0.5, 5)}">${escapeXml(line)}</tspan>`).join('')}</text>`;
        break;
      }
      case 'LIGHT': break; // Lights remain live in Tableforge, not baked into art.
      default: warnings.add(`The ${String(node.type).slice(0, 60)} layer is not rendered. Its supported child layers are retained.`); content = (node.children || []).map(render).join('');
    }
    const blend = ['multiply', 'screen', 'overlay', 'darken', 'lighten'].includes(node.blendMode) ? ` style="mix-blend-mode:${node.blendMode}"` : '';
    return `<g opacity="${opacity(node.alpha)}" transform="${matrixText(matrix(node.transform))}"${blend}>${content}</g>`;
  };
  let backgroundGrid = '';
  if (page.grid.visible) {
    const options = { ...page.grid[page.grid.variant === 'dots' ? 'dotsOptions' : 'linesOptions'], ...page.grid.sharedOptions };
    backgroundGrid = `<rect x="${origin[0]}" y="${origin[1]}" width="${width}" height="${height}" fill="${grid('page-grid', page.grid.variant, options)}"/>`;
  }
  const content = (page.children || []).map(render).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 64}" height="${rows * 64}" viewBox="${origin[0]} ${origin[1]} ${width} ${height}"><defs>${defs.join('')}</defs><rect x="${origin[0]}" y="${origin[1]}" width="${width}" height="${height}" ${paint(page.background?.colour, 0xeeeeee)}/>${backgroundGrid}${content}</svg>`;
}

function hatchGeometry(geometry, distance, square) {
  const segments = [];
  for (const ring of geometry.polygons.flat()) ring.forEach((p, i) => segments.push([p, ring[(i + 1) % ring.length]]));
  for (const line of geometry.polylines) for (let i = 1; i < line.length; i += 1) segments.push([line[i - 1], line[i]]);
  const totalLength = segments.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  const step = Math.max(18, totalLength / 6000);
  const points = geometryPoints(geometry);
  const box = points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  let seed = 1027;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const strokes = [];
  for (const [a, b] of segments) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.1) continue;
    const tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    for (let d = 0; d < length; d += step) for (const side of [-1, 1]) {
      const away = distance * (0.4 + random() * 0.2);
      const x = a[0] + tangent[0] * d - tangent[1] * away * side;
      const y = a[1] + tangent[1] * d + tangent[0] * away * side;
      const angle = square ? Math.round(random()) * Math.PI / 2 : random() * Math.PI;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let i = -2; i <= 2; i += 1) {
        const half = Math.min(15, distance * 0.5) * (0.8 + random() * 0.4), shift = i * 4;
        strokes.push(`M${number(x + shift * cos + half * sin)},${number(y + shift * sin - half * cos)}L${number(x + shift * cos - half * sin)},${number(y + shift * sin + half * cos)}`);
      }
    }
  }
  return { path: strokes.join(''), bounds: [box[0] - distance * 2, box[1] - distance * 2, box[2] - box[0] + distance * 4, box[3] - box[1] + distance * 4] };
}

export function makeDungeonScrawlBoard(map, backgroundSrc, { name = map.name, lightingEnabled = true } = {}) {
  if (map.error) fail(map.error);
  const board = makeBoard(name.trim() || map.name);
  return {
    ...board,
    columns: map.columns,
    rows: map.rows,
    tileSize: 42,
    grid: { ...board.grid, visibleToDm: false, visibleToPlayers: false },
    background: { ...board.background, src: backgroundSrc, opacity: 1, fitToBoard: true },
    tokens: [],
    drawings: [],
    doors: normalizeDoors(map.doors.map((door) => ({ ...door, id: uid('door') }))),
    lighting: { ...board.lighting, enabled: lightingEnabled, darkness: 1, reveals: [], hiddenReveals: [], walls: map.walls.map((wall) => normalizeWall({ ...wall, id: uid('wall') })), lights: map.lights.map((light) => ({ ...light, id: uid('light') })) },
    importMetadata: { source: 'dungeon-scrawl', pageId: map.id, sourceCellSize: map.cell, sourceOrigin: map.origin, warnings: map.warnings },
  };
}
