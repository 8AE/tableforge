export class ImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    Object.assign(this, details);
  }
}

export async function readImportResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ImportError(body?.code || `HTTP_${response.status}`, body?.error || `The request failed (HTTP ${response.status}). Try again.`, {
      requestId: body?.requestId, occurredAt: body?.occurredAt, url: body?.url, status: response.status,
    });
  }
  if (body === null) throw new ImportError('INVALID_RESPONSE', 'Tableforge returned an unreadable response. Reload the app and try again.');
  return body;
}

export async function requestImportJson(url, options = {}) {
  try {
    return await readImportResponse(await fetch(url, options));
  } catch (error) {
    if (error.code || error.name === 'AbortError') throw error;
    throw new ImportError('HOST_UNREACHABLE', 'Cannot reach the Tableforge host. Check that it is running, then try again.');
  }
}

export function describeImportError(error) {
  return {
    code: error?.code || 'IMPORT_FAILED',
    message: error?.message || 'The import failed. Try again.',
    requestId: error?.requestId,
    url: error?.url,
  };
}
