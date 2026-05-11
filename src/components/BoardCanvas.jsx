import React, { useEffect, useRef, useState } from 'react';
import {
  feetBetween,
  isPointInDrawing,
  normalizeBackground,
  revealBox,
  shapeBox,
  shapeMeasurement,
  snapToTile,
  uid,
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
  onAddDrawing,
  onMoveDrawing,
  onMoveBackground,
  onAddLightReveal,
  onDeleteSelection,
  onDuplicateSelection,
  fitToViewport = false,
  playerZoom = 1,
}) {
  const [drag, setDrag] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const shellRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const tile = board.tileSize;
  const width = board.columns * tile;
  const height = board.rows * tile;
  const scale = fitScale * playerZoom;
  const visibleTokens = board.tokens.filter((token) => view === 'dm' || (token.layer === 'player' && token.visible));
  const visibleDrawings = board.drawings.filter((drawing) => view === 'dm' || (drawing.layer === 'player' && drawing.visible !== false));
  const background = normalizeBackground(board.background);
  const lighting = { enabled: false, darkness: 0.86, reveals: [], ...board.lighting };

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

  const onPointerDown = (event) => {
    if (view !== 'dm') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const snapped = snapToTile(point, board);
    const token = tokenAt(point);
    const drawing = drawingAt(point);

    if (tool === 'background') {
      const bgWidth = width * background.scale;
      const bgHeight = height * background.scale;
      const nearResize = point.px > background.x + bgWidth - 32 && point.py > background.y + bgHeight - 32;
      setDrag({ type: nearResize ? 'background-resize' : 'background', start: { x: point.px, y: point.py }, original: background });
      setSelected(null);
      return;
    }

    if (tool === 'token') {
      onAddToken(snapped);
      return;
    }

    if (tool === 'select' && token) {
      setSelected({ type: 'token', id: token.id });
      setDrag({ type: 'token', id: token.id, offset: { x: point.x - token.x, y: point.y - token.y } });
      return;
    }

    if (tool === 'select' && drawing) {
      setSelected({ type: 'drawing', id: drawing.id });
      setDrag({ type: 'drawing', id: drawing.id, last: snapped });
      return;
    }

    if (tool === 'select') {
      setSelected(null);
      return;
    }

    if (['ruler', 'square', 'circle', 'cone', 'shape', 'light'].includes(tool)) {
      setDrag({ type: tool, start: snapped, end: snapped });
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
      onMoveToken(drag.id, {
        x: Math.max(0, Math.min(board.columns - 1, Math.floor(point.x - drag.offset.x))),
        y: Math.max(0, Math.min(board.rows - 1, Math.floor(point.y - drag.offset.y))),
      });
      return;
    }

    if (drag.type === 'drawing') {
      const dx = snapped.x - drag.last.x;
      const dy = snapped.y - drag.last.y;
      if (dx || dy) {
        onMoveDrawing(drag.id, dx, dy);
        setDrag({ ...drag, last: snapped });
      }
      return;
    }

    if (drag.type === 'draw') {
      setDrag({ ...drag, points: [...drag.points, point] });
      return;
    }

    setDrag({ ...drag, end: snapped });
  };

  const onBoardPointerDown = (event) => {
    setContextMenu(null);
    if (view === 'player') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ type: 'pan', start: { x: event.clientX, y: event.clientY }, original: pan });
      return;
    }
    onPointerDown(event);
  };

  const onContextMenu = (event) => {
    if (view !== 'dm') return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const token = tokenAt(point);
    const drawing = drawingAt(point);
    if (!token && !drawing) return;
    const target = token ? { type: 'token', id: token.id } : { type: 'drawing', id: drawing.id };
    setSelected(target);
    setContextMenu({ x: point.px, y: point.py, target });
  };

  const onPointerUp = () => {
    if (!drag) return;
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
    setDrag(null);
  };

  const liveDrawing = drag?.type === 'draw'
    ? [{ id: 'live-draw', type: 'path', points: drag.points, color: drawColor, strokeWidth: 4, layer: drawLayer }]
    : [];
  const liveShape = drag && ['square', 'circle', 'cone', 'shape', 'ruler', 'light'].includes(drag.type) ? drag : null;

  return (
    <div className={`board-shell ${fitToViewport ? 'board-shell-fit' : ''}`} ref={shellRef}>
      <div className="board-stage" style={{ width: width * scale, height: height * scale }}>
        <div
          className={`board ${fitToViewport ? 'board-fit' : ''}`}
          style={{ width, height, '--tile': `${tile}px`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
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
                left: background.x,
                top: background.y,
                width: width * background.scale,
                opacity: background.opacity,
              }}
            />
          )}
          {tool === 'background' && view === 'dm' && background.src && (
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
                {visibleTokens.filter((token) => token.layer === 'player' && token.visible && Number(token.visionFeet) > 0).map((token) => (
                  <circle
                    key={`vision-${token.id}`}
                    cx={(token.x + token.size / 2) * tile}
                    cy={(token.y + token.size / 2) * tile}
                    r={(Number(token.visionFeet) / 5) * tile}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            {[...visibleDrawings, ...liveDrawing].map((drawing) => renderDrawing(drawing, tile, selected))}
            {liveShape && renderLiveShape(liveShape, tile)}
            {lighting.enabled && (
              <rect
                className={view === 'dm' ? 'lighting-preview' : 'lighting-darkness'}
                x="0"
                y="0"
                width={width}
                height={height}
                fill={`rgba(0, 0, 0, ${lighting.darkness})`}
                mask={`url(#lighting-mask-${board.id})`}
              />
            )}
          </svg>

          {visibleTokens.map((token) => (
            <button
              key={token.id}
              className={`map-token token-${token.layer} ${!token.visible ? 'token-hidden' : ''} ${selected?.type === 'token' && selected.id === token.id ? 'selected' : ''}`}
              style={{
                left: token.x * tile,
                top: token.y * tile,
                width: token.size * tile,
                height: token.size * tile,
                background: token.color,
                backgroundImage: token.image ? `url(${token.image})` : undefined,
              }}
              title={`${token.label} (${token.layer})`}
            >
              <span>{token.label}</span>
            </button>
          ))}
          {contextMenu && (
            <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
              <button onClick={() => { onDuplicateSelection(contextMenu.target); setContextMenu(null); }}>Duplicate</button>
              <button onClick={() => { onDeleteSelection(contextMenu.target); setContextMenu(null); }}>Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderDrawing(drawing, tile, selected) {
  const isSelected = selected?.type === 'drawing' && selected.id === drawing.id;
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
  return renderStoredShape(drawing, tile, isSelected);
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
    const points = `${(drawing.start.x + 0.5) * tile},${(drawing.start.y + 0.5) * tile} ${(drawing.end.x + 1) * tile},${(drawing.end.y + 1) * tile} ${drawing.end.x * tile},${drawing.end.y * tile}`;
    return (
      <g key={drawing.id}>
        <polygon {...common} points={points} />
        <MeasureLabel x={x + w / 2} y={y + h / 2} text={label} />
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
  if (shape.type === 'light') {
    const box = revealBox(shape);
    return <rect key="live-light" className="live-light-reveal" x={box.x * tile} y={box.y * tile} width={box.w * tile} height={box.h * tile} rx="4" />;
  }
  if (shape.type === 'ruler') {
    const x1 = (start.x + 0.5) * tile;
    const y1 = (start.y + 0.5) * tile;
    const x2 = (end.x + 0.5) * tile;
    const y2 = (end.y + 0.5) * tile;
    return (
      <g key="live-ruler">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f8fafc" strokeWidth="4" markerEnd="url(#arrow)" />
        <MeasureLabel x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} text={`${feetBetween(start, end)} ft`} />
      </g>
    );
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

function renderRevealHole(reveal, tile) {
  const box = revealBox(reveal);
  return (
    <rect
      key={`reveal-${reveal.id}`}
      x={box.x * tile}
      y={box.y * tile}
      width={box.w * tile}
      height={box.h * tile}
      rx="8"
      fill="black"
    />
  );
}

function MeasureLabel({ x, y, text }) {
  return (
    <g className="measure-label">
      <rect x={x - 44} y={y - 13} width="88" height="26" rx="6" />
      <text x={x} y={y + 5} textAnchor="middle">{text}</text>
    </g>
  );
}
