import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 5173);
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'projects.json');

app.use(express.json({ limit: '50mb' }));

async function readProjects() {
  try {
    const file = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { projects: [], openProjectId: null };
  }
}

async function writeProjects(data) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = path.join(dataDir, `projects.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, dataFile);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

app.get('/api/projects', async (_request, response) => {
  response.json(await readProjects());
});

app.post('/api/projects', async (request, response) => {
  const data = await readProjects();
  const project = request.body;
  if (data.projects.some((item) => item.name.trim().toLowerCase() === project.name.trim().toLowerCase())) {
    response.status(409).json({ error: 'A project with that name already exists.' });
    return;
  }
  data.projects.push(project);
  data.openProjectId = project.id;
  await writeProjects(data);
  response.status(201).json(data);
});

app.put('/api/projects/:id', async (request, response) => {
  const data = await readProjects();
  if (data.projects.some((project) => project.id !== request.params.id && project.name.trim().toLowerCase() === request.body.name.trim().toLowerCase())) {
    response.status(409).json({ error: 'A project with that name already exists.' });
    return;
  }
  data.projects = data.projects.map((project) => project.id === request.params.id ? request.body : project);
  await writeProjects(data);
  response.json(data);
});

app.delete('/api/projects/:id', async (request, response) => {
  const data = await readProjects();
  data.projects = data.projects.filter((project) => project.id !== request.params.id);
  if (data.openProjectId === request.params.id) {
    data.openProjectId = null;
  }
  await writeProjects(data);
  response.json(data);
});

app.post('/api/projects/:id/open', async (request, response) => {
  const data = await readProjects();
  data.openProjectId = request.params.id;
  await writeProjects(data);
  response.json(data);
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

app.listen(port, '0.0.0.0', () => {
  console.log(`Tableforge host running on http://0.0.0.0:${port}`);
});
