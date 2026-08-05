import React, { useEffect, useMemo, useState } from 'react';
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
  const [error, setError] = useState('');
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

  const loadCatalog = async () => {
    setError('');
    setIsLoadingCatalog(true);
    try {
      const normalizedBaseUrl = normalizeFiveEToolsBaseUrl(baseUrl);
      const data = await fetchFiveEToolsMaps(normalizedBaseUrl);
      setCatalog(data);
      setLoadedBaseUrl(normalizedBaseUrl);
      setMapResults([]);
      return data;
    } catch (loadError) {
      setError(loadError.message || 'Unable to load the 5e.tools map catalog.');
      return null;
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const selectBook = (bookId) => {
    setSelectedBookId(bookId);
    const book = books.find((item) => item.id === bookId);
    setSelectedMapIds(new Set(book?.maps.map((map) => map.id) || []));
    setError('');
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
    const query = mapQuery.trim().toLowerCase();
    if (!query) return;
    setError('');
    const normalizedBaseUrl = normalizeFiveEToolsBaseUrl(baseUrl);
    const data = catalog && loadedBaseUrl === normalizedBaseUrl ? catalog : await loadCatalog();
    if (!data) return;
    const matches = flattenFiveEToolsMapData(data, normalizedBaseUrl)
      .filter((map) => map.searchText.includes(query))
      .slice(0, 30);
    setMapResults(matches);
    if (!matches.length) setError('No matching maps found.');
  };

  const runImport = async (maps, book = null) => {
    if (!maps.length || isImporting) return;
    setError('');
    setIsImporting(true);
    setProgress({ completed: 0, total: maps.length, map: null });
    try {
      const result = await onImportMaps(maps, {
        book,
        baseUrl: normalizeFiveEToolsBaseUrl(baseUrl),
        onProgress: setProgress,
      });
      if (result?.ok === false) setError(result.error || 'Unable to import the selected maps.');
    } catch (importError) {
      setError(importError.message || 'Unable to import the selected maps.');
    } finally {
      setIsImporting(false);
      setProgress(null);
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
            <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
          </label>
          <button className="command" type="button" onClick={loadCatalog} disabled={isLoadingCatalog || isImporting}>
            <Library size={16} /> {isLoadingCatalog ? 'Loading...' : 'Reload catalog'}
          </button>
        </div>

        {mode === 'book' ? (
          <>
            <div className="fiveetools-book-picker">
              <label>
                Filter campaign books
                <input value={bookFilter} onChange={(event) => setBookFilter(event.target.value)} placeholder="Rise of Tiamat, Curse of Strahd..." />
              </label>
              <label>
                Campaign book
                <select value={selectedBookId} onChange={(event) => selectBook(event.target.value)} disabled={isLoadingCatalog || !books.length}>
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
              <input value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') searchMaps(); }} placeholder="Cragmaw Hideout, Castle Ravenloft..." autoFocus />
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

        {progress && (
          <p className="fiveetools-import-progress" role="status">
            Importing {Math.min(progress.completed + 1, progress.total)} of {progress.total}{progress.map?.displayTitle ? `: ${progress.map.displayTitle}` : ''}
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
