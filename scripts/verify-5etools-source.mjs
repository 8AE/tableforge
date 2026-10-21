import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { getFiveEToolsMapBooks, makeFiveEToolsMapBoard } from '../src/lib/fiveETools.js';
import { resolveFiveEToolsMonster, fiveEToolsMonsterResult, fiveEToolsTokenImage } from '../src/lib/fiveEToolsMonsters.js';

const root = path.resolve(process.argv[2] || '../5etools');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const localBase = 'http://localhost:5050/';
const failures = [];
const books = getFiveEToolsMapBooks(read('data/generated/gendata-maps.json'), localBase);
let maps = 0;
for (const book of books) for (const map of book.maps) {
  maps++;
  const board = makeFiveEToolsMapBoard(map, '/local-test-image');
  assert.ok(Number.isFinite(board.rows) && Number.isFinite(board.columns));
  if (new URL(map.imageUrl).origin === new URL(localBase).origin && !fs.existsSync(path.join(root, decodeURIComponent(new URL(map.imageUrl).pathname)))) failures.push(`Missing map: ${map.id}`);
}
const index = read('data/bestiary/index.json');
const raw = [...new Set(Object.values(index))].flatMap((file) => read(`data/bestiary/${file}`).monster);
const templates = read('data/bestiary/template.json').monsterTemplate;
const byKey = new Map(raw.map((monster) => [`${monster.source}|${monster.name}`.toLowerCase(), monster]));
for (const monster of raw) {
  const resolved = resolveFiveEToolsMonster(monster, byKey, templates);
  const url = fiveEToolsTokenImage(localBase, resolved);
  if (url && new URL(url).origin === new URL(localBase).origin && !fs.existsSync(path.join(root, decodeURIComponent(new URL(url).pathname)))) failures.push(`Missing token: ${monster.name} (${monster.source})`);
}

// Run the installed source's own copier as an independent oracle. No upstream
// code or game data is bundled into Tableforge by this optional audit script.
process.chdir(root);
for (const file of ['js/parser.js', 'js/utils.js', 'js/render.js']) await import(pathToFileURL(path.join(root, file)));
const nativeUtils = await import(pathToFileURL(path.join(root, 'node/util.js')));
nativeUtils.patchLoadJson();
const native = structuredClone(raw).map((monster) => ({ ...monster, __prop: 'monster' }));
let copiesCompared = 0;
for (const monster of native) {
  const original = byKey.get(`${monster.source}|${monster.name}`.toLowerCase());
  if (!original._copy) continue;
  await DataUtil.monster.pMergeCopy(native, monster, { isErrorOnMissing: true });
  const expected = fiveEToolsMonsterResult(monster, localBase);
  const actual = fiveEToolsMonsterResult(resolveFiveEToolsMonster(original, byKey, templates), localBase);
  try { assert.deepEqual(actual, expected); }
  catch { failures.push(`Native stats mismatch: ${monster.name} (${monster.source})`); }
  copiesCompared++;
}
console.log(JSON.stringify({ root, books: books.length, maps, monsters: raw.length, copiesCompared, failures }, null, 2));
if (failures.length) process.exitCode = 1;
