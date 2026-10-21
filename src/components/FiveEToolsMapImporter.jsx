import React, { useEffect, useMemo, useState } from 'react';
import { useImportAttempt } from '../hooks/useImportAttempt';
import { ImportFeedback } from './ImportFeedback';
import { ImportError } from '../lib/importErrors';
import { BookOpen, CheckSquare, Image, Library, Square } from 'lucide-react';
import {
  fetchFiveEToolsMaps,
  flattenFiveEToolsMapData,
  getFiveEToolsMapBoardDimensions,
  getFiveEToolsMapBooks,
  normalizeFiveEToolsBaseUrl,
} from '../lib/fiveETools';

export function FiveEToolsMapImporter({
  baseUrl,
  onBaseUrlChange,
  onImportMaps,
  allowSingleMap = true,
  initialMode = 'book',
  bulkActionLabel = 'Import selected maps',
}) {
  const [mode, setMode] = useState(allowSingleMap ? initialMode : 'book');
  const [catalog, setCatalog] = useState(null);
  const [loadedBaseUrl, setLoadedBaseUrl] = useState('');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const attempts = useImportAttempt();
  const [useRegionWalls, setUseRegionWalls] = useState(false);
  const [bookFilter, setBookFilter] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedMapIds, setSelectedMapIds] = useState(new Set());
  const [mapQuery, setMapQuery] = useState('');
  const [mapResults, setMapResults] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(null);

  const books = useMemo(() => getFiveEToolsMapBooks(catalog, loadedBaseUrl || baseUrl), [catalog, loadedBaseUrl, baseUrl]);
  const visibleBooks = useMemo(() => {
    const query = bookFilter.trim().toLowerCase();
    return query ? books.filter((book) => `${book.name} ${book.source}`.toLowerCase().includes(query)) : books;
  }, [books, bookFilter]);
  const selectedBook = books.find((book) => book.id === selectedBookId) || null;
  const selectedMaps = selectedBook?.maps.filter((map) => selectedMapIds.has(map.id)) || [];

  const resetSource = (value) => {
    attempts.clear();
    setIsLoadingCatalog(false);
    setCatalog(null);
    setLoadedBaseUrl('');
    setSelectedBookId('');
    setSelectedMapIds(new Set());
    setMapResults([]);
    onBaseUrlChange(value);
  };

  const loadCatalog = async (searchQuery = null) => {
    const attempt = attempts.begin(searchQuery === null ? 'Load map catalog' : 'Search maps');
    setIsLoadingCatalog(true);
    setCatalog(null);
    setSelectedBookId('');
    setSelectedMapIds(new Set());
    setMapResults([]);
    let notice = '';
    try {
      const normalizedBaseUrl = normalizeFiveEToolsBaseUrl(baseUrl);
      const data = await fetchFiveEToolsMaps(normalizedBaseUrl, { signal: attempt.controller.signal, onNotice: (message) => { notice = message; } });
      if (!attempts.isCurrent(attempt)) return;
      setCatalog(data);
      setLoadedBaseUrl(normalizedBaseUrl);
      if (searchQuery !== null) {
        const matches = flattenFiveEToolsMapData(data, normalizedBaseUrl).filter((map) => map.searchText.includes(searchQuery)).slice(0, 30);
        setMapResults(matches);
        attempts.finish(attempt, `${matches.length ? `Found ${matches.length} maps (up to 30 shown).` : 'No matching maps found. Try another title or campaign.'}${notice ? ` ${notice}` : ''}`, notice ? 'warning' : 'success');
      } else {
        attempts.finish(attempt, `Loaded ${getFiveEToolsMapBooks(data, normalizedBaseUrl).length} books from ${normalizedBaseUrl}.${notice ? ` ${notice}` : ''}`, notice ? 'warning' : 'success');
      }
    } catch (error) { attempts.fail(attempt, error); }
    finally { if (attempts.isCurrent(attempt)) setIsLoadingCatalog(false); }
  };

  useEffect(() => { loadCatalog(); }, []);

  const selectBook = (bookId) => {
    setSelectedBookId(bookId);
    const book = books.find((item) => item.id === bookId);
    setSelectedMapIds(new Set(book?.maps.map((map) => map.id) || []));
    attempts.clear();
  };

  const toggleMap = (mapId) => {
    setSelectedMapIds((current) => {
      const next = new Set(current);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  };

  const searchMaps = async () => {
    if (isLoadingCatalog || isImporting) return;
    const query = mapQuery.trim().toLowerCase();
    if (!query) {
      const attempt = attempts.begin('Search maps');
      attempts.fail(attempt, new ImportError('SEARCH_REQUIRED', 'Enter a map or campaign name before searching.'));
      return;
    }
    await loadCatalog(query);
  };

  const runImport = async (maps, book = null) => {
    if (!maps.length || isImporting || isLoadingCatalog) return;
    const attempt = attempts.begin(maps.length === 1 ? 'Import map' : 'Import campaign maps');
    setIsImporting(true);
    setProgress({ completed: 0, total: maps.length, map: null });
    try {
      const result = await onImportMaps(maps, {
        book, baseUrl: loadedBaseUrl, useRegionWalls, signal: attempt.controller.signal,
        onProgress: (value) => { if (attempts.isCurrent(attempt)) setProgress(value); },
      });
      if (result?.ok === false) throw new ImportError(result.code || 'IMPORT_FAILED', result.error || 'Unable to import the selected maps.');
      attempts.finish(attempt, `Imported ${maps.length} map${maps.length === 1 ? '' : 's'}.`);
    } catch (error) { attempts.fail(attempt, error); }
    finally {
      if (attempts.isCurrent(attempt)) { setIsImporting(false); setProgress(null); }
    }
  };

  return (
    <div className="fiveetools-importer">
      {allowSingleMap && (
        <div className="fiveetools-import-tabs" role="tablist" aria-label="5e.tools import type">
          <button type="button" role="tab" aria-selected={mode === 'book'} className={mode === 'book' ? 'active' : ''} onClick={() => setMode('book')}>
            <BookOpen size={16} /> Campaign book
          </button>
          <button type="button" role="tab" aria-selected={mode === 'map'} className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')}>
            <Image size={16} /> Single map
          </button>
        </div>
      )}

      <div className="map-import">
        <div className="fiveetools-base-url-row">
          <label>
            5e.tools base URL
            <input value={baseUrl} onChange={(event) => resetSource(event.target.value)} disabled={isImporting} />
          </label>
          <button className="command" type="button" onClick={() => loadCatalog()} disabled={isLoadingCatalog || isImporting}>
            <Library size={16} /> {isLoadingCatalog ? 'Loading...' : 'Reload catalog'}
          </button>
        </div>

        {mode === 'book' ? (
          <>
            <p className="empty-note">Creates boards from the book’s DM and player maps. Adventure text, encounters, and monsters are not included.</p>
            <div className="fiveetools-book-picker">
              <label>
                Filter campaign books
                <input value={bookFilter} onChange={(event) => setBookFilter(event.target.value)} placeholder="Rise of Tiamat, Curse of Strahd..." />
              </label>
              <label>
                Campaign book
                <select value={selectedBookId} onChange={(event) => selectBook(event.target.value)} disabled={isLoadingCatalog || isImporting || !books.length}>
                  <option value="">Select a campaign book...</option>
                  {visibleBooks.map((book) => (
                    <option key={book.id} value={book.id}>{book.name} ({book.maps.length} maps)</option>
                  ))}
                </select>
              </label>
            </div>

            {selectedBook && (
              <div className="fiveetools-book-maps">
                <div className="fiveetools-map-selection-header">
                  <div>
                    <strong>{selectedBook.name}</strong>
                    <span>{selectedMaps.length} of {selectedBook.maps.length} maps selected · DM and player versions are listed separately</span>
                  </div>
                  <div>
                    <button type="button" onClick={() => setSelectedMapIds(new Set(selectedBook.maps.map((map) => map.id)))} disabled={isImporting}>
                      <CheckSquare size={15} /> Select all
                    </button>
                    <button type="button" onClick={() => setSelectedMapIds(new Set())} disabled={isImporting}>
                      <Square size={15} /> Select none
                    </button>
                  </div>
                </div>
                <div className="fiveetools-map-checklist">
                  {selectedBook.maps.map((map) => {
                    const dimensions = getFiveEToolsMapBoardDimensions(map);
                    return (
                      <label className="fiveetools-map-option" key={map.id}>
                        <input type="checkbox" checked={selectedMapIds.has(map.id)} onChange={() => toggleMap(map.id)} disabled={isImporting} />
                        <span className={map.imageType === 'mapPlayer' ? 'map-kind player' : 'map-kind dm'}>{map.imageType === 'mapPlayer' ? 'Player' : 'DM'}</span>
                        <span>
                          <strong>{map.displayTitle}</strong>
                          <small>{map.chapterName || 'Unchaptered'} · {dimensions.columns} x {dimensions.rows}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <button className="command accent fiveetools-import-action" type="button" onClick={() => runImport(selectedMaps, selectedBook)} disabled={!selectedMaps.length || isImporting}>
                  <BookOpen size={16} /> {isImporting ? 'Importing campaign...' : `${bulkActionLabel} (${selectedMaps.length})`}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              Search maps
              <input value={mapQuery} onChange={(event) => { setMapQuery(event.target.value); setMapResults([]); attempts.clear(); }} disabled={isLoadingCatalog || isImporting} onKeyDown={(event) => { if (event.key === 'Enter') searchMaps(); }} placeholder="Cragmaw Hideout, Castle Ravenloft..." autoFocus />
            </label>
            <button className="command" type="button" title="Search the 5e.tools maps gallery" onClick={searchMaps} disabled={isLoadingCatalog || isImporting}>
              <Library size={16} /> {isLoadingCatalog ? 'Loading...' : 'Search maps'}
            </button>
            {mapResults.length > 0 && (
              <div className="map-results">
                {mapResults.map((map) => {
                  const dimensions = getFiveEToolsMapBoardDimensions(map);
                  return (
                    <div className="map-result" key={map.id}>
                      <div>
                        <strong>{map.displayTitle}</strong>
                        <span>{map.sourceName} · {map.chapterName} · {dimensions.columns} x {dimensions.rows}</span>
                      </div>
                      <button className="command" type="button" title="Create a new board from this map" onClick={() => runImport([map])} disabled={isImporting}>
                        <Image size={15} /> {isImporting ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <label className="fiveetools-region-option">
          <input type="checkbox" checked={useRegionWalls} onChange={(event) => setUseRegionWalls(event.target.checked)} disabled={isImporting} />
          Use map area outlines as estimated walls
        </label>
        <p className="empty-note">5etools areas are clickable regions, not measured walls or doors. Review any estimates before enabling lighting. Grid dimensions are estimates; hex grids, offsets, and unusual scales may need adjustment in Board Settings. Original grid metadata is retained.</p>
        {progress && (
          <p className="fiveetools-import-progress" role="status">
            Importing {Math.min(progress.completed + 1, progress.total)} of {progress.total}{progress.map?.displayTitle ? `: ${progress.map.displayTitle}` : ''}
          </p>
        )}
        <ImportFeedback feedback={attempts.feedback} />
      </div>
    </div>
  );
}
