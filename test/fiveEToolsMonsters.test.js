import test from 'node:test';
import assert from 'node:assert/strict';
import { fiveEToolsTokenImage, resolveFiveEToolsMonster, fiveEToolsMonsterResult } from '../src/lib/fiveEToolsMonsters.js';
import { fetchFiveEToolsMaps, normalizeFiveEToolsBaseUrl, importFiveEToolsSelection } from '../src/lib/fiveETools.js';

test('normalizes site-page URLs and rejects invalid protocols', () => {
  assert.equal(normalizeFiveEToolsBaseUrl(' http://localhost:5050/index.html#maps '), 'http://localhost:5050/');
  assert.equal(normalizeFiveEToolsBaseUrl('https://example.test/subdir'), 'https://example.test/subdir/');
  assert.throws(() => normalizeFiveEToolsBaseUrl('file:///tmp'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeFiveEToolsBaseUrl('localhost:5050'), { code: 'INVALID_URL' });
});

test('uses native token filename rules, explicit artwork references, and missing-token flags', () => {
  const monster = { name: 'Ægir "Red" Démon', source: 'MM', hasToken: true };
  assert.equal(fiveEToolsTokenImage('http://localhost:5050', monster), 'http://localhost:5050/img/bestiary/tokens/MM/AEgir%20Red%20Demon.webp');
  assert.equal(fiveEToolsTokenImage('http://localhost:5050', { ...monster, token: { name: 'Goblin', source: 'XMM' } }), 'http://localhost:5050/img/bestiary/tokens/XMM/Goblin.webp');
  assert.equal(fiveEToolsTokenImage('http://localhost:5050', { ...monster, tokenHref: { type: 'external', url: 'https://example.test/token.png' } }), 'https://example.test/token.png');
  assert.equal(fiveEToolsTokenImage('http://localhost:5050', { name: 'No art', source: 'MM' }), '');
});

test('resolves inherited quick stats, template darkvision, and root overrides without mutating the data', () => {
  const parent = { name: 'Guard', source: 'MM', size: ['M'], type: 'humanoid', ac: [16], hp: { average: 11 }, cr: '1/8', senses: [], hasToken: true };
  const child = { name: 'Cave Guard', source: 'Test', hp: { average: 22 }, _copy: { name: 'Guard', source: 'MM', _templates: [{ name: 'Dwarf', source: 'PHB' }] } };
  const templates = [{ name: 'Dwarf', source: 'PHB', apply: { _root: { size: ['S'] }, _mod: { _: { mode: 'addSenses', senses: { type: 'darkvision', range: 60 } } } } }];
  const before = structuredClone(child);
  const result = fiveEToolsMonsterResult(resolveFiveEToolsMonster(child, new Map([['mm|guard', parent]]), templates), 'http://localhost:5050');
  assert.deepEqual([result.ac, result.hp, result.sizeName, result.visionFeet, result.cr, result.image], ['16', '22', 'Small', 60, '1/8', '']);
  assert.deepEqual(child, before);
  assert.throws(() => resolveFiveEToolsMonster(child, new Map()), { code: 'MONSTER_COPY_MISSING' });
});

test('custom source failures remain failures and expose backend error details', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return Response.json({ error: 'Source is offline.', code: 'SOURCE_UNREACHABLE', requestId: 'retry-123' }, { status: 502 });
  });
  await assert.rejects(fetchFiveEToolsMaps('http://localhost:5050'), { code: 'SOURCE_UNREACHABLE', requestId: 'retry-123', message: 'Source is offline.' });
  assert.equal(urls.length, 1, 'a failed custom installation must not fall back to a public catalog');
});

test('default public mirror fallback is disclosed and malformed catalogs fail clearly', async (t) => {
  let calls = 0;
  let notice;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? Response.json({ error: 'Forbidden', code: 'SOURCE_HTTP_403' }, { status: 502 }) : Response.json({ book: { chapters: [] } }));
  await fetchFiveEToolsMaps('https://5e.tools/', { onNotice: (value) => { notice = value; } });
  assert.equal(calls, 2);
  assert.match(notice, /public source mirror/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'not a catalog' }));
  await assert.rejects(fetchFiveEToolsMaps('http://localhost:5050'), { code: 'INVALID_MAP_CATALOG' });
});

test('streamed imports report progress, preserve source errors, and explain interrupted host responses', async (t) => {
  let body = '{"type":"progress","completed":0,"total":1}\n{"type":"complete","projectId":"saved"}\n';
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const progress = [];
  assert.equal((await importFiveEToolsSelection({}, { onProgress: (event) => progress.push(event.completed) })).projectId, 'saved');
  assert.deepEqual(progress, [0]);
  body = '{"type":"error","code":"SOURCE_HTTP_404","error":"Image missing.","requestId":"current"}\n';
  await assert.rejects(importFiveEToolsSelection({}), { code: 'SOURCE_HTTP_404', requestId: 'current' });
  for (const broken of ['', 'not json\n', '{"type":"progress"}\n']) {
    body = broken;
    await assert.rejects(importFiveEToolsSelection({}), { code: 'IMPORT_INTERRUPTED' });
  }
});
