import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const legacyFile = path.join(dataDir, 'projects.json');
const openProjectFile = path.join(dataDir, 'open-project.json');

function isProjectId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value) && !value.includes('..');
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
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

async function migrate() {
  if (!await pathExists(legacyFile)) {
    console.log('No legacy data/projects.json file found. Nothing to migrate.');
    return;
  }

  const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
  const projects = Array.isArray(legacy.projects) ? legacy.projects : [];
  if (!projects.length) {
    throw new Error('Legacy data/projects.json does not contain a projects array with entries.');
  }

  for (const project of projects) {
    if (!isProjectId(project.id)) {
      throw new Error(`Refusing to migrate unsafe project id: ${project.id}`);
    }
  }

  for (const project of projects) {
    const projectDir = path.join(dataDir, project.id);
    await fs.mkdir(path.join(projectDir, 'assets', 'images'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'assets', 'audio'), { recursive: true });
    await writeJsonAtomic(path.join(projectDir, 'project.json'), {
      ...project,
      assets: Array.isArray(project.assets) ? project.assets : [],
    });
  }

  if (legacy.openProjectId) {
    await writeJsonAtomic(openProjectFile, { openProjectId: legacy.openProjectId });
  }

  for (const project of projects) {
    const migrated = JSON.parse(await fs.readFile(path.join(dataDir, project.id, 'project.json'), 'utf8'));
    if (migrated.id !== project.id) {
      throw new Error(`Verification failed for project ${project.id}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(dataDir, `projects.legacy-${stamp}.json`);
  await fs.rename(legacyFile, backupFile);
  console.log(`Migrated ${projects.length} project(s). Legacy file moved to ${path.relative(rootDir, backupFile)}.`);
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
