import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const referencePath = fileURLToPath(new URL('../test/fixtures/dungeon-scrawl-reference.ds', import.meta.url));
const loadProjects = async (request) => (await request.get('/api/projects')).json();
test.describe.configure({ mode: 'serial' });

test('imports the actual reference through the browser, persists it, publishes and exports it', async ({ page, request, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Dungeon & Map Builder')).toHaveCount(0);
  await page.getByRole('button', { name: 'Import Dungeon Scrawl (.ds)', exact: true }).click();
  await page.getByLabel('Choose a .ds file or drop it here').setInputFiles(referencePath);
  await expect(page.getByText(/21 × 10 cells · 16 walls/)).toBeVisible();
  await expect(page.locator('.scrawl-preview img')).toBeVisible();
  await page.locator('.scrawl-preview img').evaluate((image) => image.decode());
  await page.locator('.scrawl-preview').screenshot({ path: testInfo.outputPath('reference-preview.png') });
  await page.getByLabel('Board name', { exact: true }).fill('Reference Dungeon');
  await page.getByLabel('Campaign name', { exact: true }).fill('Scrawl reference campaign');
  await page.getByRole('button', { name: 'Create campaign with this map', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.board-background')).toBeVisible();
  const payload = await loadProjects(request);
  const project = payload.projects.find((p) => p.name === 'Scrawl reference campaign');
  const board = project.state.boards[0];
  expect(board.lighting.walls).toHaveLength(16);
  expect(board.lighting.lights).toHaveLength(0);
  expect(board.lighting.enabled).toBe(true);
  expect(board.tokens).toHaveLength(0);
  expect(board.columns).toBe(21);
  expect(board.rows).toBe(10);
  expect(project.assets).toHaveLength(1);
  const background = await request.get(board.background.src);
  expect(background.ok()).toBe(true);
  expect(background.headers()['content-type']).toContain('image/png');
  fs.writeFileSync(testInfo.outputPath('reference-board.png'), await background.body());
  await page.reload();
  await page.getByRole('button', { name: 'Scrawl reference campaign', exact: true }).click();
  await expect(page.locator('.board-background')).toHaveAttribute('src', board.background.src);

  // Campaign archives retain the raster assets and editable wall/light state.
  const exported = await request.get(`/api/projects/${project.id}/export`);
  expect(exported.ok()).toBe(true);
  const archive = unzipSync(await exported.body());
  const saved = JSON.parse(strFromU8(archive['project.json']));
  expect(saved.state.boards[0].lighting.walls).toHaveLength(16);
  expect(Object.keys(archive).filter((name) => name.endsWith('.png'))).toHaveLength(1);
  await request.delete(`/api/projects/${project.id}`);
  const restored = await request.post('/api/projects/import', { multipart: { file: { name: 'campaign.zip', mimeType: 'application/zip', buffer: await exported.body() } } });
  expect(restored.status()).toBe(201);
  expect((await request.get(board.background.src)).ok()).toBe(true);

  // Publish a token with vision, then verify the player gets the imported walls
  // and a non-empty visibility polygon instead of a permanently black map.
  saved.state.boards[0].tokens = [{ id: 'hero', x: 8.5, y: 3, label: 'Hero', size: 1, layer: 'player', visible: true, visionEnabled: true, visionBrightFeet: 60, visionDimFeet: 60 }];
  saved.updatedAt = new Date().toISOString();
  expect((await request.put(`/api/projects/${project.id}`, { data: saved })).ok()).toBe(true);
  const publish = await request.post(`/api/projects/${project.id}/open`);
  expect(publish.ok()).toBe(true);
  const player = await context.newPage();
  await player.goto('/?view=player');
  await expect(player.locator('.board-background')).toBeVisible();
  await expect(player.locator('mask polygon').first()).toHaveAttribute('points', /\d/);
  await player.screenshot({ path: testInfo.outputPath('reference-player-vision.png') });
  await player.close();
  expect(errors).toEqual([]);
});

test('renders embedded assets and real lights, adds a board without changing the published board, and supports undo', async ({ page, request }, testInfo) => {
  const payload = await loadProjects(request);
  const project = payload.projects.find((p) => p.name === 'Scrawl reference campaign');
  const publishedBoardId = project.state.playerBoardId;
  const save = JSON.parse(strFromU8(unzipSync(fs.readFileSync(referencePath)).map));
  const nodes = save.state.document.nodes;
  const pageNode = nodes[nodes.document.children[0]];
  pageNode.children.push('asset', 'light');
  nodes.asset = { id: 'asset', type: 'ASSET', assetId: 'embedded', transform: [1, 0, 0, 1, 550, 220] };
  save.data.assets.embedded = { asset: { dimensions: [1, 1], scale: [36, 36] }, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' };
  nodes.light = { id: 'light', type: 'LIGHT', variant: 'radial', transform: [1, 0, 0, 1, 620, 280], config: { radial: { radius: 5, brightRadius: 2, strength: 1 }, shared: { colour: { colour: 0xffaa44, alpha: 1 } } } };
  await page.goto('/');
  await page.getByRole('button', { name: 'Scrawl reference campaign', exact: true }).click();
  await page.getByRole('button', { name: /^Boards:/ }).click();
  await page.getByRole('button', { name: 'Import Dungeon Scrawl (.ds)', exact: true }).click();
  await page.getByLabel('Choose a .ds file or drop it here').setInputFiles({ name: 'lit-map.ds', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync({ map: strToU8(JSON.stringify(save)) })) });
  await expect(page.getByText(/1 lights · 1 embedded images/)).toBeVisible();
  await page.getByRole('button', { name: 'Import as new board', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updated = (await loadProjects(request)).projects.find((p) => p.id === project.id);
  expect(updated.state.boards).toHaveLength(2);
  expect(updated.state.playerBoardId).toBe(publishedBoardId);
  const board = updated.state.boards[1];
  expect(board.lighting.lights).toHaveLength(1);
  expect(board.lighting.lights[0].radiusFeet).toBe(25);
  await expect(page.locator('mask polygon').first()).toHaveAttribute('points', /\d/);
  fs.writeFileSync(testInfo.outputPath('embedded-asset-board.png'), await (await request.get(board.background.src)).body());
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(async () => (await loadProjects(request)).projects.find((p) => p.id === project.id).state.boards.length).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  await expect.poll(async () => (await loadProjects(request)).projects.find((p) => p.id === project.id).state.boards.length).toBe(2);
});

test('bad files and cancelled previews do not create campaigns; removed builder API stays removed', async ({ page, request }) => {
  const before = await loadProjects(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Dungeon Scrawl (.ds)', exact: true }).click();
  await page.getByLabel('Choose a .ds file or drop it here').setInputFiles({ name: 'broken.ds', mimeType: 'application/octet-stream', buffer: Buffer.from('not a map') });
  await expect(page.getByRole('alert')).toContainText('valid map JSON');
  await expect(page.getByRole('button', { name: 'Create campaign with this map', exact: true })).toBeDisabled();
  await page.getByLabel('Choose a .ds file or drop it here').setInputFiles(referencePath);
  await expect(page.getByText(/16 walls/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await loadProjects(request)).projects.length).toBe(before.projects.length);
  expect((await request.get('/api/dungeons')).status()).toBe(404);
  const invalidUpload = await request.post('/api/dungeon-scrawl/import', { multipart: { board: '{}', file: { name: 'map.png', mimeType: 'image/png', buffer: Buffer.from('bad png') } } });
  expect(invalidUpload.status()).toBe(400);
  expect((await loadProjects(request)).projects.length).toBe(before.projects.length);
});

test('waits for an in-flight edit before importing another board', async ({ page, request }) => {
  const project = (await loadProjects(request)).projects.find((p) => p.name === 'Scrawl reference campaign');
  const originalCount = project.state.boards.length;
  const editedBoardId = project.state.activeBoardId;
  await page.goto('/');
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: 'Board Setup', exact: true }).click();
  let releaseSave, saveStarted;
  const paused = new Promise((resolve) => { releaseSave = resolve; });
  const started = new Promise((resolve) => { saveStarted = resolve; });
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === 'PUT') { saveStarted(); await paused; }
    await route.continue();
  });
  await page.getByLabel('Name', { exact: true }).fill('Edit saved before import');
  await started;
  await page.getByRole('button', { name: 'Import Dungeon Scrawl (.ds)', exact: true }).click();
  await page.getByLabel('Choose a .ds file or drop it here').setInputFiles(referencePath);
  await expect(page.getByText(/16 walls/)).toBeVisible();
  await page.getByRole('button', { name: 'Import as new board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
  expect((await loadProjects(request)).projects.find((p) => p.id === project.id).state.boards).toHaveLength(originalCount);
  releaseSave();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = (await loadProjects(request)).projects.find((p) => p.id === project.id);
  expect(after.state.boards).toHaveLength(originalCount + 1);
  expect(after.state.boards.find((b) => b.id === editedBoardId).name).toBe('Edit saved before import');
});
