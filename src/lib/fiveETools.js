import { defaultLighting, makeBoard } from './board.js';
import { ImportError, readImportResponse, requestImportJson } from './importErrors.js';

const DEFAULT_BASE_URL = 'https://5e.tools/';
const MAP_TYPES = new Set(['map', 'mapPlayer']);

export function normalizeFiveEToolsBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  const trimmed = String(baseUrl || '').trim() || DEFAULT_BASE_URL;
  let url;
  try { url = new URL(trimmed); } catch { throw new ImportError('INVALID_URL', 'Enter the 5etools site URL, for example http://localhost:5050/.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ImportError('INVALID_URL', 'The 5etools URL must use http:// or https:// without embedded login credentials.');
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/[^/]+\.html$/i, '/');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function fetchFiveEToolsJson(url, options = {}) {
  return requestImportJson(`/api/5etools?url=${encodeURIComponent(url)}`, options);
}

export const FIVE_E_TOOLS_MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/';

export async function fetchFiveEToolsData(baseUrl, path, { signal, onNotice } = {}) {
  const normalizedBaseUrl = normalizeFiveEToolsBaseUrl(baseUrl);
  try {
    return { data: await fetchFiveEToolsJson(`${normalizedBaseUrl}${path}`, { signal }), dataBase: normalizedBaseUrl };
  } catch (error) {
    // A custom installation must never quietly return somebody else's catalog.
    if (signal?.aborted || normalizedBaseUrl !== DEFAULT_BASE_URL) throw error;
    const data = await fetchFiveEToolsJson(`${FIVE_E_TOOLS_MIRROR}${path}`, { signal });
    onNotice?.('5e.tools could not be reached. Data was loaded from its public source mirror; artwork still uses your configured site.');
    return { data, dataBase: FIVE_E_TOOLS_MIRROR };
  }
}

export async function fetchFiveEToolsMaps(baseUrl, options) {
  const { data } = await fetchFiveEToolsData(baseUrl, 'data/generated/gendata-maps.json', options);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.values(data).every((source) => Array.isArray(source?.chapters) && source.chapters.every((chapter) => Array.isArray(chapter.images)))) {
    throw new ImportError('INVALID_MAP_CATALOG', 'The response is not a 5etools map catalog. Update the source installation and reload the catalog.');
  }
  return data;
}

export async function importFiveEToolsSelection(selection, { signal, onProgress } = {}) {
  let response;
  try { response = await fetch('/api/5etools/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection), signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new ImportError('HOST_UNREACHABLE', 'Cannot reach the Tableforge host. Check that it is running and retry.');
  }
  if (!response.ok) return readImportResponse(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress?.(event);
        if (event.type === 'error') throw new ImportError(event.code, event.error, event);
        if (event.type === 'complete') return { ok: true, ...event };
      }
      if (done) throw new ImportError('IMPORT_INTERRUPTED', 'The host connection ended before confirming the import. Check the campaign before retrying.');
    }
  } catch (error) {
    if (error instanceof ImportError || signal?.aborted) throw error;
    throw new ImportError('IMPORT_INTERRUPTED', 'The host connection ended before confirming the import. Check the campaign before retrying.');
  } finally { await reader.cancel().catch(() => {}); }
}

