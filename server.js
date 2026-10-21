import express from 'express';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import multer from 'multer';
import unzipper from 'unzipper';
import { makeProject, normalizeBoard, normalizeLibraryToken } from './src/lib/board.js';
import { makeFiveEToolsMapBoard, normalizeFiveEToolsBaseUrl } from './src/lib/fiveETools.js';
import { ImportError } from './src/lib/importErrors.js';
import { fetchRemoteJson, fetchRemoteImage, remoteErrorBody } from './server/remoteContent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.TABLEFORGE_DATA_DIR || path.join(__dirname, 'data');
const legacyDataFile = path.join(dataDir, 'projects.json');
const openProjectFile = path.join(dataDir, 'open-project.json');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const audioExtensions = new Set(['.mp3', '.wav']);
const videoExtensions = new Set(['.mp4', '.webm', '.mov']);
const maxProjectAssetUploadBytes = 1024 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_request, _file, callback) => {
      try {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tableforge-asset-upload-'));
        callback(null, tempDir);
      } catch (error) {
        callback(error);
      }
    },
    filename: (_request, file, callback) => {
      callback(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname || '.asset')}`);
    },
  }),
  limits: { fileSize: maxProjectAssetUploadBytes },
});
const importUpload = multer({
  storage: multer.diskStorage({
    destination: async (_request, _file, callback) => {
      try {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tableforge-import-upload-'));
        callback(null, tempDir);
      } catch (error) {
        callback(error);
      }
    },
    filename: (_request, file, callback) => {
      callback(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname || '.zip')}`);
    },
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
});

app.use(express.json({ limit: '50mb' }));
app.use((_request, response, next) => {
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self' http: https: ws: wss:",
    ].join('; '),
  );
  next();
});

function projectDir(projectId) {
  return path.join(dataDir, projectId);
}

function projectFile(projectId) {
  return path.join(projectDir(projectId), 'project.json');
}

function projectAssetDir(projectId, bucket) {
  return path.join(projectDir(projectId), 'assets', bucket);
}

function isProjectId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value) && !value.includes('..');
}

function sanitizeFilename(value) {
  const extension = path.extname(value || '').toLowerCase();
  const basename = path.basename(value || 'asset', extension)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
  return `${basename}${extension}`;
}

function sanitizeArchiveName(value) {
  const basename = String(value || 'project')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
  return `${basename}.zip`;
}

function getAssetBucket(file, requestedType = '') {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const assetType = String(requestedType || '').toLowerCase();
  if (file.mimetype?.startsWith('audio/') || audioExtensions.has(extension)) return 'audio';
  if (file.mimetype?.startsWith('video/') || videoExtensions.has(extension)) return 'videos';
  if (file.mimetype?.startsWith('image/') || imageExtensions.has(extension)) return 'images';
  if (assetType === 'audio') return 'audio';
  if (assetType === 'video') return 'videos';
  if (assetType === 'image') return 'images';
  return null;
}

function getAssetCategory(file, fallback = '') {
  const normalized = String(fallback || '').trim().toLowerCase();
  if (['map', 'token', 'music', 'audio', 'image', 'video'].includes(normalized)) return normalized;
  if (file.mimetype?.startsWith('video/')) return 'video';
  return file.mimetype?.startsWith('audio/') ? 'audio' : 'image';
}

function isAllowedAsset(file, bucket) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (bucket === 'images') return imageExtensions.has(extension);
  if (bucket === 'audio') return audioExtensions.has(extension);
  if (bucket === 'videos') return videoExtensions.has(extension);
  return false;
}

