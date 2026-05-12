import React, { useEffect, useState } from 'react';
import {
  Brush,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Grid2X2,
  Image,
  Layers,
  MousePointer2,
  Plus,
  Redo2,
  Send,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { BoardCanvas } from './BoardCanvas';
import { Panel } from './Panel';
import { ToolGrid } from './ToolGrid';
import { Topbar } from './Topbar';
import { boxesOverlap, defaultLighting, getBoard, loadImage, makeBoard, offsetDrawing, revealBox, uid, updateActiveBoard } from '../lib/board';

export function DungeonMasterPortal({ state, projects = [], openProjectId, setState, leaveProject, publishProjectToPlayers, undo, redo, canUndo, canRedo }) {
  const [tool, setTool] = useState('select');
  const [activeLayer, setActiveLayer] = useState('player');
  const [tokenDraft, setTokenDraft] = useState({ label: 'Bandit', color: '#df5d52', size: 1 });
  const [drawColor, setDrawColor] = useState('#36d399');
  const [drawLayer, setDrawLayer] = useState('player');
  const [selected, setSelected] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [tokensExpanded, setTokensExpanded] = useState(true);
  const [drawingsExpanded, setDrawingsExpanded] = useState(true);
  const board = getBoard(state, state.activeBoardId);

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

  const addToken = (point) => {
    const token = {
      id: uid('token'),
      x: point.x,
      y: point.y,
      label: tokenDraft.label || 'Token',
      color: tokenDraft.color,
      layer: activeLayer,
      size: Number(tokenDraft.size) || 1,
      visible: true,
      visionEnabled: true,
    };
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, tokens: [...active.tokens, token] })));
    setSelected({ type: 'token', id: token.id });
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

  const duplicateBoard = () => {
    const next = {
      ...structuredClone(board),
      id: uid('board'),
      name: `${board.name} Copy`,
      tokens: board.tokens.map((token) => ({ ...token, id: uid('token') })),
      drawings: board.drawings.map((drawing) => ({ ...drawing, id: uid('drawing') })),
    };
    setState((current) => ({ ...current, boards: [...current.boards, next], activeBoardId: next.id }));
  };

  const showBoardToPlayers = () => {
    setState((current) => ({ ...current, playerBoardId: current.activeBoardId }), { skipHistory: true });
    window.setTimeout(() => publishProjectToPlayers(openProjectId), 320);
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
        walls: [...(active.lighting?.walls || []), wall],
      },
    })));
  };

  const moveLightWall = (id, wall) => {
    updateLighting({ walls: (board.lighting?.walls || []).map((item) => item.id === id ? wall : item) });
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

  const copySelection = () => {
    const item = selected?.type === 'token'
      ? board.tokens.find((token) => token.id === selected.id)
      : selected?.type === 'drawing'
        ? board.drawings.find((drawing) => drawing.id === selected.id)
        : board.lighting?.walls?.find((wall) => wall.id === selected?.id);
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
  };

  const deleteSelection = (target = selected) => {
    if (!target) return;
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      tokens: target.type === 'token' ? active.tokens.filter((token) => token.id !== target.id) : active.tokens,
      drawings: target.type === 'drawing' ? active.drawings.filter((drawing) => drawing.id !== target.id) : active.drawings,
      lighting: target.type === 'wall'
        ? { ...defaultLighting, ...active.lighting, walls: (active.lighting?.walls || []).filter((wall) => wall.id !== target.id) }
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
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
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
  }, [board, selected, clipboard, undo, redo]);

  const selectedDrawing = selected?.type === 'drawing' ? board.drawings.find((drawing) => drawing.id === selected.id) : null;
  const selectedToken = selected?.type === 'token' ? board.tokens.find((token) => token.id === selected.id) : null;
  const selectedWall = selected?.type === 'wall' ? board.lighting?.walls?.find((wall) => wall.id === selected.id) : null;

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <Grid2X2 size={22} />
          <div>
            <strong>Tableforge</strong>
            <span>Dungeon master portal</span>
          </div>
        </div>

        <Panel title="Project" icon={<Layers size={16} />}>
          <button className="command" title="Return to the project home screen" onClick={leaveProject}><Layers size={16} /> Project home</button>
        </Panel>

        <Panel title="Boards" icon={<Layers size={16} />}>
          <div className="board-list">
            {state.boards.map((item) => (
              <button
                key={item.id}
                className={item.id === state.activeBoardId ? 'active' : ''}
                onClick={() => setState((current) => ({ ...current, activeBoardId: item.id }), { skipHistory: true })}
              >
                <span>{item.name}</span>
                {item.id === state.playerBoardId && <Users size={15} />}
              </button>
            ))}
          </div>
          <div className="split">
            <button className="command" title="Create a new empty board in this project" onClick={addBoard}><Plus size={16} /> New</button>
            <button className="command" title="Duplicate the active board" onClick={duplicateBoard}><Copy size={16} /> Duplicate</button>
          </div>
          <button className="command accent" title="Publish the active board to the player viewer" onClick={showBoardToPlayers}><Send size={16} /> Show active board to players</button>
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
          <button className="command" title="Remove all manually revealed lighting areas" onClick={clearLightReveals}><Eraser size={16} /> Clear reveal areas</button>
          <button className="command" title="Remove all lighting walls from this board" onClick={clearLightWalls}><Eraser size={16} /> Clear light walls</button>
        </Panel>

        <Panel title="Board" icon={<Image size={16} />}>
          <label>
            Name
            <input value={board.name} onChange={(event) => updateBoard({ name: event.target.value })} />
          </label>
          <div className="split">
            <label>
              Tiles wide
              <input type="number" min="4" max="80" value={board.columns} onChange={(event) => updateBoard({ columns: Number(event.target.value) })} />
            </label>
            <label>
              Tiles high
              <input type="number" min="4" max="80" value={board.rows} onChange={(event) => updateBoard({ rows: Number(event.target.value) })} />
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
            Background image
            <input type="file" accept="image/*" onChange={(event) => loadImage(event, (src) => updateBackground({ src }))} />
          </label>
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

        <Panel title="Tools" icon={<MousePointer2 size={16} />}>
          <ToolGrid value={tool} onChange={setTool} />
          <div className="segmented">
            <button className={activeLayer === 'player' ? 'active' : ''} onClick={() => setActiveLayer('player')}><Users size={15} /> Player</button>
            <button className={activeLayer === 'dm' ? 'active' : ''} onClick={() => setActiveLayer('dm')}><EyeOff size={15} /> DM</button>
          </div>
        </Panel>

        {selectedWall && (
          <Panel title="Selected Wall" icon={<EyeOff size={16} />}>
            <div className="shortcut-row">
              <button className="command" title="Duplicate the selected light-blocking wall" onClick={() => duplicateSelection()}><Copy size={16} /> Duplicate</button>
              <button className="command danger" title="Delete the selected light-blocking wall" onClick={() => deleteSelection()}><Trash2 size={16} /> Delete</button>
            </div>
          </Panel>
        )}

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
              Token image
              <input type="file" accept="image/*" onChange={(event) => loadImage(event, (image) => updateToken(selectedToken.id, { image }))} />
            </label>
            <label className="check-row" title="Toggle whether this token reveals darkness with its vision distance">
              <input type="checkbox" checked={selectedToken.visionEnabled !== false} onChange={(event) => updateToken(selectedToken.id, { visionEnabled: event.target.checked })} />
              Vision enabled
            </label>
            <div className="split">
              <label title="How far this token can see when board lighting is enabled">
                Vision feet
                <input type="number" min="0" step="5" value={selectedToken.visionFeet || 0} onChange={(event) => updateToken(selectedToken.id, { visionFeet: Number(event.target.value) })} />
              </label>
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
                    {drawing.type === 'path' ? 'Freehand' : drawing.shape || 'Shape'} {index + 1}
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
      </aside>

      <section className="workspace">
        <Topbar board={board} mode="dm" />
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
          onMoveDrawing={(id, dx, dy) => updateDrawing(id, offsetDrawing(board.drawings.find((drawing) => drawing.id === id), dx, dy))}
          onAddDrawing={addDrawing}
          onMoveBackground={(patch) => updateBackground(patch)}
          onAddLightReveal={addLightReveal}
          onAddLightWall={addLightWall}
          onMoveLightWall={moveLightWall}
          onRemoveLightReveal={removeLightReveal}
          onDeleteSelection={deleteSelection}
          onDuplicateSelection={duplicateSelection}
        />
      </section>
    </>
  );
}
