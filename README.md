# Tableforge

Tableforge is a browser-based Dungeons & Dragons table display with two synchronized modes:

- **Dungeon Master portal** for building and controlling the board.
- **Player viewer** for a fullscreen table display that only shows player-visible content.

The app is designed to run on one host machine. Projects are stored on that host in `data/projects.json`, and connected browsers use the host API so players and DMs on other machines see the same project data.

## Features

- Create standard 5 ft square-grid boards or 50 ft hex-grid boards for large-scale ship and air combat.
- Configure board cell width, cell height, and cell pixel size.
- Upload a board background image and adjust its scale and opacity.
- Keep a board background image fitted to the full board size as tile dimensions change.
- Move the board background image on its own background layer.
- Resize the board background image by dragging it in background edit mode.
- Create, rename, delete, and open projects that contain saved boards. Project names must be unique.
- Create multiple saved boards and publish the active board to the player viewer.
- Place and move tokens on the active board grid, including standard 5 ft tokens and dedicated 50 ft hex tokens. Clicking with the token tool asks whether to create a new token or place one from the library on that cell.
- Edit selected tokens, including color and uploaded token artwork.
- Open a project-wide searchable token library with quick stats (CR, AC, HP, size, vision, source) for each saved token, edit tokens in a dedicated popup, and import them onto any board in the project.
- Search monsters from the 5e.tools bestiary (including custom locally hosted base URLs) or the public Open 5e API, review their stats, and save them into the project token library.
- Configure token vision distance and quickly toggle token vision on or off for board lighting.
- Duplicate or delete tokens and drawings from the right-click menu in the DM view.
- Enable board lighting, manually reveal lit areas, draw light-blocking walls, and preview player visibility in the DM view.
- Assign tokens to the player layer or DM-only layer.
- Toggle token visibility.
- Measure distance with a draggable ruler using the active board scale.
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
- Existing boards use the standard 5 ft square grid. New boards can be created as either 5 ft square grids or 50 ft hex grids from the board drawer.
- 50 ft hex boards render hexagon outlines and are intended for ship combat, air combat, and other large-scale scenes.
- 50 ft hex tokens are a separate token type and occupy one 50 ft hex cell by default.
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
- Electron and electron-builder for the desktop wrapper and native packages

## Desktop Application Developer Guide

Tableforge includes an Electron desktop wrapper in `desktop/`. The wrapper launches the existing Express server as a background process, waits for `GET /api/health`, and then loads the local app from `http://127.0.0.1:<dynamic-port>`.

### Prerequisites

- Node.js v18 or v20.
- npm dependencies installed with `npm install`.
- Linux packaging: `build-essential`, `fakeroot`, and `dpkg` packages are recommended for local `.deb` builds.
- macOS packaging: Xcode Command Line Tools are required. Install them with `xcode-select --install`.
- Windows packaging: run from Windows for the most reliable NSIS and Authenticode signing flow.

### Local Development

Build the web client once before starting Electron:

```bash
npm run build
npm run desktop:start
```

The Electron app chooses a free port starting at `3000`, passes it to `server.js` as `PORT`, and stores desktop data in the current user's OS application data directory. To request a different first port:

```bash
TABLEFORGE_DESKTOP_PORT=3100 npm run desktop:start
```

Chrome Developer Tools are available from the **View** menu, `Ctrl+Shift+I` on Windows/Linux, or `Cmd+Option+I` on macOS.

### Packaging

Build the web client before packaging:

```bash
npm run build
```

Create an unpacked desktop build for inspection:

```bash
npm run desktop:build
```

Build native installers for the current target family:

```bash
npm run desktop:dist-win
npm run desktop:dist-mac
npm run desktop:dist-linux
```

Build all configured x64 targets:

```bash
npm run desktop:dist-all
```

Configured outputs are Windows NSIS and portable `.exe` packages for x64/arm64, macOS DMG and ZIP universal packages, and Linux AppImage plus `.deb` packages for x64. Production icons should be placed in `desktop/assets/` before release packaging.

### Code Signing

macOS signing and notarization support is configured in `electron-builder.yml`. Set these environment variables when building signed macOS releases:

```bash
CSC_LINK=/path/to/developer-id.p12
CSC_KEY_PASSWORD=certificate-password
APPLE_ID=apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=app-specific-password
APPLE_TEAM_ID=TEAMID1234
```

Windows Authenticode signing can use electron-builder's standard certificate variables:

```bash
CSC_LINK=/path/to/windows-cert.pfx
CSC_KEY_PASSWORD=certificate-password
```

### Data Portability

Browser/server mode stores projects in the repository `data/` directory. Desktop mode stores projects and uploaded assets in the OS application data directory:

- Windows: `%APPDATA%/Tableforge/data`
- macOS: `~/Library/Application Support/Tableforge/data`
- Linux: `~/.config/Tableforge/data`

Copy this `data` directory to move projects between desktop installs. Each project is stored as a folder containing `project.json` and its uploaded image/audio assets.

## Future Backend Ideas

This prototype is ready for a real multiplayer backend when needed. Useful next steps would be:

- Persist boards in a database.
- Add authenticated DM/player sessions.
- Support multiple campaigns and saved scenes.
- Add asset libraries for maps and tokens.
- Add initiative tracking and fog of war.
