# T Maps UI Prototype (Tasco P11 — AABW 2026)

A front-end prototype that recreates the [T Maps](https://apps.apple.com/vn/app/t-maps/id6769729366) navigation app UI/UX inside a simulated iPhone frame, built with React, Leaflet, and Tauri. It targets visual and interaction fidelity with T Maps (search, bottom sheets, route planning, turn-by-turn navigation HUD, map mode picker) using mocked place data.

## Tech stack

- **React 19 + TypeScript** — UI and state
- **Vite** — dev server / build (runs on port `1420` per `tauri.conf.json`, not the Vite default `5173`)
- **Leaflet** — the underlying map (CartoDB light tiles for the default style, Esri World Imagery for satellite)
- **lucide-react** — icon set
- **Tauri 2** — optional desktop shell (`src-tauri/`) to package the UI as a native app

## Features

- Home screen with search bar, category shortcuts, and recent-places history, inside a draggable bottom sheet (min / half / full / details states)
- Search with mocked results and quick "Chỉ đường" (directions) action
- Place details screen: rating, address, hours placeholder, coordinates, and directions/share/bookmark actions
- Route planning: 5 travel modes (car/bus/walk/bike/scooter), route summary with ETA, and alternate-route list
- Simulated turn-by-turn navigation mode with a live HUD (direction banner, speed readout, cancel bar)
- Floating map controls: 3D tilt toggle, map-mode picker (default/satellite, traffic/transit, 2D/3D), recenter
- CSS-based 3D tilt simulation on top of the 2D Leaflet raster map (no vector-tile 3D buildings)

All place, menu, and review data in `src/App.tsx` is mocked — there is no backend.

## Getting started

```bash
npm install
npm run dev       # starts Vite at http://localhost:1420
```

Other scripts:

```bash
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
npm run tauri dev # run inside the Tauri desktop shell
```

## Project structure

```
ui/
├── src/
│   ├── App.tsx        # all screens/state (single-file prototype)
│   ├── App.css         # phone-frame chrome + all screen styles
│   └── main.tsx
├── src-tauri/           # Tauri desktop shell config (optional)
└── vite.config.ts
```

## Known limitations

- 3D buildings are faked with a CSS `perspective`/`rotateX` tilt on a flat raster map, not real extruded vector-tile buildings.
- Traffic and public-transit toggles in the map-mode sheet are decorative (no real data layer behind them).
- No routing, geocoding, or navigation is real — distances, ETAs, and turn-by-turn steps are hardcoded/simulated.
