export async function renderInkarnatePng(map) {
  const image = new Image();
  image.src = map.image;
  try { await image.decode(); } catch { throw new Error('The embedded Inkarnate image could not be decoded. Save a new offline backup.'); }
  if (image.naturalWidth !== map.imageWidth || image.naturalHeight !== map.imageHeight) throw new Error('The embedded image does not match its saved dimensions.');
  const rect = map.imageRect;
  let blob;
  // Preserve the actual saved PNG bytes when the grid fits the image exactly.
  if (rect.x === 0 && rect.y === 0 && Math.abs(rect.width - map.columns) < 1e-8 && Math.abs(rect.height - map.rows) < 1e-8 && image.naturalWidth * image.naturalHeight <= 16_000_000) {
    const bytes = Uint8Array.from(atob(map.image.slice(22)), (char) => char.charCodeAt(0));
    blob = new Blob([bytes], { type: 'image/png' });
  } else {
    const scale = Math.min(map.imageWidth / rect.width, 8192 / Math.max(map.columns, map.rows), Math.sqrt(16_000_000 / (map.columns * map.rows)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(map.columns * scale); canvas.height = Math.round(map.rows * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the map image.');
    context.drawImage(image, rect.x * canvas.width / map.columns, rect.y * canvas.height / map.rows, rect.width * canvas.width / map.columns, rect.height * canvas.height / map.rows);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  if (!blob || blob.size > 25 * 1024 * 1024) throw new Error('The prepared map exceeds 25 MB. Save a smaller offline backup in Inkarnate.');
  return new File([blob], `${map.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'Inkarnate'}.png`, { type: 'image/png' });
}
