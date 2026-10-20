# Inkarnate import

Choose **Import Inkarnate (.ink)** on the project home screen, in the board drawer, or under **Board Setup → Import Map**. In Inkarnate, download an offline backup from the map menu. Current `.ink` and uncompressed version 3 `.json` backups are accepted.

Review the preview before importing. Blue lines are saved wall paths. Gold outlines are estimated blockers; gold circles indicate estimated lights. Turn off **Estimate blockers and lights from stamps** to retain only saved wall geometry. You can override the number of square-grid columns. Each Tableforge cell is 5 ft. Dynamic lighting is enabled by default; turn it off for daylight. With lighting enabled, add a player token with vision to explore unlit areas.

The importer creates a new campaign from the home screen or appends a board to the current campaign. It does not replace an existing board or change what players are currently viewing. Imports into an existing campaign support undo and redo. Background images and geometry are included in campaign ZIP exports.

## Verified format

The supplied backup for [the reference map](https://inkarnate.com/maps/edit/21759926) is preserved in `test/fixtures/inkarnate-reference.ink`. It is gzip-compressed JSON with envelope `version: 3` and `scene.majorVersion: 3`. The reference has a 2048 × 1536 embedded PNG, an 8192 × 6144 normalized scene, and a square grid size of 204.8: **40 × 30 cells**. Its 17 tree stamps produce **17 estimated trunk blockers (136 wall segments)**. There are no room walls or light-emitting stamps in this reference.

Fields and command semantics were checked against the backup and Inkarnate's public editor bundles on 2026-10-20 (`chunk-109770977-1-83-2.js`, `chunk-2029397263-1-83-2.js`, `chunk-111612081-1-83-2.js`). Tableforge does not load or execute these bundles.

| Data | Use |
| --- | --- |
| `preview`, `previewDimensions` | Complete embedded PNG and its dimensions, including all rendered artwork |
| `scene.normSceneSize` | Normalized scene coordinate space |
| `history` | Commands replayed to recover the current object state |
| `cmd-composite.cmds` | Nested command batches |
| `cmd-entity-add.items` | Objects with layer IDs |
| `cmd-entity-update.items` | Entity IDs and updated fields |
| `cmd-entity-remove.entityIds` | Deleted objects; flattened objects also stop supplying geometry |
| Layer/group commands | Visibility, opacity, movement, grouping and explicit-pivot transforms |
| `grid.style` | Square grid size and offset, even when the grid layer is hidden |
| `path-v2.paths` | SVG path data in object-local coordinates |
| `path-v2.x/y/angle/scale` | World placement; saved path flips are already baked into the path string |
| `path-v2.blockLights`, `wallEnabled` | Whether the path should block light |
| `path-v2.portals` | Open gaps with an anchor and width measured along the path |
| `stamp.x/y/scale/name/defaultName` | Object positions and names used for optional estimates |

The PNG is preserved byte for byte when its grid fits the scene. Grid offsets and partial cells add transparent margins without stretching the map; artwork and geometry receive the same offset. Oversized images are reduced only when preparing the board image. No remote asset requests or account credentials are used. The app saves a flattened background, not a redistributable library of Inkarnate stamps.

## Geometry and estimates

Current Line/Shape tool paths become editable, freeform Tableforge walls. Curves are approximated by short segments. Holes and disconnected contours remain separate. Portals cut gaps out of the contour, including gaps that cross the start of a closed shape. Portals are open passages, not inferred closed doors. Hidden layers/groups/objects, zero-opacity objects and light-pass paths do not create blockers.

The backup references stamp artwork by asset ID; it does not contain stamp collision shapes or VTT light radii. Optional estimates use recognizable English object names:

- Tree, palm, oak, pine, fir and willow: an octagonal trunk with a default radius of 0.18 cells.
- Rock, boulder, pillar and column: an octagonal blocker with a default radius of 0.4 cells.
- Torch, lantern and lamp: 15 ft bright / 30 ft total light.
- Brazier, campfire, bonfire, fire and fireplace: 20 ft bright / 40 ft total light.
- Candle: 5 ft bright / 10 ft total light.

Blocker size follows stamp scale with a conservative bound. Both custom names and saved asset names are recognized. Lights are warm in colour and editable under **Imported Lights**. Stamps named unlit, extinguished, broken or off do not create lights. Estimate provenance is saved on each generated wall/light and in board import metadata. Trunks do not cover the canopy. Walls can be selected, moved or removed using the existing wall tools.

Wall/door/building stamps have no usable saved collision dimensions and remain artwork; the importer explains that these require tracing. Older decorative paths, non-square grids, unknown geometry commands, group transforms without a pivot and offset wall textures produce explicit review notes. Without a supported square grid, a 40-cell grid is fitted to the long edge and can be adjusted. Full map artwork remains intact.

## Limits and checks

The worker accepts at most 100 MB compressed input / 160 MB expanded JSON, 100,000 history commands, 20,000 objects, 64 nesting levels, 4,000 wall segments, 64 lights and 200 × 200 cells. Preview PNGs are limited to 64 megapixels / 16,384 pixels per axis; board rasterization is capped at 16 megapixels / 8192 pixels per axis and a 25 MB upload. Gzip checksums, PNG headers/dimensions, object coordinates and group cycles are validated. Missing, external, corrupt or unsupported previews are rejected before saving.

`npm test` covers the actual backup, exact PNG preservation, grid alignment, command replay, visibility, groups, native paths/curves/portals, estimates, malformed data, migration and light occlusion. `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` checks actual browser import, preview controls, persisted PNG bytes, player view, ZIP export/re-import, existing-campaign imports, undo/redo and rejected/cancelled imports alongside the Dungeon Scrawl regression tests. All browser tests use a disposable campaign store.
