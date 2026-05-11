import React, { useEffect, useState } from 'react';
import { DungeonMasterPortal } from './components/DungeonMasterPortal';
import { PlayerViewer } from './components/PlayerViewer';
import { useSyncedBoard } from './hooks/useSyncedBoard';

export function App() {
  const {
    state,
    projects,
    openProjectId,
    isLoading,
    setState,
    createProject,
    openProject,
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
        <ProjectLauncher projects={projects} isLoading={isLoading} onCreateProject={createProject} onOpenProject={openProject} />
      ) : mode === 'dm' ? (
        <DungeonMasterPortal
          state={state}
          projects={projects}
          openProjectId={openProjectId}
          setState={setState}
          createProject={createProject}
          openProject={openProject}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      ) : (
        <PlayerViewer state={state} />
      )}
    </main>
  );
}

function ProjectLauncher({ projects, isLoading, onCreateProject, onOpenProject }) {
  const [name, setName] = useState('New Campaign');
  return (
    <section className="project-launcher">
      <div className="project-card">
        <strong>Open a project</strong>
        <span>Projects are saved on this host machine and shared with connected players.</span>
        {isLoading && <p>Loading projects...</p>}
        <div className="project-list">
          {projects.map((project) => (
            <button key={project.id} onClick={() => onOpenProject(project.id)}>
              {project.name}
            </button>
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
