import React, { useEffect, useState } from 'react';
import { BoardCanvas } from './BoardCanvas';
import { Topbar } from './Topbar';
import { getBoard } from '../lib/board';

export function PlayerViewer({ state }) {
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showZoom, setShowZoom] = useState(false);
  const [zoom, setZoom] = useState(1);
  const enterFullscreen = () => document.documentElement.requestFullscreen?.();

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  if (!state) {
    return (
      <section className="player-screen empty-player">
        <div>
          <strong>No project open</strong>
          <span>The DM needs to open a project before the table display can show a board.</span>
        </div>
      </section>
    );
  }

  const board = getBoard(state, state.playerBoardId);

  return (
    <section className={`player-screen ${isFullscreen ? 'fullscreen-active' : ''}`}>
      <div className="top-hover-zone" />
      <Topbar board={board} mode="player" onFullscreen={enterFullscreen} onToggleZoom={() => setShowZoom((shown) => !shown)} />
      {showZoom && (
        <div className="zoom-popover">
          <input type="range" min="0.4" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      )}
      <BoardCanvas board={board} view="player" tool="viewer" fitToViewport playerZoom={zoom} />
    </section>
  );
}
