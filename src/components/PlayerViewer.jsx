import React, { useEffect, useState } from 'react';
import { BoardCanvas } from './BoardCanvas';
import { Topbar } from './Topbar';
import { getBoard, updateActiveBoard } from '../lib/board';

export function PlayerViewer({ state, projectId, updateProjectState }) {
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showZoom, setShowZoom] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const enterFullscreen = () => document.documentElement.requestFullscreen?.();
  const rotateBoard = (degrees) => setRotation((current) => (current + degrees + 360) % 360);
  const clampZoom = (value) => Math.max(0.4, Math.min(10, value));

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (['input', 'select', 'textarea'].includes(event.target?.tagName?.toLowerCase())) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom((current) => clampZoom(current + 0.1));
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom((current) => clampZoom(current - 0.1));
      }
      if (event.key === '0') {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
      <BoardCanvas board={board} view="player" tool="viewer" fitToViewport playerZoom={zoom} playerRotation={rotation} onToggleDoor={toggleDoor} />
      {state.diceRoll && <DiceOverlay roll={state.diceRoll} />}
    </section>
  );
}

function DiceOverlay({ roll }) {
  return (
    <div className="dice-overlay" key={roll.id}>
      <div className="dice-tray">
        {roll.rolls.map((value, index) => (
          <div className={`dice-cube dice-d${diceShape(roll.sides)}`} key={`${roll.id}-${index}`} style={{ '--delay': `${index * 90}ms` }}>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <strong>{roll.notation}: {roll.total}</strong>
    </div>
  );
}

function diceShape(sides) {
  if ([4, 6, 8, 10, 12, 20].includes(Number(sides))) return Number(sides);
  return 20;
}
