import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync } from 'fflate';

const referencePath = fileURLToPath(new URL('../test/fixtures/inkarnate-reference.ink', import.meta.url));
const source = JSON.parse(strFromU8(gunzipSync(fs.readFileSync(referencePath))));
const loadProjects = async (request) => (await request.get('/api/projects')).json();
test.describe.configure({ mode: 'serial' });

test('imports the real forest backup with exact artwork, grid and tree blockers; persists and exports it', async ({ page, request, context }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Inkarnate (.ink)', exact: true }).click();
  await page.getByLabel('Choose an .ink file or drop it here').setInputFiles(referencePath);
  await expect(page.getByText(/40 × 30 cells · 0 saved wall segments · 17 estimated blockers · 0 estimated lights/)).toBeVisible();
  await page.locator('.inkarnate-preview').screenshot({ path: testInfo.outputPath('inkarnate-preview.png') });
  await page.getByLabel('Estimate blockers and lights from stamps').uncheck();
  await expect(page.getByText(/0 estimated blockers · 0 estimated lights/)).toBeVisible();
  await page.getByLabel('Estimate blockers and lights from stamps').check();
  await page.getByLabel('Board name', { exact: true }).fill('Inkarnate Forest');
  await page.getByLabel('Campaign name', { exact: true }).fill('Inkarnate reference campaign');
  await page.getByRole('button', { name: 'Create campaign with this map', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.board-background')).toBeVisible();
  const project = (await loadProjects(request)).projects.find((p) => p.name === 'Inkarnate reference campaign');
  const board = project.state.boards[0];
  expect([board.columns, board.rows]).toEqual([40, 30]);
  expect(board.lighting.walls).toHaveLength(136);
  expect(board.lighting.walls.every((wall) => wall.freeform && wall.estimated)).toBe(true);
  expect(board.importMetadata.estimatedBlockers).toBe(17);
  expect(board.lighting.lights).toHaveLength(0);
  expect(board.lighting.enabled).toBe(true);
  expect(project.assets).toHaveLength(1);
  const png = await (await request.get(board.background.src)).body();
  expect(png.equals(Buffer.from(source.preview.split(',')[1], 'base64'))).toBe(true);
  fs.writeFileSync(testInfo.outputPath('inkarnate-board.png'), png);
  await page.reload();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await expect(page.locator('.board-background')).toHaveAttribute('src', board.background.src);

  const exported = await request.get(`/api/projects/${project.id}/export`);
  expect(exported.ok()).toBe(true);
  const archive = unzipSync(await exported.body());
  expect(Object.keys(archive).filter((key) => key.endsWith('.png'))).toHaveLength(1);
  expect(JSON.parse(strFromU8(archive['project.json'])).state.boards[0].lighting.walls).toHaveLength(136);
  await request.delete(`/api/projects/${project.id}`);
  const restored = await request.post('/api/projects/import', { multipart: { file: { name: 'forest.zip', mimeType: 'application/zip', buffer: await exported.body() } } });
  expect(restored.status()).toBe(201);
  expect((await (await request.get(board.background.src)).body()).equals(png)).toBe(true);

  // A player token sees the forest through real visibility geometry.
  project.state.boards[0].tokens = [{ id: 'forest-hero', x: 12.5, y: 9.5, label: 'Scout', size: 1, layer: 'player', visible: true, visionEnabled: true, visionBrightFeet: 50, visionDimFeet: 50 }];
  project.updatedAt = new Date().toISOString();
  expect((await request.put(`/api/projects/${project.id}`, { data: project })).ok()).toBe(true);
  await request.post(`/api/projects/${project.id}/open`);
  const player = await context.newPage();
  await player.goto('/?view=player');
  await expect(player.locator('.board-background')).toBeVisible();
  await expect(player.locator('mask polygon').first()).toHaveAttribute('points', /\d/);
  await player.screenshot({ path: testInfo.outputPath('inkarnate-player-vision.png') });
  await player.close();
  expect(errors).toEqual([]);
});

test('imports room geometry and estimated light sources into an existing campaign without changing the player board', async ({ page, request }, testInfo) => {
  const project = (await loadProjects(request)).projects.find((p) => p.name === 'Inkarnate reference campaign');
  const save = structuredClone(source);
  save.title = 'Lit forest';
  save.history.push({ cmdType: 'cmd-entity-add', items: [
    { layerId: 'layer-object-72', entity: { entityId: 200, entityType: 'path-v2', name: 'Wall', x: 6000, y: 2000, scale: 1, paths: 'M0 0L0 2000', wallEnabled: true, blockLights: true, portals: [{ anchor: { x: 0, y: 1000 }, width: 409.6 }] } },
    { layerId: 'layer-object-72', entity: { entityId: 201, entityType: 'stamp', defaultName: 'Torch', x: 5500, y: 3000, scale: 1 } },
  ] });
  await page.goto('/');
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: /^Boards:/ }).click();
  await page.getByRole('button', { name: 'Import Inkarnate (.ink)', exact: true }).click();
  await page.getByLabel('Choose an .ink file or drop it here').setInputFiles({ name: 'lit.ink', mimeType: 'application/octet-stream', buffer: Buffer.from(gzipSync(strToU8(JSON.stringify(save)))) });
  await expect(page.getByText(/2 saved wall segments · 17 estimated blockers · 1 estimated lights/)).toBeVisible();
  await page.getByRole('button', { name: 'Import as new board', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updated = (await loadProjects(request)).projects.find((p) => p.id === project.id);
  expect(updated.state.boards).toHaveLength(2);
  expect(updated.state.playerBoardId).toBe(project.state.playerBoardId);
  const board = updated.state.boards[1];
  expect(board.lighting.walls).toHaveLength(138);
  expect(board.lighting.lights).toHaveLength(1);
  expect(board.lighting.lights[0].estimated).toBe(true);
  await expect(page.getByText('Imported Lights', { exact: true })).toBeVisible();
  await expect(page.locator('mask polygon').first()).toHaveAttribute('points', /\d/);
  await page.screenshot({ path: testInfo.outputPath('inkarnate-lit-board.png') });
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(async () => (await loadProjects(request)).projects.find((p) => p.id === project.id).state.boards.length).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  await expect.poll(async () => (await loadProjects(request)).projects.find((p) => p.id === project.id).state.boards.length).toBe(2);
});

test('invalid backups, preview cancellation and invalid uploads leave campaign data intact', async ({ page, request }) => {
  const before = await loadProjects(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Inkarnate (.ink)', exact: true }).click();
  await page.getByLabel('Choose an .ink file or drop it here').setInputFiles({ name: 'bad.ink', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toContainText('valid Inkarnate');
  await expect(page.getByRole('button', { name: 'Create campaign with this map', exact: true })).toBeDisabled();
  await page.getByLabel('Choose an .ink file or drop it here').setInputFiles(referencePath);
  await expect(page.getByText(/17 estimated blockers/)).toBeVisible();
  await page.getByLabel('Grid columns (optional)').fill('300');
  await expect(page.getByRole('alert')).toContainText('between 4 and 200');
  await expect(page.getByRole('button', { name: 'Create campaign with this map', exact: true })).toBeDisabled();
  await page.getByLabel('Grid columns (optional)').fill('20');
  await expect(page.getByText(/20 × 15 cells/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await loadProjects(request)).projects.length).toBe(before.projects.length);
  const invalid = await request.post('/api/inkarnate/import', { multipart: { board: '{}', file: { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a png') } } });
  expect(invalid.status()).toBe(400);
  expect((await loadProjects(request)).projects.length).toBe(before.projects.length);
});
