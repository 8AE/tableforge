import { parseDungeonScrawl } from './dungeonScrawl.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: parseDungeonScrawl(data.buffer, data.filename) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Unable to read this Dungeon Scrawl file.' });
  }
};
