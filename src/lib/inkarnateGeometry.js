import svgpath from 'svgpath';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const point = (x, y) => ({ x, y });

// Inkarnate path-v2 stores local SVG paths. Flips in a saved path are already
// baked into that string; applying flipX/flipY a second time mirrors it wrongly.
export function flattenInkarnatePath(source, tolerance = 2) {
  if (typeof source !== 'string' || source.length > 500000) throw new Error('An Inkarnate wall path is too large or invalid.');
  const parsed = svgpath(source);
  if (parsed.err) throw new Error('An Inkarnate wall contains an invalid SVG path.');
  const paths = [];
  let current;
  let count = 0;
  const append = (p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x), Math.abs(p.y)) > 1e7) throw new Error('A wall contains invalid coordinates.');
    if (++count > 50000) throw new Error('The map contains too many wall points.');
    if (!current) throw new Error('A wall path must start with a move command.');
    if (!current.points.length || distance(current.points.at(-1), p) > 1e-8) current.points.push(p);
  };
  const cubic = (a, b, c, d, depth = 0) => {
    // Control-polygon excess catches loops and collinear backtracking too.
    if (depth >= 16 || distance(a, b) + distance(b, c) + distance(c, d) - distance(a, d) <= tolerance) { append(d); return; }
    const ab = mix(a, b, 0.5), bc = mix(b, c, 0.5), cd = mix(c, d, 0.5);
    const abc = mix(ab, bc, 0.5), bcd = mix(bc, cd, 0.5), mid = mix(abc, bcd, 0.5);
    cubic(a, ab, abc, mid, depth + 1); cubic(mid, bcd, cd, d, depth + 1);
  };
  parsed.abs().unshort().unarc().iterate((s, _index, x, y) => {
    if (s[0] === 'M') { current = { points: [], closed: false }; paths.push(current); append(point(s[1], s[2])); }
    else if (s[0] === 'L') append(point(s[1], s[2]));
    else if (s[0] === 'H') append(point(s[1], y));
    else if (s[0] === 'V') append(point(x, s[1]));
    else if (s[0] === 'C') cubic(point(x, y), point(s[1], s[2]), point(s[3], s[4]), point(s[5], s[6]));
    else if (s[0] === 'Q') {
      const a = point(x, y), b = point(s[1], s[2]), c = point(s[3], s[4]);
      cubic(a, mix(a, b, 2 / 3), mix(c, b, 2 / 3), c);
    } else if (s[0] === 'Z' && current?.points.length) { append(current.points[0]); current.closed = true; }
    else throw new Error('The map contains an unsupported wall path command.');
  });
  return paths.filter((p) => p.points.length > 1);
}

// Portals are openings, not door objects. Cut their width from the path's arc
// length, including openings crossing a closed contour's starting vertex.
export function cutInkarnatePortals(paths, portals = []) {
  if (!Array.isArray(portals) || portals.length > 1000) throw new Error('The map contains invalid doorway gaps.');
  const measured = paths.map((path) => {
    let length = 0;
    return { ...path, gaps: [], segments: path.points.slice(1).map((end, i) => {
      const start = path.points[i], from = length; length += distance(start, end);
      return { start, end, from, to: length };
    }), length };
  });
  for (const portal of portals) {
    // Older Paper.js points used ["Point", x, y]; current backups use {x,y}.
    const anchor = Array.isArray(portal.anchor) ? point(portal.anchor[1], portal.anchor[2]) : portal.anchor;
    if (!anchor || ![anchor.x, anchor.y, portal.width].every(Number.isFinite) || portal.width <= 0) throw new Error('A doorway gap has invalid coordinates.');
    let nearest;
    for (const path of measured) for (const segment of path.segments) {
      const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
      const t = Math.max(0, Math.min(1, ((anchor.x - segment.start.x) * dx + (anchor.y - segment.start.y) * dy) / (dx * dx + dy * dy || 1)));
      const separation = distance(anchor, mix(segment.start, segment.end, t));
      if (!nearest || separation < nearest.separation) nearest = { path, separation, at: segment.from + (segment.to - segment.from) * t };
    }
    if (!nearest) continue;
    const { path, at } = nearest;
    if (portal.width >= path.length) { path.gaps.push([0, path.length]); continue; }
    for (const shift of path.closed ? [-path.length, 0, path.length] : [0]) {
      const a = Math.max(0, at - portal.width / 2 + shift), b = Math.min(path.length, at + portal.width / 2 + shift);
      if (a < b) path.gaps.push([a, b]);
    }
  }
  return measured.flatMap((path) => path.segments.flatMap((segment) => {
    let pieces = [[segment.from, segment.to]];
    for (const [a, b] of path.gaps) pieces = pieces.flatMap(([p, q]) => b <= p || a >= q ? [[p, q]] : [[p, Math.min(q, a)], [Math.max(p, b), q]].filter(([x, y]) => y - x > 1e-7));
    return pieces.map(([a, b]) => [mix(segment.start, segment.end, (a - segment.from) / (segment.to - segment.from)), mix(segment.start, segment.end, (b - segment.from) / (segment.to - segment.from))]);
  }));
}

export function inkarnateWorldPoint(p, entity) {
  const angle = (entity.angle || 0) * Math.PI / 180, scale = entity.scale ?? 1;
  return { x: (entity.x || 0) + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)), y: (entity.y || 0) + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)) };
}

// Paths may extend beyond the canvas. Retain only their visible segments,
// without introducing a new wall along the edge of the map.
export function clipInkarnateWall(wall, width, height) {
  const { start, end } = wall;
  const dx = end.x - start.x, dy = end.y - start.y;
  let from = 0, to = 1;
  for (const [p, q] of [[-dx, start.x], [dx, width - start.x], [-dy, start.y], [dy, height - start.y]]) {
    if (p === 0) { if (q < 0) return null; }
    else if (p < 0) from = Math.max(from, q / p);
    else to = Math.min(to, q / p);
    if (from > to) return null;
  }
  if (distance(start, end) * (to - from) < 1e-7) return null;
  return { ...wall, start: mix(start, end, from), end: mix(start, end, to) };
}
