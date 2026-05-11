import React, { useEffect, useState } from 'react';
import { BoardCanvas } from './BoardCanvas';
import { Topbar } from './Topbar';
import { getBoard } from '../lib/board';

export function PlayerViewer({ state }) {
  const board = getBoard(state, state.playerBoardId);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const enterFullscreen = () => document.documentElement.requestFullscreen?.();

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  return (
    <section className={`player-screen ${isFullscreen ? 'fullscreen-active' : ''}`}>
      <div className="top-hover-zone" />
      <Topbar board={board} mode="player" onFullscreen={enterFullscreen} />
      <BoardCanvas board={board} view="player" tool="viewer" fitToViewport />
    </section>
  );
}
