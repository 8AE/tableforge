import React, { useEffect, useState } from 'react';
import { DungeonBuilder } from './components/DungeonBuilder';
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
    importProject,
    publishProjectToPlayers,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSyncedBoard();
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get('view') === 'player' ? 'player' : 'dm');
  const [workspace, setWorkspace] = useState('tableforge');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === 'player') url.searchParams.set('view', 'player');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url);
  }, [mode]);

  return (
    <main className={`app app-${mode}`}>
      {workspace === 'dungeon' ? (
        <DungeonBuilder onBack={() => setWorkspace('tableforge')} />
      ) : mode === 'dm' && !state ? (
        <ProjectLauncher
          projects={projects}
          isLoading={isLoading}
          error={error}
          onCreateProject={createProject}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onImportProject={importProject}
          onOpenDungeonBuilder={() => setWorkspace('dungeon')}
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
          onOpenDungeonBuilder={() => setWorkspace('dungeon')}
        />
      ) : (
        <PlayerViewer state={playerState} />
      )}
    </main>
  );
}

function ProjectLauncher({ projects, isLoading, error, onCreateProject, onOpenProject, onRenameProject, onDeleteProject, onImportProject, onOpenDungeonBuilder }) {
  const [name, setName] = useState('New Campaign');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importConflict, setImportConflict] = useState(null);
  const [importMessage, setImportMessage] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const importSelectedFile = async (file, overwrite = false) => {
    if (!file) return;
    setIsImporting(true);
    setImportMessage('');
    const result = await onImportProject(file, { overwrite });
    setIsImporting(false);
    if (result.ok) {
      setImportFile(null);
      setImportConflict(null);
      setImportMessage('Campaign imported.');
      return;
    }
    if (result.conflict) {
      setImportFile(file);
      setImportConflict(result.conflict);
      return;
    }
    setImportMessage(result.error || 'Unable to import campaign.');
  };

  const handleImportChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) importSelectedFile(file, false);
  };

  return (
    <section className="project-launcher">
      <div className="project-card">
        <div className="project-card-header">
          <div>
            <strong>Open a project</strong>
            <span>Projects are saved on this host machine and shared with connected players.</span>
          </div>
          <button className="project-builder-button" onClick={onOpenDungeonBuilder}>Dungeon & Map Builder</button>
          <label className="project-import-button">
            Import Campaign
            <input type="file" accept=".zip,application/zip" onChange={handleImportChange} disabled={isImporting} />
          </label>
        </div>
        {isLoading && <p>Loading projects...</p>}
        {error && <p className="form-error">{error}</p>}
        {importMessage && <p className={importMessage.includes('imported') ? 'form-success' : 'form-error'}>{importMessage}</p>}
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
              <a href={`/api/projects/${encodeURIComponent(project.id)}/export`} download={`${project.name}.zip`}>Export</a>
              <button className="danger-text" onClick={() => onDeleteProject(project.id)}>Delete</button>
            </div>
          ))}
        </div>
        <div className="project-create">
          <input value={name} onChange={(event) => setName(event.target.value)} />
          <button onClick={() => onCreateProject(name || 'New Campaign')}>Create project</button>
        </div>
      </div>
      {importConflict && (
        <div className="project-conflict-overlay" role="dialog" aria-modal="true" aria-label="Project import conflict">
          <div className="project-conflict-modal">
            <strong>Project Already Exists!</strong>
            <p>
              A project named {importConflict.name} ({importConflict.id}) already exists. Importing this file will overwrite all existing data,
              including tokens, maps, and local audio for this campaign.
            </p>
            <div className="project-conflict-actions">
              <button className="danger-text" disabled={isImporting} onClick={() => importSelectedFile(importFile, true)}>Overwrite and Replace</button>
              <button onClick={() => { setImportConflict(null); setImportFile(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
