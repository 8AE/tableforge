import { useEffect, useRef, useState } from 'react';
import { CHANNEL_KEY, STORAGE_KEY, migrateState, readInitialState } from '../lib/board';

export function useSyncedBoard() {
  const [state, setLocalState] = useState(readInitialState);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const channelRef = useRef(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_KEY);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'board-state') {
        setLocalState(migrateState(event.data.state));
      }
    };
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        setLocalState(migrateState(JSON.parse(event.newValue)));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      channel.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const publish = (next) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    channelRef.current?.postMessage({ type: 'board-state', state: next });
  };

  const setState = (updater, options = {}) => {
    setLocalState((current) => {
      const next = migrateState(typeof updater === 'function' ? updater(current) : updater);
      if (!options.skipHistory) {
        setPast((items) => [...items.slice(-39), current]);
        setFuture([]);
      }
      publish(next);
      return next;
    });
  };

  const undo = () => {
    setPast((items) => {
      if (!items.length) return items;
      const previous = items[items.length - 1];
      setLocalState((current) => {
        setFuture((futureItems) => [current, ...futureItems.slice(0, 39)]);
        publish(previous);
        return previous;
      });
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      if (!items.length) return items;
      const next = items[0];
      setLocalState((current) => {
        setPast((pastItems) => [...pastItems.slice(-39), current]);
        publish(next);
        return next;
      });
      return items.slice(1);
    });
  };

  return { state, setState, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