function mimeTypeForExtension(extension) {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function supportedAssetExtension(value) {
  const extension = path.extname(value || '').toLowerCase();
  return imageExtensions.has(extension) || audioExtensions.has(extension) || videoExtensions.has(extension) ? extension : '';
}

function remoteAssetOriginalName(displayName, remotePathname, extension) {
  const fallbackName = path.basename(decodeURIComponent(remotePathname || '')) || 'remote-map';
  const rawName = String(displayName || fallbackName).trim() || fallbackName;
  return sanitizeFilename(`${rawName}${extension && !supportedAssetExtension(rawName) ? extension : ''}`);
}

async function saveProjectAsset(project, file, fields = {}, { persist = true } = {}) {
  const bucket = getAssetBucket(file, fields.assetType);
  if (!bucket || !isAllowedAsset(file, bucket)) {
    const error = new ImportError('ASSET_UNSUPPORTED_FORMAT', 'Unsupported asset format. Use PNG, JPEG, WebP, MP3, WAV, MP4, WebM, or MOV.');
    error.status = 400;
    throw error;
  }

  const safeName = sanitizeFilename(file.originalname);
  const extension = path.extname(safeName).toLowerCase();
  const mimePrefix = bucket === 'images' ? 'image/' : bucket === 'videos' ? 'video/' : 'audio/';
  const mimeType = file.mimetype?.startsWith(mimePrefix)
    ? file.mimetype
    : mimeTypeForExtension(extension);
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  const targetDir = projectAssetDir(project.id, bucket);
  const targetFile = path.join(targetDir, storedName);
  await fs.mkdir(targetDir, { recursive: true });
  if (file.path) {
    await fs.copyFile(file.path, targetFile);
  } else {
    await fs.writeFile(targetFile, file.buffer);
  }

  const asset = {
    id: `asset-${Date.now()}-${randomUUID().slice(0, 8)}`,
    name: fields.name?.trim() || safeName,
    filename: storedName,
    originalName: file.originalname,
    bucket,
    type: bucket === 'images' ? 'image' : bucket === 'videos' ? 'video' : 'audio',
    category: getAssetCategory(file, fields.category || fields.assetType),
    mimeType,
    size: file.size,
    path: `/api/projects/${encodeURIComponent(project.id)}/assets/${bucket}/${encodeURIComponent(storedName)}`,
    createdAt: new Date().toISOString(),
  };
  const assets = [...(project.assets || []), asset];
  if (persist) await writeProject({ ...project, assets });
  return { asset, assets };
}

function uploadProjectAssetFile(request, response, next) {
  upload.single('file')(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json(remoteErrorBody(new ImportError('ASSET_TOO_LARGE', 'Asset is larger than 1 GB. Choose a smaller file.')));
      return;
    }
    response.status(400).json(remoteErrorBody(new ImportError('ASSET_UPLOAD_FAILED', error.message || 'Unable to upload asset. Retry the file.')));
  });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempFile = path.join(path.dirname(file), `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, file);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureProjectFolders(projectId) {
  await fs.mkdir(projectAssetDir(projectId, 'images'), { recursive: true });
  await fs.mkdir(projectAssetDir(projectId, 'audio'), { recursive: true });
  await fs.mkdir(projectAssetDir(projectId, 'videos'), { recursive: true });
}

async function readOpenProjectId() {
  const data = await readJson(openProjectFile, { openProjectId: null });
  return data.openProjectId || null;
}

async function writeOpenProjectId(openProjectId) {
  await writeJsonAtomic(openProjectFile, { openProjectId });
}

async function listProjectIds() {
  await fs.mkdir(dataDir, { recursive: true });
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && isProjectId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function readProject(projectId) {
  if (!isProjectId(projectId)) return null;
  const project = await readJson(projectFile(projectId), null);
  if (!project) return null;
  return {
    ...project,
    assets: Array.isArray(project.assets) ? project.assets : [],
  };
}

async function writeProject(project) {
  if (!isProjectId(project.id)) throw new Error('Invalid project id.');
  const existing = await readProject(project.id);
  const nextProject = {
    ...project,
    assets: Array.isArray(project.assets) ? project.assets : existing?.assets || [],
  };
  await ensureProjectFolders(project.id);
  await writeJsonAtomic(projectFile(project.id), nextProject);
  return nextProject;
}

function boardAssetReferences(board) {
  const references = new Set();
  const add = (value) => {
    if (typeof value === 'string' && (value.includes('/assets/images/') || value.includes('/assets/videos/'))) references.add(value);
  };
  add(board?.background?.src);
  for (const token of board?.tokens || []) add(token.image);
  return references;
}

async function pruneBoardAssets(project, removedBoard) {
  const removedRefs = boardAssetReferences(removedBoard);
  if (!removedRefs.size) return project.assets || [];
  const remainingRefs = new Set();
  for (const board of project.state?.boards || []) {
    for (const reference of boardAssetReferences(board)) remainingRefs.add(reference);
  }
  const nextAssets = [];
  for (const asset of project.assets || []) {
    const isRemovedBoardMedia = ['image', 'video'].includes(asset.type) && removedRefs.has(asset.path) && !remainingRefs.has(asset.path);
    if (!isRemovedBoardMedia) {
      nextAssets.push(asset);
      continue;
    }
    if (asset.filename && ['images', 'videos'].includes(asset.bucket)) {
      await fs.rm(path.join(projectAssetDir(project.id, asset.bucket), asset.filename), { force: true }).catch(() => {});
    }
  }
  return nextAssets;
}

async function readProjects() {
  const ids = await listProjectIds();
  if (!ids.length && await pathExists(legacyDataFile)) {
    const legacy = await readJson(legacyDataFile, { projects: [], openProjectId: null });
    return {
      projects: (legacy.projects || []).map((project) => ({ ...project, assets: Array.isArray(project.assets) ? project.assets : [] })),
      openProjectId: legacy.openProjectId || null,
    };
  }
  const projects = (await Promise.all(ids.map((id) => readProject(id)))).filter(Boolean);
  const openProjectId = await readOpenProjectId();
  return {
    projects,
    openProjectId: projects.some((project) => project.id === openProjectId) ? openProjectId : null,
  };
}

async function projectExists(projectId) {
  return isProjectId(projectId) && await pathExists(projectFile(projectId));
}

function validateProjectSchema(project) {
  return Boolean(
    project
    && typeof project === 'object'
    && isProjectId(project.id)
    && typeof project.name === 'string'
    && project.name.trim()
    && project.state
    && typeof project.state === 'object'
    && Array.isArray(project.state.boards)
  );
}

function validateArchiveEntryPath(entryName, targetDirectory) {
  if (!entryName || entryName.includes('\0')) {
    throw new Error('Invalid archive entry.');
  }
  const normalizedName = entryName.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalizedName)) {
    throw new Error('Malicious entry detected (Directory Traversal Attack blocked).');
  }
  const normalized = path.posix.normalize(normalizedName);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Malicious entry detected (Directory Traversal Attack blocked).');
  }
  const targetFile = path.resolve(targetDirectory, ...normalized.split('/'));
  const boundary = path.resolve(targetDirectory);
  if (targetFile !== boundary && !targetFile.startsWith(boundary + path.sep)) {
    throw new Error('Malicious entry detected (Directory Traversal Attack blocked).');
  }
  return { normalized, targetFile };
}

function validateArchiveShape(entry, normalized) {
  const isDirectory = entry.type === 'Directory';
  const withoutTrailingSlash = normalized.replace(/\/$/, '');
  if (isDirectory) {
    if (['assets', 'assets/images', 'assets/audio', 'assets/videos'].includes(withoutTrailingSlash)) return;
    throw new Error(`Unexpected directory in archive: ${entry.path}`);
  }
  if (normalized === 'project.json') return;
  const imagePrefix = 'assets/images/';
  const audioPrefix = 'assets/audio/';
  const videoPrefix = 'assets/videos/';
  if (normalized.startsWith(imagePrefix)) {
    const filename = normalized.slice(imagePrefix.length);
    if (filename && filename === path.posix.basename(filename) && imageExtensions.has(path.extname(filename).toLowerCase())) return;
  }
  if (normalized.startsWith(audioPrefix)) {
    const filename = normalized.slice(audioPrefix.length);
    if (filename && filename === path.posix.basename(filename) && audioExtensions.has(path.extname(filename).toLowerCase())) return;
  }
  if (normalized.startsWith(videoPrefix)) {
    const filename = normalized.slice(videoPrefix.length);
    if (filename && filename === path.posix.basename(filename) && videoExtensions.has(path.extname(filename).toLowerCase())) return;
  }
  throw new Error(`Unexpected file in archive: ${entry.path}`);
}

async function inspectProjectArchive(zipFile) {
  const archive = await unzipper.Open.file(zipFile);
  const projectEntry = archive.files.find((entry) => entry.path === 'project.json' && entry.type !== 'Directory');
  if (!projectEntry) {
    const error = new Error('Archive must contain a root-level project.json file.');
    error.status = 400;
    throw error;
  }
  let project;
  try {
    project = JSON.parse((await projectEntry.buffer()).toString('utf8'));
  } catch {
    const error = new Error('project.json is not valid JSON.');
    error.status = 400;
    throw error;
  }
  if (!validateProjectSchema(project)) {
    const error = new Error('project.json does not match this application schema.');
    error.status = 400;
    throw error;
  }
  const targetDirectory = projectDir(project.id);
  for (const entry of archive.files) {
    const { normalized } = validateArchiveEntryPath(entry.path, targetDirectory);
    validateArchiveShape(entry, normalized);
  }
  return { project, archive };
}

async function extractProjectArchive(archive, targetDirectory) {
  const stagingDirectory = path.join(dataDir, `.import-${Date.now()}-${randomUUID()}`);
  try {
    await fs.mkdir(stagingDirectory, { recursive: true });
    for (const entry of archive.files) {
      const { normalized, targetFile } = validateArchiveEntryPath(entry.path, stagingDirectory);
      validateArchiveShape(entry, normalized);
      if (entry.type === 'Directory') {
        await fs.mkdir(targetFile, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await new Promise((resolve, reject) => {
        entry
          .stream()
          .pipe(createWriteStream(targetFile))
          .on('finish', resolve)
          .on('error', reject);
      });
    }
    await fs.rm(targetDirectory, { recursive: true, force: true });
    await fs.rename(stagingDirectory, targetDirectory);
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    app: 'tableforge',
    dataDir,
  });
});

app.get('/api/projects', async (_request, response) => {
  response.json(await readProjects());
});

// The client decodes a map backup and prepares a PNG before this request. Commit the
// background and complete board together, preserving the current player board.
const scrawlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, fieldSize: 4 * 1024 * 1024, files: 1, fields: 3 } });
app.post(['/api/dungeon-scrawl/import', '/api/inkarnate/import'], (request, response, next) => {
  scrawlUpload.single('file')(request, response, (error) => {
    if (error) response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The rendered map exceeds 25 MB. Import a smaller map.' : 'Unable to read the map upload.' });
    else next();
  });
}, async (request, response) => {
  let createdAsset;
  let project;
  let isNew = false;
  let committed = false;
  try {
    if (!request.file?.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('The rendered map must be a PNG image.');
    let raw;
    try { raw = JSON.parse(request.body.board); } catch { throw new Error('Invalid imported board.'); }
    const validPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1000 && Math.abs(p.y) <= 1000;
    const expectedSource = request.path === '/api/inkarnate/import' ? 'inkarnate' : 'dungeon-scrawl';
    if (raw?.importMetadata?.source !== expectedSource || typeof raw.name !== 'string' || !raw.name.trim()
      || ![raw.rows, raw.columns].every((n) => Number.isInteger(n) && n >= 4 && n <= 200)
      || !Array.isArray(raw.lighting?.walls) || raw.lighting.walls.length > 4000
      || raw.lighting.walls.some((wall) => !validPoint(wall.start) || !validPoint(wall.end))
      || !Array.isArray(raw.lighting?.lights) || raw.lighting.lights.length > 64
      || raw.lighting.lights.some((light) => !validPoint(light) || !Number.isFinite(light.radiusFeet) || light.radiusFeet < 0 || light.radiusFeet > 1000)
      || !Array.isArray(raw.doors) || raw.doors.length > 1000
      || raw.doors.some((door) => !validPoint(door.position) || !Array.isArray(door.lightingSegment) || door.lightingSegment.length !== 2 || door.lightingSegment.some((p) => !Array.isArray(p) || p.length !== 2 || !validPoint({ x: p[0], y: p[1] })))) throw new Error('The imported board contains invalid geometry.');
    const board = normalizeBoard({ ...raw, id: `board-${randomUUID()}`, name: raw.name.trim().slice(0, 120), tileSize: 42, tokens: [], drawings: [] });
    const data = await readProjects();
    if (request.body.projectId) {
      project = await readProject(request.body.projectId);
      if (!project) { response.status(404).json({ error: 'Campaign not found. Open it again before importing.' }); return; }
    } else {
      const name = String(request.body.campaignName || board.name).trim().slice(0, 120);
      if (data.projects.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) { response.status(409).json({ error: 'A campaign with that name already exists. Choose another name or import from inside that campaign.' }); return; }
      project = makeProject(name);
      isNew = true;
    }
    const media = await saveProjectAsset(project, { ...request.file, originalname: `${board.name}.png`, mimetype: 'image/png' }, { name: board.name, category: 'map' }, { persist: false });
    createdAsset = media.asset;
    board.background = { ...board.background, src: media.asset.path, type: 'image', opacity: 1, x: 0, y: 0, scale: 1, fitToBoard: true };
    const saved = await writeProject({
      ...project,
      assets: media.assets,
      updatedAt: new Date().toISOString(),
      state: { ...project.state, boards: isNew ? [board] : [...project.state.boards, board], activeBoardId: board.id, playerBoardId: isNew ? board.id : project.state.playerBoardId },
    });
    committed = true;
    response.status(201).json({ projects: isNew ? [...data.projects, saved] : data.projects.map((item) => item.id === saved.id ? saved : item), openProjectId: data.openProjectId, importedProjectId: saved.id, importedBoardId: board.id, assets: media.assets });
  } catch (error) {
    if (!committed && project) {
      if (isNew) await fs.rm(projectDir(project.id), { recursive: true, force: true }).catch(() => {});
      else if (createdAsset) await fs.rm(path.join(projectAssetDir(project.id, 'images'), createdAsset.filename), { force: true }).catch(() => {});
    }
    response.status(400).json({ error: error.message || 'Unable to save the imported map.' });
  }
});

app.post('/api/projects', async (request, response) => {
  const data = await readProjects();
  const project = request.body;
  if (!isProjectId(project.id)) {
    response.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  if (data.projects.some((item) => item.name.trim().toLowerCase() === project.name.trim().toLowerCase())) {
    response.status(409).json({ error: 'A project with that name already exists.' });
    return;
  }
  const savedProject = await writeProject({ ...project, assets: Array.isArray(project.assets) ? project.assets : [] });
  await writeOpenProjectId(savedProject.id);
  response.status(201).json({ projects: [...data.projects, savedProject], openProjectId: savedProject.id });
});

app.put('/api/projects/:id', async (request, response) => {
  const data = await readProjects();
  if (!await projectExists(request.params.id)) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (data.projects.some((project) => project.id !== request.params.id && project.name.trim().toLowerCase() === request.body.name.trim().toLowerCase())) {
    response.status(409).json({ error: 'A project with that name already exists.' });
    return;
  }
  const savedProject = await writeProject({ ...request.body, id: request.params.id });
  response.json({
    projects: data.projects.map((project) => project.id === request.params.id ? savedProject : project),
    openProjectId: data.openProjectId,
  });
});

app.delete('/api/projects/:id', async (request, response) => {
  const data = await readProjects();
  if (!isProjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  await fs.rm(projectDir(request.params.id), { recursive: true, force: true });
  const openProjectId = data.openProjectId === request.params.id ? null : data.openProjectId;
  await writeOpenProjectId(openProjectId);
  response.json({
    projects: data.projects.filter((project) => project.id !== request.params.id),
    openProjectId,
  });
});

app.delete('/api/projects/:projectId/boards/:boardId', async (request, response) => {
  const project = await readProject(request.params.projectId);
  if (!project) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  const boards = project.state?.boards || [];
  if (boards.length <= 1) {
    response.status(400).json({ error: 'A campaign must keep at least one board.' });
    return;
  }
  const removedBoard = boards.find((board) => board.id === request.params.boardId);
  if (!removedBoard) {
    response.status(404).json({ error: 'Board not found.' });
    return;
  }

  const remainingBoards = boards.filter((board) => board.id !== request.params.boardId);
  const landingBoard = remainingBoards[0];
  const nextProject = {
    ...project,
    state: {
      ...project.state,
      boards: remainingBoards,
      activeBoardId: project.state.activeBoardId === request.params.boardId ? landingBoard.id : project.state.activeBoardId,
      playerBoardId: project.state.playerBoardId === request.params.boardId ? landingBoard.id : project.state.playerBoardId,
    },
    updatedAt: new Date().toISOString(),
  };
  nextProject.assets = await pruneBoardAssets(nextProject, removedBoard);
  const savedProject = await writeProject(nextProject);
  const data = await readProjects();
  response.json({
    projects: data.projects.map((item) => item.id === savedProject.id ? savedProject : item),
    openProjectId: data.openProjectId,
  });
});

app.get('/api/projects/:projectId/export', async (request, response, next) => {
  try {
    const project = await readProject(request.params.projectId);
    if (!project) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeArchiveName(project.name)}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(response);
    archive.directory(projectDir(project.id), false);
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/import', importUpload.single('file'), async (request, response) => {
  const uploadedFile = request.file?.path;
  const uploadedDir = uploadedFile ? path.dirname(uploadedFile) : null;
  try {
    if (!uploadedFile) {
      response.status(400).json({ error: 'No archive uploaded.' });
      return;
    }
    if (path.extname(request.file.originalname || '').toLowerCase() !== '.zip') {
      response.status(400).json({ error: 'Import file must be a .zip archive.' });
      return;
    }

    await fs.mkdir(dataDir, { recursive: true });
    const { project, archive } = await inspectProjectArchive(uploadedFile);
    const overwrite = String(request.query.overwrite || 'false').toLowerCase() === 'true';
    const existingDirectory = await pathExists(projectDir(project.id));
    const existingProject = await readProject(project.id);

    if (existingDirectory && !overwrite) {
      response.status(409).json({
        error: 'Project already exists.',
        conflict: {
          id: existingProject?.id || project.id,
          name: existingProject?.name || project.id,
          incomingName: project.name,
        },
      });
      return;
    }

    await extractProjectArchive(archive, projectDir(project.id));
    await ensureProjectFolders(project.id);
    await writeOpenProjectId(project.id);
    const data = await readProjects();
    response.status(existingDirectory ? 200 : 201).json({ ...data, importedProjectId: project.id });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || 'Unable to import project archive.' });
  } finally {
    if (uploadedDir) await fs.rm(uploadedDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post('/api/projects/:id/open', async (request, response) => {
  if (!await projectExists(request.params.id)) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  await writeOpenProjectId(request.params.id);
  const data = await readProjects();
  response.json({ ...data, openProjectId: request.params.id });
});

app.get('/api/projects/:projectId/assets', async (request, response) => {
  const project = await readProject(request.params.projectId);
  if (!project) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  response.json({ assets: project.assets || [] });
});

app.post('/api/projects/:projectId/assets', uploadProjectAssetFile, async (request, response) => {
  const uploadedFile = request.file?.path;
  const uploadedDir = uploadedFile ? path.dirname(uploadedFile) : null;
  try {
    const project = await readProject(request.params.projectId);
    if (!project) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }
    if (!request.file) {
      response.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    const data = await saveProjectAsset(project, request.file, request.body);
    response.status(201).json(data);
  } catch (error) {
    response.status(error.status || 400).json(remoteErrorBody(error));
  } finally {
    if (uploadedDir) await fs.rm(uploadedDir, { recursive: true, force: true }).catch(() => {});
  }
});

function remoteRequestSignal(response) {
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  return controller.signal;
}

async function downloadProjectImage(project, url, name, category, signal) {
  const image = await fetchRemoteImage(url, { signal });
  return saveProjectAsset(project, {
    originalname: remoteAssetOriginalName(name, new URL(image.url).pathname, image.extension),
    mimetype: image.mimeType, size: image.buffer.length, buffer: image.buffer,
  }, { name, category, assetType: 'image' }, { persist: false });
}

async function removeImportedAssets(project, assets) {
  await Promise.all(assets.map((asset) => fs.rm(path.join(projectAssetDir(project.id, asset.bucket), asset.filename), { force: true })));
}

app.post('/api/projects/:projectId/assets/remote', async (request, response) => {
  let created;
  let project;
  try {
    project = await readProject(request.params.projectId);
    if (!project) throw new ImportError('CAMPAIGN_NOT_FOUND', 'Open the campaign again before importing.', { status: 404 });
    const media = await downloadProjectImage(project, request.body.url, request.body.name, request.body.category || 'map', remoteRequestSignal(response));
    created = media.asset;
    const latest = await readProject(project.id);
    if (!latest) throw new ImportError('CAMPAIGN_NOT_FOUND', 'The campaign was removed during the import.', { status: 404 });
    const assets = [...latest.assets, created];
    await writeProject({ ...latest, assets });
    response.status(201).json({ asset: created, assets });
  } catch (error) {
    if (created) await removeImportedAssets(project, [created]).catch(() => {});
    if (!response.destroyed) response.status(error.status || 500).json(remoteErrorBody(error));
  }
});

// Stream download progress, then commit the complete selection once. A failed
// map must not leave an empty campaign or orphan assets behind on retry.
app.post('/api/5etools/import', async (request, response) => {
  const signal = remoteRequestSignal(response);
  const createdAssets = [];
  let project;
  let isNew = false;
  let committed = false;
  const emit = (event) => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
  try {
    const maps = request.body.maps;
    if (!Array.isArray(maps) || !maps.length || maps.length > 500 || maps.some((map) => !map || typeof map.imageUrl !== 'string' || !map.imageUrl)) throw new ImportError('INVALID_MAP_SELECTION', 'Select between 1 and 500 maps with valid image URLs.', { status: 400 });
    const baseUrl = normalizeFiveEToolsBaseUrl(request.body.baseUrl);
    if (request.body.projectId) {
      project = await readProject(request.body.projectId);
      if (!project) throw new ImportError('CAMPAIGN_NOT_FOUND', 'Open the campaign again before importing.', { status: 404 });
    } else {
      const name = String(request.body.campaignName || 'Imported Campaign').trim().slice(0, 120) || 'Imported Campaign';
      if ((await readProjects()).projects.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) throw new ImportError('CAMPAIGN_NAME_EXISTS', 'A campaign with this name already exists. Choose another name or import from inside that campaign.', { status: 409 });
      project = makeProject(name);
      isNew = true;
    }
    response.setHeader('Content-Type', 'application/x-ndjson');
    response.setHeader('Cache-Control', 'no-store');
    const boards = [];
    for (const [index, map] of maps.entries()) {
      emit({ type: 'progress', completed: index, total: maps.length, map: { displayTitle: map.displayTitle } });
      let media;
      try { media = await downloadProjectImage(project, map.imageUrl, map.displayTitle || 'Imported Map', 'map', signal); }
      catch (error) { error.message = `${map.displayTitle || 'Map'}: ${error.message} No maps from this attempt were saved.`; throw error; }
      createdAssets.push(media.asset);
      boards.push(makeFiveEToolsMapBoard(map, media.asset.path, { useRegionWalls: Boolean(request.body.useRegionWalls) }));
    }
    signal.throwIfAborted();
    const latest = isNew ? project : await readProject(project.id);
    if (!latest) throw new ImportError('CAMPAIGN_NOT_FOUND', 'The campaign was removed during the import. No maps were saved.', { status: 404 });
    if (isNew && (await readProjects()).projects.some((entry) => entry.name.toLowerCase() === project.name.toLowerCase())) throw new ImportError('CAMPAIGN_NAME_EXISTS', 'A campaign with this name was created during the import. Choose another name.', { status: 409 });
    const saved = await writeProject({
      ...latest, assets: [...(latest.assets || []), ...createdAssets], updatedAt: new Date().toISOString(),
      state: { ...latest.state, fiveEToolsBaseUrl: baseUrl, boards: isNew ? boards : [...latest.state.boards, ...boards], activeBoardId: boards[0].id, playerBoardId: isNew ? boards[0].id : latest.state.playerBoardId },
    });
    if (isNew) await writeOpenProjectId(saved.id);
    committed = true;
    emit({ type: 'complete', payload: await readProjects(), projectId: saved.id, assets: saved.assets, importedBoards: boards });
    response.end();
  } catch (error) {
    if (!committed && project) {
      if (isNew) await fs.rm(projectDir(project.id), { recursive: true, force: true }).catch(() => {});
      else await removeImportedAssets(project, createdAssets).catch(() => {});
    }
    if (response.destroyed) return;
    const body = remoteErrorBody(error);
    if (response.headersSent) { emit({ type: 'error', ...body }); response.end(); }
    else response.status(error.status || 400).json(body);
  }
});

app.post('/api/projects/:projectId/tokens/remote', async (request, response) => {
  let project;
  let asset;
  let committed = false;
  try {
    project = await readProject(request.params.projectId);
    if (!project) throw new ImportError('CAMPAIGN_NOT_FOUND', 'Open the campaign again before saving this token.', { status: 404 });
    if (typeof request.body.token?.label !== 'string' || !request.body.token.label.trim()) throw new ImportError('INVALID_TOKEN', 'Choose a monster before saving a token.', { status: 400 });
    const token = normalizeLibraryToken(request.body.token);
    const signal = remoteRequestSignal(response);
    if (token.image) {
      const media = await downloadProjectImage(project, token.image, token.label, 'token', signal);
      asset = media.asset;
      token.image = asset.path;
    }
    signal.throwIfAborted();
    const latest = await readProject(project.id);
    if (!latest) throw new ImportError('CAMPAIGN_NOT_FOUND', 'The campaign was removed during the import.', { status: 404 });
    if (token.meta?.importKey && latest.state.tokenLibrary?.some((entry) => entry.meta?.importKey === token.meta.importKey || (entry.label === token.label && entry.meta?.source === token.meta.source && entry.meta?.origin === token.meta.origin))) throw new ImportError('TOKEN_ALREADY_SAVED', 'This monster is already in the token library. Open Saved Tokens to use it.', { status: 409 });
    const saved = await writeProject({ ...latest, assets: [...latest.assets, ...(asset ? [asset] : [])], updatedAt: new Date().toISOString(), state: { ...latest.state, tokenLibrary: [...(latest.state.tokenLibrary || []), token] } });
    committed = true;
    response.status(201).json({ payload: await readProjects(), assets: saved.assets, token });
  } catch (error) {
    if (asset && !committed) await removeImportedAssets(project, [asset]).catch(() => {});
    if (!response.destroyed) response.status(error.status || 500).json(remoteErrorBody(error));
  }
});

app.get('/api/projects/:projectId/assets/:bucket/:filename', async (request, response) => {
  const { projectId, bucket, filename } = request.params;
  if (!isProjectId(projectId) || !['images', 'audio', 'videos'].includes(bucket) || filename !== path.basename(filename)) {
    response.status(400).json({ error: 'Invalid asset path.' });
    return;
  }
  if (!await projectExists(projectId)) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  response.sendFile(path.join(projectAssetDir(projectId, bucket), filename));
});

app.get('/api/5etools', async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.json(await fetchRemoteJson(request.query.url, { signal: remoteRequestSignal(response) }));
  } catch (error) {
    if (!response.destroyed) response.status(error.status || 500).json(remoteErrorBody(error));
  }
});

app.get('/api/5etools/image', async (request, response) => {
  try {
    const image = await fetchRemoteImage(request.query.url, { signal: remoteRequestSignal(response) });
    response.setHeader('Cache-Control', 'no-store');
    response.type(image.mimeType).send(image.buffer);
  } catch (error) {
    if (!response.destroyed) response.status(error.status || 500).json(remoteErrorBody(error));
  }
});

app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));
app.use(express.static(path.join(__dirname, 'dist')));
app.use((_request, response) => {
  response.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Tableforge host running on http://${host}:${port}`);
  if (process.send) {
    process.send({ type: 'ready', port, host, dataDir });
  }
});
