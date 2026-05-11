import React, { useEffect, useState } from 'react';
import { DungeonMasterPortal } from './components/DungeonMasterPortal';
import { PlayerViewer } from './components/PlayerViewer';
import { useSyncedBoard } from './hooks/useSyncedBoard';

export function App() {
  const { state, setState, undo, redo, canUndo, canRedo } = useSyncedBoard();
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
        <DungeonMasterPortal state={state} setState={setState} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
      ) : (
        <PlayerViewer state={state} />
      )}
    </main>
  );
}
