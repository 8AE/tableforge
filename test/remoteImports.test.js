import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { makeProject } from '../src/lib/board.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let upstream, host, child, dataDir, base;
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const request = (route, method = 'GET', body) => fetch(`${host}${route}`, { method, ...body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {} });
const projects = async () => (await (await request('/api/projects')).json()).projects;
const map = (name, suffix = '/image.png') => ({ id: name, displayTitle: name, sourceId: 'Test', imageType: 'mapPlayer', width: 100, height: 100, imageUrl: base + suffix, mapRegions: [], grid: { type: 'square', size: 10 } });
const importMaps = async (body) => {
  const response = await request('/api/5etools/import', 'POST', { baseUrl: base, ...body });
  const text = await response.text();
  return response.headers.get('content-type').includes('ndjson') ? text.trim().split('\n').map(JSON.parse).at(-1) : JSON.parse(text);
};

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === '/disconnect') { req.socket.destroy(); return; }
    if (req.url === '/slow') { setTimeout(() => res.end('{}'), 450).unref(); return; }
    if (req.url === '/missing') { res.writeHead(404).end('Not found'); return; }
    if (req.url === '/forbidden') { res.writeHead(403).end('Forbidden'); return; }
    if (req.url === '/large') { res.writeHead(200, { 'content-length': String(51 * 1024 * 1024) }).end('x'); return; }
    if (req.url === '/bad.png') { res.writeHead(200, { 'content-type': 'image/png' }).end('<html>login</html>'); return; }
    if (req.url === '/image.png') { res.writeHead(200, { 'content-type': 'image/png' }).end(png); return; }
    if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>login</html>'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  base = `http://127.0.0.1:${await listen(upstream)}`;
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  host = `http://127.0.0.1:${port}`;
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tableforge-remote-test-'));
  child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, TABLEFORGE_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', TABLEFORGE_REMOTE_TIMEOUT_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', (chunk) => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${host}/api/health`).then((response) => response.ok).catch(() => false)) return;
    await delay(20);
  }
  throw new Error(`Test host did not start: ${logs}`);
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    const force = setTimeout(() => child.kill('SIGKILL'), 1500);
    child.kill();
    await exited;
    clearTimeout(force);
  }
  upstream?.closeAllConnections();
  await new Promise((resolve) => upstream?.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('proxy errors distinguish URL, HTTP, malformed JSON, connection, timeout, and size failures; each attempt has a new ID', async () => {
  const loopback = await request(`/api/5etools?url=${encodeURIComponent(base.replace('127.0.0.1', 'localhost'))}`);
  assert.equal(loopback.status, 200, 'localhost must reach an IPv4-only source, including under Electron Node 18');
  assert.deepEqual(await loopback.json(), { ok: true });
  const cases = [
    ['file:///tmp/no', 'INVALID_URL'], [`${base}/missing`, 'SOURCE_HTTP_404'], [`${base}/forbidden`, 'SOURCE_HTTP_403'],
    [`${base}/html`, 'SOURCE_INVALID_JSON'], [`${base}/slow`, 'SOURCE_TIMEOUT'], [`${base}/large`, 'SOURCE_TOO_LARGE'], [`${base}/disconnect`, 'SOURCE_UNREACHABLE'],
  ];
  const ids = new Set();
  for (const [url, code] of cases) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(`/api/5etools?url=${encodeURIComponent(url)}`);
      assert.equal(response.ok, false);
      const error = await response.json();
      assert.equal(error.code, code);
      assert.ok(error.error.length > 20);
      assert.ok(Number.isFinite(Date.parse(error.occurredAt)));
      assert.ok(!ids.has(error.requestId)); ids.add(error.requestId);
    }
  }
});

test('batch failures roll back both new campaigns and downloads into existing campaigns; retry works', async () => {
  const failed = await importMaps({ campaignName: 'Rollback test', maps: [map('Good'), map('Missing', '/missing')] });
  assert.equal(failed.type, 'error');
  assert.equal(failed.code, 'SOURCE_HTTP_404');
  assert.match(failed.error, /Missing.*No maps.*saved/);
  assert.equal((await projects()).length, 0);
  assert.equal((await fs.readdir(dataDir)).filter((name) => name.startsWith('project-')).length, 0);

  const success = await importMaps({ campaignName: 'Rollback test', maps: [map('First'), map('Second')] });
  assert.equal(success.type, 'complete');
  assert.equal(success.payload.openProjectId, success.projectId, 'new campaigns open for players just like normal campaign creation');
  const project = (await projects())[0];
  assert.equal(project.assets.length, 2);
  assert.equal(project.state.boards.length, 2);
  const unchanged = structuredClone(project);
  const existingFailure = await importMaps({ projectId: project.id, maps: [map('Third'), map('Bad', '/bad.png')] });
  assert.equal(existingFailure.code, 'SOURCE_NOT_IMAGE');
  assert.deepEqual((await projects())[0], unchanged);
  assert.equal((await fs.readdir(path.join(dataDir, project.id, 'assets/images'))).length, 2);
  const appended = await importMaps({ projectId: project.id, maps: [map('Third')] });
  assert.equal(appended.type, 'complete');
  const updated = (await projects())[0];
  assert.equal(updated.state.boards.length, 3);
  assert.equal(updated.state.playerBoardId, unchanged.state.playerBoardId);
  assert.equal(appended.payload.openProjectId, success.projectId);
});

test('cancelled batch cleans up without creating a campaign', async () => {
  const controller = new AbortController();
  const response = await fetch(`${host}/api/5etools/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignName: 'Cancelled', baseUrl: base, maps: [map('Slow', '/slow')] }), signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  await delay(200);
  assert.equal((await projects()).some((project) => project.name === 'Cancelled'), false);
});

