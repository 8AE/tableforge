import express from 'express';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const app = express();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.TABLEFORGE_DATA_DIR || path.join(__dirname, 'data');
const legacyDataFile = path.join(dataDir, 'projects.json');
const openProjectFile = path.join(dataDir, 'open-project.json');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const audioExtensions = new Set(['.mp3', '.wav']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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
  if (assetType === 'audio' || file.mimetype?.startsWith('audio/') || audioExtensions.has(extension)) return 'audio';
  if (assetType === 'image' || file.mimetype?.startsWith('image/') || imageExtensions.has(extension)) return 'images';
  return null;
}

function getAssetCategory(file, fallback = '') {
  const normalized = String(fallback || '').trim().toLowerCase();
  if (['map', 'token', 'music', 'audio', 'image'].includes(normalized)) return normalized;
  return file.mimetype?.startsWith('audio/') ? 'audio' : 'image';
}

function isAllowedAsset(file, bucket) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (bucket === 'images') return imageExtensions.has(extension) && file.mimetype?.startsWith('image/');
  if (bucket === 'audio') return audioExtensions.has(extension) && file.mimetype?.startsWith('audio/');
  return false;
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
    if (['assets', 'assets/images', 'assets/audio'].includes(withoutTrailingSlash)) return;
    throw new Error(`Unexpected directory in archive: ${entry.path}`);
  }
  if (normalized === 'project.json') return;
  const imagePrefix = 'assets/images/';
  const audioPrefix = 'assets/audio/';
  if (normalized.startsWith(imagePrefix)) {
    const filename = normalized.slice(imagePrefix.length);
    if (filename && filename === path.posix.basename(filename) && imageExtensions.has(path.extname(filename).toLowerCase())) return;
  }
  if (normalized.startsWith(audioPrefix)) {
    const filename = normalized.slice(audioPrefix.length);
    if (filename && filename === path.posix.basename(filename) && audioExtensions.has(path.extname(filename).toLowerCase())) return;
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

app.post('/api/projects/:projectId/assets', upload.single('file'), async (request, response) => {
  const project = await readProject(request.params.projectId);
  if (!project) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (!request.file) {
    response.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const bucket = getAssetBucket(request.file, request.body.assetType);
  if (!bucket || !isAllowedAsset(request.file, bucket)) {
    response.status(400).json({ error: 'Unsupported asset format.' });
    return;
  }

  const safeName = sanitizeFilename(request.file.originalname);
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  const targetDir = projectAssetDir(project.id, bucket);
  const targetFile = path.join(targetDir, storedName);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetFile, request.file.buffer);

  const asset = {
    id: `asset-${Date.now()}-${randomUUID().slice(0, 8)}`,
    name: request.body.name?.trim() || safeName,
    filename: storedName,
    originalName: request.file.originalname,
    bucket,
    type: bucket === 'images' ? 'image' : 'audio',
    category: getAssetCategory(request.file, request.body.category || request.body.assetType),
    mimeType: request.file.mimetype,
    size: request.file.size,
    path: `/api/projects/${encodeURIComponent(project.id)}/assets/${bucket}/${encodeURIComponent(storedName)}`,
    createdAt: new Date().toISOString(),
  };
  const savedProject = await writeProject({ ...project, assets: [...(project.assets || []), asset] });
  response.status(201).json({ asset, assets: savedProject.assets });
});

app.get('/api/projects/:projectId/assets/:bucket/:filename', async (request, response) => {
  const { projectId, bucket, filename } = request.params;
  if (!isProjectId(projectId) || !['images', 'audio'].includes(bucket) || filename !== path.basename(filename)) {
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
