# DM workspace UI audit

Baseline: `d11afedd557909b2ab4258d012dbec7a8dc4266f`.
Status: selected improvements implemented and verified by the implementing agent in Chrome; current references identify the working tree, not a new commit.
Method: [improve-ui](https://www.ui-skills.com/skills/ibelick/improve-ui), with its [plan template](https://github.com/ibelick/ui-skills/blob/main/skills/improve-ui/references/plan-template.md). This audit only writes this document. The implementing agent owns product changes.

## Design language

- Audited surface: Tableforge DM workspace, reached through `src/App.jsx:61-77` → `DungeonMasterPortal` → `Topbar`, `Panel`, and `BoardCanvas`; player board reviewed where shared grid presentation changes apply.
- Design sources: current rendered composition and `src/styles.css`; no governing `DESIGN.md` or `AGENTS.md` found.
- Documented decisions: existing charcoal surfaces (`#10141c`, `#1d2330`), warm white text (`#f5f3ed`), gold layer/selection states, mint primary tool states, 6px control radii, 8px panel radii, and 34–36px standard controls.
- Governing owners and consumers: `src/components/Panel.jsx:3-8` owns sidebar panel composition; `src/styles.css:155-237` supplies panel, label, field, and command styling. DM header, toolbar, and board controls retain their existing owners rather than introducing an unrelated visual system.
- Explicit exceptions: None documented.

## Findings

References labeled **baseline** refer to the commit above; **current** references identify implemented corrections. Runtime observations below were supplied by the implementing agent after Chrome inspection.

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | “Select & Pan” obscured how board dragging worked. **Resolved.** | **Contract:** the user reported cumbersome board navigation and requested drag tools and shortcuts. **Runtime:** baseline `DungeonMasterPortal.jsx:855,965-975` advertised “Select & Pan”; `BoardCanvas.jsx:413-420` started marquee selection on empty-space dragging, while `309-316` required middle mouse for panning. **Correction:** current `DungeonMasterPortal.jsx:855-857` separates Select (V) and Pan board (H); `BoardCanvas.jsx:868-873` presents persistent zoom/fit controls and the actual Space-drag/Alt-scroll gestures. | Give selection and panning distinct, accurately labeled controls with gesture help. | DM toolbar and board navigation. | High |
| 2 | A generic header subtitle selector changed the shared player-status component across its live/publish variants. **Resolved.** | **Contract:** baseline `.player-ribbon-status` owned `inline-flex`, gap7, and font12 at `styles.css:1235-1246`. **Runtime:** `Topbar.jsx:85-97` used a span for live status and a button for publishing; the more specific `.topbar span` at `styles.css:147-153` overrode the live variant with block layout/font13/margin-top2. **Correction:** current `styles.css:147-153` scopes subtitle styling to `.topbar .board-title-button > span`; status variants retain their component owner at `1372-1399`. | Scope header subtitle styling to the board subtitle. | Shared header subtitle and DM player-status variants. | High |
| 3 | The narrow header branch stacked the outer header while leaving its board/layer row unable to wrap. **Resolved.** | **Contract:** baseline responsive layout at `styles.css:2741-2797` presented a narrow-screen branch, but `topbar-main` remained nowrap (`1181-1185`) with a minimum190px title (`1188-1190`) plus unwrapped layers (`1198-1217`). **Runtime:** both belong to the DM `Topbar` rendered from `DungeonMasterPortal`. **Correction:** current DM rules wrap header/title/layer groups at `styles.css:1269-1306`, constrain title content at `1280-1291`, and fit the narrow row to available width at `3143-3155`. Chrome inspection at 390×844 and 1024×768 confirmed wrapping and `documentWidth === innerWidth`. | Wrap the existing title and layer groups within available workspace width. | DM header at narrow viewport and reduced desktop workspace widths. | High |

## Improve first

Finding 1 had the greatest direct impact on the reported problem. Its correction is now implemented: visible hand/zoom/fit controls explain board navigation without conflating it with selecting objects.

## Validation and reusable rules

- Chrome verification by the implementing agent covered board pan and scroll, viewport fit, token-context Duplicate, and opening/dismissing shortcut help with Escape. A 14,400px board fit a 534px viewport at 3.7%; a small 96px board also preserved its dimensions.
- Shared grid presentation was checked live in DM and player views on a hex board, including inverse visibility states (468 grid lines versus zero), color and thickness changes, and switching view modes.
- Keep typography/layout ownership on the relevant component. Scope descriptive text selectors so they cannot silently override status, action, or control components.
- Let title/action groups wrap when available workspace width shrinks; validate the document width as well as the viewport screenshot.
- No unsupported arbitrary padding normalization was selected. New settings reuse existing panel padding14, split gap10, and control icon gap8. Differences alone are not proof of an inconsistency.
- No Electron package validation is claimed by this UI audit.

## Player navigation follow-up

Player view now shares the board camera, drag/scroll panning, pointer-centered modifier zoom, zoom/fit toolbar and board-focused keyboard controls. It retains 1000% zoom and provides navigation-only context actions. Player fit follows viewport and rotation changes until manual zoom; ordinary door taps are distinguished from drag gestures.

Browser verification on an isolated campaign covered panning over doors without toggling, scrolling, navigation visibility, 1000% zoom, keyboard fit, inverse-rotation door clicks at all four quarter turns on square boards and at 0/90 degrees on hex boards, locked doors, 390px layout, and shared DM controls. Fullscreen entry was denied by the automated browser; fullscreen positioning and focus reveal received source review only.