test('tokens save real local artwork, reject corrupt downloads, prevent duplicates, and export/import with the asset', async () => {
  const project = makeProject('Token test');
  await request('/api/projects', 'POST', project);
  const token = { label: 'Golem', image: `${base}/bad.png`, size: 2, meta: { importKey: 'test-golem', cr: '10', ac: '17', hp: '178' } };
  const failure = await request(`/api/projects/${project.id}/tokens/remote`, 'POST', { token });
  assert.equal((await failure.json()).code, 'SOURCE_NOT_IMAGE');
  assert.equal((await projects()).find((entry) => entry.id === project.id).state.tokenLibrary.length, 0);
  token.image = `${base}/image.png`;
  const result = await (await request(`/api/projects/${project.id}/tokens/remote`, 'POST', { token })).json();
  assert.ok(result.token.image.startsWith(`/api/projects/${project.id}/assets/images/`));
  assert.deepEqual(Buffer.from(await (await request(result.token.image)).arrayBuffer()), png);
  assert.equal((await (await request(`/api/projects/${project.id}/tokens/remote`, 'POST', { token })).json()).code, 'TOKEN_ALREADY_SAVED');
  assert.equal((await fs.readdir(path.join(dataDir, project.id, 'assets/images'))).length, 1);

  const exported = Buffer.from(await (await request(`/api/projects/${project.id}/export`)).arrayBuffer());
  const archive = unzipSync(exported);
  const saved = JSON.parse(strFromU8(archive['project.json']));
  assert.equal(saved.state.tokenLibrary[0].meta.hp, '178');
  assert.equal(Object.keys(archive).filter((name) => name.endsWith('.png')).length, 1);
  await request(`/api/projects/${project.id}`, 'DELETE');
  const form = new FormData(); form.append('file', new Blob([exported]), 'campaign.zip');
  assert.equal((await fetch(`${host}/api/projects/import`, { method: 'POST', body: form })).status, 201);
  assert.deepEqual(Buffer.from(await (await request(result.token.image)).arrayBuffer()), png);
});

test('other project assets still upload and expose actionable errors for unsupported formats', async () => {
  const project = (await projects())[0];
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'reference.png'); form.append('category', 'image');
  const response = await fetch(`${host}/api/projects/${project.id}/assets`, { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.deepEqual(Buffer.from(await (await request(saved.asset.path)).arrayBuffer()), png);
  const invalid = new FormData(); invalid.append('file', new Blob(['text']), 'reference.txt');
  const error = await (await fetch(`${host}/api/projects/${project.id}/assets`, { method: 'POST', body: invalid })).json();
  assert.equal(error.code, 'ASSET_UNSUPPORTED_FORMAT');
  assert.ok(error.requestId);
});
