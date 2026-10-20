# Dungeon Scrawl import

Use **Import Dungeon Scrawl (.ds)** from the project launcher to create a campaign, or from the board drawer / Board Setup to add a board. The preview shows dimensions, wall/door/light counts, embedded image counts, and compatibility notes. Importing into an existing campaign does not change the board currently shown to players.

## Format investigation

The supplied `dungeon.ds` is preserved as `test/fixtures/dungeon-scrawl-reference.ds`. It matches the room, open doorway and corridor in the supplied screenshot. It is a ZIP containing one UTF-8 JSON entry named `map`. Dungeon Scrawl V2 currently uses **envelope version 1**; this is not the old editor V1 format.

The schema was checked against the reference file and the [Dungeon Scrawl application](https://app.dungeonscrawl.com/) bundle `main.c5d4fd81.js` on 2026-10-20. Its save/load code writes and reads `map`, restores `data.geometry`, and restores `data.assets[*].data` as embedded image data URLs. No application code or hosted renderer is required at runtime.

| Field | Meaning |
| --- | --- |
| `state.document.documentNodeId` | Root document node ID |
| `state.document.nodes` | ID-indexed scene graph; document children are pages |
| `PAGE.children` | Ordered layer roots for that map |
| `PAGE.grid.cellDiameter` | Source pixels per square cell (36 in the reference) |
| `GEOMETRY.geometryId` | Reference into `data.geometry` |
| `data.geometry[id].polygons` | Multipolygon → polygon → ring → `[x, y]`; additional rings are holes |
| `data.geometry[id].polylines` | Open paths, including internal wall segments |
| `GEOMETRY.allowsLightToPass` | Excludes that geometry from light-blocking walls |
| `transform` | Affine `[a, b, c, d, tx, ty]`, composed through parent groups |
| `ASSET.assetId` | Embedded `data.assets[id]`, with raster `data` URL and `asset.dimensions` / `asset.scale` |
| `DUNGEON_ASSET.kind` | Door or stairs; older saves identify these by generated English names |
| `LIGHT.config.radial` | Radius and optional bright radius in cells, plus strength |
| `LIGHT.config.shared.colour` | RGB integer and alpha |

## Conversion

- Read and validate the archive in a dedicated worker. Only the `map` ZIP entry is decoded; archive paths are never extracted to disk. Uncompressed JSON with the same envelope is accepted too.
- Walk each page's reachable visible scene graph in order. Apply parent transforms and opacity, exclude hidden layers, and preserve polygon holes and disconnected open paths.
- Fit bounds to whole source grid cells with a margin for wall artwork. Use the same origin and source cell size for artwork, walls, doors and lights, retaining fractional coordinates. The reference becomes **21 × 10 cells, 16 wall segments, 0 doors, 0 lights**. Its doorway remains open.
- Render local SVG from validated geometry and escaped text. Reconstruct floor/wall colours, grids, masks, shadows and hatching; embed saved raster images. Decode embedded images before rasterizing, then save a PNG in the campaign's existing asset storage. Nothing is fetched from a remote image URL.
- Turn door geometry into one interactive door segment, omit its static symbol from the background, and keep stair lines decorative. Ordinary wall outlines and holes become editable freeform lighting walls. Colocated reversed wall segments are deduplicated.
- Store radial lights separately from artwork. The existing visibility solver clips their bright/dim regions and colour against imported walls and closed doors. Source maps without lights do not gain invented light sources.
- Commit the PNG and board in one import endpoint. Drain the client's queued saves first. The project JSON is written atomically; failed imports remove newly created assets. New imports do not publish a different campaign to connected players. Existing board imports support undo/redo.

## Compatibility and limits

Supported: current Dungeon Scrawl square-grid saves, multiple pages (choose one per import), negative coordinates, group transforms, polygon holes, internal wall lines, hidden layers, light-pass geometry, PNG/JPEG/WebP/GIF assets, text, doors, stairs, and radial lights.

Artwork is reconstructed, not a byte-identical Dungeon Scrawl image export. Random hatching and rough brush jitter are not stored as pixels; their appearance may differ. Custom fonts use installed fallbacks and wrapping may differ. Water/lava become still colours, cavern shading uses a simplified outline, and paper textures use the saved background colour. Unsupported layers, including tiled textures and non-radial lights, produce preview notes. Missing or externally referenced images stop import instead of silently disappearing. SVG image assets must be converted to raster images in Dungeon Scrawl first.

Legacy editor saves, hex/isometric/projected grids, corrupt files, invalid geometry, and oversized maps receive explicit errors. Open older saves in the current Dungeon Scrawl editor, switch to a standard square grid, and save again.

Limits: 50 MB source, 64 MB expanded map JSON, 50 pages, 10,000 scene nodes, 50,000 geometry points, 64 levels of nesting, 200 × 200 cells per board, 4,000 wall segments and 64 lights per board. Raster output is capped at 16 megapixels and 8192 pixels on either axis, keeping board coordinates independent of image resolution.

The standalone Tableforge dungeon builder, its styles and its `/api/dungeons` routes are removed. Existing campaign boards keep their saved backgrounds/walls/doors; old library folders are not deleted.

## Verification

`npm test` checks the actual reference save, ZIP compression, geometry and doorway visibility, transforms, holes, embedded assets, escaped text, lights, doors, stairs, migration, rejected inputs and existing board behaviour.

`npm run test:e2e` runs the production build against a temporary campaign store and verifies browser import, PNG rendering, persistence, player visibility, campaign export/re-import, embedded assets, lights, undo/redo, invalid files and cancellation. Install the matching browser with `npx playwright install chromium`, or use an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. Test runs never use the normal campaign data directory.
