import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, Scan } from 'lucide-react';
import { getTokenDragPlacement } from '../lib/tokenDrag';
import {
  boardPixelSize,
  cellCenterPixels,
  coneTemplate,
  feetBetween,
  hexPolygonPoints,
  hexCellMetrics,
  isPointInDrawing,
  isPointNearWall,
  isHexBoard,
  normalizeBackground,
  normalizeGrid,
  pointLightPolygons,
  offsetEntity,
  offsetDrawing,
  revealBox,
  selectableBounds,
  shapeBox,
  shapeMeasurement,
  snapToTile,
  tokenCenter,
  tokenFootprint,
  tokenPixelBox,
  uid,
  visionPolygonPoints,
  wallEndpoints,
} from '../lib/board';

export function BoardCanvas({
  board,
  view,
  tool,
  selected,
  setSelected,
  activeLayer = 'token',
  drawLayer = 'player',
  drawColor = '#36d399',
  onRequestNewToken,
  onRequestLibraryToken,
  onMoveToken,
  onMoveSelection,
  vehicleImageAdjustTokenId,
  onAdjustVehicleImage,
  onAddDoor,
  onMoveDoor,
  onAddDrawing,
  onMoveDrawing,
  onMoveBackground,
  onAddLightReveal,
  onAddLightWall,
  onMoveLightWall,
  onRemoveLightReveal,
  onLiveMeasurement,
  onSelectMultiple,
  onToggleDoor,
  onDeleteSelection,
  onDuplicateSelection,
  onChangeSelectionLayer,
  onToolChange,
  fitToViewport = false,
  playerRotation = 0,
  showNavigation = true,
}) {
  const [drag, setDrag] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [tokenPrompt, setTokenPrompt] = useState(null);
  const [lockedDoorAlert, setLockedDoorAlert] = useState(null);
  const shellRef = useRef(null);
  const backgroundVideoRef = useRef(null);
  const boardRef = useRef(null);
  const menuRef = useRef(null);
  const panGestureRef = useRef(null);
  const suppressContextMenuRef = useRef(false);
  const dragRef = useRef(null);
  const renderedZoomRef = useRef(1);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  dragRef.current = drag;
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(fitToViewport);
  const zoomAnchorRef = useRef(null);
  const tile = board.tileSize;
  const boardSize = boardPixelSize(board);
  const width = boardSize.width;
  const height = boardSize.height;
  const minimumZoom = Math.min(0.1, 64 / Math.max(width, height, 1));
  const maximumZoom = view === 'dm' ? 3 : 10;
  const hexBoard = isHexBoard(board);
  const grid = normalizeGrid(board.grid);
  const gridVisible = view === 'dm' ? grid.visibleToDm : grid.visibleToPlayers;
  const gridRgb = [1, 3, 5].map((offset) => parseInt(grid.color.slice(offset, offset + 2), 16)).join(', ');
  const scale = zoom;
  const normalizedRotation = ((playerRotation % 360) + 360) % 360;
  const isRotatedSideways = normalizedRotation === 90 || normalizedRotation === 270;
  const rotatedWidth = isRotatedSideways ? height : width;
  const rotatedHeight = isRotatedSideways ? width : height;
  const stageWidth = (isRotatedSideways ? height : width) * scale;
  const stageHeight = (isRotatedSideways ? width : height) * scale;
  const rotationOffset = getRotationOffset(normalizedRotation, width, height, scale);
  const background = normalizeBackground(board.background);
  const lighting = { enabled: false, darkness: 0.86, reveals: [], hiddenReveals: [], walls: [], ...board.lighting };
  const doors = board.doors || [];
  const activeLightingWalls = useMemo(() => [
    ...lighting.walls,
    ...doors
      .filter((door) => door.state === 'closed' || door.state === 'locked' || door.isLocked)
      .map((door) => doorWall(door)),
  ], [doors, lighting.walls]);
  const selectedItems = selected?.type === 'multi' ? selected.items : selected ? [selected] : [];
  const playerTokens = useMemo(
    () => board.tokens.filter((token) => token.layer === 'player' && token.visible),
    [board.tokens],
  );
  const dmTokens = useMemo(
    () => board.tokens.filter((token) => view === 'dm' || (token.layer === 'player' && token.visible)),
    [board.tokens, view],
  );
  const visibleDrawings = useMemo(
    () => board.drawings.filter((drawing) => view === 'dm' || (drawing.layer === 'player' && drawing.visible !== false)),
    [board.drawings, view],
  );
  const activeCanvasDrawings = useMemo(() => (
    visibleDrawings.filter((drawing) => {
      if (activeLayer === 'gm') return drawing.layer === 'dm';
      if (activeLayer === 'token') return drawing.layer === 'player';
      return false;
    })
  ), [activeLayer, visibleDrawings]);
  const activeCanvasTokens = useMemo(() => (
    visibleTokensForLayer(dmTokens, activeLayer)
  ), [activeLayer, dmTokens]);
  const restartBackgroundVideo = (video) => {
    video.currentTime = 0.001;
    video.play().catch(() => {});
  };
  const loopBackgroundVideo = (video) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime < 0.5) return;
    const loopAt = Math.min(10, Math.max(0.5, video.duration - 0.05));
    if (!video.ended && video.currentTime < loopAt) return;
    restartBackgroundVideo(video);
  };
  const brightPolygons = useMemo(() => (
    playerTokens
      .filter((token) => token.visionEnabled !== false && Number(token.visionBrightFeet ?? token.visionFeet) > 0)
        .map((token) => ({ id: `vision-bright-${token.id}`, points: visionPolygonPoints(token, activeLightingWalls, tile, token.visionBrightFeet ?? token.visionFeet, board) }))
  ), [activeLightingWalls, playerTokens, tile]);
  const dimPolygons = useMemo(() => (
    playerTokens
      .filter((token) => token.visionEnabled !== false && Number(token.visionDimFeet ?? token.visionFeet) > 0)
        .map((token) => ({ id: `vision-dim-${token.id}`, points: visionPolygonPoints(token, activeLightingWalls, tile, token.visionDimFeet ?? token.visionFeet, board) }))
  ), [activeLightingWalls, playerTokens, tile]);
  const lightPolygons = useMemo(() => {
    const playerVision = [...brightPolygons, ...dimPolygons];
    return board.tokens
      .filter((token) => token.visible !== false && (Number(token.lightBrightFeet) > 0 || Number(token.lightDimFeet) > 0))
      .filter((token) => token.layer === 'player' || pointIsInAnyPolygon(tokenCenterPixels(token, board), playerVision))
      .flatMap((token) => [
        Number(token.lightBrightFeet) > 0 ? { id: `light-bright-${token.id}`, tone: 'bright', points: visionPolygonPoints(token, activeLightingWalls, tile, token.lightBrightFeet, board) } : null,
        Number(token.lightDimFeet) > 0 ? { id: `light-dim-${token.id}`, tone: 'dim', points: visionPolygonPoints(token, activeLightingWalls, tile, token.lightDimFeet, board) } : null,
      ].filter(Boolean));
  }, [activeLightingWalls, board.tokens, brightPolygons, dimPolygons, tile]);
  const sourceLightPolygons = useMemo(() => pointLightPolygons(lighting.lights, activeLightingWalls, tile, board), [lighting.lights, activeLightingWalls, tile, board.grid]);
  const allBrightPolygons = useMemo(() => [...brightPolygons, ...lightPolygons.filter((item) => item.tone === 'bright'), ...sourceLightPolygons.filter((item) => item.tone === 'bright')], [brightPolygons, lightPolygons, sourceLightPolygons]);
  const allDimPolygons = useMemo(() => [...dimPolygons, ...lightPolygons, ...sourceLightPolygons], [dimPolygons, lightPolygons, sourceLightPolygons]);
  const visibleDoors = useMemo(() => {
    if (view === 'dm' || !lighting.enabled) return doors;
    return doors.filter((door) => pointIsInAnyPolygon({ x: door.position.x * tile, y: door.position.y * tile }, allDimPolygons));
  }, [allDimPolygons, doors, lighting.enabled, tile, view]);
  const visibleTokens = useMemo(() => {
    if (view === 'dm' || !lighting.enabled) return dmTokens;
    return dmTokens.filter((token) => tokenHasVision(token) || tokenIsInRevealedLight(token, lighting, allDimPolygons, board));
  }, [allDimPolygons, dmTokens, lighting, tile, view]);

  const zoomAt = (value, clientPoint) => {
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const padding = window.getComputedStyle(shell);
    zoomAnchorRef.current = {
      x: (clientPoint?.x ?? rect.left + shell.clientWidth / 2) - rect.left - parseFloat(padding.paddingLeft || 0),
      y: (clientPoint?.y ?? rect.top + shell.clientHeight / 2) - rect.top - parseFloat(padding.paddingTop || 0),
    };
    setAutoFit(false);
    setZoom((current) => Math.max(minimumZoom, Math.min(maximumZoom, typeof value === 'function' ? value(current) : value)));
  };

  const applyFit = () => {
    const shell = shellRef.current;
    if (!shell) return;
    const padding = window.getComputedStyle(shell);
    const availableWidth = shell.clientWidth - parseFloat(padding.paddingLeft || 0) - parseFloat(padding.paddingRight || 0);
    const availableHeight = shell.clientHeight - parseFloat(padding.paddingTop || 0) - parseFloat(padding.paddingBottom || 0);
    zoomAnchorRef.current = null;
    setZoom(Math.max(minimumZoom, Math.min(1, availableWidth / rotatedWidth, availableHeight / rotatedHeight)));
    shell.scrollLeft = 0;
    shell.scrollTop = 0;
  };

  const fitBoard = () => {
    setAutoFit(true);
    applyFit();
  };

  useLayoutEffect(() => {
    if (!autoFit || !shellRef.current) return undefined;
    const shell = shellRef.current;
    applyFit();
    const observer = new ResizeObserver(applyFit);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [autoFit, rotatedWidth, rotatedHeight, normalizedRotation, minimumZoom, board.id, view]);

  useEffect(() => {
    if (!shellRef.current) return undefined;
    const shell = shellRef.current;
    const onWheel = (event) => {
      if (contextMenu || tokenPrompt || document.querySelector('[aria-modal="true"], dialog[open]')) return;
      event.preventDefault();
      if (event.altKey || event.ctrlKey || event.metaKey) {
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? shell.clientHeight : 1);
        zoomAt((current) => current * Math.exp(-delta * 0.002), { x: event.clientX, y: event.clientY });
      } else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? shell.clientHeight : 1;
        shell.scrollLeft += (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
        shell.scrollTop += (event.shiftKey ? 0 : event.deltaY) * unit;
      }
    };
    shell.addEventListener('wheel', onWheel, { passive: false });
    return () => shell.removeEventListener('wheel', onWheel);
  }, [view, contextMenu, tokenPrompt, minimumZoom, maximumZoom]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const anchor = zoomAnchorRef.current;
    const ratio = zoom / renderedZoomRef.current;
    renderedZoomRef.current = zoom;
    if (!shell || !anchor) return;
    zoomAnchorRef.current = null;
    shell.scrollLeft = (shell.scrollLeft + anchor.x) * ratio - anchor.x;
    shell.scrollTop = (shell.scrollTop + anchor.y) * ratio - anchor.y;
  }, [zoom]);

  useLayoutEffect(() => {
    setAutoFit(fitToViewport);
    if (fitToViewport) applyFit();
    else setZoom(1);
    setDrag(null);
    setContextMenu(null);
    setTokenPrompt(null);
    setSpaceHeld(false);
    setIsPanning(false);
    panGestureRef.current = null;
    suppressContextMenuRef.current = false;
    zoomAnchorRef.current = null;
    if (shellRef.current) {
      shellRef.current.scrollLeft = 0;
      shellRef.current.scrollTop = 0;
    }
  }, [board.id, view, fitToViewport]);

  const cancelInteraction = () => {
    if (dragRef.current?.type === 'ruler') onLiveMeasurement?.(null);
    dragRef.current = null;
    setDrag(null);
    setIsPanning(false);
    const gesture = panGestureRef.current;
    panGestureRef.current = null;
    if (gesture && shellRef.current?.hasPointerCapture(gesture.pointerId)) {
      shellRef.current.releasePointerCapture(gesture.pointerId);
    }
  };

  useEffect(() => {
    const onKeyUp = (event) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const onBlur = () => {
      setSpaceHeld(false);
      cancelInteraction();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onLiveMeasurement]);

  const onViewportKeyDown = (event) => {
    if (isEditableTarget(event.target) || event.target.closest('[role="menu"], [role="dialog"]') || document.querySelector('[aria-modal="true"], dialog[open]')) return;
    if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || contextMenu || tokenPrompt) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt((current) => current * 1.2);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomAt((current) => current / 1.2);
    } else if (event.key === '0') {
      event.preventDefault();
      fitBoard();
    }
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!contextMenu || !menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector('button')?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = (event) => {
      if (!menuRef.current?.contains(event.target)) setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!drag && !contextMenu && !tokenPrompt && !isPanning) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelInteraction();
      setContextMenu(null);
      setTokenPrompt(null);
      shellRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [drag, contextMenu, tokenPrompt, isPanning, onLiveMeasurement]);

  useEffect(() => {
    if (background.type !== 'video' || !background.src) return undefined;
    const video = backgroundVideoRef.current;
    if (!video) return undefined;

    video.loop = true;
    let frameId = 0;
    let lastTime = video.currentTime;
    let lastProgressAt = performance.now();
    const restart = () => loopBackgroundVideo(video);
    const resume = () => {
      if (video.ended) {
        restartBackgroundVideo(video);
        return;
      }
      if (video.paused) video.play().catch(() => {});
    };
    const monitor = () => {
      const now = performance.now();
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgressAt = now;
      }
      loopBackgroundVideo(video);
      if (video.readyState >= 2 && now - lastProgressAt > 750) {
        resume();
        if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= Math.min(10, Math.max(0.5, video.duration - 0.05)))) {
          restartBackgroundVideo(video);
          lastProgressAt = now;
        }
      }
      frameId = window.requestAnimationFrame(monitor);
    };

    video.addEventListener('ended', restart);
    video.addEventListener('pause', resume);
    video.play().catch(() => {});
    frameId = window.requestAnimationFrame(monitor);

    return () => {
      window.cancelAnimationFrame(frameId);
      video.removeEventListener('ended', restart);
      video.removeEventListener('pause', resume);
    };
  }, [background.src, background.type]);

  const pointFromEvent = (event, element = event.currentTarget) => {
    const rect = element.getBoundingClientRect();
    const hexMetrics = hexBoard ? hexCellMetrics(board) : null;
    const unitWidth = hexMetrics?.width || tile;
    const screenX = (event.clientX - rect.left) / scale;
    const screenY = (event.clientY - rect.top) / scale;
    const local = normalizedRotation === 90 ? { x: screenY, y: height - screenX }
      : normalizedRotation === 180 ? { x: width - screenX, y: height - screenY }
        : normalizedRotation === 270 ? { x: width - screenY, y: screenX }
          : { x: screenX, y: screenY };
    return {
      x: local.x / unitWidth,
      y: local.y / tile,
      px: local.x,
      py: local.y,
    };
  };

  const tokenHitTest = (tokens, point) => [...tokens]
    .filter((token) => {
      if (hexBoard && token.tokenKind === 'hex50') {
        const center = cellCenterPixels(token, board);
        return Math.hypot(point.px - center.x, point.py - center.y) <= tile / 2;
      }
      const footprint = tokenFootprint(token);
      return point.x >= token.x && point.x <= token.x + footprint.width && point.y >= token.y && point.y <= token.y + footprint.height;
    })
    .sort((a, b) => {
      const aFootprint = tokenFootprint(a);
      const bFootprint = tokenFootprint(b);
      return (aFootprint.width * aFootprint.height) - (bFootprint.width * bFootprint.height);
    })[0];

  const tokenAt = (point) => tokenHitTest(activeCanvasTokens, point);
  // On the token/GM layers, selection falls through to tokens and drawings on the
  // other of the two layers; the portal switches the active layer to match.
  const crossLayerTokenAt = (point) => ['token', 'gm'].includes(activeLayer) ? tokenHitTest(dmTokens, point) : null;
  const drawingAt = (point) => [...activeCanvasDrawings].reverse().find((drawing) => isPointInDrawing(point, drawing));
  const crossLayerDrawingAt = (point) => ['token', 'gm'].includes(activeLayer) ? [...visibleDrawings].reverse().find((drawing) => isPointInDrawing(point, drawing)) : null;
  const wallAt = (point) => activeLayer === 'walls' ? [...lighting.walls].reverse().find((wall) => isPointNearWall(point, wall)) : null;
  const doorAt = (point) => view === 'player' || activeLayer === 'walls' ? [...visibleDoors].reverse().find((door) => door.source === 'dungeon-scrawl'
    ? isPointNearWall({ x: point.px / tile, y: point.py / tile }, doorWall(door))
    : Math.hypot(point.px - door.position.x * tile, point.py - door.position.y * tile) <= tile * 0.45) : null;
  const isSelected = (type, id) => selectedItems.some((item) => item.type === type && item.id === id);

  const onPointerDown = (event) => {
    if (view !== 'dm') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button !== 0 && !(tool === 'light' && event.button === 2)) return;
    const point = pointFromEvent(event);
    const snapped = snapToTile(point, board);
    const wallPoint = lighting.snapWallsToGrid ? snapped : clampPoint(point, board);
    const token = tool === 'select' ? tokenAt(point) || crossLayerTokenAt(point) : tokenAt(point);
    const drawing = tool === 'select' ? drawingAt(point) || crossLayerDrawingAt(point) : drawingAt(point);
    const wall = wallAt(point);
    const door = doorAt(point);

    if (activeLayer !== 'map' && tool === 'background') {
      setSelected(null);
      return;
    }

    if (tool === 'background' && !background.fitToBoard) {
      const bgWidth = width * background.scale;
      const bgHeight = height * background.scale;
      const nearResize = point.px > background.x + bgWidth - 32 && point.py > background.y + bgHeight - 32;
      setDrag({ type: nearResize ? 'background-resize' : 'background', start: { x: point.px, y: point.py }, original: background });
      setSelected(null);
      return;
    }

    if (tool === 'background') {
      setSelected(null);
      return;
    }

    if (tool === 'token' && ['token', 'gm'].includes(activeLayer)) {
      setTokenPrompt({ x: point.px, y: point.py, cell: snapped });
      return;
    }

    if (tool === 'door' && activeLayer === 'walls') {
      onAddDoor?.(doorFromPoint(point));
      return;
    }

    if (tool === 'select' && token) {
      if (token.tokenKind === 'vehicle' && vehicleImageAdjustTokenId === token.id) {
        setSelected({ type: 'token', id: token.id });
        setDrag({
          type: 'vehicle-image',
          id: token.id,
          start: { x: point.px, y: point.py },
          rotation: token.vehicle?.rotation || 0,
          original: {
            imageOffsetX: Number(token.vehicle?.imageOffsetX) || 0,
            imageOffsetY: Number(token.vehicle?.imageOffsetY) || 0,
          },
        });
        return;
      }
      const isGroupDrag = isSelected('token', token.id) && selected?.type === 'multi';
      if (!isGroupDrag) setSelected({ type: 'token', id: token.id });
      const nextDrag = {
        type: 'token',
        id: token.id,
        token: structuredClone(token),
        startClient: { x: event.clientX, y: event.clientY },
        original: { x: token.x, y: token.y },
        moved: false,
        placement: null,
        group: isGroupDrag ? selected.items : null,
      };
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      return;
    }

    if (tool === 'select' && door) {
      const isGroupDrag = isSelected('door', door.id) && selected?.type === 'multi';
      if (!isGroupDrag) setSelected({ type: 'door', id: door.id });
      setDrag({
        type: 'door',
        id: door.id,
        start: snapped,
        original: structuredClone(door),
        preview: structuredClone(door),
        group: isGroupDrag ? selected.items : null,
        dx: 0,
        dy: 0,
      });
      return;
    }

    if (tool === 'select' && drawing) {
      const isGroupDrag = isSelected('drawing', drawing.id) && selected?.type === 'multi';
      if (!isGroupDrag) setSelected({ type: 'drawing', id: drawing.id });
      setDrag({ type: 'drawing', id: drawing.id, start: snapped, dx: 0, dy: 0, group: isGroupDrag ? selected.items : null });
      return;
    }

    if (tool === 'select' && wall) {
      const isGroupDrag = isSelected('wall', wall.id) && selected?.type === 'multi';
      if (!isGroupDrag) setSelected({ type: 'wall', id: wall.id });
      setDrag({ type: 'wall-move', id: wall.id, start: wall.freeform ? clampPoint(point, board) : snapped, original: structuredClone(wall), preview: structuredClone(wall), group: isGroupDrag ? selected.items : null, dx: 0, dy: 0 });
      return;
    }

    if (tool === 'select') {
      setDrag({
        type: 'marquee',
        start: point,
        end: point,
        mode: event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace',
      });
      return;
    }

    if (['ruler', 'square', 'circle', 'cone', 'shape'].includes(tool) && !['token', 'gm'].includes(activeLayer)) {
      return;
    }

    if (['light', 'wall'].includes(tool) && activeLayer !== 'walls') {
      return;
    }

    if (['ruler', 'square', 'circle', 'cone', 'shape', 'light', 'wall'].includes(tool)) {
      const type = tool === 'light' && event.button === 2 ? 'light-hide' : tool;
      setDrag({ type, start: type === 'wall' ? wallPoint : snapped, end: type === 'wall' ? wallPoint : snapped, freeform: type === 'wall' && !lighting.snapWallsToGrid });
      return;
    }

    if (tool === 'draw' && ['token', 'gm'].includes(activeLayer)) {
      setDrag({ type: 'draw', points: [point] });
    }
  };

  const onPointerMove = (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    const snapped = snapToTile(point, board);
    const wallPoint = lighting.snapWallsToGrid ? snapped : clampPoint(point, board);

    if (drag.type === 'background') {
      onMoveBackground({
        x: drag.original.x + point.px - drag.start.x,
        y: drag.original.y + point.py - drag.start.y,
      });
      return;
    }

    if (drag.type === 'background-resize') {
      const nextWidth = Math.max(tile, point.px - drag.original.x);
      onMoveBackground({ scale: nextWidth / width });
      return;
    }

    if (drag.type === 'vehicle-image') {
      const dx = point.px - drag.start.x;
      const dy = point.py - drag.start.y;
      const local = rotateDelta(dx, dy, -(drag.rotation || 0));
      onAdjustVehicleImage?.(drag.id, {
        imageOffsetX: Math.round(drag.original.imageOffsetX + local.x),
        imageOffsetY: Math.round(drag.original.imageOffsetY + local.y),
      });
      return;
    }

    if (drag.type === 'token') {
      const current = dragRef.current;
      if (current?.type !== 'token') return;
      if (!current.moved && Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) < 4) return;
      const placement = getTokenDragPlacement(current.token, board, point);
      const nextDrag = { ...current, moved: true, placement };
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      return;
    }

    if (drag.type === 'marquee') {
      setDrag({ ...drag, end: point });
      return;
    }

    if (drag.type === 'door') {
      const dx = snapped.x - drag.start.x;
      const dy = snapped.y - drag.start.y;
      setDrag({
        ...drag,
        dx,
        dy,
        preview: offsetEntity(drag.original, 'door', dx, dy),
      });
      return;
    }

    if (drag.type === 'drawing') {
      setDrag({ ...drag, dx: snapped.x - drag.start.x, dy: snapped.y - drag.start.y });
      return;
    }

    if (drag.type === 'wall-move') {
      const current = drag.original.freeform ? clampPoint(point, board) : snapped;
      const dx = current.x - drag.start.x;
      const dy = current.y - drag.start.y;
      setDrag({
        ...drag,
        dx,
        dy,
        preview: {
          ...drag.original,
          start: { x: drag.original.start.x + dx, y: drag.original.start.y + dy },
          end: { x: drag.original.end.x + dx, y: drag.original.end.y + dy },
        },
      });
      return;
    }

    if (drag.type === 'draw') {
      setDrag({ ...drag, points: [...drag.points, point] });
      return;
    }

    const nextEnd = drag.type === 'wall' && drag.freeform ? wallPoint : snapped;
    const nextDrag = { ...drag, end: nextEnd };
    setDrag(nextDrag);
    if (drag.type === 'ruler') onLiveMeasurement?.({ start: drag.start, end: snapped });
  };

  const onViewportPointerDown = (event) => {
    if (event.target.closest('.context-menu')) return;
    shellRef.current?.focus({ preventScroll: true });
    suppressContextMenuRef.current = false;
    const isPan = event.button === 1 || (event.button === 2 && (spaceHeld || view === 'player' || tool !== 'light')) || (event.button === 0 && (view === 'player' || tool === 'pan' || spaceHeld));
    if (!isPan) return;
    event.preventDefault();
    event.stopPropagation();
    cancelInteraction();
    setContextMenu(null);
    setTokenPrompt(null);
    const shell = shellRef.current;
    const point = view === 'player' && event.button === 0 && !spaceHeld && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      ? pointFromEvent(event, boardRef.current) : null;
    shell.setPointerCapture(event.pointerId);
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: shell.scrollLeft,
      top: shell.scrollTop,
      moved: false,
      door: point ? doorAt(point) : null,
      point,
    };
    setIsPanning(true);
  };

  const onViewportPointerMove = (event) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    suppressContextMenuRef.current = true;
    setContextMenu(null);
    shellRef.current.scrollLeft = gesture.left - dx;
    shellRef.current.scrollTop = gesture.top - dy;
  };

  const onViewportPointerUp = (event) => {
    const gesture = panGestureRef.current;
    if (gesture?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const stationary = !gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4;
    if (stationary && gesture.door) {
      if (gesture.door.state === 'locked' || gesture.door.isLocked) {
        const id = gesture.door.id;
        setLockedDoorAlert({ x: gesture.point.px, y: gesture.point.py, id });
        window.setTimeout(() => setLockedDoorAlert((alert) => alert?.id === id ? null : alert), 1200);
      } else onToggleDoor?.(gesture.door.id);
    }
    cancelInteraction();
  };

  const onBoardPointerDown = (event) => {
    setContextMenu(null);
    setTokenPrompt(null);
    if (view === 'player') return;
    onPointerDown(event);
  };

  const onContextMenu = (event) => {
    event.preventDefault();
    if ((view === 'dm' && tool === 'light') || suppressContextMenuRef.current) return;
    if (view === 'player') {
      setContextMenu({ x: event.clientX, y: event.clientY, target: null });
      return;
    }
    const point = pointFromEvent(event, boardRef.current);
    const token = tokenAt(point) || crossLayerTokenAt(point);
    const drawing = drawingAt(point) || crossLayerDrawingAt(point);
    const wall = wallAt(point);
    const door = doorAt(point);
    const clicked = token ? { type: 'token', id: token.id } : drawing ? { type: 'drawing', id: drawing.id } : door ? { type: 'door', id: door.id } : wall ? { type: 'wall', id: wall.id } : null;
    const partOfSelection = clicked && isSelected(clicked.type, clicked.id);
    const target = partOfSelection && selected?.type === 'multi' ? selected : clicked;
    if (clicked && !partOfSelection) setSelected(clicked);
    setContextMenu({ x: event.clientX, y: event.clientY, target });
  };

  const onPointerUp = (event) => {
    const current = dragRef.current;
    if (current?.type === 'token') {
      const moved = current.moved || Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) >= 4;
      if (moved) {
        const { drop } = getTokenDragPlacement(current.token, board, pointFromEvent(event, boardRef.current));
        const dx = drop.x - current.original.x;
        const dy = drop.y - current.original.y;
        if (dx || dy) {
          if (current.group?.length) onMoveSelection(current.group, dx, dy);
          else onMoveToken(current.id, { x: drop.x, y: drop.y });
        }
      }
      dragRef.current = null;
      setDrag(null);
      return;
    }
    if (!drag) return;
    if (drag.type === 'drawing' && (drag.dx || drag.dy)) {
      if (drag.group?.length) onMoveSelection(drag.group, drag.dx, drag.dy);
      else onMoveDrawing(drag.id, drag.dx, drag.dy);
    }
    if (drag.type === 'door' && (drag.dx || drag.dy)) {
      if (drag.group?.length) onMoveSelection(drag.group, drag.dx, drag.dy);
      else onMoveDoor(drag.id, drag.preview);
    }
    if (drag.type === 'wall-move') {
      if (drag.group?.length && (drag.dx || drag.dy)) onMoveSelection(drag.group, drag.dx, drag.dy);
      else onMoveLightWall(drag.id, drag.preview);
    }
    if (drag.type === 'draw' && drag.points.length > 1) {
      onAddDrawing({
        id: uid('draw'),
        type: 'path',
        layer: drawLayer,
        color: drawColor,
        strokeWidth: 4,
        points: drag.points,
        visible: true,
      });
    }
    if (drag.type === 'light') {
      onAddLightReveal({
        id: uid('reveal'),
        start: drag.start,
        end: drag.end,
      });
    }
    if (drag.type === 'light-hide') {
      onRemoveLightReveal({
        start: drag.start,
        end: drag.end,
      });
    }
    if (drag.type === 'wall') {
      onAddLightWall({
        id: uid('wall'),
        start: drag.start,
        end: drag.end,
        freeform: Boolean(drag.freeform),
      });
    }
    if (drag.type === 'marquee') {
      onSelectMultiple?.(selectablesInBounds(marqueeBounds(drag), board, activeCanvasTokens, activeCanvasDrawings, activeLayer === 'walls' ? lighting.walls : [], activeLayer === 'walls' ? visibleDoors : []), drag.mode);
    }
    if (['square', 'circle', 'cone', 'shape'].includes(drag.type)) {
      onAddDrawing({
        id: uid('shape'),
        type: 'shape',
        shape: drag.type === 'shape' ? 'rect' : drag.type,
        layer: drawLayer,
        color: drawColor,
        fill: `${drawColor}22`,
        strokeWidth: 3,
        start: drag.start,
        end: drag.end,
        visible: true,
      });
    }
    if (drag.type === 'ruler') {
      if (feetBetween(drag.start, drag.end, board) > 0) {
        onAddDrawing({
          id: uid('measure'),
          type: 'measurement',
          layer: 'player',
          color: '#f8fafc',
          strokeWidth: 4,
          start: drag.start,
          end: drag.end,
          visible: true,
        });
      }
      onLiveMeasurement?.(null);
    }
    setDrag(null);
  };

  const liveDrawing = drag?.type === 'draw'
    ? [{ id: 'live-draw', type: 'path', points: drag.points, color: drawColor, strokeWidth: 4, layer: drawLayer }]
    : [];
  const liveShape = drag && ['square', 'circle', 'cone', 'shape', 'ruler', 'light', 'light-hide', 'wall'].includes(drag.type) ? drag : null;
  const displayTokens = visibleTokens.map((token) => (
    drag?.type === 'token' ? token : isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'token' && item.id === token.id)
      ? { ...token, x: token.x + (drag.dx || 0), y: token.y + (drag.dy || 0) }
      : token
  ));
  const displayDrawings = visibleDrawings.map((drawing) => (
    drag?.type === 'token' ? drawing : isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'drawing' && item.id === drawing.id)
      ? { ...drawing, ...offsetDrawing(drawing, drag.dx || 0, drag.dy || 0) }
      : drag?.type === 'drawing' && drag.id === drawing.id ? { ...drawing, ...offsetDrawing(drawing, drag.dx, drag.dy) } : drawing
  ));
  const displayWalls = lighting.walls.map((wall) => (
    drag?.type === 'token' ? wall : isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'wall' && item.id === wall.id)
      ? offsetEntity(wall, 'wall', drag.dx || 0, drag.dy || 0)
      : drag?.type === 'wall-move' && drag.id === wall.id ? drag.preview : wall
  ));
  const displayDoors = visibleDoors.map((door) => (
    drag?.type === 'token' ? door : isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'door' && item.id === door.id)
      ? offsetEntity(door, 'door', drag.dx || 0, drag.dy || 0)
      : drag?.type === 'door' && drag.id === door.id ? drag.preview : door
  ));
  const tokenDragDelta = drag?.type === 'token' && drag.moved ? drag.placement?.pixelDelta : null;
  const followsTokenDrag = (type, id) => Boolean(tokenDragDelta && ((type === 'token' && drag.id === id) || drag.group?.some((item) => item.type === type && item.id === id)));
  const renderDraggedGroupItem = (type, item, rendered) => followsTokenDrag(type, item.id)
    ? <g key={item.id} transform={`translate(${tokenDragDelta.x} ${tokenDragDelta.y})`}>{rendered}</g>
    : rendered;
  const boardObjectMotion = useBoardObjectMotion(view === 'player', {
    tokens: displayTokens,
    drawings: displayDrawings,
    doors: displayDoors,
  }, tile, board);
  const liveMarquee = drag?.type === 'marquee' ? marqueeBounds(drag) : null;

  return (
    <>
    {showNavigation && (
      <div className="board-viewport-controls" role="group" aria-label="Board navigation">
        <span className="board-viewport-hint">{view === 'player' ? 'Drag to pan · Alt + scroll to zoom' : 'Space + drag to pan · Alt + scroll to zoom'}</span>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom <= minimumZoom} onClick={() => zoomAt((current) => current / 1.2)}><Minus size={16} aria-hidden="true" /></button>
        <button type="button" aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100 percent`} title="Reset zoom to 100%" onClick={() => zoomAt(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= maximumZoom} onClick={() => zoomAt((current) => current * 1.2)}><Plus size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Fit board to viewport" title="Fit board (0)" onClick={fitBoard}><Scan size={16} aria-hidden="true" /></button>
      </div>
    )}
    <div
      className={`board-shell ${fitToViewport ? 'board-shell-fit' : ''} ${view === 'player' || tool === 'pan' || spaceHeld ? 'is-pan-ready' : ''} ${isPanning ? 'is-panning' : ''}`}
      ref={shellRef}
      tabIndex={0}
      role="region"
      aria-label={view === 'dm' ? 'Interactive game board. Space and drag to pan; plus and minus to zoom; 0 to fit.' : 'Player game board. Drag to pan; plus and minus to zoom; 0 to fit.'}
      onKeyDown={onViewportKeyDown}
      onPointerDownCapture={onViewportPointerDown}
      onPointerMoveCapture={onViewportPointerMove}
      onPointerUpCapture={onViewportPointerUp}
      onPointerCancel={cancelInteraction}
      onLostPointerCapture={cancelInteraction}
      onContextMenu={onContextMenu}
    >
      <div className="board-stage" style={{ width: stageWidth, height: stageHeight }}>
        <div
          ref={boardRef}
          className={`board active-layer-${activeLayer} ${hexBoard ? 'board-hex-grid' : ''} ${gridVisible ? '' : 'board-grid-hidden'} ${fitToViewport ? 'board-fit' : ''}`}
          style={{
            width,
            height,
            '--tile': `${tile}px`,
            '--grid-color': grid.color,
            '--grid-base-color': `rgba(${gridRgb}, 0.18)`,
            '--grid-line-color': `rgba(${gridRgb}, 0.2)`,
            '--grid-hex-color': `rgba(${gridRgb}, 0.28)`,
            '--grid-thickness': `${grid.thickness}px`,
            transform: `translate(${rotationOffset.x}px, ${rotationOffset.y}px) rotate(${normalizedRotation}deg) scale(${scale})`,
          }}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelInteraction}
        >
          {background.src && (
            background.type === 'video' ? (
              <video
                ref={backgroundVideoRef}
                key={background.src}
                className="board-background"
                src={background.src}
                autoPlay
                loop
                muted={background.muted !== false}
                playsInline
                preload="auto"
                draggable="false"
                onTimeUpdate={(event) => loopBackgroundVideo(event.currentTarget)}
                style={{
                  left: background.fitToBoard ? 0 : background.x,
                  top: background.fitToBoard ? 0 : background.y,
                  width: background.fitToBoard ? width : width * background.scale,
                  height: background.fitToBoard ? height : undefined,
                  objectFit: background.fitToBoard ? 'fill' : undefined,
                  opacity: background.opacity,
                }}
              />
            ) : (
              <img
                className="board-background"
                src={background.src}
                alt=""
                draggable="false"
                style={{
                  left: background.fitToBoard ? 0 : background.x,
                  top: background.fitToBoard ? 0 : background.y,
                  width: background.fitToBoard ? width : width * background.scale,
                  height: background.fitToBoard ? height : undefined,
                  objectFit: background.fitToBoard ? 'fill' : undefined,
                  opacity: background.opacity,
                }}
              />
            )
          )}
          {tool === 'background' && view === 'dm' && background.src && !background.fitToBoard && (
            <div
              className="background-resize-handle"
              style={{
                left: background.x + width * background.scale - 12,
                top: background.y + height * background.scale - 12,
              }}
            />
          )}
          <svg className="drawing-layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <defs>
              <marker id="arrow" markerWidth="12" markerHeight="12" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,4 L0,8 Z" fill="#f8fafc" />
              </marker>
              <mask id={`lighting-mask-${board.id}`}>
                <rect x="0" y="0" width={width} height={height} fill="white" />
                {lighting.reveals.map((reveal) => renderRevealHole(reveal, tile))}
                {lighting.hiddenReveals.map((reveal) => renderRevealHole(reveal, tile, 'white'))}
                {allDimPolygons.map((token) => (
                  <polygon
                    key={`dim-${token.id}`}
                    points={token.points}
                    fill="black"
                    fillOpacity={token.intensity ?? 1}
                  />
                ))}
              </mask>
              <clipPath id={`dim-clip-${board.id}`}>
                {allDimPolygons.map((token) => <polygon key={`dim-clip-${token.id}`} points={token.points} />)}
              </clipPath>
              <mask id={`bright-mask-${board.id}`}>
                <rect x="0" y="0" width={width} height={height} fill="white" />
                {lighting.reveals.map((reveal) => renderRevealHole(reveal, tile))}
                {allBrightPolygons.map((token) => <polygon key={`bright-${token.id}`} points={token.points} fill="black" fillOpacity={token.intensity ?? 1} />)}
              </mask>
            </defs>
            {gridVisible && renderBoardGrid(board)}
            {displayDrawings.map((drawing) => renderDraggedGroupItem('drawing', drawing, renderDrawing(drawing, tile, board, selected, isSelected('drawing', drawing.id), boardObjectMotion.drawings[drawing.id])))}
            {boardObjectMotion.exiting.drawings.map((drawing) => renderDrawing(drawing, tile, board, null, false, { className: 'player-object-exit player-svg-motion' }, `exiting-drawing-${drawing.id}`))}
            {liveDrawing.map((drawing) => renderDrawing(drawing, tile, board, selected, isSelected('drawing', drawing.id)))}
            {view === 'dm' && displayWalls.filter((wall) => wall.source !== 'dungeon-scrawl' || activeLayer === 'walls' || isSelected('wall', wall.id)).map((wall) => renderDraggedGroupItem('wall', wall, renderLightingWall(wall, tile, selected, false, isSelected('wall', wall.id))))}
            {displayDoors.map((door) => renderDraggedGroupItem('door', door, renderDoor(door, tile, view, isSelected('door', door.id), boardObjectMotion.doors[door.id])))}
            {boardObjectMotion.exiting.doors.map((door) => renderDoor(door, tile, view, false, { className: 'player-object-exit player-door-motion' }, `exiting-door-${door.id}`))}
            {liveMarquee && (
              <rect
                className="marquee-selection"
                x={liveMarquee.x * tile}
                y={liveMarquee.y * tile}
                width={liveMarquee.w * tile}
                height={liveMarquee.h * tile}
              />
            )}
            {board.liveMeasurement && drag?.type !== 'ruler' && renderLiveShape({ type: 'ruler', ...board.liveMeasurement }, tile, board)}
            {liveShape && renderLiveShape(liveShape, tile, board)}
            {lighting.enabled && (
              <>
                {sourceLightPolygons.filter((light) => light.tone === 'dim').map((light) => <polygon key={`tint-${light.id}`} points={light.points} fill={light.color} opacity={light.intensity * 0.18} />)}
                <rect
                  className={view === 'dm' ? 'lighting-preview' : 'lighting-darkness'}
                  x="0"
                  y="0"
                  width={width}
                  height={height}
                  fill={`rgba(0, 0, 0, ${lighting.darkness})`}
                  mask={`url(#lighting-mask-${board.id})`}
                />
                <g clipPath={`url(#dim-clip-${board.id})`}>
                  <rect
                    className="lighting-dim"
                    x="0"
                    y="0"
                    width={width}
                    height={height}
                    fill={`rgba(0, 0, 0, ${Math.min(0.55, lighting.darkness * 0.48)})`}
                    mask={`url(#bright-mask-${board.id})`}
                  />
                </g>
              </>
            )}
          </svg>

          {[...displayTokens, ...boardObjectMotion.exiting.tokens].map((token) => {
            const motion = token.exiting
              ? { className: 'player-object-exit player-token-motion' }
              : boardObjectMotion.tokens[token.id] || {};
            const footprint = tokenFootprint(token);
            const sourceBox = tokenPixelBox(token, board);
            const isDragging = followsTokenDrag('token', token.id);
            const tokenBox = isDragging
              ? { ...sourceBox, left: sourceBox.left + tokenDragDelta.x, top: sourceBox.top + tokenDragDelta.y }
              : sourceBox;
            const vehicleImage = token.vehicle?.backgroundImage || token.image;
            const isVehicle = token.tokenKind === 'vehicle';
            const isHexToken = token.tokenKind === 'hex50';
            const vehicleRotation = token.vehicle?.rotation || 0;
            const vehicleRotatesSideways = vehicleRotation === 90 || vehicleRotation === 270;
            const vehicleSurfaceWidth = (vehicleRotatesSideways ? footprint.height : footprint.width) * tile;
            const vehicleSurfaceHeight = (vehicleRotatesSideways ? footprint.width : footprint.height) * tile;
            const vehicleImageOffsetX = Number(token.vehicle?.imageOffsetX) || 0;
            const vehicleImageOffsetY = Number(token.vehicle?.imageOffsetY) || 0;
            const vehicleImageScale = Math.max(0.25, Math.min(4, Number(token.vehicle?.imageScale) || 1));
            return (
            <button
              key={token.exiting ? `exiting-token-${token.id}` : token.id}
              className={`map-token token-${token.layer} ${token.image && !isVehicle ? 'token-image' : ''} ${isVehicle ? 'vehicle-token' : ''} ${isHexToken ? 'hex50-token' : ''} ${isVehicle && view === 'player' ? 'vehicle-token-player' : ''} ${vehicleImage && isVehicle ? 'has-vehicle-image' : ''} ${!token.visible ? 'token-hidden' : ''} ${isSelected('token', token.id) ? 'selected' : ''} ${isDragging ? 'token-dragging' : ''} ${motion.className || ''}`}
              style={{
                left: tokenBox.left,
                top: tokenBox.top,
                width: tokenBox.width,
                height: tokenBox.height,
                backgroundColor: token.image || isVehicle ? 'transparent' : token.color,
                '--tile-size': `${tile}px`,
                '--vehicle-surface-width': `${vehicleSurfaceWidth}px`,
                '--vehicle-surface-height': `${vehicleSurfaceHeight}px`,
                ...motion.style,
              }}
              title={`${token.label} (${token.layer})`}
              disabled={token.exiting}
            >
              {isVehicle ? (
                <>
                  <span
                    className="vehicle-token-rotator"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${vehicleRotation}deg)`,
                    }}
                  >
                    <span className="vehicle-token-surface">
                      {vehicleImage && (
                        <img
                          className="vehicle-token-image"
                          src={vehicleImage}
                          alt=""
                          draggable="false"
                          style={{ transform: `translate(${vehicleImageOffsetX}px, ${vehicleImageOffsetY}px) scale(${vehicleImageScale})` }}
                        />
                      )}
                    </span>
                    {view === 'dm' && <span className="vehicle-token-grid" />}
                  </span>
                </>
              ) : token.image ? <img src={token.image} alt="" draggable="false" /> : <span>{token.label}</span>}
            </button>
            );
          })}
          {tokenPrompt && (
            <div className="context-menu token-prompt" style={{ left: tokenPrompt.x, top: tokenPrompt.y }} onPointerDown={(event) => event.stopPropagation()}>
              <span className="token-prompt-title">Add a token here</span>
              <button onClick={() => { onRequestNewToken?.(tokenPrompt.cell); setTokenPrompt(null); }}>New token…</button>
              <button onClick={() => { onRequestLibraryToken?.(tokenPrompt.cell); setTokenPrompt(null); }}>From library…</button>
            </div>
          )}
          {lockedDoorAlert && (
            <div className="door-alert" style={{ left: lockedDoorAlert.x, top: lockedDoorAlert.y }}>
              Locked
            </div>
          )}
        </div>
      </div>
    </div>
    {contextMenu && createPortal((() => {
      const target = contextMenu.target;
      const menuItems = target?.type === 'multi' ? target.items : target ? [target] : [];
      const entityLayers = new Set(menuItems.flatMap((item) => {
        const entity = item.type === 'token' ? board.tokens.find((candidate) => candidate.id === item.id) : item.type === 'drawing' ? board.drawings.find((candidate) => candidate.id === item.id) : null;
        return entity ? [entity.layer === 'dm' ? 'dm' : 'player'] : [];
      }));
      const layerLabel = target?.type === 'multi' ? 'Move all to' : 'Move to';
      const run = (action) => {
        action();
        setContextMenu(null);
        shellRef.current?.focus({ preventScroll: true });
      };
      return (
        <div ref={menuRef} className="context-menu board-context-menu" role="menu" aria-label={target ? 'Selection actions' : 'Board actions'} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const buttons = [...event.currentTarget.querySelectorAll('button')];
            const index = buttons.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            setContextMenu(null);
            shellRef.current?.focus({ preventScroll: true });
          }
        }}>
          <span className="context-menu-heading">{target?.type === 'multi' ? `${menuItems.length} selected objects` : target ? `${target.type === 'wall' ? 'Wall' : target.type === 'door' ? 'Door' : target.type === 'drawing' ? 'Drawing' : 'Token'} actions` : 'Board navigation'}</span>
          {target && <button type="button" role="menuitem" onClick={() => run(() => onDuplicateSelection(target))}>Duplicate <kbd>Ctrl/⌘ D</kbd></button>}
          {target?.type === 'door' && <button type="button" role="menuitem" onClick={() => run(() => onToggleDoor(target.id))}>Toggle open / closed</button>}
          {entityLayers.size > 0 && <div className="context-menu-divider" role="separator" />}
          {entityLayers.has('player') && <button type="button" role="menuitem" onClick={() => run(() => onChangeSelectionLayer?.(target, 'dm'))}>{layerLabel} GM layer</button>}
          {entityLayers.has('dm') && <button type="button" role="menuitem" onClick={() => run(() => onChangeSelectionLayer?.(target, 'player'))}>{layerLabel} Token layer</button>}
          {target && <><div className="context-menu-divider" role="separator" /><button type="button" role="menuitem" className="context-menu-danger" onClick={() => run(() => onDeleteSelection(target))}>Delete selection</button></>}
          {!target && <>
            {view === 'dm' && onToolChange && <><button type="button" role="menuitem" onClick={() => run(() => onToolChange('select'))}>Select tool <kbd>V</kbd></button><button type="button" role="menuitem" onClick={() => run(() => onToolChange('pan'))}>Hand tool <kbd>H</kbd></button><div className="context-menu-divider" role="separator" /></>}
            <button type="button" role="menuitem" onClick={() => run(fitBoard)}>Fit board <kbd>0</kbd></button>
            <button type="button" role="menuitem" onClick={() => run(() => zoomAt(1))}>Reset zoom to 100%</button>
          </>}
        </div>
      );
    })(), document.body)}
    </>
  );
}

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function doorFromPoint(point) {
  const cell = {
    x: Math.max(0, Math.floor(point.x)),
    y: Math.max(0, Math.floor(point.y)),
  };
  const localX = point.x - cell.x;
  const localY = point.y - cell.y;
  const edge = nearestDoorEdge(localX, localY, cell);
  const segment = edge.orientation === 'h'
    ? [[edge.x, edge.y], [edge.x + 1, edge.y]]
    : [[edge.x, edge.y], [edge.x, edge.y + 1]];
  return {
    id: uid('door'),
    type: 'door',
    position: {
      x: (segment[0][0] + segment[1][0]) / 2,
      y: (segment[0][1] + segment[1][1]) / 2,
    },
    edge,
    state: 'closed',
    isLocked: false,
    lightingSegment: segment,
  };
}

function nearestDoorEdge(localX, localY, cell) {
  return [
    { orientation: 'h', x: cell.x, y: cell.y, distance: localY },
    { orientation: 'h', x: cell.x, y: cell.y + 1, distance: 1 - localY },
    { orientation: 'v', x: cell.x, y: cell.y, distance: localX },
    { orientation: 'v', x: cell.x + 1, y: cell.y, distance: 1 - localX },
  ].sort((a, b) => a.distance - b.distance)[0];
}

function renderBoardGrid(board) {
  if (isHexBoard(board)) {
    const cells = [];
    for (let y = -1; y <= board.rows; y += 1) {
      for (let x = -1; x <= board.columns; x += 1) {
        cells.push(<polygon key={`hex-${x}-${y}`} className="hex-grid-cell" points={hexPolygonPoints({ x, y }, board)} />);
      }
    }
    return <g className="hex-grid-layer">{cells}</g>;
  }
  return null;
}

function renderDrawing(drawing, tile, board, selected, selectedOverride = false, motion = {}, keyOverride = null) {
  const isSelected = selectedOverride || (selected?.type === 'drawing' && selected.id === drawing.id);
  const className = `${drawing.layer === 'dm' ? 'drawing-gm' : 'drawing-player'} ${isSelected ? 'selected-drawing' : ''} ${motion.className || ''}`.trim();
  if (drawing.type === 'path') {
    const d = drawing.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * tile} ${point.y * tile}`).join(' ');
    return (
      <path
        key={keyOverride || drawing.id}
        className={className}
        style={motion.style}
        d={d}
        fill="none"
        stroke={drawing.color}
        strokeWidth={isSelected ? drawing.strokeWidth + 2 : drawing.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (drawing.type === 'measurement') {
    return renderMeasurement(drawing, tile, board, isSelected, motion, keyOverride);
  }
  return renderStoredShape(drawing, tile, board, isSelected, motion, keyOverride);
}

function renderMeasurement(drawing, tile, board, isSelected = false, motion = {}, keyOverride = null) {
  const start = drawing.start;
  const end = drawing.end;
  const startCenter = cellCenterPixels(start, board);
  const endCenter = cellCenterPixels(end, board);
  const x1 = startCenter.x;
  const y1 = startCenter.y;
  const x2 = endCenter.x;
  const y2 = endCenter.y;
  return (
    <g key={keyOverride || drawing.id} className={`${isSelected ? 'selected-drawing' : ''} ${motion.className || ''}`.trim()} style={motion.style}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={drawing.color || '#f8fafc'}
        strokeWidth={isSelected ? (drawing.strokeWidth || 4) + 2 : drawing.strokeWidth || 4}
        strokeLinecap="round"
        markerEnd="url(#arrow)"
      />
      <MeasureLabel x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} text={`${feetBetween(start, end, board)} ft`} />
    </g>
  );
}

function renderStoredShape(drawing, tile, board, isSelected = false, motion = {}, keyOverride = null) {
  const box = shapeBox(drawing);
  const x = box.x * tile;
  const y = box.y * tile;
  const w = box.w * tile;
  const h = box.h * tile;
  const common = {
    key: `${drawing.id}-shape`,
    className: `${drawing.layer === 'dm' ? 'drawing-gm' : 'drawing-player'} ${isSelected ? 'selected-drawing' : ''}`.trim(),
    fill: drawing.fill,
    stroke: drawing.color,
    strokeWidth: isSelected ? drawing.strokeWidth + 2 : drawing.strokeWidth,
  };
  const label = shapeMeasurement(drawing, board);

  if (drawing.shape === 'circle') {
    return (
      <g key={keyOverride || drawing.id} className={motion.className} style={motion.style}>
        <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
        <MeasureLabel x={x + w / 2} y={y + h / 2} text={label} />
      </g>
    );
  }
  if (drawing.shape === 'cone') {
    const cone = coneTemplate(drawing);
    const points = [
      `${cone.start.x * tile},${cone.start.y * tile}`,
      ...cone.arc.map((point) => `${point.x * tile},${point.y * tile}`),
    ].join(' ');
    return (
      <g key={keyOverride || drawing.id} className={motion.className} style={motion.style}>
        <polygon {...common} points={points} />
        <MeasureLabel x={cone.label.x * tile} y={cone.label.y * tile} text={label} />
      </g>
    );
  }
  return (
    <g key={keyOverride || drawing.id} className={motion.className} style={motion.style}>
      <rect {...common} x={x} y={y} width={w} height={h} rx="4" />
      <MeasureLabel x={x + w / 2} y={y + h / 2} text={label} />
    </g>
  );
}

function renderLiveShape(shape, tile, board) {
  const start = shape.start;
  const end = shape.end;
  if (shape.type === 'wall') {
    return renderLightingWall({ id: 'live-wall', start, end }, tile, null, true);
  }
  if (shape.type === 'light' || shape.type === 'light-hide') {
    const box = revealBox(shape);
    return <rect key="live-light" className={shape.type === 'light-hide' ? 'live-light-hide' : 'live-light-reveal'} x={box.x * tile} y={box.y * tile} width={box.w * tile} height={box.h * tile} rx="4" />;
  }
  if (shape.type === 'ruler') {
    return renderMeasurement({ id: 'live-ruler', type: 'measurement', start, end, color: '#f8fafc', strokeWidth: 4 }, tile, board);
  }
  return renderStoredShape({
    id: 'live-shape',
    type: 'shape',
    shape: shape.type === 'shape' ? 'rect' : shape.type,
    color: '#f8fafc',
    fill: 'rgba(248, 250, 252, 0.14)',
    strokeWidth: 3,
    start,
    end,
  }, tile, board);
}

function renderLightingWall(wall, tile, selected = null, isLive = false, selectedOverride = false) {
  const points = wallEndpoints(wall, tile);
  const isSelected = selectedOverride || (selected?.type === 'wall' && selected.id === wall.id);
  return (
    <g key={`wall-${wall.id}`} className={`${isLive ? 'live-light-wall' : 'lighting-wall'} ${isSelected ? 'selected-lighting-wall' : ''}`}>
      <line x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2} />
      <circle cx={points.x1} cy={points.y1} r="5" />
      <circle cx={points.x2} cy={points.y2} r="5" />
    </g>
  );
}

function renderDoor(door, tile, view, isSelected = false, motion = {}, keyOverride = null) {
  const x = door.position.x * tile;
  const y = door.position.y * tile;
  const isOpen = door.state === 'open';
  const isLocked = door.state === 'locked' || door.isLocked;
  const [start, end] = door.lightingSegment || [[0, 0], [0, 0]];
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const rotation = dx || dy ? Math.atan2(dy, dx) * 180 / Math.PI : door.edge?.orientation === 'v' ? 90 : 0;
  const doorWidth = door.source === 'dungeon-scrawl' ? Math.max(10, Math.hypot(dx, dy) * tile) : 26;
  return (
    <g key={keyOverride || `door-${door.id}`} className={`door-icon door-${isLocked ? 'locked' : door.state} ${isSelected ? 'selected-door' : ''} ${motion.className || ''}`} style={motion.style} transform={`translate(${x} ${y}) rotate(${isOpen ? rotation + 28 : rotation})`}>
      <title>{isLocked && view === 'player' ? 'Locked' : `Door: ${door.state}`}</title>
      <rect x={-doorWidth / 2} y="-5" width={doorWidth} height="10" rx="3" />
      <circle cx={doorWidth / 2 - 5} cy="0" r="2.2" />
    </g>
  );
}

function doorWall(door) {
  const [start, end] = door.lightingSegment || [[0, 0], [0, 0]];
  return {
    id: `door-wall-${door.id}`,
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    freeform: true,
    sourceType: 'door',
  };
}

function marqueeBounds(drag) {
  const x = Math.min(drag.start.x, drag.end.x);
  const y = Math.min(drag.start.y, drag.end.y);
  return { x, y, w: Math.abs(drag.end.x - drag.start.x), h: Math.abs(drag.end.y - drag.start.y) };
}

function selectablesInBounds(bounds, board, tokens, drawings, walls, doors) {
  return [
    ...tokens.map((token) => ({ type: 'token', id: token.id, bounds: selectableBounds(token, 'token') })),
    ...drawings.map((drawing) => ({ type: 'drawing', id: drawing.id, bounds: selectableBounds(drawing, 'drawing') })),
    ...walls.map((wall) => ({ type: 'wall', id: wall.id, bounds: selectableBounds(wall, 'wall') })),
    ...doors.map((door) => ({ type: 'door', id: door.id, bounds: selectableBounds(door, 'door') })),
  ]
    .filter((item) => item.bounds && boundsOverlap(bounds, item.bounds))
    .map(({ type, id }) => ({ type, id }));
}

function boundsOverlap(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function isGroupEntityDrag(drag) {
  return ['token', 'drawing', 'wall-move', 'door'].includes(drag?.type);
}

function visibleTokensForLayer(tokens, activeLayer) {
  if (activeLayer === 'gm') return tokens.filter((token) => token.layer === 'dm');
  if (activeLayer === 'token') return tokens.filter((token) => token.layer === 'player');
  return [];
}

function useBoardObjectMotion(enabled, collections, tile, board) {
  const previousRef = useRef(null);
  const clearTimerRef = useRef(null);
  const [motion, setMotion] = useState(emptyMotionState);

  useEffect(() => () => {
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!enabled) {
      previousRef.current = null;
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      setMotion((currentMotion) => hasMotionState(currentMotion) ? emptyMotionState() : currentMotion);
      return undefined;
    }

    const current = snapshotBoardObjects(collections, tile, board);
    const previous = previousRef.current;
    previousRef.current = current;

    if (!previous) return undefined;

    const nextMotion = buildBoardObjectMotion(previous, current);
    if (!nextMotion.hasChanges) return undefined;

    setMotion(nextMotion.state);
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setMotion(emptyMotionState());
    }, 360);
    return undefined;
  }, [enabled, collections.tokens, collections.drawings, collections.doors, tile, board]);

  return motion;
}

function emptyMotionState() {
  return {
    tokens: {},
    drawings: {},
    doors: {},
    exiting: {
      tokens: [],
      drawings: [],
      doors: [],
    },
  };
}

function hasMotionState(state) {
  return Boolean(
    Object.keys(state.tokens).length
      || Object.keys(state.drawings).length
      || Object.keys(state.doors).length
      || state.exiting.tokens.length
      || state.exiting.drawings.length
      || state.exiting.doors.length,
  );
}

function snapshotBoardObjects(collections, tile, board) {
  return {
    tokens: snapshotById(collections.tokens, (token) => ({
      center: tokenCenterPixels(token, board),
      item: cloneBoardObject(token),
    })),
    drawings: snapshotById(collections.drawings, (drawing) => ({
      center: boundsCenter(selectableBounds(drawing, 'drawing'), tile),
      item: cloneBoardObject(drawing),
    })),
    doors: snapshotById(collections.doors, (door) => ({
      center: {
        x: door.position.x * tile,
        y: door.position.y * tile,
      },
      item: cloneBoardObject(door),
    })),
  };
}

function snapshotById(items, makeSnapshot) {
  return Object.fromEntries(items.map((item) => [item.id, makeSnapshot(item)]));
}

function buildBoardObjectMotion(previous, current) {
  const state = emptyMotionState();
  let hasChanges = false;

  buildMotionForType('tokens', 'token', previous, current, state);
  buildMotionForType('drawings', 'svg', previous, current, state);
  buildMotionForType('doors', 'door', previous, current, state);

  hasChanges = hasMotionState(state);

  return { hasChanges, state };
}

function buildMotionForType(type, classType, previous, current, state) {
  Object.entries(current[type]).forEach(([id, item]) => {
    const oldItem = previous[type][id];
    if (!oldItem) {
      state[type][id] = { className: `player-object-enter player-${classType}-motion` };
      return;
    }

    const dx = oldItem.center.x - item.center.x;
    const dy = oldItem.center.y - item.center.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      state[type][id] = {
        className: `player-object-move player-${classType}-motion`,
        style: {
          '--motion-x': `${dx}px`,
          '--motion-y': `${dy}px`,
        },
      };
    }
  });

  Object.entries(previous[type]).forEach(([id, item]) => {
    if (current[type][id]) return;
    state.exiting[type].push({ ...item.item, exiting: true });
  });
}

function boundsCenter(bounds, tile) {
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: (bounds.x + bounds.w / 2) * tile,
    y: (bounds.y + bounds.h / 2) * tile,
  };
}

