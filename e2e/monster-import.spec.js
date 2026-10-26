import { test, expect } from '@playwright/test';
import http from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { makeBoard, makeProject } from '../src/lib/board.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const data = {
  'index.json': { MM: 'bestiary-mm.json', TEST: 'bestiary-test.json' },
  'bestiary-mm.json': { monster: [
    { name: 'Goblin', source: 'MM', size: ['S'], type: 'humanoid', ac: [15], hp: { average: 7 }, cr: '1/4', senses: ['darkvision 60 ft.'], hasToken: true },
    { name: 'Guard', source: 'MM', size: ['M'], type: 'humanoid', ac: [16], hp: { average: 11 }, cr: '1/8', senses: [] },
  ] },
  'bestiary-test.json': { monster: [
    { name: 'Cave Guard', source: 'TEST', hp: { average: 22 }, hasToken: true, isNpc: true, _copy: { name: 'Guard', source: 'MM', _templates: [{ name: 'Dwarf', source: 'PHB' }] } },
  ] },
  'template.json': { monsterTemplate: [{ name: 'Dwarf', source: 'PHB', apply: { _root: { size: ['S'] }, _mod: { _: { mode: 'addSenses', senses: { type: 'darkvision', range: 60 } } } } }] },
};
let upstream, base, failArtwork = false;
test.beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.test');
    if (url.pathname.startsWith('/Rules/data/bestiary/')) {
      const body = data[url.pathname.split('/').at(-1)];
      response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body || { error: 'Missing' }));
    } else if (url.pathname.startsWith('/Rules/img/')) {
      response.writeHead(failArtwork ? 404 : 200, { 'content-type': 'image/png' }).end(failArtwork ? 'Missing artwork' : png);
    } else response.writeHead(404).end('Not found');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${upstream.address().port}/Rules/`;
});
test.afterEach(() => { failArtwork = false; });
test.afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

async function openCampaign(page, request, name, source = base) {
  const project = makeProject(name);
  project.state.boards[0].tokens = [];
  project.state.boards[0].drawings = [];
  const playerBoard = makeBoard('Published board');
  project.state.boards.push(playerBoard);
  project.state.playerBoardId = playerBoard.id;
  project.state.fiveEToolsBaseUrl = source;
  expect((await request.post('/api/projects', { data: project })).status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  return project;
}

async function startTokenImport(page, cell = { x: 4, y: 4 }) {
  await page.getByRole('button', { name: 'Place Token', exact: true }).click();
  const board = await page.locator('.board').boundingBox();
  await page.mouse.click(board.x + (cell.x + 0.4) * board.width / 24, board.y + (cell.y + 0.4) * board.height / 16);
  await page.getByRole('button', { name: 'New token…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New token', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import from 5eTools', exact: true }).click();
  await expect(page.getByText('Import a Monster or NPC', { exact: true })).toBeVisible();
}

async function loadCreatureUrl(page, url) {
  await page.getByRole('button', { name: 'Paste creature URL', exact: true }).click();
  await page.getByLabel('Full creature URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Load creature', exact: true }).click();
}

async function readProject(request, id) {
  return (await (await request.get('/api/projects')).json()).projects.find((project) => project.id === id);
}

test('new-token URL import saves artwork and stats, places in the clicked cell, persists, and reuses saved entries', async ({ page, request }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  // A full link chooses its own host even if the saved search source is different.
  const project = await openCampaign(page, request, 'Direct creature import', 'http://unrelated.invalid/');
  await startTokenImport(page, { x: 4, y: 5 });
  await loadCreatureUrl(page, `${base}bestiary.html#goblin_mm`);
  const row = page.getByRole('row').filter({ hasText: 'Goblin' });
  await expect(row).toContainText('darkvision 60 ft');
  await expect(row.getByRole('button', { name: 'Save & place', exact: true })).toBeEnabled();
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('direct-creature-import.png') });
  await page.setViewportSize({ width: 760, height: 900 });
  const modal = await page.locator('.token-library-modal').boundingBox();
  expect(modal.x).toBeGreaterThanOrEqual(0);
  expect(modal.x + modal.width).toBeLessThanOrEqual(760);
  await expect(row.getByRole('button', { name: 'Save & place', exact: true })).toBeInViewport();
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('direct-creature-import-narrow.png') });
  await row.getByRole('button', { name: 'Save & place', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(1);
  const saved = await readProject(request, project.id);
  expect(saved.state.tokenLibrary).toHaveLength(1);
  expect(saved.assets).toHaveLength(1);
  const libraryToken = saved.state.tokenLibrary[0];
  const placed = saved.state.boards[0].tokens[0];
  expect([placed.x, placed.y, placed.label, placed.image, placed.visionFeet]).toEqual([4, 5, 'Goblin', libraryToken.image, 60]);
  expect(placed.meta).toMatchObject({ cr: '1/4', ac: '15', hp: '7', source: 'MM', type: 'humanoid', sizeName: 'Small' });
  expect(libraryToken.image).toMatch(/^\/api\/projects\//);
  expect((await (await request.get(libraryToken.image)).body()).equals(png)).toBe(true);
  expect(saved.state.playerBoardId).toBe(project.state.playerBoardId);
  expect(saved.state.boards[1].tokens).toEqual(expect.arrayContaining(project.state.boards[1].tokens.map((token) => expect.objectContaining({ id: token.id, label: token.label }))));
  expect(saved.state.fiveEToolsBaseUrl).toBe('http://unrelated.invalid/');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(0);
  expect((await readProject(request, project.id)).state.tokenLibrary).toHaveLength(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await expect(page.locator('.board .map-token img')).toHaveAttribute('src', libraryToken.image);
  await startTokenImport(page, { x: 7, y: 6 });
  await loadCreatureUrl(page, `${base}bestiary.html#goblin_mm`);
  await page.getByRole('row').filter({ hasText: 'Goblin' }).getByRole('button', { name: 'Place', exact: true }).click();
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(2);
  const repeated = await readProject(request, project.id);
  expect(repeated.state.tokenLibrary).toHaveLength(1);
  expect(repeated.assets).toHaveLength(1);
  expect(repeated.state.boards[0].tokens[1]).toMatchObject({ x: 7, y: 6, image: libraryToken.image });

  const exported = await request.get(`/api/projects/${project.id}/export`);
  expect(exported.ok()).toBe(true);
  const archive = unzipSync(await exported.body());
  const exportedProject = JSON.parse(strFromU8(archive['project.json']));
  expect(exportedProject.state.tokenLibrary).toHaveLength(1);
  expect(exportedProject.state.boards[0].tokens).toHaveLength(2);
  expect(Object.keys(archive).some((name) => name.endsWith('.png'))).toBe(true);
  expect(errors).toEqual([]);
});

test('base URL search from New Token imports an NPC with inherited stats into the library and board', async ({ page, request }) => {
  const project = await openCampaign(page, request, 'Search creature import');
  await startTokenImport(page);
  await expect(page.getByLabel('5e.tools base URL', { exact: true })).toHaveValue(base);
  await page.getByLabel('Monster or NPC name', { exact: true }).fill('Cave Guard');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Cave Guard' });
  await expect(row).toContainText('Small humanoid');
  await expect(row).toContainText('darkvision 60 ft');
  await row.getByRole('button', { name: 'Save & place', exact: true }).click();
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(1);
  const saved = await readProject(request, project.id);
  expect(saved.state.tokenLibrary[0].meta).toMatchObject({ hp: '22', ac: '16', source: 'TEST', sizeName: 'Small' });
  expect(saved.state.boards[0].tokens[0]).toMatchObject({ label: 'Cave Guard', x: 4, y: 4, visionFeet: 60 });
});

test('library management supports direct URLs and still saves without placing a board token', async ({ page, request }) => {
  const project = await openCampaign(page, request, 'Library creature import');
  await page.getByRole('button', { name: 'Board Items', exact: true }).click();
  await page.getByRole('button', { name: 'Open token library (0)', exact: true }).click();
  await page.getByRole('button', { name: 'Find Monsters', exact: true }).click();
  await loadCreatureUrl(page, `${base}bestiary.html#guard_mm`);
  await page.getByRole('row').filter({ hasText: 'Guard' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  const saved = await readProject(request, project.id);
  expect(saved.state.tokenLibrary[0]).toMatchObject({ label: 'Guard', image: '' });
  expect(saved.state.boards[0].tokens).toHaveLength(0);
  expect(saved.assets).toHaveLength(0);
  await page.getByRole('button', { name: 'Open 5e', exact: true }).click();
  await expect(page.getByLabel('Full creature URL', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Monster or NPC name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '5e.tools', exact: true }).click();
  await page.getByRole('button', { name: 'Search by name', exact: true }).click();
  await expect(page.getByLabel('5e.tools base URL', { exact: true })).toBeVisible();
});

test('bad links and failed artwork keep the library and board intact and allow retry', async ({ page, request }) => {
  const project = await openCampaign(page, request, 'Creature import recovery');
  await startTokenImport(page);
  await loadCreatureUrl(page, `${base}bestiary.html`);
  await expect(page.getByRole('alert')).toContainText('INVALID_MONSTER_URL');
  await page.getByLabel('Full creature URL', { exact: true }).fill(`${base}bestiary.html#goblin_unknown`);
  await page.getByRole('button', { name: 'Load creature', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('MONSTER_SOURCE_NOT_FOUND');
  await page.getByLabel('Full creature URL', { exact: true }).fill(`${base}bestiary.html#missing_mm`);
  await page.getByRole('button', { name: 'Load creature', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('MONSTER_NOT_FOUND');
  await page.getByLabel('Full creature URL', { exact: true }).fill(`${base}bestiary.html#goblin_mm`);
  await page.getByRole('button', { name: 'Load creature', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save & place', exact: true });
  await expect(save).toBeEnabled();
  failArtwork = true;
  await save.click();
  await expect(page.getByRole('alert')).toContainText('SOURCE_HTTP_404');
  const failed = await readProject(request, project.id);
  expect(failed.state.tokenLibrary).toHaveLength(0);
  expect(failed.state.boards[0].tokens).toHaveLength(0);
  expect(failed.assets).toHaveLength(0);
  failArtwork = false;
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await readProject(request, project.id)).state.boards[0].tokens.length).toBe(1);
  expect((await readProject(request, project.id)).state.tokenLibrary).toHaveLength(1);
});

test('changing import method cancels a pending URL lookup without restoring stale results', async ({ page, request }) => {
  await openCampaign(page, request, 'Cancel creature lookup');
  await startTokenImport(page);
  let release;
  let intercepted = false;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/5etools?*', async (route) => {
    const url = new URL(route.request().url()).searchParams.get('url');
    if (!url.endsWith('/bestiary-test.json')) return route.continue();
    intercepted = true;
    await gate;
    await route.fulfill({ json: data['bestiary-test.json'] }).catch(() => {});
  });
  try {
    await loadCreatureUrl(page, `${base}bestiary.html#cave%20guard_test`);
    await expect.poll(() => intercepted).toBe(true);
    await page.getByRole('button', { name: 'Search by name', exact: true }).click();
    release();
    await page.getByLabel('Monster or NPC name', { exact: true }).fill('Goblin');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Goblin' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Cave Guard' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});
