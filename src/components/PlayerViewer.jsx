import React, { useEffect, useState } from 'react';
import { BoardCanvas } from './BoardCanvas';
import { Topbar } from './Topbar';
import { getBoard, updateActiveBoard } from '../lib/board';

export function PlayerViewer({ state, projectId, updateProjectState }) {
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showNavigation, setShowNavigation] = useState(true);
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
  const toggleDoor = (id) => {
    if (!projectId || !updateProjectState) return;
    updateProjectState(projectId, (current) => updateActiveBoard(
      { ...current, activeBoardId: current.playerBoardId },
      (active) => ({
        ...active,
        doors: (active.doors || []).map((door) => {
          if (door.id !== id || door.state === 'locked' || door.isLocked) return door;
          return { ...door, state: door.state === 'open' ? 'closed' : 'open' };
        }),
      }),
    ));
  };

  return (
    <section className={`player-screen ${isFullscreen ? 'fullscreen-active' : ''}`}>
      <div className="top-hover-zone" />
      <Topbar
        board={board}
        mode="player"
        onFullscreen={enterFullscreen}
        onToggleNavigation={() => setShowNavigation((shown) => !shown)}
        navigationVisible={showNavigation}
        onRotateLeft={() => rotateBoard(-90)}
        onRotateRight={() => rotateBoard(90)}
      />
      <div className="map-viewport">
        <BoardCanvas board={board} view="player" tool="viewer" fitToViewport showNavigation={showNavigation} playerRotation={rotation} onToggleDoor={toggleDoor} />
      </div>
    </section>
  );
}