function cloneBoardObject(item) {
  if (typeof structuredClone === 'function') return structuredClone(item);
  return JSON.parse(JSON.stringify(item));
}

function renderRevealHole(reveal, tile, fill = 'black') {
  const box = revealBox(reveal);
  return (
    <rect
      key={`reveal-${reveal.id}`}
      x={box.x * tile}
      y={box.y * tile}
      width={box.w * tile}
      height={box.h * tile}
      rx="8"
      fill={fill}
    />
  );
}

function tokenHasVision(token) {
  return token.visionEnabled !== false && (Number(token.visionBrightFeet ?? token.visionFeet) > 0 || Number(token.visionDimFeet ?? token.visionFeet) > 0);
}

function tokenIsInRevealedLight(token, lighting, visionPolygons, board) {
  const point = tokenCenter(token, board);
  const tile = Number(board.tileSize) || 42;
  const inReveal = (lighting.reveals || []).some((reveal) => pointInBox(point, revealBox(reveal)));
  const hiddenByReveal = (lighting.hiddenReveals || []).some((reveal) => pointInBox(point, revealBox(reveal)));
  if (inReveal && !hiddenByReveal) return true;

  return visionPolygons.some((polygon) => pointInPolygonPixels(
    { x: point.x * tile, y: point.y * tile },
    polygon.points,
  ));
}

