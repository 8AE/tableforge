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
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

app.get('/api/projects', async (_request, response) => {
  response.json(await readProjects());
});

app.post('/api/projects', async (request, response) => {
  const data = await readProjects();
  const project = request.body;
  data.projects.push(project);
  data.openProjectId = project.id;
  await writeProjects(data);
  response.status(201).json(data);
});

app.put('/api/projects/:id', async (request, response) => {
  const data = await readProjects();
  data.projects = data.projects.map((project) => project.id === request.params.id ? request.body : project);
  await writeProjects(data);
  response.json(data);
});

app.post('/api/projects/:id/open', async (request, response) => {
  const data = await readProjects();
  data.openProjectId = request.params.id;
  await writeProjects(data);
  response.json(data);
});

app.use(express.static(path.join(__dirname, 'dist')));
app.use((_request, response) => {
  response.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Tableforge host running on http://0.0.0.0:${port}`);
});
