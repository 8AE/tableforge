import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_KEY, makeProject, migrateState } from '../lib/board';
import { importFiveEToolsSelection, normalizeFiveEToolsBaseUrl } from '../lib/fiveETools';
import { makeDungeonScrawlBoard } from '../lib/dungeonScrawl';
import { renderDungeonScrawlPng } from '../lib/dungeonScrawlImage';
import { ImportError, requestImportJson } from '../lib/importErrors';
import { makeInkarnateBoard } from '../lib/inkarnate';
import { renderInkarnatePng } from '../lib/inkarnateImage';

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
  const saveInFlightRef = useRef(Promise.resolve());
  const payloadRevisionRef = useRef(0);
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
    const revision = payloadRevisionRef.current;
    const response = await fetch('/api/projects');
    const payload = await response.json();
    // A poll started before an import/save must not replace its newer result.
    if (revision === payloadRevisionRef.current) applyProjectPayload(payload);
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
    payloadRevisionRef.current += 1;
    applyProjectPayload(payload);
    channelRef.current?.postMessage({ type: 'projects', payload });
  };

  const saveProject = (project) => {
    const save = async () => {
      pendingSaveRef.current = project.id;
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || 'Unable to save project.');
        return { ok: false, error: body.error || 'Unable to save project.' };
      }
      const payload = await response.json();
      pendingSaveRef.current = null;
      commitPayload(payload);
      return { ok: true };
    };
    const promise = saveInFlightRef.current.then(save).catch((saveError) => {
      setError(saveError.message || 'Unable to save project.');
      return { ok: false, error: saveError.message || 'Unable to save project.' };
    });
    saveInFlightRef.current = promise;
    return promise;
  };

  const persistProject = (project) => {
    pendingSaveRef.current = project.id;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveProject(project);
    }, 250);
  };

  const flushProjectSave = async (projectId) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const latest = projectsRef.current.find((item) => item.id === projectId);
      if (latest) await saveProject(latest);
    }
    const result = await saveInFlightRef.current;
    if (result?.ok === false) throw new ImportError('CAMPAIGN_SAVE_FAILED', result.error || 'Save the campaign before importing.');
  };

  const importMapsIntoProject = async (project, maps, options = {}) => {
    if (project) await flushProjectSave(project.id);
    pendingSaveRef.current = project?.id || null;
    try {
      const result = await importFiveEToolsSelection({
        projectId: project?.id, campaignName: options.campaignName, maps,
        baseUrl: options.baseUrl, useRegionWalls: options.useRegionWalls,
      }, { signal: options.signal, onProgress: options.onProgress });
      pendingSaveRef.current = null;
      commitPayload(result.payload);
      return result;
    } finally { pendingSaveRef.current = null; }
  };

  const importBestiaryToken = async (token, { signal } = {}) => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) throw new ImportError('CAMPAIGN_NOT_FOUND', 'Open a campaign before saving a token.');
    await flushProjectSave(projectId);
    pendingSaveRef.current = projectId;
    try {
      const result = await requestImportJson(`/api/projects/${encodeURIComponent(projectId)}/tokens/remote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal,
      });
      pendingSaveRef.current = null;
      commitPayload(result.payload);
      return result;
    } finally { pendingSaveRef.current = null; }
  };

  const createProject = async (name, options = {}) => {
    setError('');
    if (options.maps?.length) {
      const result = await importMapsIntoProject(null, options.maps, { ...options, campaignName: name.trim() || 'New Campaign' });
      setSelectedProjectId(result.projectId);
      setPast([]);
      setFuture([]);
      return result;
    }
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

  const importMapFile = async (map, options = {}, { renderImage, makeBoard, endpoint }) => {
    setError('');
    const projectId = options.createCampaign ? null : selectedProjectIdRef.current;
    if (!options.createCampaign && !projectId) return { ok: false, error: 'Open a campaign before importing a map.' };
    try {
      // Render before changing campaign state. A failed image decode leaves the
      // campaign untouched. Drain delayed saves before the atomic board import.
      const image = await renderImage(map);
      const project = projectsRef.current.find((item) => item.id === projectId);
      const previousState = project?.state;
      const pendingProject = projectsRef.current.find((item) => item.id === pendingSaveRef.current);
      if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      const inFlight = await saveInFlightRef.current;
      if (inFlight?.ok === false && !pendingProject) throw new Error(inFlight.error);
      if (pendingProject) {
        const saved = await saveProject(pendingProject);
        if (!saved.ok) throw new Error(saved.error);
      }
      const board = makeBoard(map, '', options);
      const form = new FormData();
      form.append('file', image);
      form.append('board', JSON.stringify(board));
      if (projectId) form.append('projectId', projectId);
      else form.append('campaignName', options.campaignName?.trim() || board.name);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to save the imported map.');
      pendingSaveRef.current = null;
      commitPayload(payload);
      setSelectedProjectId(payload.importedProjectId);
      setPast((items) => previousState ? [...items.slice(-39), previousState] : []);
      setFuture([]);
      return { ok: true, assets: payload.assets, boardId: payload.importedBoardId };
    } catch (importError) {
      return { ok: false, error: importError.message || 'Unable to import this map.' };
    }
  };

  const importDungeonScrawl = (map, options) => importMapFile(map, options, { renderImage: renderDungeonScrawlPng, makeBoard: makeDungeonScrawlBoard, endpoint: '/api/dungeon-scrawl/import' });
  const importInkarnate = (map, options) => importMapFile(map, options, { renderImage: renderInkarnatePng, makeBoard: makeInkarnateBoard, endpoint: '/api/inkarnate/import' });

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
    importBestiaryToken,
    importDungeonScrawl,
    importInkarnate,
    publishProjectToPlayers,
    updateProjectState,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