function tokenCenterPixels(token, board) {
  const center = tokenCenter(token, board);
  const tile = Number(board.tileSize) || 42;
  return { x: center.x * tile, y: center.y * tile };
}

function pointIsInAnyPolygon(point, polygons) {
  return polygons.some((polygon) => pointInPolygonPixels(point, polygon.points));
}

function clampPoint(point, board) {
  return {
    x: Math.max(0, Math.min(board.columns, point.x)),
    y: Math.max(0, Math.min(board.rows, point.y)),
  };
}

function rotateDelta(dx, dy, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function pointInBox(point, box) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function pointInPolygonPixels(point, polygonPoints) {
  const points = polygonPoints
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
  if (points.length < 3) return false;

  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[current];
    const b = points[previous];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function getRotationOffset(rotation, width, height, scale) {
  if (rotation === 90) return { x: height * scale, y: 0 };
  if (rotation === 180) return { x: width * scale, y: height * scale };
  if (rotation === 270) return { x: 0, y: width * scale };
  return { x: 0, y: 0 };
}

function MeasureLabel({ x, y, text }) {
  return (
    <g className="measure-label">
      <rect x={x - 44} y={y - 13} width="88" height="26" rx="6" />
      <text x={x} y={y + 5} textAnchor="middle">{text}</text>
    </g>
  );
}
