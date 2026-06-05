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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.TABLEFORGE_DATA_DIR || path.join(__dirname, 'data');
const dungeonsDir = path.join(dataDir, 'dungeons');
const dungeonManifestFile = path.join(dungeonsDir, 'manifest.json');
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

function dungeonDir(dungeonId) {
  return path.join(dungeonsDir, dungeonId);
}

function dungeonFile(dungeonId) {
  return path.join(dungeonDir(dungeonId), 'dungeon.json');
}

function dungeonThumbnailFile(dungeonId) {
  return path.join(dungeonDir(dungeonId), 'thumbnail.png');
}

function isProjectId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value) && !value.includes('..');
}

function isDungeonId(value) {
  return isProjectId(value);
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

function sanitizeDungeonArchiveName(value) {
  return sanitizeArchiveName(value).replace(/\.zip$/i, '.tfd');
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

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '';
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

async function saveProjectAsset(project, file, fields = {}) {
  const bucket = getAssetBucket(file, fields.assetType);
  if (!bucket || !isAllowedAsset(file, bucket)) {
    const error = new Error('Unsupported asset format.');
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
  const savedProject = await writeProject({ ...project, assets: [...(project.assets || []), asset] });
  return { asset, assets: savedProject.assets };
}

function uploadProjectAssetFile(request, response, next) {
  upload.single('file')(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'Asset is larger than 1 GB.' });
      return;
    }
    response.status(400).json({ error: error.message || 'Unable to upload asset.' });
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

async function readDungeonManifest() {
  await fs.mkdir(dungeonsDir, { recursive: true });
  const manifest = await readJson(dungeonManifestFile, { dungeons: [] });
  return {
    dungeons: Array.isArray(manifest.dungeons) ? manifest.dungeons : [],
  };
}

async function writeDungeonManifest(dungeons) {
  await writeJsonAtomic(dungeonManifestFile, { dungeons });
}

function dungeonSummary(dungeon) {
  return {
    id: dungeon.id,
    name: dungeon.name,
    gridSize: dungeon.gridSize,
    updatedAt: dungeon.updatedAt || new Date().toISOString(),
    thumbnailUrl: `/api/dungeons/${encodeURIComponent(dungeon.id)}/thumbnail`,
  };
}

async function readDungeon(dungeonId) {
  if (!isDungeonId(dungeonId)) return null;
  return readJson(dungeonFile(dungeonId), null);
}

async function writeDungeon(dungeon, thumbnailDataUrl = '') {
  if (!isDungeonId(dungeon.id)) throw new Error('Invalid dungeon id.');
  const nextDungeon = {
    ...dungeon,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(dungeonDir(nextDungeon.id), { recursive: true });
  await writeJsonAtomic(dungeonFile(nextDungeon.id), nextDungeon);
  if (thumbnailDataUrl) {
    await writeDungeonThumbnail(nextDungeon.id, thumbnailDataUrl);
  }
  const manifest = await readDungeonManifest();
  const summary = dungeonSummary(nextDungeon);
  const dungeons = [
    summary,
    ...manifest.dungeons.filter((item) => item.id !== nextDungeon.id),
  ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  await writeDungeonManifest(dungeons);
  return nextDungeon;
}

async function writeDungeonThumbnail(dungeonId, dataUrl) {
  const match = String(dataUrl).match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return;
  await fs.writeFile(dungeonThumbnailFile(dungeonId), Buffer.from(match[1], 'base64'));
}

function validateDungeonSchema(dungeon) {
  return Boolean(
    dungeon
    && typeof dungeon === 'object'
    && isDungeonId(dungeon.id)
    && typeof dungeon.name === 'string'
    && dungeon.name.trim()
    && dungeon.gridSize
    && Number(dungeon.gridSize.width) >= 5
    && Number(dungeon.gridSize.height) >= 5
    && Array.isArray(dungeon.tiles)
    && Array.isArray(dungeon.terrain)
    && Array.isArray(dungeon.lightingGeometry)
  );
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

function validateDungeonArchiveShape(entry, normalized) {
  const isDirectory = entry.type === 'Directory';
  const withoutTrailingSlash = normalized.replace(/\/$/, '');
  if (isDirectory) {
    if (withoutTrailingSlash === '') return;
    throw new Error(`Unexpected directory in dungeon archive: ${entry.path}`);
  }
  if (normalized === 'dungeon.json' || normalized === 'thumbnail.png') return;
  throw new Error(`Unexpected file in dungeon archive: ${entry.path}`);
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

async function inspectDungeonArchive(zipFile) {
  const archive = await unzipper.Open.file(zipFile);
  const dungeonEntry = archive.files.find((entry) => entry.path === 'dungeon.json' && entry.type !== 'Directory');
  if (!dungeonEntry) {
    const error = new Error('Archive must contain a root-level dungeon.json file.');
    error.status = 400;
    throw error;
  }
  let dungeon;
  try {
    dungeon = JSON.parse((await dungeonEntry.buffer()).toString('utf8'));
  } catch {
    const error = new Error('dungeon.json is not valid JSON.');
    error.status = 400;
    throw error;
  }
  if (!validateDungeonSchema(dungeon)) {
    const error = new Error('dungeon.json does not match the dungeon schema.');
    error.status = 400;
    throw error;
  }
  const targetDirectory = dungeonDir(dungeon.id);
  for (const entry of archive.files) {
    const { normalized } = validateArchiveEntryPath(entry.path, targetDirectory);
    validateDungeonArchiveShape(entry, normalized);
  }
  return { dungeon, archive };
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

async function extractDungeonArchive(archive, targetDirectory) {
  const stagingDirectory = path.join(dungeonsDir, `.import-${Date.now()}-${randomUUID()}`);
  try {
    await fs.mkdir(stagingDirectory, { recursive: true });
    for (const entry of archive.files) {
      const { normalized, targetFile } = validateArchiveEntryPath(entry.path, stagingDirectory);
      validateDungeonArchiveShape(entry, normalized);
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
    response.status(error.status || 400).json({ error: error.message || 'Unable to save asset.' });
  } finally {
    if (uploadedDir) await fs.rm(uploadedDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post('/api/projects/:projectId/assets/remote', async (request, response) => {
  try {
    const project = await readProject(request.params.projectId);
    if (!project) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    const target = new URL(String(request.body.url || ''));
    if (!['http:', 'https:'].includes(target.protocol)) {
      response.status(400).json({ error: 'Remote asset URL must use http or https.' });
      return;
    }

    const upstream = await fetch(target);
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: `Unable to load ${target.href}` });
      return;
    }

    const upstreamMimeType = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || '';
    const extension = path.extname(target.pathname).toLowerCase() || extensionForMimeType(upstreamMimeType);
    const originalName = remoteAssetOriginalName(request.body.name, target.pathname, extension);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > 50 * 1024 * 1024) {
      response.status(413).json({ error: 'Remote asset is larger than 50 MB.' });
      return;
    }

    const data = await saveProjectAsset(
      project,
      {
        originalname: originalName,
        mimetype: upstreamMimeType,
        size: buffer.length,
        buffer,
      },
      { name: request.body.name, category: request.body.category || 'map', assetType: 'image' },
    );
    response.status(201).json(data);
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || 'Unable to import remote asset.' });
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

app.get('/api/dungeons', async (_request, response) => {
  const manifest = await readDungeonManifest();
  response.json({ dungeons: manifest.dungeons });
});

app.get('/api/dungeons/:id', async (request, response) => {
  const dungeon = await readDungeon(request.params.id);
  if (!dungeon) {
    response.status(404).json({ error: 'Dungeon not found.' });
    return;
  }
  response.json({ dungeon });
});

app.put('/api/dungeons/:id', async (request, response) => {
  const dungeon = { ...request.body.dungeon, id: request.params.id };
  if (!validateDungeonSchema(dungeon)) {
    response.status(400).json({ error: 'Invalid dungeon schema.' });
    return;
  }
  const savedDungeon = await writeDungeon(dungeon, request.body.thumbnailDataUrl);
  response.json({ dungeon: savedDungeon });
});

app.delete('/api/dungeons/:id', async (request, response) => {
  if (!isDungeonId(request.params.id)) {
    response.status(400).json({ error: 'Invalid dungeon id.' });
    return;
  }
  await fs.rm(dungeonDir(request.params.id), { recursive: true, force: true });
  const manifest = await readDungeonManifest();
  const dungeons = manifest.dungeons.filter((dungeon) => dungeon.id !== request.params.id);
  await writeDungeonManifest(dungeons);
  response.json({ dungeons });
});

app.get('/api/dungeons/:id/thumbnail', async (request, response) => {
  if (!isDungeonId(request.params.id)) {
    response.status(400).json({ error: 'Invalid dungeon id.' });
    return;
  }
  response.sendFile(dungeonThumbnailFile(request.params.id), (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: 'Thumbnail not found.' });
  });
});

app.get('/api/dungeons/:id/export', async (request, response, next) => {
  try {
    const dungeon = await readDungeon(request.params.id);
    if (!dungeon) {
      response.status(404).json({ error: 'Dungeon not found.' });
      return;
    }

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeDungeonArchiveName(dungeon.name)}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(response);
    archive.directory(dungeonDir(dungeon.id), false);
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

app.post('/api/dungeons/import', importUpload.single('file'), async (request, response) => {
  const uploadedFile = request.file?.path;
  const uploadedDir = uploadedFile ? path.dirname(uploadedFile) : null;
  try {
    if (!uploadedFile) {
      response.status(400).json({ error: 'No archive uploaded.' });
      return;
    }
    const extension = path.extname(request.file.originalname || '').toLowerCase();
    if (!['.zip', '.tfd'].includes(extension)) {
      response.status(400).json({ error: 'Import file must be a .zip or .tfd archive.' });
      return;
    }

    await fs.mkdir(dungeonsDir, { recursive: true });
    const { dungeon, archive } = await inspectDungeonArchive(uploadedFile);
    await extractDungeonArchive(archive, dungeonDir(dungeon.id));
    const savedDungeon = await writeDungeon(dungeon);
    const manifest = await readDungeonManifest();
    response.status(201).json({ dungeons: manifest.dungeons, importedDungeonId: savedDungeon.id });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || 'Unable to import dungeon archive.' });
  } finally {
    if (uploadedDir) await fs.rm(uploadedDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.get('/api/5etools', async (request, response) => {
  try {
    const target = new URL(String(request.query.url || ''));
    if (!['http:', 'https:'].includes(target.protocol)) {
      response.status(400).json({ error: '5e.tools URL must use http or https.' });
      return;
    }
    const upstream = await fetch(target);
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: `Unable to load ${target.href}` });
      return;
    }
    const data = await upstream.json();
    response.json(data);
  } catch {
    response.status(400).json({ error: 'Unable to load 5e.tools JSON. Check the base URL and bestiary data files.' });
  }
});

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
