import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brush,
  Circle,
  Eraser,
  Eye,
  EyeOff,
  Expand,
  Grid2X2,
  Image,
  Layers,
  MousePointer2,
  Move,
  Plus,
  Ruler,
  Save,
  Shapes,
  Square,
  Triangle,
  Users,
} from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'tableforge-board-state';
const CHANNEL_KEY = 'tableforge-board-sync';
const tileFeet = 5;

const defaultState = {
  board: {
    name: 'Blackstone Crossing',
    columns: 24,
    rows: 16,
    tileSize: 42,
    background: '',
    backgroundScale: 1,
    backgroundOpacity: 0.72,
    backgroundFit: 'cover',
  },
  tokens: [
    { id: 'hero-1', x: 5, y: 7, label: 'Kara', color: '#3ea7ff', layer: 'player', size: 1, visible: true },
    { id: 'hero-2', x: 7, y: 8, label: 'Brom', color: '#f2c94c', layer: 'player', size: 1, visible: true },
    { id: 'gm-1', x: 15, y: 5, label: 'Owlbear', color: '#df5d52', layer: 'dm', size: 2, visible: true },
  ],
  drawings: [
    {
      id: 'draw-1',
      type: 'shape',
      shape: 'rect',
      layer: 'player',
      color: '#36d399',
      fill: 'rgba(54, 211, 153, 0.13)',
      strokeWidth: 3,
      start: { x: 3, y: 3 },
      end: { x: 9, y: 6 },
    },
  ],
};

function readInitialState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : defaultState;
  } catch {
    return defaultState;
  }
}

function feetBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * tileFeet);
}

function snapToTile(point) {
  return {
    x: Math.max(0, Math.floor(point.x)),
    y: Math.max(0, Math.floor(point.y)),
  };
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function App() {
  const [state, setState] = useSyncedBoard();
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get('view') === 'player' ? 'player' : 'dm');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === 'player') url.searchParams.set('view', 'player');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url);
  }, [mode]);

  return (
    <main className={`app app-${mode}`}>
      {mode === 'dm' ? (
        <DungeonMasterPortal state={state} setState={setState} setMode={setMode} />
      ) : (
        <PlayerViewer state={state} setMode={setMode} />
      )}
    </main>
  );
}

function useSyncedBoard() {
  const [state, setState] = useState(readInitialState);
  const channelRef = useRef(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_KEY);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'board-state') {
        setState(event.data.state);
      }
    };
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        setState(JSON.parse(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      channel.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const updateState = (updater) => {
    setState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      channelRef.current?.postMessage({ type: 'board-state', state: next });
      return next;
    });
  };

  return [state, updateState];
}

