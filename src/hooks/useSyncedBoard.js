import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_KEY, makeProject, migrateState } from '../lib/board';
import { makeFiveEToolsMapBoard, normalizeFiveEToolsBaseUrl } from '../lib/fiveETools';

function isNewer(a, b) {
  return new Date(a?.updatedAt || 0).getTime() > new Date(b?.updatedAt || 0).getTime();
}

export function useSyncedBoard() {
  const [projects, setProjects] = useState([]);
  const [playerProjectId, setPlayerProjectId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const channelRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null);
  const projectsRef = useRef(projects);
  const selectedProjectIdRef = useRef(selectedProjectId);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const state = projects.find((project) => project.id === selectedProjectId)?.state || null;
  const playerState = projects.find((project) => project.id === playerProjectId)?.state || null;

  const mergeProjects = useCallback((incomingProjects) => {
    const current = projectsRef.current;
    return incomingProjects.map((incoming) => {
      const local = current.find((project) => project.id === incoming.id);
      if (pendingSaveRef.current === incoming.id && local && isNewer(local, incoming)) return local;
      return incoming;
    });
  }, []);

  const applyProjectPayload = useCallback((payload) => {
    const incomingProjects = (payload.projects || []).map((project) => ({
      ...project,
      state: migrateState(project.state),
    }));
    setProjects(mergeProjects(incomingProjects));
    setPlayerProjectId(payload.openProjectId || null);
    setIsLoading(false);
  }, [mergeProjects]);

  const fetchProjects = useCallback(async () => {
    const response = await fetch('/api/projects');
    applyProjectPayload(await response.json());
  }, [applyProjectPayload]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_KEY);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'projects') applyProjectPayload(event.data.payload);
    };
    fetchProjects().catch(() => setIsLoading(false));
    const poll = window.setInterval(() => {
      fetchProjects().catch(() => {});
    }, 2500);
    return () => {
      channel.close();
      window.clearInterval(poll);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [applyProjectPayload, fetchProjects]);

  const commitPayload = (payload) => {
    applyProjectPayload(payload);
    channelRef.current?.postMessage({ type: 'projects', payload });
  };

  const saveProject = async (project) => {
    pendingSaveRef.current = project.id;
    const response = await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Unable to save project.');
      return;
    }
    const payload = await response.json();
    pendingSaveRef.current = null;
    commitPayload(payload);
  };

  const persistProject = (project) => {
    pendingSaveRef.current = project.id;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => saveProject(project), 250);
  };

  const importMapsIntoProject = async (project, maps, options = {}) => {
    const mapList = Array.from(maps || []).filter((map) => map?.imageUrl);
    if (!mapList.length) return { ok: false, error: 'Select at least one map to import.' };

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = project.id;

    try {
      let assets = Array.isArray(project.assets) ? project.assets : [];
      const importedBoards = [];

      for (let index = 0; index < mapList.length; index += 1) {
        const map = mapList[index];
        options.onProgress?.({ completed: index, total: mapList.length, map });
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/remote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: map.imageUrl,
            name: map.displayTitle || 'Imported Map',
            category: 'map',
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Unable to import ${map.displayTitle || 'map'}.`);
        assets = body.assets || assets;
        importedBoards.push(makeFiveEToolsMapBoard(map, body.asset.path));
      }

      const firstImportedBoard = importedBoards[0];
      const replaceBoards = Boolean(options.replaceBoards);
      const nextState = migrateState({
        ...project.state,
        fiveEToolsBaseUrl: normalizeFiveEToolsBaseUrl(options.baseUrl || project.state?.fiveEToolsBaseUrl),
        boards: replaceBoards ? importedBoards : [...(project.state?.boards || []), ...importedBoards],
        activeBoardId: firstImportedBoard.id,
        playerBoardId: replaceBoards ? firstImportedBoard.id : project.state?.playerBoardId,
      });
      const updatedProject = {
        ...project,
        state: nextState,
        assets,
        updatedAt: new Date().toISOString(),
      };
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProject),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to save the imported maps.');

      options.onProgress?.({ completed: mapList.length, total: mapList.length, map: null });
      pendingSaveRef.current = null;
      commitPayload(payload);
      return { ok: true, assets, importedBoards, payload };
    } catch (importError) {
      pendingSaveRef.current = null;
      const message = importError.message || 'Unable to import 5e.tools maps.';
      setError(message);
      return { ok: false, error: message };
    }
  };

  const createProject = async (name, options = {}) => {
    setError('');
    const project = makeProject(name.trim() || 'New Campaign');
    if (options.baseUrl) {
      project.state.fiveEToolsBaseUrl = normalizeFiveEToolsBaseUrl(options.baseUrl);
    }
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Unable to create project.');
      return { ok: false, error: body.error || 'Unable to create project.' };
    }
    const payload = await response.json();
    if (options.maps?.length) {
      const result = await importMapsIntoProject(project, options.maps, {
        baseUrl: options.baseUrl,
        replaceBoards: true,
        onProgress: options.onProgress,
      });
      if (!result.ok) return { ...result, projectCreated: true, projectId: project.id };
      setSelectedProjectId(project.id);
      setPast([]);
      setFuture([]);
      return { ...result, projectId: project.id };
    }
    setSelectedProjectId(project.id);
    setPast([]);
    setFuture([]);
    commitPayload(payload);
    return { ok: true, projectId: project.id };
  };

  const importFiveEToolsMaps = async (maps, options = {}) => {
    setError('');
    const projectId = options.projectId || selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return { ok: false, error: 'Open a campaign before importing 5e.tools maps.' };
    const previousState = project.state;
    const result = await importMapsIntoProject(project, maps, options);
    if (result.ok) {
      setPast((items) => [...items.slice(-39), previousState]);
      setFuture([]);
    }
    return result;
  };

  const openProject = async (id) => {
    setSelectedProjectId(id);
    setPast([]);
    setFuture([]);
  };

  const leaveProject = () => {
    setSelectedProjectId(null);
    setPast([]);
    setFuture([]);
  };

  const renameProject = async (id, name) => {
    setError('');
    const project = projectsRef.current.find((item) => item.id === id);
    if (!project) return;
    await saveProject({ ...project, name: name.trim(), updatedAt: new Date().toISOString() });
  };

  const deleteProject = async (id) => {
    setError('');
    const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Unable to delete project.');
      return;
    }
    const payload = await response.json();
    if (selectedProjectIdRef.current === id) setSelectedProjectId(null);
    setPast([]);
    setFuture([]);
    commitPayload(payload);
  };

  const deleteBoard = async (projectId, boardId) => {
    if (!projectId || !boardId) return { ok: false, error: 'No board selected.' };
    setError('');
    const response = await fetch(`/api/projects/${projectId}/boards/${boardId}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || 'Unable to delete board.';
      setError(message);
      return { ok: false, error: message };
    }
    if (selectedProjectIdRef.current === projectId) {
      setPast([]);
      setFuture([]);
    }
    commitPayload(payload);
    return { ok: true };
  };

  const updateProjectState = (projectId, updater) => {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    const nextState = migrateState(typeof updater === 'function' ? updater(project.state) : updater);
    const updatedProject = { ...project, state: nextState, updatedAt: new Date().toISOString() };
    setProjects((items) => items.map((item) => item.id === updatedProject.id ? updatedProject : item));
    persistProject(updatedProject);
  };

  const importProject = async (file, options = {}) => {
    if (!file) return { ok: false };
    setError('');
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`/api/projects/import?overwrite=${options.overwrite ? 'true' : 'false'}`, {
      method: 'POST',
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) {
      return { ok: false, conflict: body.conflict || null, error: body.error || 'Project already exists.' };
    }
    if (!response.ok) {
      const message = body.error || 'Unable to import project.';
      setError(message);
      return { ok: false, error: message };
    }
    setSelectedProjectId(body.importedProjectId || null);
    setPast([]);
    setFuture([]);
    commitPayload(body);
    return { ok: true, importedProjectId: body.importedProjectId };
  };

  const publishProjectToPlayers = async (id = selectedProjectId) => {
    if (!id) return;
    const response = await fetch(`/api/projects/${id}/open`, { method: 'POST' });
    const payload = await response.json();
    commitPayload(payload);
  };

  const publishProjectState = (nextState) => {
    const nextProject = projectsRef.current.find((project) => project.id === selectedProjectIdRef.current);
    if (!nextProject) return;
    const updatedProject = { ...nextProject, state: nextState, updatedAt: new Date().toISOString() };
    setProjects((items) => items.map((project) => project.id === updatedProject.id ? updatedProject : project));
    persistProject(updatedProject);
  };

  const setState = (updater, options = {}) => {
    if (!state) return;
    const current = state;
    const next = migrateState(typeof updater === 'function' ? updater(current) : updater);
    if (!options.skipHistory) {
      setPast((items) => [...items.slice(-39), current]);
      setFuture([]);
    }
    publishProjectState(next);
  };

  const undo = () => {
    setPast((items) => {
      if (!items.length || !state) return items;
      const previous = items[items.length - 1];
      setFuture((futureItems) => [state, ...futureItems.slice(0, 39)]);
      publishProjectState(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      if (!items.length || !state) return items;
      const next = items[0];
      setPast((pastItems) => [...pastItems.slice(-39), state]);
      publishProjectState(next);
      return items.slice(1);
    });
  };

  return {
    state,
    playerState,
    projects,
    selectedProjectId,
    playerProjectId,
    isLoading,
    error,
    setState,
    createProject,
    openProject,
    leaveProject,
    renameProject,
    deleteProject,
    deleteBoard,
    importProject,
    importFiveEToolsMaps,
    publishProjectToPlayers,
    updateProjectState,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
