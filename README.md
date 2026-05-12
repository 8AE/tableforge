# Tableforge

Tableforge is a browser-based Dungeons & Dragons table display with two synchronized modes:

- **Dungeon Master portal** for building and controlling the board.
- **Player viewer** for a fullscreen table display that only shows player-visible content.

The app is designed to run on one host machine. Projects are stored on that host in `data/projects.json`, and connected browsers use the host API so players and DMs on other machines see the same project data.

## Features

- Create a board with custom tile width, tile height, and tile pixel size.
- Upload a board background image and adjust its scale and opacity.
- Keep a board background image fitted to the full board size as tile dimensions change.
- Move the board background image on its own background layer.
- Resize the board background image by dragging it in background edit mode.
- Create, rename, delete, and open projects that contain saved boards. Project names must be unique.
- Create multiple saved boards and publish the active board to the player viewer.
- Place and move tokens on a tile grid where each tile represents 5 feet.
- Edit selected tokens, including color and uploaded token artwork.
- Configure token vision distance and quickly toggle token vision on or off for board lighting.
- Duplicate or delete tokens and drawings from the right-click menu in the DM view.
- Enable board lighting, manually reveal lit areas, draw light-blocking walls, and preview player visibility in the DM view.
- Assign tokens to the player layer or DM-only layer.
- Toggle token visibility.
- Measure distance with a draggable ruler.
- Draw freehand annotations.
- Draw, move, recolor, hide, and reveal annotations.
- Manage tokens and drawings from collapsible DM sidebar lists.
- Draw square, circular, rectangular, and cone area shapes with measurements.
- Move and delete light-blocking walls.
- Open a fullscreen-friendly player display at the same time as the DM portal.
- Zoom the player display up to 1000% and rotate it in 90-degree increments for table-mounted screens.
- Use keyboard shortcuts for copy, paste, undo, and redo in the DM portal.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the local host server:

```bash
npm run host
```

Open the DM portal:

```text
http://127.0.0.1:5173/
```

Open the player viewer:

```text
http://127.0.0.1:5173/?view=player
```

Other devices on the same network can use the host machine's LAN address with the same port.

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Usage Notes

- The DM must create or open a project before the player viewer shows a board.
- The DM starts on the project home screen, opens one project at a time, and can return home with **Project home**.
- Projects are saved on the host machine in `data/projects.json`.
- Use **Show active board to players** in the DM portal to transition the player viewer to a different board.
- DM-layer tokens are visible in the DM portal but hidden from the player viewer.
- DM-layer drawings can be prepared privately and later moved to the player layer or revealed.
- Player-layer drawings and tokens are visible in the player viewer when not hidden.
- The player viewer includes fullscreen and zoom controls. In fullscreen, its top bar hides until the pointer moves to the top of the screen.
- Large player boards can be panned by dragging the board.

## Keyboard Shortcuts

- Copy selected token or drawing: `Cmd+C` / `Ctrl+C`
- Paste copied token or drawing: `Cmd+V` / `Ctrl+V`
- Delete selected token or drawing: `Delete` / `Backspace`
- Undo: `Cmd+Z` / `Ctrl+Z`
- Redo: `Cmd+Shift+Z`, `Ctrl+Shift+Z`, or `Ctrl+Y`

## Tech Stack

- React
- Vite
- Lucide React icons
- Express for the local host API and project storage
- Browser `BroadcastChannel` for local tab sync

## Future Backend Ideas

This prototype is ready for a real multiplayer backend when needed. Useful next steps would be:

- Persist boards in a database.
- Add authenticated DM/player sessions.
- Support multiple campaigns and saved scenes.
- Add asset libraries for maps and tokens.
- Add initiative tracking and fog of war.
