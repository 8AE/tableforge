import React from 'react';
import { Expand, Search, Users } from 'lucide-react';
import { tileFeet } from '../lib/board';

export function Topbar({ board, mode, onFullscreen, onToggleZoom }) {
  const playerUrl = `${window.location.origin}${window.location.pathname}?view=player`;
  return (
    <header className="topbar">
      <div>
        <strong>{board.name}</strong>
        <span>{board.columns} x {board.rows} tiles · {tileFeet} ft grid</span>
      </div>
      <div className="top-actions">
        {mode === 'dm' && <a className="ghost-link" href={playerUrl} target="_blank" rel="noreferrer"><Users size={16} /> Open player viewer</a>}
        {mode === 'player' && <button onClick={onToggleZoom}><Search size={16} /> Zoom</button>}
        {mode === 'player' && <button onClick={onFullscreen}><Expand size={16} /> Full screen</button>}
      </div>
    </header>
  );
}
