import React, { useEffect, useState } from 'react';
import { Copy, Expand, Home, Plus, Redo2, RotateCcw, RotateCw, Search, Settings, Trash2, Undo2, Users } from 'lucide-react';
import { boardGridLabel } from '../lib/board';

const layerOptions = [
  ['map', 'Map'],
  ['token', 'Token'],
  ['gm', 'GM'],
  ['walls', 'Wall/Lighting'],
];

export function Topbar({
  board,
  mode,
  boards = [],
  activeBoardId,
  playerBoardId,
  activeLayer = 'token',
  onLayerChange,
  onBoardSelect,
  onAddBoard,
  onImportBoard,
  onImportFiveEToolsMap,
  onDuplicateBoard,
  onDeleteBoard,
  onPublishBoard,
  onProjectHome,
  onFullscreen,
  onToggleZoom,
  onRotateLeft,
  onRotateRight,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) {
  const playerUrl = `${window.location.origin}${window.location.pathname}?view=player`;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isDrawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen]);
  return (
    <header className={`topbar ${isDrawerOpen ? 'drawer-open' : ''}`}>
      <div className="topbar-main">
        <button
          className="board-title-button"
          type="button"
          onClick={() => setIsDrawerOpen((open) => !open)}
          title="Open page drawer"
        >
          <strong>{board.name}</strong>
          <span>{board.columns} x {board.rows} cells · {boardGridLabel(board)}</span>
        </button>
        {mode === 'dm' && (
          <div className="layer-switcher" aria-label="Active layer">
            <span>Active Layer</span>
            <div>
              {layerOptions.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={activeLayer === id ? 'active' : ''}
                  onClick={() => onLayerChange?.(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="top-actions">
        {mode === 'dm' && (
          <div className="history-actions">
            <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={onUndo} disabled={!canUndo}><Undo2 size={16} /></button>
            <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={onRedo} disabled={!canRedo}><Redo2 size={16} /></button>
          </div>
        )}
        {mode === 'dm' && (
          playerBoardId === activeBoardId ? (
            <span className="player-ribbon-status live"><Users size={16} /> Players live here</span>
          ) : (
            <button
              type="button"
              className="player-ribbon-status publish-button"
              title="Publish this board so players see it"
              onClick={() => onPublishBoard?.(activeBoardId)}
            >
              <Users size={16} /> Bring players here
            </button>
          )
        )}
        {mode === 'dm' && <a className="ghost-link" href={playerUrl} target="_blank" rel="noreferrer"><Users size={16} /> Open player view</a>}
        {mode === 'player' && <button onClick={onToggleZoom}><Search size={16} /> Zoom</button>}
        {mode === 'player' && <button title="Rotate board counter clockwise" onClick={onRotateLeft}><RotateCcw size={16} /> Rotate</button>}
        {mode === 'player' && <button title="Rotate board clockwise" onClick={onRotateRight}><RotateCw size={16} /> Rotate</button>}
        {mode === 'player' && <button onClick={onFullscreen}><Expand size={16} /> Full screen</button>}
      </div>
      {mode === 'dm' && isDrawerOpen && (
        <div className="page-drawer" aria-label="Board page drawer">
          <div className="page-drawer-rail">
            <button className="drawer-home-button" type="button" onClick={onProjectHome}>
              <Home size={16} />
              Project home
            </button>
            <div
              className="player-ribbon"
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', 'player-ribbon')}
              title="Drag onto a board to publish it to players"
            >
              <Users size={16} />
              PLAYERS
            </div>
          </div>
          <div className="page-card-row">
            {boards.map((item) => (
              <article
                key={item.id}
                className={`page-card ${item.id === activeBoardId ? 'active' : ''} ${item.id === playerBoardId ? 'published' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  if (event.dataTransfer.getData('text/plain') === 'player-ribbon') onPublishBoard?.(item.id);
                }}
              >
                <button className="page-card-preview" type="button" onClick={() => onBoardSelect?.(item.id)}>
                  <span>{item.name}</span>
                </button>
                <div className="page-card-meta">
                  <strong>{item.name}</strong>
                  <span>{item.columns} x {item.rows} · {boardGridLabel(item)} · {item.id === playerBoardId ? 'Published' : 'DM only'}</span>
                </div>
                <div className="page-card-actions">
                  <button
                    type="button"
                    className={item.id === playerBoardId ? 'publish-action live' : 'publish-action'}
                    title={item.id === playerBoardId ? 'Players are viewing this board' : 'Publish this board to players'}
                    disabled={item.id === playerBoardId}
                    onClick={() => onPublishBoard?.(item.id)}
                  >
                    <Users size={14} />
                  </button>
                  <button type="button" title="Board settings" onClick={() => onBoardSelect?.(item.id)}><Settings size={14} /></button>
                  <button type="button" title="Duplicate board" onClick={() => onDuplicateBoard?.(item.id)}><Copy size={14} /></button>
                  <button type="button" title="Delete board" disabled={boards.length <= 1} onClick={() => onDeleteBoard?.(item)}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
            <article className="page-card add-page-card">
              <div className="add-page-heading">
                <Plus size={22} />
                <span>Add New Board</span>
              </div>
              <div className="add-page-actions">
                <button type="button" onClick={() => onAddBoard?.('square-5ft')}>5 ft Square Board</button>
                <button type="button" onClick={() => onAddBoard?.('hex-50ft')}>50 ft Hex Board</button>
                <button type="button" onClick={onImportBoard}>Import from Dungeon Builder</button>
                <button type="button" onClick={onImportFiveEToolsMap}>Import from 5e.tools</button>
              </div>
            </article>
          </div>
        </div>
      )}
    </header>
  );
}
