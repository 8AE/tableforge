# Tableforge

Tableforge is a browser-based Dungeons & Dragons table display with two synchronized modes:

- **Dungeon Master portal** for building and controlling the board.
- **Player viewer** for a fullscreen table display that only shows player-visible content.

The current app runs entirely in the browser. Board state is saved in `localStorage` and synchronized between open DM/player tabs with `BroadcastChannel`.

## Features

- Create a board with custom tile width, tile height, and tile pixel size.
- Upload a board background image and adjust its scale and opacity.
- Place and move tokens on a tile grid where each tile represents 5 feet.
- Assign tokens to the player layer or DM-only layer.
- Toggle token visibility.
- Measure distance with a draggable ruler.
- Draw freehand annotations.
- Draw square, circular, rectangular, and cone area shapes.
- Open a fullscreen-friendly player display at the same time as the DM portal.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the local dev server:

```bash
npm run dev
```

Open the DM portal:

```text
http://127.0.0.1:5173/
```

Open the player viewer:

```text
http://127.0.0.1:5173/?view=player
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Usage Notes

- Keep the DM portal and player viewer open in the same browser profile to get live synchronization.
- DM-layer tokens are visible in the DM portal but hidden from the player viewer.
- Player-layer drawings and tokens are visible in the player viewer.
- The player viewer includes a fullscreen button for tabletop display use.

## Tech Stack

- React
- Vite
- Lucide React icons
- Browser `localStorage` and `BroadcastChannel` for persistence and tab sync

## Future Backend Ideas

This prototype is ready for a real multiplayer backend when needed. Useful next steps would be:

- Persist boards in a database.
- Add authenticated DM/player sessions.
- Support multiple campaigns and saved scenes.
- Add asset libraries for maps and tokens.
- Add initiative tracking and fog of war.
