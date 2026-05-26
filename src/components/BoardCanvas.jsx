import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  coneTemplate,
  feetBetween,
  isPointInDrawing,
  isPointNearWall,
  normalizeBackground,
  offsetEntity,
  offsetDrawing,
  revealBox,
  selectableBounds,
  shapeBox,
  shapeMeasurement,
  snapToTile,
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
  drawLayer = 'player',
  drawColor = '#36d399',
  onAddToken,
  onMoveToken,
  onMoveSelection,
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
  fitToViewport = false,
  playerZoom = 1,
  playerRotation = 0,
}) {
  const [drag, setDrag] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [lockedDoorAlert, setLockedDoorAlert] = useState(null);
  const shellRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const tile = board.tileSize;
  const width = board.columns * tile;
  const height = board.rows * tile;
  const scale = fitScale * playerZoom;
  const normalizedRotation = ((playerRotation % 360) + 360) % 360;
  const isRotatedSideways = normalizedRotation === 90 || normalizedRotation === 270;
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
  const brightPolygons = useMemo(() => (
    playerTokens
      .filter((token) => token.visionEnabled !== false && Number(token.visionBrightFeet ?? token.visionFeet) > 0)
        .map((token) => ({ id: `vision-bright-${token.id}`, points: visionPolygonPoints(token, activeLightingWalls, tile, token.visionBrightFeet ?? token.visionFeet) }))
  ), [activeLightingWalls, playerTokens, tile]);
  const dimPolygons = useMemo(() => (
    playerTokens
      .filter((token) => token.visionEnabled !== false && Number(token.visionDimFeet ?? token.visionFeet) > 0)
        .map((token) => ({ id: `vision-dim-${token.id}`, points: visionPolygonPoints(token, activeLightingWalls, tile, token.visionDimFeet ?? token.visionFeet) }))
  ), [activeLightingWalls, playerTokens, tile]);
  const lightPolygons = useMemo(() => {
    const playerVision = [...brightPolygons, ...dimPolygons];
    return board.tokens
      .filter((token) => token.visible !== false && (Number(token.lightBrightFeet) > 0 || Number(token.lightDimFeet) > 0))
      .filter((token) => token.layer === 'player' || pointIsInAnyPolygon(tokenCenterPixels(token, tile), playerVision))
      .flatMap((token) => [
        Number(token.lightBrightFeet) > 0 ? { id: `light-bright-${token.id}`, tone: 'bright', points: visionPolygonPoints(token, activeLightingWalls, tile, token.lightBrightFeet) } : null,
        Number(token.lightDimFeet) > 0 ? { id: `light-dim-${token.id}`, tone: 'dim', points: visionPolygonPoints(token, activeLightingWalls, tile, token.lightDimFeet) } : null,
      ].filter(Boolean));
  }, [activeLightingWalls, board.tokens, brightPolygons, dimPolygons, tile]);
  const allBrightPolygons = useMemo(() => [...brightPolygons, ...lightPolygons.filter((item) => item.tone === 'bright')], [brightPolygons, lightPolygons]);
  const allDimPolygons = useMemo(() => [...dimPolygons, ...lightPolygons], [dimPolygons, lightPolygons]);
  const visibleDoors = useMemo(() => {
    if (view === 'dm' || !lighting.enabled) return doors;
    return doors.filter((door) => pointIsInAnyPolygon({ x: door.position.x * tile, y: door.position.y * tile }, allDimPolygons));
  }, [allDimPolygons, doors, lighting.enabled, tile, view]);
  const visibleTokens = useMemo(() => {
    if (view === 'dm' || !lighting.enabled) return dmTokens;
    return dmTokens.filter((token) => tokenHasVision(token) || tokenIsInRevealedLight(token, lighting, allDimPolygons, tile));
  }, [allDimPolygons, dmTokens, lighting, tile, view]);

  useEffect(() => {
    if (!fitToViewport || !shellRef.current) {
      setFitScale(1);
      return undefined;
    }
    const shell = shellRef.current;
    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const nextScale = Math.min(rect.width / width, rect.height / height, 1);
      setFitScale(Math.max(0.2, nextScale));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [fitToViewport, width, height]);

  const pointFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / (tile * scale),
      y: (event.clientY - rect.top) / (tile * scale),
      px: (event.clientX - rect.left) / scale,
      py: (event.clientY - rect.top) / scale,
    };
  };

  const tokenAt = (point) => [...visibleTokens].reverse().find((token) => (
    point.x >= token.x && point.x <= token.x + token.size && point.y >= token.y && point.y <= token.y + token.size
  ));

  const drawingAt = (point) => [...visibleDrawings].reverse().find((drawing) => isPointInDrawing(point, drawing));
  const wallAt = (point) => [...lighting.walls].reverse().find((wall) => isPointNearWall(point, wall));
  const doorAt = (point) => [...visibleDoors].reverse().find((door) => Math.hypot(point.x - door.position.x, point.y - door.position.y) <= 0.45);
  const isSelected = (type, id) => selectedItems.some((item) => item.type === type && item.id === id);

  const onPointerDown = (event) => {
    if (view !== 'dm') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const snapped = snapToTile(point, board);
    const wallPoint = lighting.snapWallsToGrid ? snapped : clampPoint(point, board);
    const token = tokenAt(point);
    const drawing = drawingAt(point);
    const wall = wallAt(point);
    const door = doorAt(point);

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

    if (tool === 'token') {
      onAddToken(snapped);
      return;
    }

    if (tool === 'door') {
      onAddDoor?.(doorFromPoint(point));
      return;
    }

    if (tool === 'select' && token) {
      const isGroupDrag = isSelected('token', token.id) && selected?.type === 'multi';
      if (!isGroupDrag) setSelected({ type: 'token', id: token.id });
      setDrag({
        type: 'token',
        id: token.id,
        offset: { x: point.x - token.x, y: point.y - token.y },
        original: { x: token.x, y: token.y },
        preview: { x: token.x, y: token.y },
        group: isGroupDrag ? selected.items : null,
      });
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

    if (['ruler', 'square', 'circle', 'cone', 'shape', 'light', 'wall'].includes(tool)) {
      const type = tool === 'light' && event.button === 2 ? 'light-hide' : tool;
      setDrag({ type, start: type === 'wall' ? wallPoint : snapped, end: type === 'wall' ? wallPoint : snapped, freeform: type === 'wall' && !lighting.snapWallsToGrid });
      return;
    }

    if (tool === 'draw') {
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

    if (drag.type === 'pan') {
      setPan({ x: drag.original.x + event.clientX - drag.start.x, y: drag.original.y + event.clientY - drag.start.y });
      return;
    }

    if (drag.type === 'token') {
      const preview = {
        x: Math.max(0, Math.min(board.columns - 1, Math.floor(point.x - drag.offset.x))),
        y: Math.max(0, Math.min(board.rows - 1, Math.floor(point.y - drag.offset.y))),
      };
      setDrag({
        ...drag,
        preview,
        dx: preview.x - drag.original.x,
        dy: preview.y - drag.original.y,
      });
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

  const onBoardPointerDown = (event) => {
    setContextMenu(null);
    if (view === 'player') {
      const point = pointFromEvent(event);
      const door = doorAt(point);
      if (door) {
        if (door.state === 'locked' || door.isLocked) {
          setLockedDoorAlert({ x: point.px, y: point.py, id: door.id });
          window.setTimeout(() => setLockedDoorAlert((alert) => alert?.id === door.id ? null : alert), 1200);
          return;
        }
        onToggleDoor?.(door.id);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ type: 'pan', start: { x: event.clientX, y: event.clientY }, original: pan });
      return;
    }
    onPointerDown(event);
  };

  const onContextMenu = (event) => {
    if (view !== 'dm') return;
    event.preventDefault();
    if (tool === 'light') return;
    const point = pointFromEvent(event);
    const token = tokenAt(point);
    const drawing = drawingAt(point);
    const wall = wallAt(point);
    const door = doorAt(point);
    if (!token && !drawing && !door && !wall) return;
    const target = token ? { type: 'token', id: token.id } : drawing ? { type: 'drawing', id: drawing.id } : door ? { type: 'door', id: door.id } : { type: 'wall', id: wall.id };
    setSelected(target);
    setContextMenu({ x: point.px, y: point.py, target });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.type === 'token') {
      if (drag.group?.length && (drag.dx || drag.dy)) onMoveSelection(drag.group, drag.dx, drag.dy);
      else onMoveToken(drag.id, drag.preview);
    }
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
      onSelectMultiple?.(selectablesInBounds(marqueeBounds(drag), board, visibleTokens, visibleDrawings, lighting.walls, visibleDoors), drag.mode);
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
      if (feetBetween(drag.start, drag.end) > 0) {
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
    isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'token' && item.id === token.id)
      ? { ...token, x: token.x + (drag.dx || 0), y: token.y + (drag.dy || 0) }
      : drag?.type === 'token' && drag.id === token.id ? { ...token, ...drag.preview } : token
  ));
  const displayDrawings = visibleDrawings.map((drawing) => (
    isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'drawing' && item.id === drawing.id)
      ? { ...drawing, ...offsetDrawing(drawing, drag.dx || 0, drag.dy || 0) }
      : drag?.type === 'drawing' && drag.id === drawing.id ? { ...drawing, ...offsetDrawing(drawing, drag.dx, drag.dy) } : drawing
  ));
  const displayWalls = lighting.walls.map((wall) => (
    isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'wall' && item.id === wall.id)
      ? offsetEntity(wall, 'wall', drag.dx || 0, drag.dy || 0)
      : drag?.type === 'wall-move' && drag.id === wall.id ? drag.preview : wall
  ));
  const displayDoors = visibleDoors.map((door) => (
    isGroupEntityDrag(drag) && drag.group?.some((item) => item.type === 'door' && item.id === door.id)
      ? offsetEntity(door, 'door', drag.dx || 0, drag.dy || 0)
      : drag?.type === 'door' && drag.id === door.id ? drag.preview : door
  ));
  const liveMarquee = drag?.type === 'marquee' ? marqueeBounds(drag) : null;

  return (
    <div className={`board-shell ${fitToViewport ? 'board-shell-fit' : ''}`} ref={shellRef}>
      <div className="board-stage" style={{ width: stageWidth, height: stageHeight }}>
        <div
          className={`board ${fitToViewport ? 'board-fit' : ''}`}
          style={{
            width,
            height,
            '--tile': `${tile}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) translate(${rotationOffset.x}px, ${rotationOffset.y}px) rotate(${normalizedRotation}deg) scale(${scale})`,
          }}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onContextMenu={onContextMenu}
        >
          {background.src && (
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
                  />
                ))}
              </mask>
              <clipPath id={`dim-clip-${board.id}`}>
                {allDimPolygons.map((token) => <polygon key={`dim-clip-${token.id}`} points={token.points} />)}
              </clipPath>
              <mask id={`bright-mask-${board.id}`}>
                <rect x="0" y="0" width={width} height={height} fill="white" />
                {lighting.reveals.map((reveal) => renderRevealHole(reveal, tile))}
                {allBrightPolygons.map((token) => <polygon key={`bright-${token.id}`} points={token.points} fill="black" />)}
              </mask>
            </defs>
            {[...displayDrawings, ...liveDrawing].map((drawing) => renderDrawing(drawing, tile, selected, isSelected('drawing', drawing.id)))}
            {view === 'dm' && displayWalls.map((wall) => renderLightingWall(wall, tile, selected, false, isSelected('wall', wall.id)))}
            {displayDoors.map((door) => renderDoor(door, tile, view, isSelected('door', door.id)))}
            {liveMarquee && (
              <rect
                className="marquee-selection"
                x={liveMarquee.x * tile}
                y={liveMarquee.y * tile}
                width={liveMarquee.w * tile}
                height={liveMarquee.h * tile}
              />
            )}
            {board.liveMeasurement && drag?.type !== 'ruler' && renderLiveShape({ type: 'ruler', ...board.liveMeasurement }, tile)}
            {liveShape && renderLiveShape(liveShape, tile)}
            {lighting.enabled && (
              <>
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

          {displayTokens.map((token) => (
            <button
              key={token.id}
              className={`map-token token-${token.layer} ${token.image ? 'token-image' : ''} ${!token.visible ? 'token-hidden' : ''} ${isSelected('token', token.id) ? 'selected' : ''}`}
              style={{
                left: token.x * tile,
                top: token.y * tile,
                width: token.size * tile,
                height: token.size * tile,
                backgroundColor: token.image ? 'transparent' : token.color,
              }}
              title={`${token.label} (${token.layer})`}
            >
              {token.image ? <img src={token.image} alt="" draggable="false" /> : <span>{token.label}</span>}
            </button>
          ))}
          {contextMenu && (
            <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
              <button onClick={() => { onDuplicateSelection(contextMenu.target); setContextMenu(null); }}>Duplicate</button>
              {contextMenu.target.type === 'door' && <button onClick={() => { onToggleDoor(contextMenu.target.id); setContextMenu(null); }}>Toggle open/closed</button>}
              <button onClick={() => { onDeleteSelection(contextMenu.target); setContextMenu(null); }}>Delete</button>
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
  );
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

function renderDrawing(drawing, tile, selected, selectedOverride = false) {
  const isSelected = selectedOverride || (selected?.type === 'drawing' && selected.id === drawing.id);
  if (drawing.type === 'path') {
    const d = drawing.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * tile} ${point.y * tile}`).join(' ');
    return (
      <path
        key={drawing.id}
        className={isSelected ? 'selected-drawing' : ''}
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
    return renderMeasurement(drawing, tile, isSelected);
  }
  return renderStoredShape(drawing, tile, isSelected);
}

function renderMeasurement(drawing, tile, isSelected = false) {
  const start = drawing.start;
  const end = drawing.end;
  const x1 = (start.x + 0.5) * tile;
  const y1 = (start.y + 0.5) * tile;
  const x2 = (end.x + 0.5) * tile;
  const y2 = (end.y + 0.5) * tile;
  return (
    <g key={drawing.id} className={isSelected ? 'selected-drawing' : ''}>
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
      <MeasureLabel x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} text={`${feetBetween(start, end)} ft`} />
    </g>
  );
}

function renderStoredShape(drawing, tile, isSelected = false) {
  const box = shapeBox(drawing);
  const x = box.x * tile;
  const y = box.y * tile;
  const w = box.w * tile;
  const h = box.h * tile;
  const common = {
    key: `${drawing.id}-shape`,
    className: isSelected ? 'selected-drawing' : '',
    fill: drawing.fill,
    stroke: drawing.color,
    strokeWidth: isSelected ? drawing.strokeWidth + 2 : drawing.strokeWidth,
  };
  const label = shapeMeasurement(drawing);

  if (drawing.shape === 'circle') {
    return (
      <g key={drawing.id}>
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
      <g key={drawing.id}>
        <polygon {...common} points={points} />
        <MeasureLabel x={cone.label.x * tile} y={cone.label.y * tile} text={label} />
      </g>
    );
  }
  return (
    <g key={drawing.id}>
      <rect {...common} x={x} y={y} width={w} height={h} rx="4" />
      <MeasureLabel x={x + w / 2} y={y + h / 2} text={label} />
    </g>
  );
}

function renderLiveShape(shape, tile) {
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
    return renderMeasurement({ id: 'live-ruler', type: 'measurement', start, end, color: '#f8fafc', strokeWidth: 4 }, tile);
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
  }, tile);
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

function renderDoor(door, tile, view, isSelected = false) {
  const x = door.position.x * tile;
  const y = door.position.y * tile;
  const isOpen = door.state === 'open';
  const isLocked = door.state === 'locked' || door.isLocked;
  const rotation = door.edge?.orientation === 'v' ? 90 : 0;
  return (
    <g key={`door-${door.id}`} className={`door-icon door-${isLocked ? 'locked' : door.state} ${isSelected ? 'selected-door' : ''}`} transform={`translate(${x} ${y}) rotate(${isOpen ? rotation + 28 : rotation})`}>
      <title>{isLocked && view === 'player' ? 'Locked' : `Door: ${door.state}`}</title>
      <rect x="-13" y="-5" width="26" height="10" rx="3" />
      <circle cx="8" cy="0" r="2.2" />
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

function tokenIsInRevealedLight(token, lighting, visionPolygons, tile) {
  const point = {
    x: token.x + token.size / 2,
    y: token.y + token.size / 2,
  };
  const inReveal = (lighting.reveals || []).some((reveal) => pointInBox(point, revealBox(reveal)));
  const hiddenByReveal = (lighting.hiddenReveals || []).some((reveal) => pointInBox(point, revealBox(reveal)));
  if (inReveal && !hiddenByReveal) return true;

  return visionPolygons.some((polygon) => pointInPolygonPixels(
    { x: point.x * tile, y: point.y * tile },
    polygon.points,
  ));
}

function tokenCenterPixels(token, tile) {
  return {
    x: (token.x + token.size / 2) * tile,
    y: (token.y + token.size / 2) * tile,
  };
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
