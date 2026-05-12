import React, { useEffect, useState } from 'react';
import { BoardCanvas } from './BoardCanvas';
import { Topbar } from './Topbar';
import { getBoard } from '../lib/board';

export function PlayerViewer({ state }) {
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showZoom, setShowZoom] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const enterFullscreen = () => document.documentElement.requestFullscreen?.();
  const rotateBoard = (degrees) => setRotation((current) => (current + degrees + 360) % 360);

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
      <Topbar
        board={board}
        mode="player"
        onFullscreen={enterFullscreen}
        onToggleZoom={() => setShowZoom((shown) => !shown)}
        onRotateLeft={() => rotateBoard(-90)}
        onRotateRight={() => rotateBoard(90)}
      />
      {showZoom && (
        <div className="zoom-popover">
          <input type="range" min="0.4" max="10" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      )}
      <BoardCanvas board={board} view="player" tool="viewer" fitToViewport playerZoom={zoom} playerRotation={rotation} />
    </section>
  );
}