function DungeonMasterPortal({ state, setState, setMode }) {
  const [tool, setTool] = useState('select');
  const [activeLayer, setActiveLayer] = useState('player');
  const [tokenDraft, setTokenDraft] = useState({ label: 'Bandit', color: '#df5d52', size: 1 });
  const [drawColor, setDrawColor] = useState('#36d399');
  const [drawLayer, setDrawLayer] = useState('player');

  const updateBoard = (patch) => setState((current) => ({ ...current, board: { ...current.board, ...patch } }));
  const updateToken = (id, patch) => {
    setState((current) => ({
      ...current,
      tokens: current.tokens.map((token) => token.id === id ? { ...token, ...patch } : token),
    }));
  };

  const addToken = (point) => {
    setState((current) => ({
      ...current,
      tokens: [
        ...current.tokens,
        {
          id: uid('token'),
          x: point.x,
          y: point.y,
          label: tokenDraft.label || 'Token',
          color: tokenDraft.color,
          layer: activeLayer,
          size: Number(tokenDraft.size) || 1,
          visible: true,
        },
      ],
    }));
  };

  const addDrawing = (drawing) => {
    setState((current) => ({ ...current, drawings: [...current.drawings, drawing] }));
  };

  const clearDrawings = () => {
    setState((current) => ({ ...current, drawings: current.drawings.filter((drawing) => drawing.layer !== drawLayer) }));
  };

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

        <Panel title="Board" icon={<Image size={16} />}>
          <label>
            Name
            <input value={state.board.name} onChange={(event) => updateBoard({ name: event.target.value })} />
          </label>
          <div className="split">
            <label>
              Tiles wide
              <input type="number" min="4" max="80" value={state.board.columns} onChange={(event) => updateBoard({ columns: Number(event.target.value) })} />
            </label>
            <label>
              Tiles high
              <input type="number" min="4" max="80" value={state.board.rows} onChange={(event) => updateBoard({ rows: Number(event.target.value) })} />
            </label>
          </div>
          <label>
            Tile pixels
            <input type="range" min="24" max="72" value={state.board.tileSize} onChange={(event) => updateBoard({ tileSize: Number(event.target.value) })} />
          </label>
          <label className="file-button">
            <Image size={16} />
            Background image
            <input type="file" accept="image/*" onChange={(event) => loadImage(event, (background) => updateBoard({ background }))} />
          </label>
          <div className="split">
            <label>
              Image scale
              <input type="number" step="0.05" min="0.2" max="4" value={state.board.backgroundScale} onChange={(event) => updateBoard({ backgroundScale: Number(event.target.value) })} />
            </label>
            <label>
              Opacity
              <input type="number" step="0.05" min="0" max="1" value={state.board.backgroundOpacity} onChange={(event) => updateBoard({ backgroundOpacity: Number(event.target.value) })} />
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
        </Panel>

        <Panel title="Tokens" icon={<Layers size={16} />}>
          <div className="token-list">
            {state.tokens.map((token) => (
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
        <Topbar state={state} mode="dm" setMode={setMode} />
        <BoardCanvas
          state={state}
          view="dm"
          tool={tool}
          activeLayer={activeLayer}
          drawLayer={drawLayer}
          drawColor={drawColor}
          onAddToken={addToken}
          onMoveToken={(id, point) => updateToken(id, point)}
          onAddDrawing={addDrawing}
        />
      </section>
    </>
  );
}

function PlayerViewer({ state, setMode }) {
  const enterFullscreen = () => document.documentElement.requestFullscreen?.();
  return (
    <section className="player-screen">
      <Topbar state={state} mode="player" setMode={setMode} onFullscreen={enterFullscreen} />
      <BoardCanvas state={state} view="player" tool="viewer" fitToViewport />
    </section>
  );
}

function Topbar({ state, mode, setMode, onFullscreen }) {
  const playerUrl = `${window.location.origin}${window.location.pathname}?view=player`;
  return (
    <header className="topbar">
      <div>
        <strong>{state.board.name}</strong>
        <span>{state.board.columns} x {state.board.rows} tiles · {tileFeet} ft grid</span>
      </div>
      <div className="top-actions">
        {mode === 'dm' && <a className="ghost-link" href={playerUrl} target="_blank" rel="noreferrer"><Users size={16} /> Open player viewer</a>}
        {mode === 'player' && <button onClick={onFullscreen}><Expand size={16} /> Full screen</button>}
        <button onClick={() => setMode(mode === 'dm' ? 'player' : 'dm')}><Save size={16} /> {mode === 'dm' ? 'Viewer' : 'DM portal'}</button>
      </div>
    </header>
  );
}

function BoardCanvas({ state, view, tool, activeLayer, drawLayer = 'player', drawColor = '#36d399', onAddToken, onMoveToken, onAddDrawing, fitToViewport = false }) {
  const { board } = state;
  const [drag, setDrag] = useState(null);
  const shellRef = useRef(null);
  const [scale, setScale] = useState(1);
  const tile = board.tileSize;
  const width = board.columns * tile;
  const height = board.rows * tile;
  const visibleTokens = state.tokens.filter((token) => view === 'dm' || (token.layer === 'player' && token.visible));
  const visibleDrawings = state.drawings.filter((drawing) => view === 'dm' || drawing.layer === 'player');

  const backgroundStyle = board.background ? {
    backgroundImage: `linear-gradient(rgba(15, 23, 42, ${1 - board.backgroundOpacity}), rgba(15, 23, 42, ${1 - board.backgroundOpacity})), url(${board.background})`,
    backgroundSize: `${100 * board.backgroundScale}%`,
    backgroundPosition: 'center',
  } : {};

  useEffect(() => {
    if (!fitToViewport || !shellRef.current) {
      setScale(1);
      return undefined;
    }
    const shell = shellRef.current;
    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const nextScale = Math.min(rect.width / width, rect.height / height, 1);
      setScale(Math.max(0.2, nextScale));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [fitToViewport, width, height]);

  const pointFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / tile,
      y: (event.clientY - rect.top) / tile,
    };
  };

  const tokenAt = (point) => [...visibleTokens].reverse().find((token) => (
    point.x >= token.x && point.x <= token.x + token.size && point.y >= token.y && point.y <= token.y + token.size
  ));

  const onPointerDown = (event) => {
    if (view !== 'dm') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const snapped = snapToTile(point);
    const token = tokenAt(point);

    if (tool === 'token') {
      onAddToken(snapped);
      return;
    }

    if (tool === 'select' && token) {
      setDrag({ type: 'token', id: token.id, offset: { x: point.x - token.x, y: point.y - token.y } });
      return;
    }

    if (['ruler', 'square', 'circle', 'cone', 'shape'].includes(tool)) {
      setDrag({ type: tool, start: snapped, end: snapped });
      return;
    }

    if (tool === 'draw') {
      setDrag({ type: 'draw', points: [point] });
    }
  };

  const onPointerMove = (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    const snapped = snapToTile(point);

    if (drag.type === 'token') {
      onMoveToken(drag.id, {
        x: Math.max(0, Math.min(board.columns - 1, Math.floor(point.x - drag.offset.x))),
        y: Math.max(0, Math.min(board.rows - 1, Math.floor(point.y - drag.offset.y))),
      });
      return;
    }

    if (drag.type === 'draw') {
      setDrag({ ...drag, points: [...drag.points, point] });
      return;
    }

    setDrag({ ...drag, end: snapped });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.type === 'draw' && drag.points.length > 1) {
      onAddDrawing({
        id: uid('draw'),
        type: 'path',
        layer: drawLayer,
        color: drawColor,
        strokeWidth: 4,
        points: drag.points,
      });
    }
    if (['square', 'circle', 'cone', 'shape'].includes(drag.type)) {
      onAddDrawing({
        id: uid('shape'),
        type: 'shape',
        shape: drag.type === 'shape' ? 'rect' : drag.type,
        layer: drawLayer,
        color: drawColor,
        fill: `${drawColor}22`,
        strokeWidth: 3,
        start: drag.start,
        end: drag.end,
      });
    }
    setDrag(null);
  };

  const liveDrawing = drag?.type === 'draw'
    ? [{ id: 'live-draw', type: 'path', points: drag.points, color: drawColor, strokeWidth: 4, layer: drawLayer }]
    : [];
  const liveShape = drag && ['square', 'circle', 'cone', 'shape', 'ruler'].includes(drag.type) ? drag : null;

  return (
    <div
      className={`board-shell ${fitToViewport ? 'board-shell-fit' : ''}`}
      ref={shellRef}
    >
      <div className="board-stage" style={{ width: width * scale, height: height * scale }}>
        <div
          className={`board ${fitToViewport ? 'board-fit' : ''}`}
          style={{ width, height, '--tile': `${tile}px`, transform: `scale(${scale})`, ...backgroundStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <svg className="drawing-layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <defs>
              <marker id="arrow" markerWidth="12" markerHeight="12" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,4 L0,8 Z" fill="#f8fafc" />
              </marker>
            </defs>
            {[...visibleDrawings, ...liveDrawing].map((drawing) => renderDrawing(drawing, tile))}
            {liveShape && renderLiveShape(liveShape, tile)}
          </svg>

          {visibleTokens.map((token) => (
            <button
              key={token.id}
              className={`map-token token-${token.layer} ${!token.visible ? 'token-hidden' : ''}`}
              style={{
                left: token.x * tile,
                top: token.y * tile,
                width: token.size * tile,
                height: token.size * tile,
                background: token.color,
              }}
              title={`${token.label} (${token.layer})`}
            >
              <span>{token.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderDrawing(drawing, tile) {
  if (drawing.type === 'path') {
    const d = drawing.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * tile} ${point.y * tile}`).join(' ');
    return <path key={drawing.id} d={d} fill="none" stroke={drawing.color} strokeWidth={drawing.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
  }
  return renderStoredShape(drawing, tile);
}

function renderStoredShape(drawing, tile) {
  const start = drawing.start;
  const end = drawing.end;
  const x = Math.min(start.x, end.x) * tile;
  const y = Math.min(start.y, end.y) * tile;
  const w = (Math.abs(end.x - start.x) + 1) * tile;
  const h = (Math.abs(end.y - start.y) + 1) * tile;
  const common = { key: drawing.id, fill: drawing.fill, stroke: drawing.color, strokeWidth: drawing.strokeWidth };
  if (drawing.shape === 'circle') {
    return <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
  }
  if (drawing.shape === 'cone') {
    const points = `${start.x * tile},${start.y * tile} ${end.x * tile},${(end.y + 1) * tile} ${(end.x + 1) * tile},${end.y * tile}`;
    return <polygon {...common} points={points} />;
  }
  return <rect {...common} x={x} y={y} width={w} height={h} rx="4" />;
}

function renderLiveShape(shape, tile) {
  const start = shape.start;
  const end = shape.end;
  if (shape.type === 'ruler') {
    const x1 = (start.x + 0.5) * tile;
    const y1 = (start.y + 0.5) * tile;
    const x2 = (end.x + 0.5) * tile;
    const y2 = (end.y + 0.5) * tile;
    return (
      <g key="live-ruler">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f8fafc" strokeWidth="4" markerEnd="url(#arrow)" />
        <text x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} fill="#f8fafc" fontSize="15" fontWeight="800">
          {feetBetween(start, end)} ft
        </text>
      </g>
    );
  }
  return renderStoredShape({
    id: 'live-shape',
    type: 'shape',
    shape: shape.type === 'shape' ? 'rect' : shape.type,
    color: '#f8fafc',
    fill: 'rgba(248, 250, 252, 0.14)',
    strokeWidth: 3,
    start,
    end,
  }, tile);
}

function ToolGrid({ value, onChange }) {
  const tools = [
    ['select', <Move size={17} />, 'Select and move'],
    ['token', <Plus size={17} />, 'Place token'],
    ['ruler', <Ruler size={17} />, 'Ruler'],
    ['draw', <Brush size={17} />, 'Freehand'],
    ['shape', <Shapes size={17} />, 'Rectangle'],
    ['square', <Square size={17} />, 'Square area'],
    ['circle', <Circle size={17} />, 'Circle area'],
    ['cone', <Triangle size={17} />, 'Cone area'],
  ];
  return (
    <div className="tool-grid">
      {tools.map(([id, icon, label]) => (
        <button key={id} title={label} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {icon}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <section className="panel">
      <h2>{icon}{title}</h2>
      {children}
    </section>
  );
}

function loadImage(event, onLoad) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.readAsDataURL(file);
}

createRoot(document.getElementById('root')).render(<App />);
