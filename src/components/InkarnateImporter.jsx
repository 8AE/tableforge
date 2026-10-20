import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileUp, X } from 'lucide-react';
import { MAX_INK_BYTES, prepareInkarnateMap } from '../lib/inkarnate.js';

export function InkarnateImporter({ onImport, onClose, createCampaign = false }) {
  const [document, setDocument] = useState(null);
  const [name, setName] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [estimateObjects, setEstimateObjects] = useState(true);
  const [lightingEnabled, setLightingEnabled] = useState(true);
  const [columns, setColumns] = useState('');
  const [showGeometry, setShowGeometry] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null), dialogRef = useRef(null), workerRef = useRef(null);
  const { map, layoutError } = useMemo(() => {
    if (!document) return {};
    try { return { map: prepareInkarnateMap(document, { estimateObjects, ...(columns === '' ? {} : { cellsAcross: Number(columns) }) }) }; }
    catch (error) { return { layoutError: error.message }; }
  }, [document, estimateObjects, columns]);

  useEffect(() => {
    const previous = window.document.activeElement;
    fileRef.current?.focus();
    return () => { workerRef.current?.terminate(); previous?.focus?.(); };
  }, []);

  const chooseFile = async (file) => {
    if (!file || busy) return;
    setDocument(null); setError(''); setStatus(''); setColumns('');
    if (!/\.(?:ink|json)$/i.test(file.name)) { setError('Choose an Inkarnate offline backup ending in .ink or .json.'); return; }
    if (file.size > MAX_INK_BYTES) { setError('Choose an Inkarnate backup smaller than 100 MB.'); return; }
    setBusy(true); setStatus('Reading the map, grid and object history…');
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../lib/inkarnate.worker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        const finish = () => { window.clearTimeout(timer); worker.terminate(); workerRef.current = null; };
        const timer = window.setTimeout(() => { finish(); reject(new Error('This backup took too long to read. Save a smaller map.')); }, 30000);
        worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
        worker.onerror = () => { finish(); reject(new Error('The Inkarnate reader could not start. Reload Tableforge and try again.')); };
        worker.postMessage({ buffer, filename: file.name }, [buffer]);
      });
      // Decode before offering import; a corrupt embedded preview must never
      // create a campaign with a missing background.
      const image = new Image(); image.src = result.image;
      try { await image.decode(); } catch { throw new Error('The backup contains a damaged map image. Save a new offline backup.'); }
      setDocument(result); setName(result.name); setCampaignName(result.name); setStatus('Map ready. Review the overlay, then import.');
    } catch (error) { setError(error.message || 'Unable to read this Inkarnate backup.'); setStatus(''); }
    finally { setBusy(false); }
  };

  const importMap = async () => {
    if (!map || busy) return;
    setBusy(true); setError(''); setStatus('Saving your map and lighting…');
    try {
      const result = await onImport(map, { name, campaignName, lightingEnabled });
      if (!result?.ok) throw new Error(result?.error || 'Unable to save this board.');
      onClose();
    } catch (error) { setError(error.message); setStatus(''); }
    finally { setBusy(false); }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')];
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="library-overlay" role="dialog" aria-modal="true" aria-labelledby="inkarnate-title" onKeyDown={handleKeyDown} ref={dialogRef}>
    <div className="library-modal scrawl-import-modal" aria-busy={busy}>
      <header className="library-modal-header">
        <div><strong id="inkarnate-title">Import from Inkarnate</strong><span>Your map artwork, grid and lighting setup.</span></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close Inkarnate import"><X size={18} /></button>
      </header>
      <div className="scrawl-import-content">
        <p>In <a href="https://inkarnate.com/" target="_blank" rel="noreferrer">Inkarnate <ExternalLink size={13} /></a>, open your map and choose <strong>Save Offline Backup</strong> from its menu. Import the <strong>.ink</strong> file here.</p>
        <div className="scrawl-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}>
          <FileUp size={28} aria-hidden="true" />
          <label htmlFor="inkarnate-file">Choose an .ink file or drop it here</label>
          <input id="inkarnate-file" ref={fileRef} type="file" accept=".ink,.json" disabled={busy} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
          <small>Current Inkarnate backups · up to 100 MB · saved map image included</small>
        </div>
        {(error || layoutError) && <p className="form-error" role="alert">{error || layoutError}</p>}
        <p className="scrawl-status" role="status" aria-live="polite">{status}</p>
        {document && <>
          <div className="inkarnate-options">
            <label className="check-row"><input type="checkbox" checked={estimateObjects} disabled={busy} onChange={(event) => setEstimateObjects(event.target.checked)} />Estimate blockers and lights from stamps</label>
            <label className="check-row"><input type="checkbox" checked={showGeometry} onChange={(event) => setShowGeometry(event.target.checked)} />Show walls and lights in preview</label>
            <label>Grid columns (optional)<input type="number" min="4" max="200" step="1" placeholder={`Saved grid: ${Math.round(document.width / document.cell)}`} value={columns} disabled={busy} onChange={(event) => setColumns(event.target.value)} /></label>
          </div>
          {map && <>
            <div className="inkarnate-preview">
              <svg width={map.columns * 10} height={map.rows * 10} viewBox={`0 0 ${map.columns} ${map.rows}`} role="img" aria-label={`Preview of ${map.name}`}>
                <image href={map.image} x={map.imageRect.x} y={map.imageRect.y} width={map.imageRect.width} height={map.imageRect.height} preserveAspectRatio="none" />
                {showGeometry && <g>{map.walls.map((wall, i) => <line key={i} x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} stroke={wall.estimated ? '#ffcf70' : '#58dcff'} strokeWidth="0.075" />)}
                  {map.lights.map((light, i) => <g key={i}><circle cx={light.x} cy={light.y} r={light.radiusFeet / 5} fill="#ffd36b" fillOpacity="0.15" stroke="#ffd36b" strokeWidth="0.06" strokeDasharray="0.2 0.15" /><circle cx={light.x} cy={light.y} r="0.15" fill="#fff3a4" /></g>)}
                </g>}
              </svg>
            </div>
            <p className="empty-note">Blue: saved walls · Gold: estimated blockers and lights. Doorway gaps stay open.</p>
            <p className="scrawl-stats">{map.columns} × {map.rows} cells · {map.walls.filter((wall) => !wall.estimated).length} saved wall segments · {map.estimates.length} estimated blockers · {map.lights.length} estimated lights</p>
            <p className="empty-note">{map.imageWidth} × {map.imageHeight} image · {map.objectCount} visible objects. Tree estimates cover trunks, not the canopy.</p>
            <label>Board name<input value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
            {createCampaign && <label>Campaign name<input value={campaignName} maxLength={120} disabled={busy} onChange={(event) => setCampaignName(event.target.value)} /></label>}
            <label className="check-row"><input type="checkbox" checked={lightingEnabled} disabled={busy} onChange={(event) => setLightingEnabled(event.target.checked)} />Enable dynamic lighting</label>
            <p className="empty-note">{lightingEnabled ? 'Players see lit areas and token vision. Add a token with vision to explore unlit areas.' : 'Daylight: players see the whole map. Walls and lights are saved for when you enable lighting.'}</p>
            <div className="scrawl-warnings"><strong>Import notes</strong><ul>{map.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>
          </>}
        </>}
      </div>
      <footer className="scrawl-actions">
        <button type="button" className="command" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="command accent" disabled={busy || !map} onClick={importMap}>{busy ? 'Working…' : createCampaign ? 'Create campaign with this map' : 'Import as new board'}</button>
      </footer>
    </div>
  </div>;
}
