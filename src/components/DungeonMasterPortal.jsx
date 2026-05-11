import React, { useEffect, useState } from 'react';
import {
  Brush,
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
import { getBoard, loadImage, makeBoard, offsetDrawing, uid, updateActiveBoard } from '../lib/board';

export function DungeonMasterPortal({ state, projects = [], openProjectId, setState, leaveProject, publishProjectToPlayers, undo, redo, canUndo, canRedo }) {
  const [tool, setTool] = useState('select');
  const [activeLayer, setActiveLayer] = useState('player');
  const [tokenDraft, setTokenDraft] = useState({ label: 'Bandit', color: '#df5d52', size: 1 });
  const [drawColor, setDrawColor] = useState('#36d399');
  const [drawLayer, setDrawLayer] = useState('player');
  const [selected, setSelected] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const board = getBoard(state, state.activeBoardId);

  const updateBoard = (patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, ...patch })));
  };
  const updateBackground = (patch) => {
    setState((current) => updateActiveBoard(current, (active) => ({ ...active, background: { ...active.background, ...patch } })));
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
    publishProjectToPlayers(openProjectId);
  };

  const clearDrawings = () => {
    setState((current) => updateActiveBoard(current, (active) => ({
      ...active,
      drawings: active.drawings.filter((drawing) => drawing.layer !== drawLayer),
    })));
    setSelected(null);
  };

  const copySelection = () => {
    const item = selected?.type === 'token'
      ? board.tokens.find((token) => token.id === selected.id)
      : board.drawings.find((drawing) => drawing.id === selected?.id);
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
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
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
          <button className="command" onClick={leaveProject}><Layers size={16} /> Project home</button>
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
            <button className="command" onClick={addBoard}><Plus size={16} /> New</button>
            <button className="command" onClick={duplicateBoard}><Copy size={16} /> Duplicate</button>
          </div>
          <button className="command accent" onClick={showBoardToPlayers}><Send size={16} /> Show active board to players</button>
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
          <div className="split">
            <label>
              Scale
              <input type="number" step="0.05" min="0.1" max="5" value={board.background.scale} onChange={(event) => updateBackground({ scale: Number(event.target.value) })} />
            </label>
            <label>
              Opacity
              <input type="number" step="0.05" min="0" max="1" value={board.background.opacity} onChange={(event) => updateBackground({ opacity: Number(event.target.value) })} />
            </label>
          </div>
          <div className="split">
            <label>
              X offset
              <input type="number" value={Math.round(board.background.x)} onChange={(event) => updateBackground({ x: Number(event.target.value) })} />
            </label>
            <label>
              Y offset
              <input type="number" value={Math.round(board.background.y)} onChange={(event) => updateBackground({ y: Number(event.target.value) })} />
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

        <Panel title="Shortcuts" icon={<Clipboard size={16} />}>
          <div className="shortcut-row">
            <button className="command" onClick={copySelection} disabled={!selected}><Copy size={16} /> Copy</button>
            <button className="command" onClick={pasteSelection} disabled={!clipboard}><Clipboard size={16} /> Paste</button>
          </div>
          <div className="shortcut-row">
            <button className="command" onClick={undo} disabled={!canUndo}><Undo2 size={16} /> Undo</button>
            <button className="command" onClick={redo} disabled={!canRedo}><Redo2 size={16} /> Redo</button>
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
            <div className="shortcut-row">
              <button className="command" onClick={() => duplicateSelection()}><Copy size={16} /> Duplicate</button>
              <button className="command danger" onClick={() => deleteSelection()}><Trash2 size={16} /> Delete</button>
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
          <button className="command" onClick={clearDrawings}><Eraser size={16} /> Clear active drawing layer</button>
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
          <div className="token-list">
            {board.tokens.map((token) => (
              <div className="token-row" key={token.id}>
                <span className="swatch" style={{ background: token.color }} />
                <input value={token.label} onChange={(event) => updateToken(token.id, { label: event.target.value })} />
                <button title="Toggle layer visibility" onClick={() => updateToken(token.id, { visible: !token.visible })}>
                  {token.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <select value={token.layer} onChange={(event) => updateToken(token.id, { layer: event.target.value })}>
                  <option value="player">Player</option>
                  <option value="dm">DM</option>
                </select>
              </div>
            ))}
          </div>
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
          onDeleteSelection={deleteSelection}
          onDuplicateSelection={duplicateSelection}
        />
      </section>
    </>
  );
}
