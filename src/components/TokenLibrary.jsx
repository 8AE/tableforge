import React, { useEffect, useState } from 'react';
import { Copy, Image, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-react';
import { areTokenAndBoardCompatible, incompatibleTokenGridMessage, isHexBoard, normalizeLibraryToken, uid } from '../lib/board';

export function normalizeFiveEToolsBaseUrl(baseUrl = 'https://5e.tools/') {
  const trimmed = (baseUrl || '').trim() || 'https://5e.tools/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

async function fetchProxyJson(url) {
  const response = await fetch(`/api/5etools?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

const sizeNames = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', C: 'Colossal' };
const sizeToCells = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4, Colossal: 5 };
const typeColors = {
  aberration: '#8b5cf6',
  beast: '#36d399',
  celestial: '#f2c94c',
  construct: '#94a3b8',
  dragon: '#df5d52',
  elemental: '#38bdf8',
  fey: '#ec4899',
  fiend: '#ef4444',
  giant: '#f97316',
  humanoid: '#3ea7ff',
  monstrosity: '#a855f7',
  ooze: '#84cc16',
  plant: '#22c55e',
  undead: '#64748b',
};

function monsterTypeColor(type) {
  return typeColors[String(type || '').toLowerCase()] || '#df5d52';
}

function parseDarkvisionFeet(senses) {
  const text = Array.isArray(senses) ? senses.join(' ') : String(senses || '');
  const match = text.match(/darkvision\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function monsterResultToLibraryToken(result) {
  return normalizeLibraryToken({
    id: uid('library-token'),
    label: result.name,
    color: monsterTypeColor(result.type),
    image: result.image || '',
    layer: 'dm',
    size: sizeToCells[result.sizeName] || 1,
    visionFeet: result.visionFeet,
    visionMode: result.visionFeet ? 'darkvision' : 'normal',
    visionEnabled: Boolean(result.visionFeet),
    meta: {
      cr: result.cr,
      type: result.type,
      sizeName: result.sizeName,
      ac: result.ac,
      hp: result.hp,
      source: result.source,
      origin: result.origin,
    },
  });
}

function fiveEToolsMonsterResult(monster, baseUrl) {
  const type = typeof monster.type === 'string' ? monster.type : monster.type?.type || '';
  const size = Array.isArray(monster.size) ? monster.size[0] : monster.size;
  const acEntry = Array.isArray(monster.ac) ? monster.ac[0] : monster.ac;
  return {
    key: `5etools-${monster.source}-${monster.name}`,
    name: monster.name || 'Unknown',
    cr: monster.cr == null ? '' : typeof monster.cr === 'object' ? monster.cr.cr || '' : String(monster.cr),
    type,
    sizeName: sizeNames[size] || 'Medium',
    ac: typeof acEntry === 'number' ? String(acEntry) : acEntry?.ac != null ? String(acEntry.ac) : '',
    hp: monster.hp?.average != null ? String(monster.hp.average) : '',
    source: monster.source || '',
    origin: '5e.tools',
    visionFeet: parseDarkvisionFeet(monster.senses),
    image: fiveEToolsTokenImage(baseUrl, monster),
  };
}

function fiveEToolsTokenImage(baseUrl, monster) {
  if (!monster.name || !monster.source) return '';
  const source = encodeURIComponent(monster.source);
  const name = encodeURIComponent(monster.name).replace(/'/g, '%27');
  return `${normalizeFiveEToolsBaseUrl(baseUrl)}img/bestiary/tokens/${source}/${name}.webp`;
}

const FIVE_E_TOOLS_MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/';

async function searchFiveEToolsMonsters(query, baseUrl) {
  const normalizedBase = normalizeFiveEToolsBaseUrl(baseUrl);
  let dataBase = normalizedBase;
  let index;
  try {
    index = await fetchProxyJson(`${dataBase}data/bestiary/index.json`);
  } catch (error) {
    // 5e.tools blocks direct fetches; fall back to the public source mirror for data
    // while keeping the configured base URL for token artwork.
    dataBase = FIVE_E_TOOLS_MIRROR;
    index = await fetchProxyJson(`${dataBase}data/bestiary/index.json`);
  }
  const files = Object.values(index).filter((file) => typeof file === 'string');
  const matches = [];
  for (const file of files) {
    const data = await fetchProxyJson(`${dataBase}data/bestiary/${file}`);
    for (const monster of data.monster || []) {
      if (monster.name?.toLowerCase().includes(query)) matches.push(fiveEToolsMonsterResult(monster, normalizedBase));
      if (matches.length >= 30) break;
    }
    if (matches.length >= 30) break;
  }
  return matches;
}

function open5eMonsterResult(monster) {
  return {
    key: `open5e-${monster.slug || monster.name}`,
    name: monster.name || 'Unknown',
    cr: monster.challenge_rating || '',
    type: monster.type || '',
    sizeName: monster.size || 'Medium',
    ac: monster.armor_class != null ? String(monster.armor_class) : '',
    hp: monster.hit_points != null ? String(monster.hit_points) : '',
    source: monster.document__title || 'Open 5e',
    origin: 'Open 5e',
    visionFeet: parseDarkvisionFeet(monster.senses),
    image: monster.img_main || '',
  };
}

async function searchOpen5eMonsters(query) {
  const data = await fetchProxyJson(`https://api.open5e.com/v1/monsters/?name__icontains=${encodeURIComponent(query)}&limit=30`);
  return (data.results || []).map(open5eMonsterResult);
}

function metaLine(meta) {
  if (!meta) return '';
  return [
    meta.cr !== undefined && meta.cr !== '' ? `CR ${meta.cr}` : '',
    meta.type,
    meta.sizeName,
    meta.ac ? `AC ${meta.ac}` : '',
    meta.hp ? `HP ${meta.hp}` : '',
    meta.source,
  ].filter(Boolean).join(' · ');
}

function tokenKindText(token) {
  if (token.tokenKind === 'hex50') return '50 ft hex';
  if (token.tokenKind === 'vehicle') return `Vehicle · ${token.vehicle?.width || 1} x ${token.vehicle?.height || 1} cells`;
  return `${token.size} x ${token.size} cells`;
}

function tokenVisionText(token) {
  const feet = Number(token.visionFeet) || 0;
  if (!feet || token.visionEnabled === false) return 'No vision';
  return `${token.visionMode === 'lowlight' ? 'Low light' : token.visionMode === 'normal' ? 'Normal' : 'Darkvision'} ${feet} ft`;
}

function TokenPreview({ token }) {
  return (
    <span className={`library-token-preview ${token.image ? 'has-image' : ''}`} style={{ backgroundColor: token.image ? 'transparent' : token.color }}>
      {token.image ? <img src={token.image} alt="" /> : token.label.slice(0, 2)}
    </span>
  );
}

function ImagePickerRow({ token, imageAssets, isUploadingAsset, onUploadImage, onApplyImage }) {
  const isVehicle = token.tokenKind === 'vehicle';
  return (
    <>
      {token.image && (
        <div className="selected-asset-row">
          <img src={token.image} alt="" />
          <button className="command" onClick={() => onApplyImage('')}>Clear token image</button>
        </div>
      )}
      <label className="file-button">
        <Image size={16} />
        {isUploadingAsset ? 'Uploading image...' : isVehicle ? 'Vehicle background' : token.tokenKind === 'hex50' ? '50 ft token image' : 'Token image'}
        <input type="file" accept="image/*" onChange={(event) => onUploadImage(event, (asset) => onApplyImage(asset.path))} />
      </label>
      {imageAssets.length > 0 && (
        <details className="asset-picker">
          <summary>Pick image from project assets</summary>
          <div className="asset-picker-grid">
            {imageAssets.map((asset) => (
              <button key={asset.id} title={`Use ${asset.name}`} onClick={() => onApplyImage(asset.path)}>
                <img src={asset.path} alt="" />
                <span>{asset.name}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export function TokenLibraryModal({
  mode = 'manage',
  board,
  tokenLibrary,
  selectedToken,
  onSaveSelectedToken,
  fiveEToolsBaseUrl,
  onChangeFiveEToolsBaseUrl,
  imageAssets,
  isUploadingAsset,
  onUploadImage,
  onImportToken,
  onUpdateToken,
  onDeleteToken,
  onAddLibraryToken,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('saved');
  const [librarySearch, setLibrarySearch] = useState('');
  const [editingTokenId, setEditingTokenId] = useState(null);
  const [source, setSource] = useState('5etools');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const editingToken = tokenLibrary.find((token) => token.id === editingTokenId) || null;

  useEffect(() => {
    if (!editingTokenId) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setEditingTokenId(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editingTokenId]);

  const searchText = librarySearch.trim().toLowerCase();
  const filteredTokens = tokenLibrary.filter((token) => {
    if (!searchText) return true;
    return [token.label, token.meta?.type, token.meta?.source, token.meta?.cr ? `cr ${token.meta.cr}` : '', tokenKindText(token)]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(searchText));
  });

  const runSearch = async () => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;
    setSearchError('');
    setResults([]);
    setIsSearching(true);
    try {
      const matches = source === 'open5e'
        ? await searchOpen5eMonsters(trimmed)
        : await searchFiveEToolsMonsters(trimmed, fiveEToolsBaseUrl);
      setResults(matches);
      if (!matches.length) setSearchError('No matching monsters found.');
    } catch (error) {
      setSearchError(error.message || 'Unable to search for monsters.');
    } finally {
      setIsSearching(false);
    }
  };

  const saveResult = (result) => {
    onAddLibraryToken(monsterResultToLibraryToken(result));
    setSavedKeys((keys) => new Set([...keys, result.key]));
  };

  return (
    <div className="library-overlay" role="dialog" aria-modal="true" aria-label="Token library">
      <div className="library-modal token-library-modal">
        <header className="library-modal-header">
          <div>
            <strong>{mode === 'pick' ? 'Place a Library Token' : 'Token Library'}</strong>
            <span>{mode === 'pick' ? 'Pick a saved token to place on the selected cell.' : `${tokenLibrary.length} saved token${tokenLibrary.length === 1 ? '' : 's'} in this project`}</span>
          </div>
          <nav className="library-tabs" aria-label="Token library sections">
            <button type="button" className={activeTab === 'saved' ? 'active' : ''} onClick={() => setActiveTab('saved')}>
              Saved Tokens ({tokenLibrary.length})
            </button>
            <button type="button" className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>
              Find Monsters
            </button>
          </nav>
          <button title="Close token library" onClick={onClose}><X size={18} /></button>
        </header>

        {activeTab === 'saved' && (
          <>
            <div className="token-library-toolbar">
              <label className="token-search">
                <Search size={15} />
                <input
                  autoFocus
                  placeholder="Search saved tokens by name, type, CR, or source..."
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                />
              </label>
              {mode === 'manage' && (
                <button
                  className="command accent save-selected-button"
                  title={selectedToken ? 'Save the selected board token into this library' : 'Select a token on the board first'}
                  onClick={onSaveSelectedToken}
                  disabled={!selectedToken}
                >
                  <Copy size={16} /> Save selected board token
                </button>
              )}
            </div>
            <div className="token-table-wrap">
              {filteredTokens.length > 0 ? (
                <table className="token-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Size</th>
                      <th>Vision</th>
                      <th>Layer</th>
                      <th className="token-table-actions-head">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTokens.map((token) => {
                      const compatible = areTokenAndBoardCompatible(token, board);
                      return (
                        <tr key={token.id}>
                          <td>
                            <div className="token-cell">
                              <TokenPreview token={token} />
                              <div>
                                <strong>{token.label}</strong>
                                {token.meta && <span>{metaLine(token.meta)}</span>}
                              </div>
                            </div>
                          </td>
                          <td>{tokenKindText(token)}</td>
                          <td>{tokenVisionText(token)}</td>
                          <td>{token.layer === 'dm' ? 'DM' : 'Player'}</td>
                          <td>
                            <div className="token-table-actions">
                              <button
                                className="command accent"
                                title={compatible ? (mode === 'pick' ? 'Place this token on the selected cell' : 'Add this token to the active board') : incompatibleTokenGridMessage(token, board)}
                                disabled={!compatible}
                                onClick={() => onImportToken(token)}
                              >
                                <Plus size={15} /> {mode === 'pick' ? 'Place' : 'Import'}
                              </button>
                              {mode === 'manage' && (
                                <>
                                  <button className="command" title="Edit this library token" onClick={() => setEditingTokenId(token.id)}>
                                    <Pencil size={15} /> Edit
                                  </button>
                                  <button className="command danger icon-only" title="Remove this token from the library" onClick={() => onDeleteToken(token.id)}>
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="library-empty">
                  <strong>{tokenLibrary.length ? 'No tokens match your search' : 'No saved tokens yet'}</strong>
                  <span>
                    {tokenLibrary.length
                      ? 'Try a different name, creature type, or source.'
                      : 'Save a selected board token or find monsters from 5e.tools and Open 5e.'}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'search' && (
          <div className="monster-search">
            <div className="monster-search-controls">
              <div className="source-toggle" role="group" aria-label="Monster source">
                <button type="button" className={source === '5etools' ? 'active' : ''} onClick={() => setSource('5etools')}>5e.tools</button>
                <button type="button" className={source === 'open5e' ? 'active' : ''} onClick={() => setSource('open5e')}>Open 5e</button>
              </div>
              {source === '5etools' ? (
                <label className="base-url-field">
                  5e.tools base URL
                  <input value={fiveEToolsBaseUrl || 'https://5e.tools/'} onChange={(event) => onChangeFiveEToolsBaseUrl(event.target.value)} />
                </label>
              ) : (
                <p className="empty-note">Searches the public Open 5e API (api.open5e.com) — SRD and open-license monsters.</p>
              )}
              <div className="monster-search-row">
                <label className="token-search">
                  <Search size={15} />
                  <input
                    autoFocus
                    placeholder="Goblin, dragon, bandit..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
                  />
                </label>
                <button className="command" onClick={runSearch} disabled={isSearching}>
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
              {searchError && <p className="form-error">{searchError}</p>}
            </div>
            <div className="token-table-wrap">
              {results.length > 0 && (
                <table className="token-table">
                  <thead>
                    <tr>
                      <th>Monster</th>
                      <th>CR</th>
                      <th>AC</th>
                      <th>HP</th>
                      <th>Source</th>
                      <th className="token-table-actions-head">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => {
                      const alreadySaved = savedKeys.has(result.key);
                      return (
                        <tr key={result.key}>
                          <td>
                            <div className="token-cell">
                              <span className={`library-token-preview ${result.image ? 'has-image' : ''}`} style={{ backgroundColor: result.image ? 'transparent' : monsterTypeColor(result.type) }}>
                                {result.image ? <img src={result.image} alt="" loading="lazy" /> : result.name.slice(0, 2)}
                              </span>
                              <div>
                                <strong>{result.name}</strong>
                                <span>{[result.sizeName, result.type].filter(Boolean).join(' ')}{result.visionFeet ? ` · darkvision ${result.visionFeet} ft` : ''}</span>
                              </div>
                            </div>
                          </td>
                          <td>{result.cr || '?'}</td>
                          <td>{result.ac || '?'}</td>
                          <td>{result.hp || '?'}</td>
                          <td>{result.source}</td>
                          <td>
                            <div className="token-table-actions">
                              <button
                                className={alreadySaved ? 'command' : 'command accent'}
                                title={alreadySaved ? 'Already saved to the library' : 'Save this monster into the project token library'}
                                disabled={alreadySaved}
                                onClick={() => saveResult(result)}
                              >
                                <Plus size={15} /> {alreadySaved ? 'Saved' : 'Save'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {!results.length && !isSearching && !searchError && (
                <div className="library-empty">
                  <strong>Search for monsters</strong>
                  <span>Results show CR, AC, HP, and source so you can pick the right stat block before saving it.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editingToken && (
        <TokenEditModal
          token={editingToken}
          imageAssets={imageAssets}
          isUploadingAsset={isUploadingAsset}
          onUploadImage={onUploadImage}
          onUpdate={(patch) => onUpdateToken(editingToken.id, patch)}
          onDelete={() => { onDeleteToken(editingToken.id); setEditingTokenId(null); }}
          onClose={() => setEditingTokenId(null)}
        />
      )}
    </div>
  );
}

function TokenEditModal({ token, imageAssets, isUploadingAsset, onUploadImage, onUpdate, onDelete, onClose }) {
  return (
    <div className="library-overlay token-edit-overlay" role="dialog" aria-modal="true" aria-label={`Edit ${token.label}`}>
      <div className="popup-modal">
        <header className="library-modal-header">
          <div>
            <strong>Edit Token</strong>
            {token.meta ? <span>{metaLine(token.meta)}</span> : <span>Library token settings apply to future imports.</span>}
          </div>
          <button title="Close editor" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="popup-modal-body">
          <label>
            Name
            <input value={token.label} onChange={(event) => onUpdate({ label: event.target.value })} />
          </label>
          <div className="split">
            <label>
              Color
              <input type="color" value={token.color} onChange={(event) => onUpdate({ color: event.target.value })} />
            </label>
            <label>
              Size
              <input
                type="number"
                min="1"
                max="6"
                value={token.tokenKind === 'hex50' ? 1 : token.size}
                onChange={(event) => onUpdate({ size: Number(event.target.value) })}
                disabled={token.tokenKind === 'hex50' || token.tokenKind === 'vehicle'}
              />
            </label>
          </div>
          {token.tokenKind === 'hex50' && <p className="empty-note">50 ft hex token · import onto 50 ft hex boards only</p>}
          {token.tokenKind === 'vehicle' && (
            <div className="vehicle-editor">
              <div className="split">
                <label>
                  Grid width
                  <input type="number" min="1" max="30" value={token.vehicle?.width || 1} onChange={(event) => onUpdate({ vehicle: { ...(token.vehicle || {}), width: Number(event.target.value) } })} />
                </label>
                <label>
                  Grid height
                  <input type="number" min="1" max="30" value={token.vehicle?.height || 1} onChange={(event) => onUpdate({ vehicle: { ...(token.vehicle || {}), height: Number(event.target.value) } })} />
                </label>
              </div>
              <button className="command" title="Rotate this vehicle token 90 degrees" onClick={() => onUpdate({ vehicle: { ...(token.vehicle || {}), rotation: (((token.vehicle?.rotation || 0) + 90) % 360) } })}>
                <RotateCw size={16} /> Rotate {token.vehicle?.rotation || 0} degrees
              </button>
            </div>
          )}
          <ImagePickerRow
            token={token}
            imageAssets={imageAssets}
            isUploadingAsset={isUploadingAsset}
            onUploadImage={onUploadImage}
            onApplyImage={(path) => onUpdate(token.tokenKind === 'vehicle'
              ? { image: path, vehicle: { ...(token.vehicle || {}), backgroundImage: path } }
              : { image: path })}
          />
          <div className="split">
            <label>
              Layer
              <select value={token.layer} onChange={(event) => onUpdate({ layer: event.target.value })}>
                <option value="player">Player</option>
                <option value="dm">DM</option>
              </select>
            </label>
            <label>
              Vision feet
              <input
                type="number"
                min="0"
                step="5"
                value={token.visionFeet || 0}
                onChange={(event) => {
                  const feet = Number(event.target.value) || 0;
                  onUpdate({ visionFeet: feet, visionBrightFeet: feet, visionDimFeet: feet });
                }}
              />
            </label>
          </div>
          <div className="split">
            <label>
              Vision type
              <select value={token.visionMode || 'darkvision'} onChange={(event) => onUpdate({ visionMode: event.target.value })}>
                <option value="darkvision">Darkvision</option>
                <option value="lowlight">Low light</option>
                <option value="normal">Normal</option>
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={token.visionEnabled !== false} onChange={(event) => onUpdate({ visionEnabled: event.target.checked })} />
              Vision enabled
            </label>
          </div>
        </div>
        <div className="popup-modal-actions">
          <button className="command danger" title="Remove this token from the library" onClick={onDelete}><Trash2 size={16} /> Delete</button>
          <button className="command accent" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function TokenCreateModal({ board, initialDraft, imageAssets, isUploadingAsset, onUploadImage, onCancel, onCreate }) {
  const hexBoard = isHexBoard(board);
  const [draft, setDraft] = useState(() => {
    const base = initialDraft || {};
    return {
      label: base.label || (hexBoard ? 'Ship' : 'Bandit'),
      color: base.color || '#df5d52',
      size: Number(base.size) || 1,
      tokenKind: hexBoard ? 'hex50' : base.tokenKind === 'vehicle' ? 'vehicle' : 'creature',
      image: base.image || '',
      vehicle: {
        width: Number(base.vehicle?.width) || 4,
        height: Number(base.vehicle?.height) || 3,
        backgroundImage: base.vehicle?.backgroundImage || base.image || '',
        rotation: Number(base.vehicle?.rotation) || 0,
      },
    };
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  const isVehicle = draft.tokenKind === 'vehicle';
  return (
    <div className="library-overlay" role="dialog" aria-modal="true" aria-label="New token">
      <div className="popup-modal">
        <header className="library-modal-header">
          <div>
            <strong>New Token</strong>
            <span>Configure the token, then place it on the selected cell.</span>
          </div>
          <button title="Cancel" onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="popup-modal-body">
          <label>
            Type
            <select value={draft.tokenKind} onChange={(event) => setDraft({ ...draft, tokenKind: event.target.value })}>
              {!hexBoard && <option value="creature">Standard token</option>}
              {!hexBoard && <option value="vehicle">Vehicle token</option>}
              {hexBoard && <option value="hex50">50 ft hex token</option>}
            </select>
          </label>
          <label>
            Label
            <input
              autoFocus
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') onCreate(draft); }}
            />
          </label>
          <div className="split">
            <label>
              Color
              <input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
            </label>
            <label>
              Size
              <input
                type="number"
                min="1"
                max="6"
                value={draft.tokenKind === 'hex50' ? 1 : draft.size}
                onChange={(event) => setDraft({ ...draft, size: Number(event.target.value) || 1 })}
                disabled={isVehicle || draft.tokenKind === 'hex50'}
              />
            </label>
          </div>
          {isVehicle && (
            <div className="vehicle-editor">
              <div className="split">
                <label>
                  Grid width
                  <input type="number" min="1" max="30" value={draft.vehicle.width} onChange={(event) => setDraft({ ...draft, vehicle: { ...draft.vehicle, width: Number(event.target.value) || 1 } })} />
                </label>
                <label>
                  Grid height
                  <input type="number" min="1" max="30" value={draft.vehicle.height} onChange={(event) => setDraft({ ...draft, vehicle: { ...draft.vehicle, height: Number(event.target.value) || 1 } })} />
                </label>
              </div>
              <button className="command" title="Rotate the new vehicle token 90 degrees" onClick={() => setDraft({ ...draft, vehicle: { ...draft.vehicle, rotation: ((draft.vehicle.rotation + 90) % 360) } })}>
                <RotateCw size={16} /> Rotate {draft.vehicle.rotation} degrees
              </button>
            </div>
          )}
          <ImagePickerRow
            token={draft}
            imageAssets={imageAssets}
            isUploadingAsset={isUploadingAsset}
            onUploadImage={onUploadImage}
            onApplyImage={(path) => setDraft({ ...draft, image: path, vehicle: { ...draft.vehicle, backgroundImage: path } })}
          />
        </div>
        <div className="popup-modal-actions">
          <button className="command" onClick={onCancel}>Cancel</button>
          <button className="command accent" onClick={() => onCreate(draft)}><Plus size={16} /> Place token</button>
        </div>
      </div>
    </div>
  );
}
