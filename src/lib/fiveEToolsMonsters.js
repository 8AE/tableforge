import { normalizeLibraryToken, uid } from './board.js';
import { fetchFiveEToolsData, fetchFiveEToolsJson, getFiveEToolsImageUrl, normalizeFiveEToolsBaseUrl } from './fiveETools.js';
import { ImportError } from './importErrors.js';

const sizes = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', C: 'Colossal' };
const sizeCells = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4, Colossal: 5 };
const statFields = new Set(['size', 'type', 'ac', 'hp', 'cr', 'senses', 'token', 'tokenUrl', 'tokenHref', 'hasToken']);
const key = (entry) => `${entry.source}|${entry.name}`.toLowerCase();
const list = (value) => value == null ? [] : Array.isArray(value) ? value : [value];

export function parseDarkvisionFeet(senses) {
  return Number(list(senses).join(' ').match(/darkvision\s+(\d+)/i)?.[1]) || 0;
}

export function fiveEToolsTokenImage(baseUrl, monster) {
  if (monster.tokenUrl) return /^https?:\/\//i.test(monster.tokenUrl) ? monster.tokenUrl : '';
  if (monster.tokenHref) return getFiveEToolsImageUrl(baseUrl, monster.tokenHref);
  if (!monster.token && !monster.hasToken) return '';
  const token = monster.token || monster;
  if (!token.name || !token.source) return '';
  // 5etools Parser.nameToTokenName / String.toAscii, not the display name.
  const name = token.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Æ/g, 'AE').replace(/æ/g, 'ae').replace(/"/g, '');
  return getFiveEToolsImageUrl(baseUrl, { type: 'internal', path: `bestiary/tokens/${token.source}/${name}.webp` });
}

function applyStatMods(monster, mods = {}) {
  for (const [property, entries] of Object.entries(mods)) {
    if (property !== '_' && !statFields.has(property)) continue; // Not part of the token's quick stats.
    for (const mod of list(entries)) {
      if (property === '_' && mod.mode === 'addSenses') {
        for (const sense of list(mod.senses)) {
          const existing = list(monster.senses);
          const at = existing.findIndex((value) => value.toLowerCase().startsWith(`${sense.type.toLowerCase()} `));
          const range = at < 0 ? 0 : Number(existing[at].match(/\d+/)?.[0]);
          if (range < sense.range) {
            if (at >= 0) existing.splice(at, 1);
            existing.push(`${sense.type} ${sense.range} ft.`);
          }
          monster.senses = existing;
        }
      } else if (property === '_' && mod.mode === 'maxSize') {
        const order = 'TSMLHG';
        monster.size = list(monster.size).map((size) => order.indexOf(size) > order.indexOf(mod.max) ? mod.max : size);
      } else if (property === '_' && mod.mode === 'setProp' && statFields.has(mod.prop)) {
        monster[mod.prop] = structuredClone(mod.value);
      } else if (property === '_' && ['addSkills', 'addSpells', 'replaceSpells', 'removeSpells', 'scalarMultXp', 'addAllSaves', 'addAllSkills'].includes(mod.mode)) {
        // These do not alter the quick stats or token artwork we import.
      } else if (property === '_' && mod.mode === 'setProp' && !statFields.has(String(mod.prop).split('.')[0])) {
        // A change to a non-imported field.
      } else if (statFields.has(property) && ['scalarMultProp', 'scalarAddProp'].includes(mod.mode)) {
        const before = Number(monster[property]?.[mod.prop]);
        if (!Number.isFinite(before)) throw new ImportError('MONSTER_COPY_UNSUPPORTED', `Cannot calculate ${property} for ${monster.name}. Update the source data or choose another entry.`);
        let next = mod.mode === 'scalarMultProp' ? before * mod.scalar : before + mod.scalar;
        if (mod.floor) next = Math.floor(next);
        monster[property][mod.prop] = next;
      } else if (statFields.has(property) && mod.mode === 'prefixSuffixStringProp') {
        monster[property][mod.prop] = `${mod.prefix || ''}${monster[property]?.[mod.prop] || ''}${mod.suffix || ''}`;
      } else {
        throw new ImportError('MONSTER_COPY_UNSUPPORTED', `The ${mod.mode || 'unknown'} stat change for ${monster.name} is not supported. Choose another entry or update Tableforge.`);
      }
    }
  }
}

// Resolve only the fields represented by a library token. Adventure text,
// attacks, spellcasting, and full stat blocks are not imported by this feature.
export function resolveFiveEToolsMonster(monster, monsters, templates = [], trail = new Set()) {
  if (!monster._copy) return structuredClone(monster);
  if (trail.has(key(monster))) throw new ImportError('MONSTER_COPY_CYCLE', `The source contains a circular copy for ${monster.name}. Update its bestiary data.`);
  const nextTrail = new Set([...trail, key(monster)]);
  const parent = monsters.get(key(monster._copy));
  if (!parent) throw new ImportError('MONSTER_COPY_MISSING', `The source is missing ${monster._copy.name} (${monster._copy.source}), required by ${monster.name}. Update its bestiary data.`);
  const inherited = resolveFiveEToolsMonster(parent, monsters, templates, nextTrail);
  const out = structuredClone(monster);
  for (const field of statFields) {
    if (out[field] === null) { delete out[field]; continue; }
    if (out[field] !== undefined) continue;
    if (field === 'hasToken' && !monster._copy._preserve?.hasToken && !monster._copy._preserve?.['*']) continue;
    if (inherited[field] !== undefined) out[field] = structuredClone(inherited[field]);
  }
  const templateMods = [];
  for (const reference of monster._copy._templates || []) {
    const template = resolveTemplate(reference, templates);
    for (const [field, value] of Object.entries(template.apply?._root || {})) {
      if (statFields.has(field) && !Object.hasOwn(monster, field)) out[field] = structuredClone(value);
    }
    templateMods.push(template.apply?._mod || {});
  }
  applyStatMods(out, monster._copy._mod);
  for (const mods of templateMods) applyStatMods(out, mods);
  delete out._copy;
  return out;
}

