import { hexCellMetrics, isHexBoard, snapToTile, tokenFootprint, tokenPixelBox } from './board.js';

const clamp = (value, maximum) => Math.max(0, Math.min(Math.max(0, maximum), value));

/** Keep the moving token under the board-space pointer; snap only its eventual drop. */
export function getTokenDragPlacement(token, board, { px, py }) {
  const originalBox = tokenPixelBox(token, board);
  const previewBox = {
    left: px - originalBox.width / 2,
    top: py - originalBox.height / 2,
    width: originalBox.width,
    height: originalBox.height,
  };
  const footprint = tokenFootprint(token);
  const tile = Number(board.tileSize) || 42;
  let drop;
  if (isHexBoard(board) && token.tokenKind === 'hex50') {
    const { width } = hexCellMetrics(board);
    // snapToTile searches near its input. Keep outboard pointers within that search's reach.
    drop = snapToTile({
      x: clamp(px / width, Number(board.columns) + 0.5),
      y: clamp(py / tile, Number(board.rows) * 0.75 + 0.25),
    }, board);
  } else {
    drop = {
      x: clamp(Math.round(previewBox.left / tile), board.columns - footprint.width),
      y: clamp(Math.round(previewBox.top / tile), board.rows - footprint.height),
    };
  }
  return {
    previewBox,
    drop,
    pixelDelta: { x: previewBox.left - originalBox.left, y: previewBox.top - originalBox.top },
  };
}