export function getFiveEToolsMapBooks(data, baseUrl) {
  return Object.values(data || {})
    .map((source) => {
      const maps = flattenMapSource(source, baseUrl);
      if (!maps.length) return null;
      return {
        id: source.id || source.source || source.name,
        name: source.name || source.source || source.id || 'Untitled Book',
        source: source.source || source.id || '',
        type: source.prop || 'book',
        maps,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function flattenFiveEToolsMapData(data, baseUrl) {
  return Object.values(data || {})
    .flatMap((source) => flattenMapSource(source, baseUrl))
    .sort((a, b) => Number(b.imageType === 'mapPlayer') - Number(a.imageType === 'mapPlayer'));
}

function flattenMapSource(source = {}, baseUrl) {
  const maps = [];
  source.chapters?.forEach((chapter) => {
    const images = chapter.images || [];
    const imagesById = new Map(images.filter((image) => image.id).map((image) => [image.id, image]));
    const titlesById = new Map(
      images
        .filter((image) => image.id && image.imageType === 'map')
        .map((image) => [image.id, image.title || image.altText || 'Untitled Map']),
    );
    let lastMapTitle = '';

    images.forEach((image, index) => {
      if (!MAP_TYPES.has(image.imageType)) return;
      const parentImage = image.mapParent?.id ? imagesById.get(image.mapParent.id) : null;
      const rawTitle = image.title || image.altText || 'Untitled Map';
      const parentTitle = image.mapParent?.id ? titlesById.get(image.mapParent.id) : '';
      const displayTitle = getMapDisplayTitle(image.imageType, rawTitle, parentTitle || lastMapTitle);
      if (image.imageType === 'map') lastMapTitle = displayTitle;

      maps.push({
        id: `${source.id || source.source || 'source'}-${chapter.ix ?? 0}-${index}-${image.href?.path || image.href?.url || rawTitle}`,
        displayTitle,
        sourceId: source.id || source.source || '',
        sourceName: source.name || source.source || source.id || 'Unknown Source',
        sourceType: source.prop || 'book',
        chapterIndex: chapter.ix ?? 0,
        chapterName: chapter.name || '',
        imageType: image.imageType,
        imageUrl: getFiveEToolsImageUrl(baseUrl, image.href),
        width: Number(image.width) || 0,
        height: Number(image.height) || 0,
        grid: image.grid || null,
        mapRegions: image.mapRegions || parentImage?.mapRegions || [],
        mapParent: image.mapParent || null,
        mapRegionWidth: Number(image.mapRegions ? image.width : parentImage?.width) || Number(image.width) || 0,
        mapRegionHeight: Number(image.mapRegions ? image.height : parentImage?.height) || Number(image.height) || 0,
        searchText: [
          displayTitle,
          rawTitle,
          source.name,
          source.source,
          source.id,
          chapter.name,
          parentTitle,
        ].filter(Boolean).join(' ').toLowerCase(),
      });
    });
  });
  return maps;
}

function getMapDisplayTitle(imageType, rawTitle, parentTitle) {
  if (imageType !== 'mapPlayer') return rawTitle;
  const title = rawTitle === 'Player Version' && parentTitle ? parentTitle : rawTitle;
  return /\bplayer\b/i.test(title) ? title : `${title} (Player)`;
}

export function getFiveEToolsImageUrl(baseUrl, href = {}) {
  if (href.type === 'external') return /^https?:\/\//i.test(href.url || '') ? href.url : '';
  if (!href.path) return '';
  const encodedPath = href.path.split('/').map(encodeURIComponent).join('/');
  return `${normalizeFiveEToolsBaseUrl(baseUrl)}img/${encodedPath}`;
}

export function getFiveEToolsMapBoardDimensions(map) {
  const grid = map.grid || {};
  const scale = Number(grid.scale) || 1;
  const gridSize = grid.type === 'square' ? Number(grid.size) || 0 : 0;
  if (gridSize && map.width && map.height) {
    return {
      columns: clampBoardTiles(Math.ceil((map.width / gridSize) * scale)),
      rows: clampBoardTiles(Math.ceil((map.height / gridSize) * scale)),
    };
  }
  const fallbackColumns = map.width && map.height ? Math.round(Math.sqrt((map.width / map.height) * 600)) : 30;
  return {
    columns: clampBoardTiles(fallbackColumns),
    rows: clampBoardTiles(map.width && map.height ? Math.round(fallbackColumns * (map.height / map.width)) : 20),
  };
}

export function getFiveEToolsMapRegionWalls(map, dimensions = getFiveEToolsMapBoardDimensions(map)) {
  const regionWidth = map.mapRegionWidth || map.width;
  const regionHeight = map.mapRegionHeight || map.height;
  if (!regionWidth || !regionHeight || !map.mapRegions?.length) return [];
  const walls = [];
  const seen = new Set();

  map.mapRegions.forEach((region, regionIndex) => {
    const points = (region.points || [])
      .map((point) => pointToBoard(point, regionWidth, regionHeight, dimensions))
      .filter(Boolean);
    if (points.length < 2) return;

    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      if (!next || samePoint(point, next)) return;
      const key = getWallKey(point, next);
      if (seen.has(key)) return;
      seen.add(key);
      walls.push({
        id: `wall-map-${regionIndex}-${index}`,
        estimated: true,
        start: point,
        end: next,
      });
    });
  });

  return walls;
}

export function makeFiveEToolsMapBoard(map, assetPath, { useRegionWalls = false } = {}) {
  const dimensions = getFiveEToolsMapBoardDimensions(map);
  return {
    ...makeBoard(map.displayTitle || 'Imported Map'),
    name: map.displayTitle || 'Imported Map',
    columns: dimensions.columns,
    rows: dimensions.rows,
    background: {
      src: assetPath,
      type: 'image',
      muted: true,
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      fitToBoard: true,
    },
    lighting: {
      ...defaultLighting,
      walls: useRegionWalls ? getFiveEToolsMapRegionWalls(map, dimensions) : [],
    },
    doors: [],
    tokens: [],
    drawings: [],
    fiveETools: {
      mapId: map.id,
      sourceId: map.sourceId,
      sourceName: map.sourceName,
      chapterName: map.chapterName,
      imageType: map.imageType,
      grid: map.grid,
      mapRegions: map.mapRegions,
      mapParent: map.mapParent,
      width: map.width,
      height: map.height,
      regionWallsEstimated: useRegionWalls,
    },
  };
}

function pointToBoard(point, regionWidth, regionHeight, dimensions) {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every((n) => Number.isFinite(Number(n)))) return null;
  return {
    x: clampWallCoordinate((Number(point[0]) / regionWidth) * dimensions.columns, dimensions.columns),
    y: clampWallCoordinate((Number(point[1]) / regionHeight) * dimensions.rows, dimensions.rows),
  };
}

function clampWallCoordinate(value, max) {
  return Math.max(-0.5, Math.min(max - 0.5, value - 0.5));
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function getWallKey(a, b) {
  const first = serializeWallPoint(a);
  const second = serializeWallPoint(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function serializeWallPoint(point) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function clampBoardTiles(value) {
  return Math.max(4, Math.min(200, Number(value) || 24));
}
