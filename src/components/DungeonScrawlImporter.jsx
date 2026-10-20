import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileUp, X } from 'lucide-react';
import { MAX_DS_BYTES } from '../lib/dungeonScrawl.js';

export function DungeonScrawlImporter({ onImport, onClose, createCampaign = false }) {
  const [document, setDocument] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [lightingEnabled, setLightingEnabled] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);
  const workerRef = useRef(null);
  const dialogRef = useRef(null);
  const map = document?.maps.find((item) => item.id === selectedId);

  useEffect(() => {
    const previousFocus = window.document.activeElement;
    fileRef.current?.focus();
    return () => { workerRef.current?.terminate(); previousFocus?.focus?.(); };
  }, []);

  useEffect(() => {
    if (!map?.svg) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(new Blob([map.svg], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [map]);

  const chooseFile = async (file) => {
    if (!file || busy) return;
    setError('');
    setDocument(null);
    if (!/\.ds$/i.test(file.name)) { setError('Choose a Dungeon Scrawl save file ending in .ds.'); return; }
    if (file.size > MAX_DS_BYTES) { setError('Choose a .ds file smaller than 50 MB.'); return; }
    setBusy(true);
    setStatus('Reading map geometry and embedded images…');
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../lib/dungeonScrawl.worker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('This map took too long to read. Try saving a smaller map.')); }, 30000);
        const finish = () => { window.clearTimeout(timer); worker.terminate(); workerRef.current = null; };
        worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
        worker.onerror = () => { finish(); reject(new Error('The map reader could not start. Reload Tableforge and try again.')); };
        worker.postMessage({ buffer, filename: file.name }, [buffer]);
      });
      const first = result.maps.find((item) => item.id === result.selectedPageId && !item.error) || result.maps.find((item) => !item.error);
      setDocument(result);
      setSelectedId(first.id);
      setName(first.name);
      setCampaignName(first.name);
      setStatus('Map ready to import.');
    } catch (readError) {
      setError(readError.message || 'Unable to read this .ds file.');
      setStatus('');
    } finally { setBusy(false); }
  };

  const importMap = async () => {
    if (!map || map.error || busy) return;
    setBusy(true);
    setError('');
    setStatus('Rendering and saving your board…');
    try {
      const result = await onImport(map, { name, campaignName, lightingEnabled });
      if (!result?.ok) throw new Error(result?.error || 'Unable to save the imported board.');
      onClose();
    } catch (importError) {
      setError(importError.message || 'Unable to import this map.');
      setStatus('');
    } finally { setBusy(false); }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return (
    <div className="library-overlay" role="dialog" aria-modal="true" aria-labelledby="scrawl-title" onKeyDown={handleKeyDown} ref={dialogRef}>
      <div className="library-modal scrawl-import-modal" aria-busy={busy}>
        <header className="library-modal-header">
          <div><strong id="scrawl-title">Import from Dungeon Scrawl</strong><span>Your map, walls, doors and lights, ready for the table.</span></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close Dungeon Scrawl import"><X size={18} /></button>
        </header>
        <div className="scrawl-import-content">
          <p>Build your map in <a href="https://app.dungeonscrawl.com/" target="_blank" rel="noreferrer">Dungeon Scrawl <ExternalLink size={13} /></a>, choose <strong>File → Save</strong>, then import the <strong>.ds</strong> file here.</p>
          <div className="scrawl-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}>
            <FileUp size={28} aria-hidden="true" />
            <label htmlFor="scrawl-file">Choose a .ds file or drop it here</label>
            <input ref={fileRef} id="scrawl-file" type="file" accept=".ds" disabled={busy} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
            <small>Square-grid maps · up to 50 MB · no image export needed</small>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="scrawl-status" role="status" aria-live="polite">{status}</p>
          {document && (
            <>
              {document.maps.length > 1 && <label>Map in this file<select value={selectedId} disabled={busy} onChange={(event) => { const next = document.maps.find((item) => item.id === event.target.value); setSelectedId(next.id); setName(next.name); }}>
                {document.maps.map((item) => <option key={item.id} value={item.id} disabled={Boolean(item.error)}>{item.name}{item.error ? ' (unavailable)' : ''}</option>)}
              </select></label>}
              {document.maps.filter((item) => item.error).map((item) => <p className="form-error" key={item.id}>{item.name}: {item.error}</p>)}
              {preview && <div className="scrawl-preview"><img src={preview} alt={`Preview of ${map.name}`} />
                {map.doors.length > 0 && <svg viewBox={`0 0 ${map.columns} ${map.rows}`} aria-hidden="true">{map.doors.map((door, i) => <line key={i} x1={door.lightingSegment[0][0]} y1={door.lightingSegment[0][1]} x2={door.lightingSegment[1][0]} y2={door.lightingSegment[1][1]} stroke="#ad783b" strokeWidth="0.15" />)}</svg>}
              </div>}
              {map && !map.error && <>
                <p className="scrawl-stats">{map.columns} × {map.rows} cells · {map.walls.length} walls · {map.doors.length} doors · {map.lights.length} lights · {map.imageCount} embedded images</p>
                <label>Board name<input value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
                {createCampaign && <label>Campaign name<input value={campaignName} maxLength={120} disabled={busy} onChange={(event) => setCampaignName(event.target.value)} /></label>}
                <label className="check-row"><input type="checkbox" checked={lightingEnabled} disabled={busy} onChange={(event) => setLightingEnabled(event.target.checked)} />Enable dynamic lighting</label>
                <p className="empty-note">{lightingEnabled ? 'Players see lit areas and token vision. Add a token with vision to explore unlit rooms.' : 'The whole map is visible. Imported walls and lights are ready when you enable lighting.'} {!map.lights.length && 'This map has no saved light sources.'}</p>
                {map.warnings.length > 0 && <div className="scrawl-warnings"><strong>Import notes</strong><ul>{map.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
              </>}
            </>
          )}
        </div>
        <footer className="scrawl-actions">
          <button className="command" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="command accent" type="button" disabled={busy || !map || Boolean(map.error)} onClick={importMap}>{busy ? 'Working…' : createCampaign ? 'Create campaign with this map' : 'Import as new board'}</button>
        </footer>
      </div>
    </div>
  );
}
