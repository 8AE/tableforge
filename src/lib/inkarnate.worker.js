import { parseInkarnate } from './inkarnate.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: parseInkarnate(data.buffer, data.filename) }); }
  catch (error) { self.postMessage({ error: error.message || 'Unable to read this Inkarnate backup.' }); }
};
