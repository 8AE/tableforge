import test from 'node:test';
import assert from 'node:assert/strict';
import { fiveEToolsTokenImage, resolveFiveEToolsMonster, fiveEToolsMonsterResult, parseFiveEToolsMonsterUrl, fetchFiveEToolsMonsterFromUrl } from '../src/lib/fiveEToolsMonsters.js';
import { fetchFiveEToolsMaps, normalizeFiveEToolsBaseUrl, importFiveEToolsSelection } from '../src/lib/fiveETools.js';

test('normalizes site-page URLs and rejects invalid protocols', () => {
  assert.equal(normalizeFiveEToolsBaseUrl(' http://localhost:5050/index.html#maps '), 'http://localhost:5050/');
  assert.equal(normalizeFiveEToolsBaseUrl('https://example.test/subdir'), 'https://example.test/subdir/');
  assert.throws(() => normalizeFiveEToolsBaseUrl('file:///tmp'), { code: 'INVALID_URL' });
  assert.throws(() => normalizeFiveEToolsBaseUrl('localhost:5050'), { code: 'INVALID_URL' });
});

test('reads exact creature identities from public, local and subfolder bestiary links', () => {
  assert.deepEqual(parseFiveEToolsMonsterUrl(' https://5e.tools/bestiary.html#Goblin_MM '), { baseUrl: 'https://5e.tools/', name: 'goblin', source: 'mm', hasScaling: false });
  assert.deepEqual(parseFiveEToolsMonsterUrl('http://localhost:5050/Rules/bestiary.html?view=book#%c3%86gir%20%22red%22%2c%20d%c3%a9mon_test,flstsource:test=1'), { baseUrl: 'http://localhost:5050/Rules/', name: 'ægir "red", démon', source: 'test', hasScaling: false });
  assert.equal(parseFiveEToolsMonsterUrl('http://127.0.0.1:5050/bestiary.html#guard_captain_mm,scaled:2').name, 'guard_captain');
  assert.equal(parseFiveEToolsMonsterUrl('http://[::1]:5050/bestiary.html#goblin_mm,scaledspellsummon:3').hasScaling, true);
});

test('rejects incomplete or invalid creature links before making a request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  for (const url of ['', 'localhost:5050/bestiary.html#goblin_mm', 'file:///bestiary.html#goblin_mm', 'https://user:secret@example.test/bestiary.html#goblin_mm', 'https://5e.tools/spells.html#goblin_mm', 'https://5e.tools/bestiary.html', 'https://5e.tools/bestiary.html#goblin', 'https://5e.tools/bestiary.html#_mm', 'https://5e.tools/bestiary.html#goblin_', 'https://5e.tools/bestiary.html#%ZZ_mm']) {
    await assert.rejects(fetchFiveEToolsMonsterFromUrl(url), { code: 'INVALID_MONSTER_URL' });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('direct links load only the requested book and match the full name and source', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (proxy) => {
    const url = new URL(proxy, 'http://tableforge.test').searchParams.get('url');
    urls.push(url);
    if (url.endsWith('/index.json')) return Response.json({ MM: 'bestiary-mm.json', XMM: 'bestiary-xmm.json', Unrelated: 'missing.json' });
    assert.equal(url, 'http://localhost:5050/Rules/data/bestiary/bestiary-mm.json');
    return Response.json({ monster: [
      { name: 'Goblin Boss', source: 'MM', hp: { average: 21 } },
      { name: 'Goblin', source: 'XMM', hp: { average: 99 } },
      { name: 'Goblin', source: 'MM', size: ['S'], hp: { average: 7 }, ac: [15], hasToken: true },
    ] });
  });
  const result = await fetchFiveEToolsMonsterFromUrl('http://localhost:5050/Rules/bestiary.html#goblin_mm');
  assert.deepEqual([result.name, result.source, result.hp, result.ac, result.sizeName], ['Goblin', 'MM', '7', '15', 'Small']);
  assert.equal(result.image, 'http://localhost:5050/Rules/img/bestiary/tokens/MM/Goblin.webp');
  assert.equal(urls.length, 2);
});

