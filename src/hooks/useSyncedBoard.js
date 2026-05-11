import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_KEY, makeProject, migrateState } from '../lib/board';

export function useSyncedBoard() {
  const [projects, setProjects] = useState([]);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const channelRef = useRef(null);
  const saveTimerRef = useRef(null);
  const state = projects.find((project) => project.id === openProjectId)?.state || null;

  const applyProjectPayload = useCallback((payload) => {
    setProjects(payload.projects || []);
    setOpenProjectId(payload.openProjectId || null);
    setIsLoading(false);
  }, []);

  const fetchProjects = useCallback(async () => {
    const response = await fetch('/api/projects');
    applyProjectPayload(await response.json());
  }, [applyProjectPayload]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_KEY);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'projects') {
        applyProjectPayload(event.data.payload);
      }
    };
    fetchProjects().catch(() => setIsLoading(false));
    const poll = window.setInterval(() => {
      fetchProjects().catch(() => {});
    }, 1500);
    return () => {
      channel.close();
      window.clearInterval(poll);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [applyProjectPayload, fetchProjects]);

  const persistProject = (project) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      const payload = await response.json();
      channelRef.current?.postMessage({ type: 'projects', payload });
    }, 180);
  };

  const createProject = async (name) => {
    const project = makeProject(name);
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    const payload = await response.json();
    applyProjectPayload(payload);
    channelRef.current?.postMessage({ type: 'projects', payload });
  };

  const openProject = async (id) => {
    const response = await fetch(`/api/projects/${id}/open`, { method: 'POST' });
    const payload = await response.json();
    applyProjectPayload(payload);
    setPast([]);
    setFuture([]);
    channelRef.current?.postMessage({ type: 'projects', payload });
  };

  const publishProject = (nextState) => {
    const nextProject = projects.find((project) => project.id === openProjectId);
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
    publishProject(next);
  };

  const undo = () => {
    setPast((items) => {
      if (!items.length || !state) return items;
      const previous = items[items.length - 1];
      setFuture((futureItems) => [state, ...futureItems.slice(0, 39)]);
      publishProject(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      if (!items.length || !state) return items;
      const next = items[0];
      setPast((pastItems) => [...pastItems.slice(-39), state]);
      publishProject(next);
      return items.slice(1);
    });
  };

  return {
    state,
    projects,
    openProjectId,
    isLoading,
    setState,
    createProject,
    openProject,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
