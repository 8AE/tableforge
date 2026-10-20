// Persist a PNG in the campaign's existing asset store. The SVG is generated
// locally from validated geometry and embedded raster images; no remote loads.
export async function renderDungeonScrawlPng(map) {
  const svg = new DOMParser().parseFromString(map.svg, 'image/svg+xml');
  // Decoding the outer SVG can succeed even when a nested image is broken.
  // Check each asset first so an incomplete map cannot be silently saved.
  for (const source of new Set([...svg.querySelectorAll('image')].map((node) => node.getAttribute('href')))) {
    const embedded = new Image();
    embedded.src = source;
    try { await embedded.decode(); } catch { throw new Error('An embedded image could not be decoded. Replace it in Dungeon Scrawl and save the .ds file again.'); }
  }
  const url = URL.createObjectURL(new Blob([map.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(64, 8192 / Math.max(map.columns, map.rows), Math.sqrt(16_000_000 / (map.columns * map.rows)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(map.columns * scale);
    canvas.height = Math.round(map.rows * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not render the map.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This browser could not create the map image.');
    return new File([blob], `${map.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'Dungeon'}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
