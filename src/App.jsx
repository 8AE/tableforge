import React, { useEffect, useState } from 'react';
import { DungeonMasterPortal } from './components/DungeonMasterPortal';
import { PlayerViewer } from './components/PlayerViewer';
import { useSyncedBoard } from './hooks/useSyncedBoard';

export function App() {
  const {
    state,
    playerState,
    projects,
    selectedProjectId,
    isLoading,
    error,
    setState,
    createProject,
    openProject,
    leaveProject,
    renameProject,
    deleteProject,
    publishProjectToPlayers,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSyncedBoard();
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get('view') === 'player' ? 'player' : 'dm');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === 'player') url.searchParams.set('view', 'player');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url);
  }, [mode]);

  return (
    <main className={`app app-${mode}`}>
      {mode === 'dm' && !state ? (
        <ProjectLauncher
          projects={projects}
          isLoading={isLoading}
          error={error}
          onCreateProject={createProject}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
        />
      ) : mode === 'dm' ? (
        <DungeonMasterPortal
          state={state}
          projects={projects}
          openProjectId={selectedProjectId}
          setState={setState}
          createProject={createProject}
          openProject={openProject}
          leaveProject={leaveProject}
          publishProjectToPlayers={publishProjectToPlayers}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      ) : (
        <PlayerViewer state={playerState} />
      )}
    </main>
  );
}

function ProjectLauncher({ projects, isLoading, error, onCreateProject, onOpenProject, onRenameProject, onDeleteProject }) {
  const [name, setName] = useState('New Campaign');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  return (
    <section className="project-launcher">
      <div className="project-card">
        <strong>Open a project</strong>
        <span>Projects are saved on this host machine and shared with connected players.</span>
        {isLoading && <p>Loading projects...</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="project-list">
          {projects.map((project) => (
            <div className="project-row" key={project.id}>
              {editingId === project.id ? (
                <input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
              ) : (
                <button onClick={() => onOpenProject(project.id)}>{project.name}</button>
              )}
              {editingId === project.id ? (
                <button onClick={() => { onRenameProject(project.id, editingName); setEditingId(null); }}>Save</button>
              ) : (
                <button onClick={() => { setEditingId(project.id); setEditingName(project.name); }}>Rename</button>
              )}
              <button className="danger-text" onClick={() => onDeleteProject(project.id)}>Delete</button>
            </div>
          ))}
        </div>
        <div className="project-create">
          <input value={name} onChange={(event) => setName(event.target.value)} />
          <button onClick={() => onCreateProject(name || 'New Campaign')}>Create project</button>
        </div>
      </div>
    </section>
  );
}
