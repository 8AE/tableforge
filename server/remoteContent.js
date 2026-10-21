import { randomUUID } from 'node:crypto';
import { setDefaultAutoSelectFamily } from 'node:net';
import { ImportError } from '../src/lib/importErrors.js';

// Electron 28's Node 18 runtime otherwise tries only ::1 for localhost, which
// cannot reach a local installation bound to 127.0.0.1. Try both families.
setDefaultAutoSelectFamily(true);

export function remoteUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new ImportError('INVALID_URL', 'Enter a complete URL beginning with http:// or https://.', { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ImportError('INVALID_URL', 'Use an http:// or https:// URL without embedded login credentials.', { status: 400 });
  return url;
}

export function remoteErrorBody(error) {
  return {
    error: error.message || 'The import could not be completed. Try again.',
    code: error.code || 'IMPORT_FAILED',
    requestId: randomUUID().slice(0, 8),
    occurredAt: new Date().toISOString(),
    ...(error.url ? { url: error.url } : {}),
  };
}

export async function fetchRemote(value, { signal, maxBytes = 50 * 1024 * 1024, timeoutMs = Number(process.env.TABLEFORGE_REMOTE_TIMEOUT_MS) || 20000 } = {}) {
  const url = remoteUrl(value);
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) {
      await response.body?.cancel();
      const guidance = response.status === 404 ? 'The file was not found. Check the base URL and install or update the source data/images.'
        : [401, 403].includes(response.status) ? 'The source refused access. Use an accessible local installation or mirror.'
          : response.status === 429 ? 'The source is limiting requests. Wait briefly and retry.' : 'The source server returned an error. Try again later.';
      throw new ImportError(`SOURCE_HTTP_${response.status}`, `${guidance} (HTTP ${response.status})`, { status: 502, url: url.href });
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new ImportError('SOURCE_TOO_LARGE', `The source file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB. Choose a smaller asset.`, { status: 413, url: url.href });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new ImportError('SOURCE_TOO_LARGE', `The source file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB. Choose a smaller asset.`, { status: 413, url: url.href });
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), url: response.url || url.href, mimeType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '' };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (signal?.aborted) throw new ImportError('IMPORT_CANCELLED', 'The import was cancelled. No changes were saved.', { status: 499 });
    if (timeout.aborted) throw new ImportError('SOURCE_TIMEOUT', 'The source took too long to respond. Check that it is running, then retry.', { status: 504, url: url.href });
    throw new ImportError('SOURCE_UNREACHABLE', 'Cannot connect to the source. Check the URL, network, and that the local 5etools server is running.', { status: 502, url: url.href });
  }
}

export async function fetchRemoteJson(url, options) {
  const result = await fetchRemote(url, options);
  try { return JSON.parse(result.buffer.toString('utf8')); }
  catch { throw new ImportError('SOURCE_INVALID_JSON', 'The source returned a web page or invalid JSON instead of data. Use the 5etools site root URL and check its data files.', { status: 502, url: result.url }); }
}

export async function fetchRemoteImage(url, options) {
  const result = await fetchRemote(url, options);
  const bytes = result.buffer;
  const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? ['.png', 'image/png']
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? ['.jpg', 'image/jpeg']
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? ['.webp', 'image/webp'] : null;
  if (!format) throw new ImportError('SOURCE_NOT_IMAGE', 'The source did not return a supported PNG, JPEG, or WebP image. It may be an error or login page.', { status: 415, url: result.url });
  return { ...result, extension: format[0], mimeType: format[1] };
}
