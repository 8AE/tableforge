import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_KEY, makeProject, migrateState } from '../lib/board';

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

  const createProject = async (name) => {
    setError('');
    const project = makeProject(name.trim() || 'New Campaign');
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Unable to create project.');
      return;
    }
    const payload = await response.json();
    setSelectedProjectId(project.id);
    setPast([]);
    setFuture([]);
    commitPayload(payload);
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
    publishProjectToPlayers,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