function resolveTemplate(reference, templates, trail = new Set()) {
  const template = templates.find((entry) => key(entry) === key(reference));
  if (!template || trail.has(key(reference))) throw new ImportError('MONSTER_TEMPLATE_INVALID', `The source is missing a valid ${reference.name} template. Update its bestiary data.`);
  if (!template._copy) return template;
  const parent = structuredClone(resolveTemplate(template._copy, templates, new Set([...trail, key(reference)])));
  for (const mod of list(template._copy._mod?._)) {
    const field = mod.prop?.replace(/^apply\._root\./, '');
    if (mod.mode !== 'setProp' || !statFields.has(field)) throw new ImportError('MONSTER_TEMPLATE_UNSUPPORTED', `The ${reference.name} template uses an unsupported stat change.`);
    parent.apply._root[field] = structuredClone(mod.value);
  }
  return { ...parent, ...template, apply: parent.apply };
}

export function fiveEToolsMonsterResult(monster, baseUrl) {
  const ac = list(monster.ac)[0];
  return {
    key: `5etools-${monster.source}-${monster.name}`, name: monster.name, source: monster.source || '', origin: '5e.tools',
    type: typeof monster.type === 'string' ? monster.type : monster.type?.type || '',
    sizeName: sizes[list(monster.size)[0]] || 'Medium',
    cr: monster.cr == null ? '' : String(typeof monster.cr === 'object' ? monster.cr.cr ?? '' : monster.cr),
    ac: typeof ac === 'number' ? String(ac) : ac?.ac != null ? String(ac.ac) : '',
    hp: monster.hp?.average != null ? String(monster.hp.average) : monster.hp?.special || '',
    visionFeet: parseDarkvisionFeet(monster.senses), image: fiveEToolsTokenImage(baseUrl, monster),
  };
}

export async function searchFiveEToolsMonsters(query, baseUrl, options = {}) {
  const base = normalizeFiveEToolsBaseUrl(baseUrl);
  const { data: index, dataBase } = await fetchFiveEToolsData(base, 'data/bestiary/index.json', options);
  if (!index || Array.isArray(index) || typeof index !== 'object' || !Object.values(index).length || !Object.values(index).every((file) => typeof file === 'string' && /^[\w.-]+\.json$/.test(file))) throw new ImportError('INVALID_BESTIARY_INDEX', 'The source did not return a valid bestiary index. Check the site root URL and update its data.');
  const files = [...new Set(Object.values(index))];
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const records = new Array(files.length);
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
      while (cursor < files.length) {
        const at = cursor++;
        const data = await fetchFiveEToolsJson(`${dataBase}data/bestiary/${files[at]}`, { signal });
        if (!Array.isArray(data?.monster)) throw new ImportError('INVALID_BESTIARY_DATA', `${files[at]} is not a bestiary data file. Update the source installation.`);
        records[at] = data.monster;
      }
    }));
    const all = records.flat();
    const matches = all.filter((monster) => monster.name?.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source)).slice(0, 30);
    // Templates may be inherited through another monster, so load them for any copy.
    const templateData = matches.some((monster) => monster._copy) ? await fetchFiveEToolsJson(`${dataBase}data/bestiary/template.json`, { signal }) : {};
    const byKey = new Map(all.map((monster) => [key(monster), monster]));
    return matches.map((monster) => fiveEToolsMonsterResult(resolveFiveEToolsMonster(monster, byKey, templateData.monsterTemplate || []), base));
  } finally { controller.abort(); }
}

export async function searchOpen5eMonsters(query, options = {}) {
  const data = await fetchFiveEToolsJson(`https://api.open5e.com/v1/monsters/?name__icontains=${encodeURIComponent(query)}&limit=30`, options);
  if (!Array.isArray(data?.results)) throw new ImportError('INVALID_BESTIARY_DATA', 'Open 5e returned an unexpected response. Try again later.');
  return data.results.map((monster) => ({
    key: `open5e-${monster.slug || monster.name}`, name: monster.name || 'Unknown', cr: monster.challenge_rating ?? '',
    type: monster.type || '', sizeName: monster.size || 'Medium', ac: String(monster.armor_class ?? ''), hp: String(monster.hit_points ?? ''),
    source: monster.document__title || 'Open 5e', origin: 'Open 5e', visionFeet: parseDarkvisionFeet(monster.senses), image: monster.img_main || '',
  }));
}

export function monsterResultToLibraryToken(result, color = '#df5d52') {
  return normalizeLibraryToken({
    id: uid('library-token'), label: result.name, color, image: result.image || '', layer: 'dm', size: sizeCells[result.sizeName] || 1,
    visionFeet: result.visionFeet, visionMode: result.visionFeet ? 'darkvision' : 'normal', visionEnabled: Boolean(result.visionFeet),
    meta: { cr: result.cr, type: result.type, sizeName: result.sizeName, ac: result.ac, hp: result.hp, source: result.source, origin: result.origin, importKey: result.key },
  });
}
