# One Layer Each — notes for Claude Code

A local multiplayer ice breaker. Node server + two browser pages. No build step.

- `server.js` — HTTP + WebSocket server. Game phases: `open → locked → printing → done`. Shuffles the print order. Persists to `data/session.json`.
- `public/play.html`, `public/js/play.js`, `public/css/play.css` — phone page (name, drawing canvas, status screens).
- `public/host.html`, `public/js/host.js`, `public/css/host.css` — projector page: lobby, slicing, printing HUD, finale.
- `public/js/scene.js` — three.js stage (plate, printer head, lights, bloom).
- `public/js/layer-geometry.js` — drawing → extruded 3D layer (marching squares).
- `public/js/demo.js` — fake drawings for rehearsal (`/host?demo=28`).
- `public/js/palette.js` — the 8 filament colours shared by both pages.

Run with `npm install && npm start`, then open `http://localhost:3000/host`.
Timing of the print lives in `layerDurations()` in `host.js`. Text shown on screens lives in the HTML files and `render()` in `play.js`.
