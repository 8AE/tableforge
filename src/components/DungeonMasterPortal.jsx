import React, { useEffect, useState } from 'react';
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Grid2X2,
  Image,
  Library,
  Layers,
  Lightbulb,
  MousePointer2,
  Music,
  Pencil,
  Plus,
  Redo2,
  Ruler,
  Send,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { BoardCanvas } from './BoardCanvas';
import { Panel } from './Panel';
import { Topbar } from './Topbar';
import { boxesOverlap, defaultLighting, getBoard, getBoardEntity, makeBoard, normalizeDoors, normalizeLibraryToken, normalizeWall, offsetEntity, offsetDrawing, revealBox, uid, updateActiveBoard } from '../lib/board';
import { dungeonToBoard, normalizeDungeon } from '../lib/dungeon';

export function DungeonMasterPortal({ state, projects = [], openProjectId, setState, leaveProject, publishProjectToPlayers, deleteBoard, undo, redo, canUndo, canRedo, onOpenDungeonBuilder }) {
  const [tool, setTool] = useState('select');
  const [activeLayer, setActiveLayer] = useState('token');
  const [layerNotice, setLayerNotice] = useState('');
  const [publishToast, setPublishToast] = useState('');
  const [tokenDraft, setTokenDraft] = useState({ label: 'Bandit', color: '#df5d52', size: 1 });
  const [drawColor, setDrawColor] = useState('#36d399');
  const [drawLayer, setDrawLayer] = useState('player');
  const [selected, setSelected] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [tokensExpanded, setTokensExpanded] = useState(true);
  const [drawingsExpanded, setDrawingsExpanded] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState('journal');
  const [isQuickMenuCollapsed, setIsQuickMenuCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('tableforge-dm-sidebar-width'));
    return Number.isFinite(saved) && saved >= 300 ? saved : 380;
  });
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [editingLibraryTokenId, setEditingLibraryTokenId] = useState(null);
  const [bestiaryQuery, setBestiaryQuery] = useState('');
  const [bestiaryResults, setBestiaryResults] = useState([]);
  const [bestiaryError, setBestiaryError] = useState('');
  const [isSearchingBestiary, setIsSearchingBestiary] = useState(false);
  const [mapQuery, setMapQuery] = useState('');
  const [mapResults, setMapResults] = useState([]);
  const [mapImportError, setMapImportError] = useState('');
  const [isSearchingMaps, setIsSearchingMaps] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetCategory, setAssetCategory] = useState('token');
  const [assetError, setAssetError] = useState('');
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isDungeonImportOpen, setIsDungeonImportOpen] = useState(false);
  const [boardDeleteTarget, setBoardDeleteTarget] = useState(null);
  const [boardDeleteError, setBoardDeleteError] = useState('');
  const [dungeonLibrary, setDungeonLibrary] = useState([]);
  const [dungeonImportError, setDungeonImportError] = useState('');
  const board = getBoard(state, state.activeBoardId);
  const tokenLibrary = state.tokenLibrary || [];
  const imageAssets = assets.filter((asset) => asset.type === 'image');
  const audioAssets = assets.filter((asset) => asset.type === 'audio');
  const sidebarStyle = { '--dm-sidebar-width': `${sidebarWidth}px` };

  const startSidebarResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const minWidth = 300;
    const maxWidth = Math.min(620, Math.max(360, window.innerWidth - 420));

    const onPointerMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX));
      setSidebarWidth(nextWidth);
    };
    const onPointerUp = (upEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - upEvent.clientX));
      window.localStorage.setItem('tableforge-dm-sidebar-width', String(Math.round(nextWidth)));
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const updateBoard = (patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, ...patch })));
  };
  const updateBackground = (patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, background: { ...active.background, ...patch } })));
  };
  const toggleBackgroundFit = (enabled) => {
    updateBackground(enabled ? { fitToBoard: true, x: 0, y: 0, scale: 1 } : { fitToBoard: false });
  };
  const updateLighting = (patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      lighting: { ...defaultLighting, ...active.lighting, ...patch },
    })));
  };
  const updateToken = (id, patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      tokens: active.tokens.map((token) => token.id === id ? { ...token, ...patch } : token),
    })));
  };
  const updateDrawing = (id, patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      drawings: active.drawings.map((drawing) => drawing.id === id ? { ...drawing, ...patch, fill: patch.color ? `${patch.color}22` : drawing.fill } : drawing),
    })));
  };
  const updateDoor = (id, patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      doors: (active.doors || []).map((door) => door.id === id ? mergeDoorPatch(door, patch) : door),
    })));
  };
  const updateTokenLibrary = (updater) => {
    setState((current) => ({
      ...current,
      tokenLibrary: typeof updater === 'function' ? updater(current.tokenLibrary || []) : updater,
    }));
  };
  const updateFiveEToolsBaseUrl = (baseUrl) => {
    setState((current) => ({ ...current, fiveEToolsBaseUrl: baseUrl }), { skipHistory: true });
  };
  const updateLiveMeasurement = (measurement) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, liveMeasurement: measurement })), { skipHistory: true });
  };
  const fetchProjectAssets = async () => {
    if (!openProjectId) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(openProjectId)}/assets`);
      if (!response.ok) throw new Error('Unable to load project assets.');
      const data = await response.json();
      setAssets(data.assets || []);
      setAssetError('');
    } catch (error) {
      setAssetError(error.message || 'Unable to load project assets.');
    }
  };

  useEffect(() => {
    setAssets([]);
    fetchProjectAssets();
  }, [openProjectId]);

  const uploadProjectAsset = async (file, category = assetCategory) => {
    if (!openProjectId || !file) return null;
    const form = new FormData();
    form.append('file', file);
    form.append('category', category);
    form.append('assetType', file.type.startsWith('audio/') ? 'audio' : 'image');
    const response = await fetch(`/api/projects/${encodeURIComponent(openProjectId)}/assets`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Unable to upload ${file.name}.`);
    }
    const data = await response.json();
    setAssets(data.assets || []);
    return data.asset;
  };

  const uploadProjectAssets = async (files) => {
    const fileList = Array.from(files || []);
    if (!openProjectId || !fileList.length) return;
    setAssetError('');
    setIsUploadingAsset(true);
    try {
      for (const file of fileList) {
        await uploadProjectAsset(file, assetCategory);
      }
    } catch (error) {
      setAssetError(error.message || 'Unable to upload asset.');
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const uploadImageForUse = async (event, category, onAssetReady) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAssetError('');
    setIsUploadingAsset(true);
    try {
      const asset = await uploadProjectAsset(file, category);
      if (asset) onAssetReady(asset);
    } catch (error) {
      setAssetError(error.message || 'Unable to upload image asset.');
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const addToken = (point) => {
    const token = {
      id: uid('token'),
      x: point.x,
      y: point.y,
      label: tokenDraft.label || 'Token',
      color: tokenDraft.color,
      layer: activeLayer === 'gm' ? 'dm' : 'player',
      size: Number(tokenDraft.size) || 1,
      visible: true,
      visionEnabled: true,
      visionBrightFeet: 0,
      visionDimFeet: 0,
      lightBrightFeet: 0,
      lightDimFeet: 0,
      image: tokenDraft.image || '',
    };
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, tokens: [...active.tokens, token] })));
    setSelected({ type: 'token', id: token.id });
  };

  const saveSelectedTokenToLibrary = () => {
    if (!selectedToken) return;
    const libraryToken = normalizeLibraryToken({
      ...selectedToken,
      id: uid('library-token'),
    });
    updateTokenLibrary((items) => [...items, libraryToken]);
  };

  const importLibraryToken = (libraryToken) => {
    const token = {
      ...normalizeLibraryToken(libraryToken),
      id: uid('token'),
      x: 0,
      y: 0,
      visible: true,
    };
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, tokens: [...active.tokens, token] })));
    setSelected({ type: 'token', id: token.id });
  };

  const updateLibraryToken = (id, patch) => {
    updateTokenLibrary((items) => items.map((token) => token.id === id ? normalizeLibraryToken({ ...token, ...patch }) : token));
  };

  const deleteLibraryToken = (id) => {
    updateTokenLibrary((items) => items.filter((token) => token.id !== id));
    if (editingLibraryTokenId === id) setEditingLibraryTokenId(null);
  };

  const saveBestiaryMonsterToLibrary = (monster) => {
    updateTokenLibrary((items) => [...items, normalizeLibraryToken({
      id: uid('library-token'),
      label: monster.name,
      color: monsterColor(monster),
      image: monsterTokenImage(state.fiveEToolsBaseUrl, monster),
      layer: 'dm',
      size: monsterTokenSize(monster),
      visionFeet: monsterVisionFeet(monster),
      visionMode: monsterVisionFeet(monster) ? 'darkvision' : 'normal',
      visionEnabled: Boolean(monsterVisionFeet(monster)),
    })]);
  };

  const searchBestiary = async () => {
    const query = bestiaryQuery.trim().toLowerCase();
    if (!query) return;
    setBestiaryError('');
    setBestiaryResults([]);
    setIsSearchingBestiary(true);
    try {
      const baseUrl = normalizeFiveEToolsBaseUrl(state.fiveEToolsBaseUrl);
      const index = await fetchBestiaryJson(`${baseUrl}data/bestiary/index.json`);
      const files = Object.values(index).filter((file) => typeof file === 'string');
      const matches = [];
      for (const file of files) {
        const data = await fetchBestiaryJson(`${baseUrl}data/bestiary/${file}`);
        for (const monster of data.monster || []) {
          if (monster.name?.toLowerCase().includes(query)) matches.push(monster);
          if (matches.length >= 40) break;
        }
        if (matches.length >= 40) break;
      }
      setBestiaryResults(matches);
      if (!matches.length) setBestiaryError('No matching monsters found.');
    } catch (error) {
      setBestiaryError(error.message || 'Unable to search the 5e.tools bestiary.');
    } finally {
      setIsSearchingBestiary(false);
    }
  };

  const searchMaps = async () => {
    const query = mapQuery.trim().toLowerCase();
    if (!query) return;
    setMapImportError('');
    setMapResults([]);
    setIsSearchingMaps(true);
    try {
      const baseUrl = normalizeFiveEToolsBaseUrl(state.fiveEToolsBaseUrl);
      const data = await fetchMapsJson(baseUrl);
      const matches = flattenMapData(data, baseUrl)
        .filter((map) => map.searchText.includes(query))
        .slice(0, 30);
      setMapResults(matches);
      if (!matches.length) setMapImportError('No matching maps found.');
    } catch (error) {
      setMapImportError(error.message || 'Unable to search 5e.tools maps.');
    } finally {
      setIsSearchingMaps(false);
    }
  };

  const importMap = (map) => {
    const dimensions = getMapBoardDimensions(map);
    const importedWalls = getMapRegionWalls(map, dimensions);
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      name: map.displayTitle || active.name,
      columns: dimensions.columns,
      rows: dimensions.rows,
      background: {
        ...active.background,
        src: map.imageUrl,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        fitToBoard: true,
      },
      lighting: {
        ...defaultLighting,
        ...active.lighting,
        walls: importedWalls,
      },
    })));
    setMapImportError('');
    setMapResults([]);
    setMapQuery(map.displayTitle);
  };

  const useAssetAsMap = (asset) => {
    updateBackground({ src: asset.path, opacity: 1, fitToBoard: true, x: 0, y: 0, scale: 1 });
    setMapImportError('');
  };

  const useAssetForTokenDraft = (asset) => {
    setTokenDraft((draft) => ({ ...draft, image: asset.path }));
  };

  const addDrawing = (drawing) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, drawings: [...active.drawings, drawing] })));
    setSelected({ type: 'drawing', id: drawing.id });
  };

  const addBoard = () => {
    const next = makeBoard(`Board ${state.boards.length + 1}`);
    next.tokens = [];
    next.drawings = [];
    setState((current) => ({ ...current, boards: [...current.boards, next], activeBoardId: next.id }));
  };

  const openDungeonImport = async () => {
    setDungeonImportError('');
    setIsDungeonImportOpen(true);
    try {
      const response = await fetch('/api/dungeons');
      if (!response.ok) throw new Error('Unable to load dungeon library.');
      const data = await response.json();
      setDungeonLibrary(data.dungeons || []);
    } catch (error) {
      setDungeonImportError(error.message || 'Unable to load dungeon library.');
    }
  };

  const importDungeonAsBoard = async (dungeonSummary) => {
    try {
      const response = await fetch(`/api/dungeons/${encodeURIComponent(dungeonSummary.id)}`);
      if (!response.ok) throw new Error('Unable to load dungeon.');
      const data = await response.json();
      const nextBoard = dungeonToBoard(normalizeDungeon(data.dungeon));
      setState((current) => ({
        ...current,
        boards: [...current.boards, nextBoard],
        activeBoardId: nextBoard.id,
      }));
      setIsDungeonImportOpen(false);
      setActiveSidebarTab('map');
    } catch (error) {
      setDungeonImportError(error.message || 'Unable to import dungeon.');
    }
  };

  const duplicateBoard = (boardId = board.id) => {
    const sourceBoard = state.boards.find((item) => item.id === boardId) || board;
    const next = {
      ...structuredClone(sourceBoard),
      id: uid('board'),
      name: `${sourceBoard.name} Copy`,
      tokens: sourceBoard.tokens.map((token) => ({ ...token, id: uid('token') })),
      drawings: sourceBoard.drawings.map((drawing) => ({ ...drawing, id: uid('drawing') })),
    };
    setState((current) => ({ ...current, boards: [...current.boards, next], activeBoardId: next.id }));
  };

  const requestDeleteBoard = (item) => {
    setBoardDeleteTarget(item);
    setBoardDeleteError('');
  };

  const confirmDeleteBoard = async () => {
    if (!boardDeleteTarget) return;
    const result = await deleteBoard?.(openProjectId, boardDeleteTarget.id);
    if (result?.ok === false) {
      setBoardDeleteError(result.error || 'Unable to delete board.');
      return;
    }
    setBoardDeleteTarget(null);
  };

  const showBoardToPlayers = (boardId = state.activeBoardId) => {
    const publishedBoard = state.boards.find((item) => item.id === boardId) || board;
    const timestamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setState((current) => ({ ...current, playerBoardId: boardId }), { skipHistory: true });
    setPublishToast(`Active Board Published to Players ${timestamp}: ${publishedBoard.name}`);
    window.setTimeout(() => setPublishToast(''), 2600);
    window.setTimeout(() => publishProjectToPlayers(openProjectId), 320);
  };

  const switchActiveLayer = (layer) => {
    setActiveLayer(layer);
    setDrawLayer(layer === 'gm' ? 'dm' : 'player');
    if (layer === 'map') setTool('background');
    if (layer === 'walls' && !['select', 'wall', 'door', 'light'].includes(tool)) setTool('wall');
    if (['token', 'gm'].includes(layer) && ['background', 'wall', 'door', 'light'].includes(tool)) setTool('select');
    const label = { map: 'Map & Background', token: 'Tokens & Objects', gm: 'GM Info Layer', walls: 'Walls & Lighting' }[layer] || layer;
    setLayerNotice(label);
    window.setTimeout(() => setLayerNotice(''), 1100);
  };

  const addLightReveal = (reveal) => {
    const revealArea = revealBox(reveal);
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      lighting: {
        ...{ ...defaultLighting, ...active.lighting },
        reveals: [...(active.lighting?.reveals || []), reveal],
        hiddenReveals: (active.lighting?.hiddenReveals || []).filter((hidden) => !boxesOverlap(revealBox(hidden), revealArea)),
      },
    })));
  };

  const addLightWall = (wall) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      lighting: {
        ...{ ...defaultLighting, ...active.lighting },
        walls: [...(active.lighting?.walls || []), normalizeWall(wall)],
      },
    })));
  };

  const addDoor = (door) => {
    const edgeKey = (edge) => `${edge?.x},${edge?.y},${edge?.orientation}`;
    setState((current) => updateActiveBoard(current, (active) => {
      const normalizedDoor = normalizeDoors([door])[0];
      const existing = (active.doors || []).find((item) => edgeKey(item.edge) === edgeKey(normalizedDoor.edge));
      if (existing) {
        return {
          ...active,
          doors: (active.doors || []).map((item) => item.id === existing.id ? { ...item, state: 'closed', isLocked: false } : item),
        };
      }
      return {
        ...active,
        doors: [...(active.doors || []), normalizedDoor],
      };
    }));
    setSelected(null);
  };

  const moveLightWall = (id, wall) => {
    updateLighting({ walls: (board.lighting?.walls || []).map((item) => item.id === id ? wall : item) });
  };

  const moveDoor = (id, door) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      doors: (active.doors || []).map((item) => item.id === id ? door : item),
    })));
  };

  const toggleDoor = (id) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      doors: (active.doors || []).map((door) => {
        if (door.id !== id) return door;
        if (door.state === 'locked' || door.isLocked) return door;
        return { ...door, state: door.state === 'open' ? 'closed' : 'open' };
      }),
    })));
  };

  const removeLightReveal = (area) => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      lighting: {
        ...{ ...defaultLighting, ...active.lighting },
        hiddenReveals: [...(active.lighting?.hiddenReveals || []), { id: uid('hidden-reveal'), ...area }],
      },
    })));
  };

  const clearLightReveals = () => {
    updateLighting({ reveals: [], hiddenReveals: [] });
  };

  const clearLightWalls = () => {
    updateLighting({ walls: [] });
  };

  const nudgeSelection = (dx, dy) => {
    if (!selected) return;
    const amount = selected.type === 'wall' ? 0.2 : 1;
    if (selected.type === 'token' && selectedToken) updateToken(selected.id, { x: Math.max(0, selectedToken.x + dx * amount), y: Math.max(0, selectedToken.y + dy * amount) });
    if (selected.type === 'drawing' && selectedDrawing) updateDrawing(selected.id, offsetDrawing(selectedDrawing, dx * amount, dy * amount));
    if (selected.type === 'door' && selectedDoor) updateDoor(selected.id, offsetEntity(selectedDoor, 'door', dx * amount, dy * amount));
    if (selected.type === 'wall') {
      updateLighting({
        walls: (board.lighting?.walls || []).map((wall) => wall.id === selected.id
          ? {
              ...wall,
              start: { x: wall.start.x + dx * amount, y: wall.start.y + dy * amount },
              end: { x: wall.end.x + dx * amount, y: wall.end.y + dy * amount },
            }
          : wall),
      });
    }
  };

  const selectedItems = selected?.type === 'multi' ? selected.items : selected ? [selected] : [];

  const moveSelection = (items, dx, dy) => {
    if (!items?.length) return;
    const tokenIds = new Set(items.filter((item) => item.type === 'token').map((item) => item.id));
    const drawingIds = new Set(items.filter((item) => item.type === 'drawing').map((item) => item.id));
    const wallIds = new Set(items.filter((item) => item.type === 'wall').map((item) => item.id));
    const doorIds = new Set(items.filter((item) => item.type === 'door').map((item) => item.id));
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      tokens: active.tokens.map((token) => tokenIds.has(token.id) ? offsetEntity(token, 'token', dx, dy) : token),
      drawings: active.drawings.map((drawing) => drawingIds.has(drawing.id) ? offsetEntity(drawing, 'drawing', dx, dy) : drawing),
      doors: (active.doors || []).map((door) => doorIds.has(door.id) ? offsetEntity(door, 'door', dx, dy) : door),
      lighting: {
        ...defaultLighting,
        ...active.lighting,
        walls: (active.lighting?.walls || []).map((wall) => wallIds.has(wall.id)
          ? {
              ...wall,
              start: { x: wall.start.x + dx, y: wall.start.y + dy },
              end: { x: wall.end.x + dx, y: wall.end.y + dy },
            }
          : wall),
      },
    })));
  };

  const selectMultiple = (items, mode = 'replace') => {
    const keyFor = (item) => `${item.type}:${item.id}`;
    const currentItems = selectedItems;
    let nextItems = items;
    if (mode === 'add') {
      const merged = new Map(currentItems.map((item) => [keyFor(item), item]));
      items.forEach((item) => merged.set(keyFor(item), item));
      nextItems = [...merged.values()];
    }
    if (mode === 'subtract') {
      const remove = new Set(items.map(keyFor));
      nextItems = currentItems.filter((item) => !remove.has(keyFor(item)));
    }
    if (nextItems.length === 0) setSelected(null);
    else if (nextItems.length === 1) setSelected(nextItems[0]);
    else setSelected({ type: 'multi', items: nextItems });
  };

  const copySelection = () => {
    const item = getBoardEntity(board, selected);
    if (item) setClipboard({ type: selected.type, item: structuredClone(item) });
  };

  const pasteSelection = () => {
    if (!clipboard) return;
    if (clipboard.type === 'token') {
      const token = { ...clipboard.item, id: uid('token'), x: clipboard.item.x + 1, y: clipboard.item.y + 1 };
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, tokens: [...active.tokens, token] })));
      setSelected({ type: 'token', id: token.id });
    }
    if (clipboard.type === 'drawing') {
      const drawing = offsetDrawing({ ...clipboard.item, id: uid('drawing') }, 1, 1);
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, drawings: [...active.drawings, drawing] })));
      setSelected({ type: 'drawing', id: drawing.id });
    }
    if (clipboard.type === 'door') {
      const door = { ...offsetEntity(clipboard.item, 'door', 1, 1), id: uid('door') };
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, doors: [...(active.doors || []), door] })));
      setSelected({ type: 'door', id: door.id });
    }
  };

  const deleteSelection = (target = selected) => {
    if (!target) return;
    const targets = target.type === 'multi' ? target.items : [target];
    const tokenIds = new Set(targets.filter((item) => item.type === 'token').map((item) => item.id));
    const drawingIds = new Set(targets.filter((item) => item.type === 'drawing').map((item) => item.id));
    const wallIds = new Set(targets.filter((item) => item.type === 'wall').map((item) => item.id));
    const doorIds = new Set(targets.filter((item) => item.type === 'door').map((item) => item.id));
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      tokens: tokenIds.size ? active.tokens.filter((token) => !tokenIds.has(token.id)) : active.tokens,
      drawings: drawingIds.size ? active.drawings.filter((drawing) => !drawingIds.has(drawing.id)) : active.drawings,
      doors: doorIds.size ? (active.doors || []).filter((door) => !doorIds.has(door.id)) : active.doors,
      lighting: wallIds.size
        ? { ...defaultLighting, ...active.lighting, walls: (active.lighting?.walls || []).filter((wall) => !wallIds.has(wall.id)) }
        : active.lighting,
    })));
    setSelected(null);
  };

  const duplicateSelection = (target = selected) => {
    if (!target) return;
    if (target.type === 'token') {
      const source = board.tokens.find((token) => token.id === target.id);
      if (!source) return;
      const token = { ...structuredClone(source), id: uid('token'), x: source.x + 1, y: source.y + 1 };
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, tokens: [...active.tokens, token] })));
      setSelected({ type: 'token', id: token.id });
    }
    if (target.type === 'drawing') {
      const source = board.drawings.find((drawing) => drawing.id === target.id);
      if (!source) return;
      const drawing = { ...structuredClone(source), ...offsetDrawing(source, 1, 1), id: uid('drawing') };
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, drawings: [...active.drawings, drawing] })));
      setSelected({ type: 'drawing', id: drawing.id });
    }
    if (target.type === 'wall') {
      const source = board.lighting?.walls?.find((wall) => wall.id === target.id);
      if (!source) return;
      const wall = {
        ...structuredClone(source),
        id: uid('wall'),
        start: { x: source.start.x + 1, y: source.start.y + 1 },
        end: { x: source.end.x + 1, y: source.end.y + 1 },
      };
      setState((current) => updateActiveBoard(current, (active) => ({
        ...active,
        lighting: { ...defaultLighting, ...active.lighting, walls: [...(active.lighting?.walls || []), wall] },
      })));
      setSelected({ type: 'wall', id: wall.id });
    }
    if (target.type === 'door') {
      const source = board.doors?.find((door) => door.id === target.id);
      if (!source) return;
      const door = { ...offsetEntity(structuredClone(source), 'door', 1, 1), id: uid('door') };
      setState((current) => updateActiveBoard(current, (active) => ({ ...active, doors: [...(active.doors || []), door] })));
      setSelected({ type: 'door', id: door.id });
    }
  };

  const moveDoorToPosition = (door, position) => {
    const dx = Number(position.x) - door.position.x;
    const dy = Number(position.y) - door.position.y;
    updateDoor(door.id, offsetEntity(door, 'door', dx, dy));
  };

  const selectedDrawing = selected?.type === 'drawing' ? board.drawings.find((drawing) => drawing.id === selected.id) : null;
  const selectedToken = selected?.type === 'token' ? board.tokens.find((token) => token.id === selected.id) : null;
  const selectedWall = selected?.type === 'wall' ? board.lighting?.walls?.find((wall) => wall.id === selected.id) : null;
  const selectedDoor = selected?.type === 'door' ? board.doors?.find((door) => door.id === selected.id) : null;
  const sidebarTabs = [
    ['journal', 'Board Items'],
    ['library', 'Assets & Boards'],
    ['soundboard', 'Audio'],
    ['settings', 'Board Setup'],
  ];
  const quickMapTools = [
    ['select', <MousePointer2 size={18} />, 'Select & Pan', 'V'],
    ['token', <Plus size={18} />, 'Place Token', 'T'],
    ['draw', <Brush size={18} />, 'Drawing & Shapes', 'D'],
    ['ruler', <Ruler size={18} />, 'Ruler / Measurement', 'M'],
    ['light', <Lightbulb size={18} />, 'Lighting & Vision', 'L'],
  ];

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
      const keyTools = { v: 'select', t: 'token', d: 'draw', m: 'ruler', l: 'light' };
      if (!event.metaKey && !event.ctrlKey && keyTools[event.key.toLowerCase()]) {
        event.preventDefault();
        setTool(keyTools[event.key.toLowerCase()]);
        return;
      }
      const arrowDeltas = {
        arrowup: [0, -1],
        arrowdown: [0, 1],
        arrowleft: [-1, 0],
        arrowright: [1, 0],
      };
      const arrowDelta = arrowDeltas[event.key.toLowerCase()];
      if (arrowDelta && selected) {
        event.preventDefault();
        if (selected.type === 'multi') moveSelection(selected.items, arrowDelta[0], arrowDelta[1]);
        else nudgeSelection(arrowDelta[0], arrowDelta[1]);
        return;
      }
      if (['backspace', 'delete'].includes(event.key.toLowerCase()) && selected) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (!mod) return;
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
      }
      if (event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
      if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [board, selected, selectedItems, selectedToken, selectedDrawing, selectedDoor, clipboard, undo, redo]);

  return (
    <>
      <section className="workspace" style={sidebarStyle}>
        <Topbar
          board={board}
          mode="dm"
          boards={state.boards}
          activeBoardId={state.activeBoardId}
          playerBoardId={state.playerBoardId}
          activeLayer={activeLayer}
          onLayerChange={switchActiveLayer}
          onBoardSelect={(id) => setState((current) => ({ ...current, activeBoardId: id }), { skipHistory: true })}
          onAddBoard={addBoard}
          onImportBoard={openDungeonImport}
          onDuplicateBoard={duplicateBoard}
          onDeleteBoard={requestDeleteBoard}
          onPublishBoard={showBoardToPlayers}
        />
        <div className="map-viewport">
          {layerNotice && <div className="layer-notice" role="status">{layerNotice}</div>}
          {publishToast && <div className="publish-toast" role="status">{publishToast}</div>}
          <div className={`quick-map-menu ${isQuickMenuCollapsed ? 'collapsed' : ''}`}>
            <div className="quick-menu-tools" aria-label="Map quick access tools">
              {quickMapTools.map(([id, icon, label, hotkey]) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  className={tool === id ? 'active' : ''}
                  onClick={() => setTool(id)}
                >
                  {icon}
                  <span>{hotkey}</span>
                </button>
              ))}
            </div>
            {['draw', 'shape', 'square', 'circle', 'cone', 'light', 'wall', 'door'].includes(tool) && (
              <div className="tool-popout" role="group" aria-label={`${tool} options`}>
                {['draw', 'shape', 'square', 'circle', 'cone'].includes(tool) && (
                  <>
                    <button type="button" className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')}>Freehand</button>
                    <button type="button" className={tool === 'shape' ? 'active' : ''} onClick={() => setTool('shape')}>Rect</button>
                    <button type="button" className={tool === 'circle' ? 'active' : ''} onClick={() => setTool('circle')}>Circle</button>
                    <button type="button" className={tool === 'cone' ? 'active' : ''} onClick={() => setTool('cone')}>Cone</button>
                    <input aria-label="Stroke color" type="color" value={drawColor} onChange={(event) => setDrawColor(event.target.value)} />
                  </>
                )}
                {['light', 'wall', 'door'].includes(tool) && (
                  <>
                    <button type="button" className={tool === 'wall' ? 'active' : ''} onClick={() => setTool('wall')}>Wall</button>
                    <button type="button" className={tool === 'door' ? 'active' : ''} onClick={() => setTool('door')}>Door</button>
                    <button type="button" className={tool === 'light' ? 'active' : ''} onClick={() => setTool('light')}>Reveal / Hide</button>
                  </>
                )}
              </div>
            )}
            <button
              className="quick-menu-toggle"
              type="button"
              title={isQuickMenuCollapsed ? 'Show map tools' : 'Hide map tools'}
              aria-label={isQuickMenuCollapsed ? 'Show map tools' : 'Hide map tools'}
              onClick={() => setIsQuickMenuCollapsed((collapsed) => !collapsed)}
            >
              {isQuickMenuCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
          <BoardCanvas
            board={board}
            view="dm"
            tool={tool}
            selected={selected}
            setSelected={setSelected}
            activeLayer={activeLayer}
            drawLayer={drawLayer}
            drawColor={drawColor}
            onAddToken={addToken}
            onMoveToken={(id, point) => updateToken(id, point)}
            onMoveSelection={moveSelection}
            onAddDoor={addDoor}
            onMoveDoor={moveDoor}
            onMoveDrawing={(id, dx, dy) => updateDrawing(id, offsetDrawing(board.drawings.find((drawing) => drawing.id === id), dx, dy))}
            onAddDrawing={addDrawing}
            onMoveBackground={(patch) => updateBackground(patch)}
            onAddLightReveal={addLightReveal}
            onAddLightWall={addLightWall}
            onMoveLightWall={moveLightWall}
            onRemoveLightReveal={removeLightReveal}
            onLiveMeasurement={updateLiveMeasurement}
            onSelectMultiple={selectMultiple}
            onToggleDoor={toggleDoor}
            onDeleteSelection={deleteSelection}
            onDuplicateSelection={duplicateSelection}
          />
        </div>
      </section>

      <aside className="sidebar" style={sidebarStyle}>
        <button
          className="sidebar-resize-handle"
          type="button"
          aria-label="Resize right sidebar"
          title="Resize sidebar"
          onPointerDown={startSidebarResize}
        />
        <div className="brand">
          <Grid2X2 size={22} />
          <div>
            <strong>Tableforge</strong>
            <span>Dungeon master portal</span>
          </div>
        </div>

        <nav className="sidebar-tabs" aria-label="Dungeon master controls">
          {sidebarTabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeSidebarTab === id ? 'active' : ''}
              onClick={() => setActiveSidebarTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-body">
          {activeSidebarTab === 'library' && (
            <div className="sidebar-tab-panel">

        <Panel title="Project" icon={<Layers size={16} />}>
          <button className="command" title="Return to the project home screen" onClick={leaveProject}><Layers size={16} /> Project home</button>
          <button className="command accent" title="Open the standalone dungeon builder" onClick={onOpenDungeonBuilder}><Grid2X2 size={16} /> Launch Dungeon Builder</button>
        </Panel>

        <Panel title="Asset Manager" icon={<Upload size={16} />}>
          <label>
            Asset category
            <select value={assetCategory} onChange={(event) => setAssetCategory(event.target.value)}>
              <option value="token">Token</option>
              <option value="map">Map</option>
              <option value="music">Background music</option>
              <option value="image">Image</option>
              <option value="audio">Audio</option>
            </select>
          </label>
          <label
            className="asset-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadProjectAssets(event.dataTransfer.files);
            }}
          >
            <Upload size={18} />
            <span>{isUploadingAsset ? 'Uploading...' : 'Drop files or browse'}</span>
            <small>.png, .jpeg, .webp, .mp3, .wav</small>
            <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.mp3,.wav,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav" onChange={(event) => uploadProjectAssets(event.target.files)} />
          </label>
          {assetError && <p className="form-error">{assetError}</p>}
          <div className="project-asset-grid">
            {assets.map((asset) => (
              <div className="project-asset-card" key={asset.id}>
                <div className="project-asset-preview">
                  {asset.type === 'image' ? <img src={asset.path} alt="" /> : <Music size={22} />}
                </div>
                <strong title={asset.name}>{asset.name}</strong>
                <span>{asset.category} · {asset.type}</span>
                {asset.type === 'image' && (
                  <div className="project-asset-actions">
                    <button title="Use this image for new tokens" onClick={() => useAssetForTokenDraft(asset)}>Token</button>
                    <button title="Use this image as the active board background" onClick={() => useAssetAsMap(asset)}>Map</button>
                  </div>
                )}
              </div>
            ))}
            {!assets.length && <p className="empty-note">No project assets uploaded yet.</p>}
          </div>
        </Panel>

        <Panel title="Boards" icon={<Layers size={16} />}>
          <div className="board-list">
            {state.boards.map((item) => (
              <div className={`board-list-item ${item.id === state.activeBoardId ? 'active' : ''}`} key={item.id}>
                <button
                  className="board-switch"
                  onClick={() => setState((current) => ({ ...current, activeBoardId: item.id }), { skipHistory: true })}
                >
                  <span>{item.name}</span>
                  {item.id === state.playerBoardId && <Users size={15} />}
                </button>
                <button
                  className="danger-icon"
                  title={`Delete ${item.name}`}
                  disabled={state.boards.length <= 1}
                  onClick={() => requestDeleteBoard(item)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="split">
            <button className="command" title="Create a new empty board in this project" onClick={addBoard}><Plus size={16} /> New</button>
            <button className="command" title="Duplicate the active board" onClick={duplicateBoard}><Copy size={16} /> Duplicate</button>
          </div>
          <button className="command accent" title="Publish the active board to the player viewer" onClick={() => showBoardToPlayers()}><Send size={16} /> Show active board to players</button>
        </Panel>
            </div>
          )}

          {activeSidebarTab === 'settings' && (
            <div className="sidebar-tab-panel">

        <Panel title="Board" icon={<Image size={16} />}>
          <label>
            Name
            <input value={board.name} onChange={(event) => updateBoard({ name: event.target.value })} />
          </label>
          <div className="split">
            <label>
              Tiles wide
              <input type="number" min="4" max="200" value={board.columns} onChange={(event) => updateBoard({ columns: Number(event.target.value) })} />
            </label>
            <label>
              Tiles high
              <input type="number" min="4" max="200" value={board.rows} onChange={(event) => updateBoard({ rows: Number(event.target.value) })} />
            </label>
          </div>
          <label>
            Tile pixels
            <input type="range" min="24" max="72" value={board.tileSize} onChange={(event) => updateBoard({ tileSize: Number(event.target.value) })} />
          </label>
        </Panel>

        <Panel title="Background Layer" icon={<Image size={16} />}>
          <label className="file-button">
            <Image size={16} />
            {isUploadingAsset ? 'Uploading image...' : 'Background image'}
            <input type="file" accept="image/*" onChange={(event) => uploadImageForUse(event, 'map', useAssetAsMap)} />
          </label>
          {imageAssets.length > 0 && (
            <details className="asset-picker">
              <summary>Choose from Project Assets</summary>
              <div className="asset-picker-grid">
                {imageAssets.map((asset) => (
                  <button key={asset.id} title={`Use ${asset.name} as the active board background`} onClick={() => useAssetAsMap(asset)}>
                    <img src={asset.path} alt="" />
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          <div className="map-import">
            <label>
              5e.tools base URL
              <input value={state.fiveEToolsBaseUrl || 'https://5e.tools/'} onChange={(event) => updateFiveEToolsBaseUrl(event.target.value)} />
            </label>
            <label>
              Import from 5e.tools
              <input value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') searchMaps(); }} placeholder="Cragmaw Hideout, Castle Ravenloft..." />
            </label>
            <button className="command" title="Search the 5e.tools maps gallery" onClick={searchMaps} disabled={isSearchingMaps}>
              <Library size={16} /> {isSearchingMaps ? 'Searching...' : 'Search maps'}
            </button>
            {mapImportError && <p className="form-error">{mapImportError}</p>}
            {mapResults.length > 0 && (
              <div className="map-results">
                {mapResults.map((map) => {
                  const dimensions = getMapBoardDimensions(map);
                  return (
                    <div className="map-result" key={map.id}>
                      <div>
                        <strong>{map.displayTitle}</strong>
                        <span>{map.sourceName} · {map.chapterName} · {dimensions.columns} x {dimensions.rows}</span>
                      </div>
                      <button className="command" title="Use this map as the active board background" onClick={() => importMap(map)}>
                        <Image size={15} /> Import
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <label className="check-row" title="Keep the background image stretched to the board's full width and height">
            <input type="checkbox" checked={Boolean(board.background.fitToBoard)} onChange={(event) => toggleBackgroundFit(event.target.checked)} />
            Fit background to board
          </label>
          <div className="split">
            <label>
              Scale
              <input type="number" step="0.05" min="0.1" max="5" value={board.background.scale} onChange={(event) => updateBackground({ scale: Number(event.target.value) })} disabled={Boolean(board.background.fitToBoard)} />
            </label>
            <label>
              Opacity
              <input type="number" step="0.05" min="0" max="1" value={board.background.opacity} onChange={(event) => updateBackground({ opacity: Number(event.target.value) })} />
            </label>
          </div>
          <div className="split">
            <label>
              X offset
              <input type="number" value={Math.round(board.background.x)} onChange={(event) => updateBackground({ x: Number(event.target.value) })} disabled={Boolean(board.background.fitToBoard)} />
            </label>
            <label>
              Y offset
              <input type="number" value={Math.round(board.background.y)} onChange={(event) => updateBackground({ y: Number(event.target.value) })} disabled={Boolean(board.background.fitToBoard)} />
            </label>
          </div>
        </Panel>

        <Panel title="Lighting" icon={<EyeOff size={16} />}>
          <label className="check-row" title="Darken the player board and reveal only lit areas">
            <input type="checkbox" checked={Boolean(board.lighting?.enabled)} onChange={(event) => updateLighting({ enabled: event.target.checked })} />
            Enable board lighting
          </label>
          <label title="How dark unrevealed player areas should be">
            Darkness
            <input type="range" min="0.35" max="0.98" step="0.01" value={board.lighting?.darkness ?? 0.86} onChange={(event) => updateLighting({ darkness: Number(event.target.value) })} />
          </label>
          <label className="check-row" title="When disabled, wall endpoints can be placed anywhere on the map">
            <input type="checkbox" checked={board.lighting?.snapWallsToGrid !== false} onChange={(event) => updateLighting({ snapWallsToGrid: event.target.checked })} />
            Snap lighting walls to grid
          </label>
          <button className="command" title="Remove all manually revealed lighting areas" onClick={clearLightReveals}><Eraser size={16} /> Clear reveal areas</button>
          <button className="command" title="Remove all lighting walls from this board" onClick={clearLightWalls}><Eraser size={16} /> Clear light walls</button>
        </Panel>

        {selectedWall && (
          <Panel title="Selected Wall" icon={<EyeOff size={16} />}>
            <div className="shortcut-row">
              <button className="command" title="Duplicate the selected light-blocking wall" onClick={() => duplicateSelection()}><Copy size={16} /> Duplicate</button>
              <button className="command danger" title="Delete the selected light-blocking wall" onClick={() => deleteSelection()}><Trash2 size={16} /> Delete</button>
            </div>
          </Panel>
        )}

        {selectedDoor && (
          <Panel title="Selected Door" icon={<MousePointer2 size={16} />}>
            <div className="split">
              <label>
                X center
                <input type="number" step="0.5" value={selectedDoor.position.x} onChange={(event) => moveDoorToPosition(selectedDoor, { x: Number(event.target.value), y: selectedDoor.position.y })} />
              </label>
              <label>
                Y center
                <input type="number" step="0.5" value={selectedDoor.position.y} onChange={(event) => moveDoorToPosition(selectedDoor, { x: selectedDoor.position.x, y: Number(event.target.value) })} />
              </label>
            </div>
            <label>
              Door state
              <select value={selectedDoor.state} onChange={(event) => updateDoor(selectedDoor.id, { state: event.target.value })}>
                <option value="closed">Closed</option>
                <option value="open">Open</option>
                <option value="locked">Locked</option>
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={selectedDoor.state === 'locked' || selectedDoor.isLocked} onChange={(event) => updateDoor(selectedDoor.id, { isLocked: event.target.checked })} />
              Locked
            </label>
            <div className="shortcut-row">
              <button className="command" title="Duplicate the selected door" onClick={() => duplicateSelection()}><Copy size={16} /> Duplicate</button>
              <button className="command danger" title="Delete the selected door" onClick={() => deleteSelection()}><Trash2 size={16} /> Delete</button>
            </div>
          </Panel>
        )}
            </div>
          )}

          {activeSidebarTab === 'settings' && (
            <div className="sidebar-tab-panel">

        <Panel title="Shortcuts" icon={<Clipboard size={16} />}>
          <div className="shortcut-row">
            <button className="command" title="Copy the selected token or drawing" onClick={copySelection} disabled={!selected}><Copy size={16} /> Copy</button>
            <button className="command" title="Paste the copied token or drawing" onClick={pasteSelection} disabled={!clipboard}><Clipboard size={16} /> Paste</button>
          </div>
          <div className="shortcut-row">
            <button className="command" title="Undo the last board edit" onClick={undo} disabled={!canUndo}><Undo2 size={16} /> Undo</button>
            <button className="command" title="Redo the last undone board edit" onClick={redo} disabled={!canRedo}><Redo2 size={16} /> Redo</button>
          </div>
        </Panel>
            </div>
          )}

          {activeSidebarTab === 'journal' && (
            <div className="sidebar-tab-panel">

        <Panel title="Token" icon={<Plus size={16} />}>
          <label>
            Label
            <input value={tokenDraft.label} onChange={(event) => setTokenDraft({ ...tokenDraft, label: event.target.value })} />
          </label>
          <div className="split">
            <label>
              Color
              <input type="color" value={tokenDraft.color} onChange={(event) => setTokenDraft({ ...tokenDraft, color: event.target.value })} />
            </label>
            <label>
              Size
              <input type="number" min="1" max="6" value={tokenDraft.size} onChange={(event) => setTokenDraft({ ...tokenDraft, size: event.target.value })} />
            </label>
          </div>
          {tokenDraft.image && (
            <div className="selected-asset-row">
              <img src={tokenDraft.image} alt="" />
              <button className="command" onClick={() => setTokenDraft({ ...tokenDraft, image: '' })}>Clear token image</button>
            </div>
          )}
          {imageAssets.length > 0 && (
            <details className="asset-picker">
              <summary>Pick token image from assets</summary>
              <div className="asset-picker-grid">
                {imageAssets.map((asset) => (
                  <button key={asset.id} title={`Use ${asset.name} for new tokens`} onClick={() => useAssetForTokenDraft(asset)}>
                    <img src={asset.path} alt="" />
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </Panel>

        {selectedToken && (
          <Panel title="Selected Token" icon={<MousePointer2 size={16} />}>
            <label>
              Label
              <input value={selectedToken.label} onChange={(event) => updateToken(selectedToken.id, { label: event.target.value })} />
            </label>
            <div className="split">
              <label>
                Color
                <input type="color" value={selectedToken.color} onChange={(event) => updateToken(selectedToken.id, { color: event.target.value })} />
              </label>
              <label>
                Size
                <input type="number" min="1" max="6" value={selectedToken.size} onChange={(event) => updateToken(selectedToken.id, { size: Number(event.target.value) })} />
              </label>
            </div>
            <label className="file-button">
              <Image size={16} />
              {isUploadingAsset ? 'Uploading image...' : 'Token image'}
              <input type="file" accept="image/*" onChange={(event) => uploadImageForUse(event, 'token', (asset) => updateToken(selectedToken.id, { image: asset.path }))} />
            </label>
            {imageAssets.length > 0 && (
              <details className="asset-picker">
                <summary>Pick image from project assets</summary>
                <div className="asset-picker-grid">
                  {imageAssets.map((asset) => (
                    <button key={asset.id} title={`Use ${asset.name} for this token`} onClick={() => updateToken(selectedToken.id, { image: asset.path })}>
                      <img src={asset.path} alt="" />
                      <span>{asset.name}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
            <label className="check-row" title="Toggle whether this token reveals darkness with its vision distance">
              <input type="checkbox" checked={selectedToken.visionEnabled !== false} onChange={(event) => updateToken(selectedToken.id, { visionEnabled: event.target.checked })} />
              Vision enabled
            </label>
            <div className="split">
              <label title="How far this token can see when board lighting is enabled">
                Bright vision
                <input type="number" min="0" step="5" value={selectedToken.visionBrightFeet ?? selectedToken.visionFeet ?? 0} onChange={(event) => updateToken(selectedToken.id, { visionBrightFeet: Number(event.target.value), visionFeet: Number(event.target.value) })} />
              </label>
              <label title="Dim vision reaches beyond bright vision">
                Dim vision
                <input type="number" min="0" step="5" value={selectedToken.visionDimFeet ?? selectedToken.visionFeet ?? 0} onChange={(event) => updateToken(selectedToken.id, { visionDimFeet: Number(event.target.value) })} />
              </label>
            </div>
            <div className="split">
              <label title="Bright light emitted by this token">
                Bright light
                <input type="number" min="0" step="5" value={selectedToken.lightBrightFeet || 0} onChange={(event) => updateToken(selectedToken.id, { lightBrightFeet: Number(event.target.value) })} />
              </label>
              <label title="Dim light emitted by this token">
                Dim light
                <input type="number" min="0" step="5" value={selectedToken.lightDimFeet || 0} onChange={(event) => updateToken(selectedToken.id, { lightDimFeet: Number(event.target.value) })} />
              </label>
            </div>
            <div className="split">
              <label title="Label this token's vision type">
                Vision type
                <select value={selectedToken.visionMode || 'darkvision'} onChange={(event) => updateToken(selectedToken.id, { visionMode: event.target.value })}>
                  <option value="darkvision">Darkvision</option>
                  <option value="lowlight">Low light</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
            </div>
            <div className="shortcut-row">
              <button className="command" title="Duplicate the selected token" onClick={() => duplicateSelection()}><Copy size={16} /> Duplicate</button>
              <button className="command danger" title="Delete the selected token" onClick={() => deleteSelection()}><Trash2 size={16} /> Delete</button>
            </div>
          </Panel>
        )}

        <Panel title="Token Library" icon={<Library size={16} />}>
          <button className="command accent" title="Open the project-wide token library" onClick={() => setIsLibraryOpen(true)}>
            <Library size={16} /> Open token library ({tokenLibrary.length})
          </button>
        </Panel>

        <Panel title="Drawing" icon={<Brush size={16} />}>
          <div className="split">
            <label>
              Color
              <input type="color" value={drawColor} onChange={(event) => setDrawColor(event.target.value)} />
            </label>
            <label>
              Layer
              <select value={drawLayer} onChange={(event) => setDrawLayer(event.target.value)}>
                <option value="player">Player</option>
                <option value="dm">DM</option>
              </select>
            </label>
          </div>
          {selectedDrawing && (
            <div className="selection-editor">
              <strong>Selected drawing</strong>
              <div className="split">
                <label>
                  Color
                  <input type="color" value={selectedDrawing.color} onChange={(event) => updateDrawing(selectedDrawing.id, { color: event.target.value })} />
                </label>
                <label>
                  Layer
                  <select value={selectedDrawing.layer} onChange={(event) => updateDrawing(selectedDrawing.id, { layer: event.target.value })}>
                    <option value="player">Player</option>
                    <option value="dm">DM</option>
                  </select>
                </label>
              </div>
              <button className="command" onClick={() => updateDrawing(selectedDrawing.id, { visible: !selectedDrawing.visible })}>
                {selectedDrawing.visible ? <Eye size={16} /> : <EyeOff size={16} />} {selectedDrawing.visible ? 'Hide drawing' : 'Reveal drawing'}
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Tokens" icon={<Layers size={16} />}>
          <button className="list-toggle" title="Show or hide the token list" onClick={() => setTokensExpanded((expanded) => !expanded)}>
            {tokensExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {tokensExpanded ? 'Hide tokens' : `Show tokens (${board.tokens.length})`}
          </button>
          {tokensExpanded && (
            <div className="asset-list">
              {board.tokens.map((token) => (
                <div className="asset-row token-row" key={token.id}>
                  <span className="swatch" style={{ background: token.color }} />
                  <input value={token.label} onChange={(event) => updateToken(token.id, { label: event.target.value })} onFocus={() => setSelected({ type: 'token', id: token.id })} />
                  <button title="Toggle token visibility" onClick={() => updateToken(token.id, { visible: !token.visible })}>
                    {token.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <select value={token.layer} onChange={(event) => updateToken(token.id, { layer: event.target.value })}>
                    <option value="player">Player</option>
                    <option value="dm">DM</option>
                  </select>
                  <button className="danger-icon" title="Delete token" onClick={() => deleteSelection({ type: 'token', id: token.id })}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Drawings" icon={<Brush size={16} />}>
          <button className="list-toggle" title="Show or hide the drawing list" onClick={() => setDrawingsExpanded((expanded) => !expanded)}>
            {drawingsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {drawingsExpanded ? 'Hide drawings' : `Show drawings (${board.drawings.length})`}
          </button>
          {drawingsExpanded && (
            <div className="asset-list">
              {board.drawings.map((drawing, index) => (
                <div className="asset-row drawing-row" key={drawing.id}>
                  <span className="swatch square-swatch" style={{ background: drawing.color }} />
                  <button className="asset-name" title="Select drawing" onClick={() => setSelected({ type: 'drawing', id: drawing.id })}>
                    {drawing.type === 'measurement' ? 'Measurement' : drawing.type === 'path' ? 'Freehand' : drawing.shape || 'Shape'} {index + 1}
                  </button>
                  <button title="Toggle drawing visibility" onClick={() => updateDrawing(drawing.id, { visible: drawing.visible === false })}>
                    {drawing.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <select value={drawing.layer} onChange={(event) => updateDrawing(drawing.id, { layer: event.target.value })}>
                    <option value="player">Player</option>
                    <option value="dm">DM</option>
                  </select>
                  <button className="danger-icon" title="Delete drawing" onClick={() => deleteSelection({ type: 'drawing', id: drawing.id })}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </Panel>
            </div>
          )}

          {activeSidebarTab === 'soundboard' && (
            <div className="sidebar-tab-panel">
              <Panel title="Soundboard" icon={<Music size={16} />}>
                {audioAssets.length > 0 ? (
                  <div className="soundboard-list">
                    {audioAssets.map((asset) => (
                      <div className="soundboard-track" key={asset.id}>
                        <strong title={asset.name}>{asset.name}</strong>
                        <audio controls src={asset.path} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-note">Upload audio assets from the Campaign tab to build the soundboard.</p>
                )}
              </Panel>
            </div>
          )}
        </div>
      </aside>

      {isLibraryOpen && (
        <div className="library-overlay" role="dialog" aria-modal="true" aria-label="Token library">
          <div className="library-modal">
            <header className="library-modal-header">
              <div>
                <strong>Token Library</strong>
                <span>{tokenLibrary.length} saved tokens in this project</span>
              </div>
              <button title="Close token library" onClick={() => setIsLibraryOpen(false)}><X size={18} /></button>
            </header>

            <div className="library-modal-tools">
              <button className="command accent" title="Save the selected board token into this project's token library" onClick={saveSelectedTokenToLibrary} disabled={!selectedToken}>
                <Copy size={16} /> Save selected token
              </button>
              <div className="bestiary-search">
                <label>
                  5e.tools base URL
                  <input value={state.fiveEToolsBaseUrl || 'https://5e.tools/'} onChange={(event) => updateFiveEToolsBaseUrl(event.target.value)} />
                </label>
                <label>
                  Search bestiary
                  <input value={bestiaryQuery} onChange={(event) => setBestiaryQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') searchBestiary(); }} placeholder="Goblin, dragon, bandit..." />
                </label>
                <button className="command" title="Search the 5e.tools bestiary data files" onClick={searchBestiary} disabled={isSearchingBestiary}>
                  <Library size={16} /> {isSearchingBestiary ? 'Searching...' : 'Search bestiary'}
                </button>
                {bestiaryError && <p className="form-error">{bestiaryError}</p>}
                {bestiaryResults.length > 0 && (
                  <div className="bestiary-results">
                    {bestiaryResults.map((monster) => (
                      <div className="bestiary-result" key={`${monster.source}-${monster.name}`}>
                        <div>
                          <strong>{monster.name}</strong>
                          <span>{monster.source} · CR {formatMonsterCr(monster)} · {formatMonsterSize(monster)}</span>
                        </div>
                        <button className="command" title="Save this bestiary monster into the project token library" onClick={() => saveBestiaryMonsterToLibrary(monster)}>
                          <Plus size={15} /> Save
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="library-grid">
              {tokenLibrary.map((libraryToken) => {
                const isEditing = editingLibraryTokenId === libraryToken.id;
                return (
                  <div className="library-token-card" key={libraryToken.id}>
                    <div className="library-grid-token">
                      <span className={`library-token-preview large ${libraryToken.image ? 'has-image' : ''}`} style={{ backgroundColor: libraryToken.image ? 'transparent' : libraryToken.color }}>
                        {libraryToken.image ? <img src={libraryToken.image} alt="" /> : libraryToken.label.slice(0, 2)}
                      </span>
                      <div>
                        <strong>{libraryToken.label}</strong>
                        <span>{libraryToken.layer} · size {libraryToken.size} · vision {libraryToken.visionFeet || 0} ft</span>
                      </div>
                    </div>
                    <div className="library-card-actions">
                      <button className="command" title="Import this library token onto the active board" onClick={() => importLibraryToken(libraryToken)}><Plus size={16} /> Import</button>
                      <button className="command" title="Edit this library token" onClick={() => setEditingLibraryTokenId(isEditing ? null : libraryToken.id)}><Pencil size={16} /> Edit</button>
                      <button className="command danger" title="Remove this token from the project library" onClick={() => deleteLibraryToken(libraryToken.id)}><Trash2 size={16} /> Delete</button>
                    </div>
                    {isEditing && (
                      <div className="library-token-editor">
                        <label>
                          Name
                          <input value={libraryToken.label} onChange={(event) => updateLibraryToken(libraryToken.id, { label: event.target.value })} />
                        </label>
                        <div className="split">
                          <label>
                            Color
                            <input type="color" value={libraryToken.color} onChange={(event) => updateLibraryToken(libraryToken.id, { color: event.target.value })} />
                          </label>
                          <label>
                            Size
                            <input type="number" min="1" max="6" value={libraryToken.size} onChange={(event) => updateLibraryToken(libraryToken.id, { size: Number(event.target.value) })} />
                          </label>
                        </div>
                        <label className="file-button">
                          <Image size={16} />
                          {isUploadingAsset ? 'Uploading image...' : 'Token image'}
                          <input type="file" accept="image/*" onChange={(event) => uploadImageForUse(event, 'token', (asset) => updateLibraryToken(libraryToken.id, { image: asset.path }))} />
                        </label>
                        {imageAssets.length > 0 && (
                          <details className="asset-picker">
                            <summary>Pick image from project assets</summary>
                            <div className="asset-picker-grid">
                              {imageAssets.map((asset) => (
                                <button key={asset.id} title={`Use ${asset.name} for this library token`} onClick={() => updateLibraryToken(libraryToken.id, { image: asset.path })}>
                                  <img src={asset.path} alt="" />
                                  <span>{asset.name}</span>
                                </button>
                              ))}
                            </div>
                          </details>
                        )}
                        <div className="split">
                          <label>
                            Layer
                            <select value={libraryToken.layer} onChange={(event) => updateLibraryToken(libraryToken.id, { layer: event.target.value })}>
                              <option value="player">Player</option>
                              <option value="dm">DM</option>
                            </select>
                          </label>
                          <label>
                            Vision feet
                            <input type="number" min="0" step="5" value={libraryToken.visionFeet || 0} onChange={(event) => updateLibraryToken(libraryToken.id, { visionFeet: Number(event.target.value) })} />
                          </label>
                        </div>
                        <label>
                          Vision type
                          <select value={libraryToken.visionMode || 'darkvision'} onChange={(event) => updateLibraryToken(libraryToken.id, { visionMode: event.target.value })}>
                            <option value="darkvision">Darkvision</option>
                            <option value="lowlight">Low light</option>
                            <option value="normal">Normal</option>
                          </select>
                        </label>
                        <label className="check-row">
                          <input type="checkbox" checked={libraryToken.visionEnabled !== false} onChange={(event) => updateLibraryToken(libraryToken.id, { visionEnabled: event.target.checked })} />
                          Vision enabled
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
              {!tokenLibrary.length && (
                <div className="library-empty">
                  <strong>No saved tokens yet</strong>
                  <span>Save a selected board token or search the 5e.tools bestiary to start building this project library.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isDungeonImportOpen && (
        <div className="library-overlay" role="dialog" aria-modal="true" aria-label="Import dungeon map">
          <div className="library-modal dungeon-import-modal">
            <div className="library-modal-header">
              <div>
                <strong>Import Dungeon Map</strong>
                <span>Select a global dungeon to instantiate as a campaign board with lighting walls and terrain metadata.</span>
              </div>
              <button onClick={() => setIsDungeonImportOpen(false)} aria-label="Close dungeon import"><X size={18} /></button>
            </div>
            {dungeonImportError && <p className="form-error">{dungeonImportError}</p>}
            <div className="dungeon-import-grid">
              {dungeonLibrary.map((dungeon) => (
                <article className="dungeon-card" key={dungeon.id}>
                  <div className="dungeon-thumb">
                    {dungeon.thumbnailUrl ? <img src={`${dungeon.thumbnailUrl}?v=${encodeURIComponent(dungeon.updatedAt || '')}`} alt="" /> : <Grid2X2 size={30} />}
                  </div>
                  <div className="dungeon-card-body">
                    <strong>{dungeon.name}</strong>
                    <span>{dungeon.gridSize?.width || 0} x {dungeon.gridSize?.height || 0}</span>
                  </div>
                  <button className="command accent" onClick={() => importDungeonAsBoard(dungeon)}>Import</button>
                </article>
              ))}
              {!dungeonLibrary.length && <div className="library-empty"><strong>No dungeons found</strong><span>Create one from the Dungeon Builder first.</span></div>}
            </div>
          </div>
        </div>
      )}

      {boardDeleteTarget && (
        <div className="project-conflict-overlay" role="dialog" aria-modal="true" aria-label="Delete board">
          <div className="project-conflict-modal">
            <strong>Delete Board</strong>
            <p>
              Delete '{boardDeleteTarget.name}'? This will remove the board, including its tokens, drawings, walls, lighting, and map configuration.
            </p>
            {boardDeleteError && <p className="form-error">{boardDeleteError}</p>}
            <div className="project-conflict-actions">
              <button className="command danger" onClick={confirmDeleteBoard} autoFocus>
                Delete Board
              </button>
              <button className="command" onClick={() => setBoardDeleteTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

function normalizeFiveEToolsBaseUrl(baseUrl = 'https://5e.tools/') {
  const trimmed = baseUrl.trim() || 'https://5e.tools/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function mergeDoorPatch(door, patch) {
  const next = { ...door, ...patch };
  if (patch.state) {
    next.isLocked = patch.state === 'locked';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'isLocked')) {
    next.isLocked = Boolean(patch.isLocked);
    if (next.isLocked) next.state = 'locked';
    else if (door.state === 'locked') next.state = 'closed';
  }
  return next;
}

async function fetchBestiaryJson(url) {
  const response = await fetch(`/api/5etools?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

async function fetchMapsJson(baseUrl) {
  try {
    return await fetchBestiaryJson(`${baseUrl}data/generated/gendata-maps.json`);
  } catch {
    return fetchBestiaryJson('https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/generated/gendata-maps.json');
  }
}

function flattenMapData(data, baseUrl) {
  const maps = [];
  Object.values(data || {}).forEach((source) => {
    source.chapters?.forEach((chapter) => {
      const titlesById = new Map();
      const imagesById = new Map();
      let lastMapTitle = '';
      chapter.images?.forEach((image) => {
        if (image.id) imagesById.set(image.id, image);
      });
      chapter.images?.forEach((image, index) => {
        if (!['map', 'mapPlayer'].includes(image.imageType)) return;
        const parentImage = image.mapParent?.id ? imagesById.get(image.mapParent.id) : null;
        const rawTitle = image.title || image.altText || 'Untitled Map';
        const displayTitle = image.imageType === 'mapPlayer' && rawTitle === 'Player Version'
          ? `${lastMapTitle || rawTitle} (Player)`
          : rawTitle;
        if (image.id) titlesById.set(image.id, displayTitle);
        if (image.imageType === 'map') lastMapTitle = displayTitle;
        maps.push({
          id: `${source.id}-${chapter.ix}-${index}-${image.href?.path || rawTitle}`,
          displayTitle,
          sourceName: source.name || source.source || source.id,
          chapterName: chapter.name || '',
          imageType: image.imageType,
          imageUrl: getImageUrl(baseUrl, image.href),
          width: Number(image.width) || 0,
          height: Number(image.height) || 0,
          grid: image.grid || null,
          mapRegions: image.mapRegions || parentImage?.mapRegions || [],
          mapRegionWidth: Number(image.mapRegions ? image.width : parentImage?.width) || Number(image.width) || 0,
          mapRegionHeight: Number(image.mapRegions ? image.height : parentImage?.height) || Number(image.height) || 0,
          searchText: [
            displayTitle,
            rawTitle,
            source.name,
            source.source,
            source.id,
            chapter.name,
            image.mapParent?.id ? titlesById.get(image.mapParent.id) : '',
          ].filter(Boolean).join(' ').toLowerCase(),
        });
      });
    });
  });
  return maps.sort((a, b) => Number(b.imageType === 'mapPlayer') - Number(a.imageType === 'mapPlayer'));
}

function getImageUrl(baseUrl, href = {}) {
  if (href.type === 'external') return href.url;
  if (!href.path) return '';
  return `${normalizeFiveEToolsBaseUrl(baseUrl)}img/${href.path.split('/').map(encodeURIComponent).join('/')}`;
}

function getMapBoardDimensions(map) {
  const grid = map.grid || {};
  const scale = Number(grid.scale) || 1;
  const gridSize = grid.type === 'square' ? Number(grid.size) || 0 : 0;
  if (gridSize && map.width && map.height) {
    return {
      columns: clampBoardTiles(Math.ceil((map.width / gridSize) * scale)),
      rows: clampBoardTiles(Math.ceil((map.height / gridSize) * scale)),
    };
  }
  const fallbackColumns = map.width && map.height ? Math.round(Math.sqrt((map.width / map.height) * 600)) : 30;
  return {
    columns: clampBoardTiles(fallbackColumns),
    rows: clampBoardTiles(map.width && map.height ? Math.round(fallbackColumns * (map.height / map.width)) : 20),
  };
}

function getMapRegionWalls(map, dimensions) {
  const regionWidth = map.mapRegionWidth || map.width;
  const regionHeight = map.mapRegionHeight || map.height;
  if (!regionWidth || !regionHeight || !map.mapRegions?.length) return [];
  const walls = [];
  const seen = new Set();

  map.mapRegions.forEach((region, regionIndex) => {
    const points = (region.points || [])
      .map((point) => pointToBoard(point, regionWidth, regionHeight, dimensions))
      .filter(Boolean);

    if (points.length < 2) return;

    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      if (!next || samePoint(point, next)) return;
      const key = getWallKey(point, next);
      if (seen.has(key)) return;
      seen.add(key);
      walls.push({
        id: `wall-map-${region.area || regionIndex}-${index}`,
        start: point,
        end: next,
      });
    });
  });

  return walls;
}

function pointToBoard(point, regionWidth, regionHeight, dimensions) {
  if (!Array.isArray(point) || point.length < 2) return null;
  return {
    x: clampWallCoordinate((Number(point[0]) / regionWidth) * dimensions.columns, dimensions.columns),
    y: clampWallCoordinate((Number(point[1]) / regionHeight) * dimensions.rows, dimensions.rows),
  };
}

function clampWallCoordinate(value, max) {
  return Math.max(-0.5, Math.min(max - 0.5, value - 0.5));
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function getWallKey(a, b) {
  const first = serializeWallPoint(a);
  const second = serializeWallPoint(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function serializeWallPoint(point) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function clampBoardTiles(value) {
  return Math.max(4, Math.min(200, Number(value) || 24));
}

function monsterTokenSize(monster) {
  const size = Array.isArray(monster.size) ? monster.size[0] : monster.size;
  return { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4, C: 5 }[size] || 1;
}

function monsterVisionFeet(monster) {
  const senses = Array.isArray(monster.senses) ? monster.senses.join(' ') : '';
  const match = senses.match(/darkvision\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function monsterColor(monster) {
  const type = typeof monster.type === 'string' ? monster.type : monster.type?.type;
  const colors = {
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
  return colors[type] || '#df5d52';
}

function monsterTokenImage(baseUrl, monster) {
  if (!monster.name || !monster.source) return '';
  const source = encodeURIComponent(monster.source);
  const name = encodeURIComponent(monster.name).replace(/'/g, '%27');
  return `${normalizeFiveEToolsBaseUrl(baseUrl)}img/bestiary/tokens/${source}/${name}.webp`;
}

function formatMonsterCr(monster) {
  if (monster.cr == null) return '?';
  if (typeof monster.cr === 'object') return monster.cr.cr || '?';
  return monster.cr;
}

function formatMonsterSize(monster) {
  const size = Array.isArray(monster.size) ? monster.size[0] : monster.size;
  return { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', C: 'Colossal' }[size] || 'Medium';
}