test('direct NPC links resolve cross-book copy chains and templates and disclose URL scaling', async (t) => {
  const base = 'http://127.0.0.1:5050/';
  const files = {
    'index.json': { MM: 'bestiary-mm.json', Test: 'bestiary-test.json' },
    'bestiary-mm.json': { monster: [{ name: 'Guard', source: 'MM', size: ['M'], type: 'humanoid', ac: [16], hp: { average: 11 }, senses: [], cr: '1/8' }] },
    'bestiary-test.json': { monster: [
      { name: 'Local Guard', source: 'Test', _copy: { name: 'Guard', source: 'MM', _templates: [{ name: 'Dwarf', source: 'PHB' }] } },
      { name: 'Cave Guard', source: 'Test', hp: { average: 22 }, _copy: { name: 'Local Guard', source: 'Test' } },
    ] },
    'template.json': { monsterTemplate: [{ name: 'Dwarf', source: 'PHB', apply: { _root: { size: ['S'] }, _mod: { _: { mode: 'addSenses', senses: { type: 'darkvision', range: 60 } } } } }] },
  };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (proxy) => {
    const url = new URL(proxy, 'http://tableforge.test').searchParams.get('url');
    urls.push(url);
    assert.ok(url.startsWith(base));
    return Response.json(files[url.split('/').at(-1)]);
  });
  const notices = [];
  const result = await fetchFiveEToolsMonsterFromUrl(`${base}bestiary.html#cave%20guard_test,scaled:2`, { onNotice: (message) => notices.push(message) });
  assert.deepEqual([result.name, result.ac, result.hp, result.sizeName, result.visionFeet, result.cr], ['Cave Guard', '16', '22', 'Small', 60, '1/8']);
  assert.equal(new Set(urls).size, 4);
  assert.equal(urls.length, 4);
  assert.match(notices[0], /original creature/);
});

test('direct links report missing sources and creatures instead of picking a similar entry', async (t) => {
  let data = { monster: [{ name: 'Goblin Boss', source: 'MM' }] };
  t.mock.method(globalThis, 'fetch', async (proxy) => Response.json(decodeURIComponent(proxy).endsWith('index.json') ? { MM: 'bestiary-mm.json' } : data));
  await assert.rejects(fetchFiveEToolsMonsterFromUrl('http://localhost:5050/bestiary.html#goblin_xmm'), { code: 'MONSTER_SOURCE_NOT_FOUND' });
  await assert.rejects(fetchFiveEToolsMonsterFromUrl('http://localhost:5050/bestiary.html#goblin_mm'), { code: 'MONSTER_NOT_FOUND' });
  data = { wrong: [] };
  await assert.rejects(fetchFiveEToolsMonsterFromUrl('http://localhost:5050/bestiary.html#goblin_mm'), { code: 'INVALID_BESTIARY_DATA' });
});

test('public direct imports disclose the mirror and continue using the original artwork host', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (proxy) => {
    const url = new URL(proxy, 'http://tableforge.test').searchParams.get('url');
    urls.push(url);
    if (url.startsWith('https://5e.tools/')) return Response.json({ error: 'Forbidden', code: 'SOURCE_HTTP_403' }, { status: 502 });
    if (url.endsWith('/index.json')) return Response.json({ MM: 'bestiary-mm.json' });
    return Response.json({ monster: [{ name: 'Goblin', source: 'MM', hasToken: true }] });
  });
  const notices = [];
  const result = await fetchFiveEToolsMonsterFromUrl('https://5e.tools/bestiary.html#goblin_mm', { onNotice: (message) => notices.push(message) });
  assert.equal(result.image, 'https://5e.tools/img/bestiary/tokens/MM/Goblin.webp');
  assert.equal(urls.length, 3);
  assert.ok(urls.slice(1).every((url) => url.startsWith('https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/')));
  assert.match(notices[0], /public source mirror/);
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
