import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, DoorOpen, Eraser, Grid2X2, Import, Layers, Mountain, Plus, Save, Trash2, Waves } from 'lucide-react';
import {
  clampGridSize,
  drawDungeonToContext,
  dungeonTools,
  makeDungeon,
  normalizeDungeon,
  paintDungeonAt,
  renderDungeonThumbnailDataUrl,
  resizeDungeon,
} from '../lib/dungeon';

const toolMeta = {
  wall: { label: 'Walls', icon: <Layers size={16} /> },
  door: { label: 'Doors', icon: <DoorOpen size={16} /> },
  stairs: { label: 'Stairs', icon: <Mountain size={16} /> },
  difficult: { label: 'Diff. Terrain', icon: <Grid2X2 size={16} /> },
  water: { label: 'Water', icon: <Waves size={16} /> },
  erase: { label: 'Erase', icon: <Eraser size={16} /> },
};

export function DungeonBuilder({ onBack, onImportToCampaign }) {
  const [dungeons, setDungeons] = useState([]);
  const [activeDungeon, setActiveDungeon] = useState(null);
  const [tool, setTool] = useState('wall');
  const [createDraft, setCreateDraft] = useState({ name: 'New Dungeon', width: 20, height: 20 });
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState('');

  const loadDungeons = async () => {
    const response = await fetch('/api/dungeons');
    const data = await response.json();
    setDungeons(data.dungeons || []);
  };

  useEffect(() => {
    loadDungeons().catch((error) => setMessage(error.message || 'Unable to load dungeons.'));
  }, []);

  const createDungeon = async () => {
    const dungeon = makeDungeon(createDraft.name, createDraft.width, createDraft.height);
    const saved = await saveDungeon(dungeon);
    setActiveDungeon(saved);
    setIsCreating(false);
  };

  const openDungeon = async (id) => {
    const response = await fetch(`/api/dungeons/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Unable to open dungeon.');
    const data = await response.json();
    setActiveDungeon(normalizeDungeon(data.dungeon));
  };

  const deleteDungeon = async (id) => {
    if (!window.confirm('Delete this dungeon permanently?')) return;
    const response = await fetch(`/api/dungeons/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to delete dungeon.');
    if (activeDungeon?.id === id) setActiveDungeon(null);
    await loadDungeons();
  };

  const saveDungeon = async (dungeon) => {
    const normalized = normalizeDungeon(dungeon);
    const response = await fetch(`/api/dungeons/${encodeURIComponent(normalized.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dungeon: normalized,
        thumbnailDataUrl: renderDungeonThumbnailDataUrl(normalized),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to save dungeon.');
    }
    const data = await response.json();
    await loadDungeons();
    setMessage('Dungeon saved.');
    return normalizeDungeon(data.dungeon);
  };

  const importDungeonFile = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/dungeons/import', { method: 'POST', body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to import dungeon.');
    }
    await loadDungeons();
    setMessage('Dungeon imported.');
  };

  if (activeDungeon) {
    return (
      <DungeonEditor
        dungeon={activeDungeon}
        tool={tool}
        setTool={setTool}
        onBack={() => {
          setActiveDungeon(null);
          setMessage('');
          loadDungeons();
        }}
        onChange={setActiveDungeon}
        onSave={async (dungeon) => setActiveDungeon(await saveDungeon(dungeon))}
        onImportToCampaign={onImportToCampaign}
      />
    );
  }

  return (
    <section className="dungeon-app">
      <header className="dungeon-homebar">
        <div>
          <strong>Dungeon & Map Builder</strong>
          <span>Global tactical map library stored outside campaign projects.</span>
        </div>
        <div className="dungeon-home-actions">
          <button className="command" onClick={onBack}><ArrowLeft size={16} /> TableForge Home</button>
          <label className="command">
            <Import size={16} /> Import Dungeon
            <input type="file" accept=".zip,.tfd,application/zip" onChange={(event) => importDungeonFile(event.target.files?.[0]).catch((error) => setMessage(error.message))} />
          </label>
          <button className="command accent" onClick={() => setIsCreating(true)}><Plus size={16} /> Create New Dungeon</button>
        </div>
      </header>

      {message && <p className={message.includes('Unable') ? 'form-error dungeon-message' : 'form-success dungeon-message'}>{message}</p>}

      <div className="dungeon-grid">
        {dungeons.map((dungeon) => (
          <article className="dungeon-card" key={dungeon.id}>
            <button className="dungeon-thumb" onClick={() => openDungeon(dungeon.id).catch((error) => setMessage(error.message))}>
              {dungeon.thumbnailUrl ? <img src={`${dungeon.thumbnailUrl}?v=${encodeURIComponent(dungeon.updatedAt || '')}`} alt="" /> : <Grid2X2 size={34} />}
            </button>
            <div className="dungeon-card-body">
              <strong>{dungeon.name}</strong>
              <span>{dungeon.gridSize?.width || 0} x {dungeon.gridSize?.height || 0} grid</span>
            </div>
            <div className="dungeon-card-actions">
              <button onClick={() => openDungeon(dungeon.id).catch((error) => setMessage(error.message))}>Open</button>
              <a href={`/api/dungeons/${encodeURIComponent(dungeon.id)}/export`} download={`${dungeon.name}.tfd`}>Export</a>
              <button className="danger-text" onClick={() => deleteDungeon(dungeon.id).catch((error) => setMessage(error.message))}>Delete</button>
            </div>
          </article>
        ))}
        {!dungeons.length && (
          <div className="dungeon-empty">
            <strong>No dungeons yet</strong>
            <span>Create a dungeon to start building reusable battle maps.</span>
          </div>
        )}
      </div>

      {isCreating && (
        <div className="project-conflict-overlay" role="dialog" aria-modal="true" aria-label="Create dungeon">
          <div className="project-conflict-modal">
            <strong>Create Dungeon</strong>
            <label>
              Name
              <input value={createDraft.name} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} />
            </label>
            <div className="split">
              <label>
                Width
                <input type="number" min="5" max="100" value={createDraft.width} onChange={(event) => setCreateDraft({ ...createDraft, width: event.target.value })} />
              </label>
              <label>
                Height
                <input type="number" min="5" max="100" value={createDraft.height} onChange={(event) => setCreateDraft({ ...createDraft, height: event.target.value })} />
              </label>
            </div>
            <div className="project-conflict-actions">
              <button className="command accent" onClick={() => createDungeon().catch((error) => setMessage(error.message))}>Create</button>
              <button className="command" onClick={() => setIsCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DungeonEditor({ dungeon, tool, setTool, onBack, onChange, onSave, onImportToCampaign }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const normalized = useMemo(() => normalizeDungeon(dungeon), [dungeon]);

  const updateSize = (patch) => {
    onChange(resizeDungeon(normalized, patch.width ?? normalized.gridSize.width, patch.height ?? normalized.gridSize.height));
  };

  const paintFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * normalized.gridSize.width;
    const y = ((event.clientY - rect.top) / rect.height) * normalized.gridSize.height;
    const localX = x - Math.floor(x);
    const localY = y - Math.floor(y);
    const point = {
      x,
      y,
      localX,
      localY,
      nearEdge: Math.min(localX, localY, 1 - localX, 1 - localY) < 0.18,
    };
    onChange(paintDungeonAt(normalized, tool, point));
  };

  const save = async () => {
    await onSave(normalized);
    setStatus('Saved.');
  };

  return (
    <section className="dungeon-editor">
      <header className="dungeon-editor-bar">
        <button onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <button onClick={() => save().catch((error) => setStatus(error.message))}><Save size={16} /> Save</button>
        <a href={`/api/dungeons/${encodeURIComponent(normalized.id)}/export`} download={`${normalized.name}.tfd`}><Download size={16} /> Export</a>
        <label>
          Name
          <input value={normalized.name} onChange={(event) => onChange({ ...normalized, name: event.target.value })} />
        </label>
        <div className="dungeon-size-controls">
          <label>
            Grid W
            <input type="number" min="5" max="100" value={normalized.gridSize.width} onChange={(event) => updateSize({ width: clampGridSize(event.target.value) })} />
          </label>
          <label>
            Grid H
            <input type="number" min="5" max="100" value={normalized.gridSize.height} onChange={(event) => updateSize({ height: clampGridSize(event.target.value) })} />
          </label>
        </div>
        {onImportToCampaign && <button onClick={() => onImportToCampaign(normalized)}>Import to Campaign</button>}
      </header>

      <aside className="dungeon-palette">
        <strong>Palette</strong>
        {dungeonTools.map((item) => (
          <button key={item} className={tool === item ? 'active' : ''} onClick={() => setTool(item)}>
            {toolMeta[item].icon}
            {toolMeta[item].label}
          </button>
        ))}
        <div className="dungeon-lighting-note">
          <strong>Lighting Options</strong>
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            Auto Wall Light
          </label>
          <span>{normalized.lightingGeometry.length} lighting vectors generated.</span>
        </div>
        {status && <p className={status === 'Saved.' ? 'form-success' : 'form-error'}>{status}</p>}
      </aside>

      <DungeonCanvas
        dungeon={normalized}
        dragging={dragging}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          paintFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (dragging) paintFromEvent(event);
        }}
        onPointerUp={() => setDragging(false)}
      />
    </section>
  );
}

function DungeonCanvas({ dungeon, onPointerDown, onPointerMove, onPointerUp }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawDungeonToContext(canvas.getContext('2d'), dungeon, canvas.width, canvas.height);
  }, [dungeon]);

  return (
    <div className="dungeon-canvas-shell">
      <canvas
        ref={ref}
        width={Math.max(640, dungeon.gridSize.width * 36)}
        height={Math.max(420, dungeon.gridSize.height * 36)}
        className="dungeon-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
