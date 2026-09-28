# One Layer Each

An ice breaker for 28 people, played entirely on devices.

Everyone scans a QR code, types their name and draws one thing on their phone. When you press **Print it**, the projector turns every drawing into a solid 3D layer, shuffles them, and "prints" them one on top of the other with a glowing nozzle. At the end the room sees one strange sculpture and the line *"You just 3D printed together."* Tap any layer to see who drew it.

---

## 1. Start it (once, about 2 minutes)

You need **Node.js 18 or newer** (download from nodejs.org if `node -v` fails).

In VS Code, open this folder, open the terminal and run:

```bash
npm install
npm start
```

Or just ask Claude Code: *"Install and start the game."*

The terminal prints two addresses:

```
Projector screen:  http://localhost:3000/host
Players join at:   http://192.168.x.x:3000
```

Open the **projector screen** address in Chrome on the laptop connected to the projector and press **F** for full screen.

## 2. Run the session (about 5 minutes)

| Step | What you do | What they see |
|---|---|---|
| Join | Leave the lobby up. The QR code is on screen. | Phones: name, then a drawing canvas |
| Draw | Click **2:00 timer** in the small bar at the bottom right (optional) | A countdown on every phone. Drawings lock automatically at 0:00 |
| Lock | Click **Lock** when everyone is in (or let the timer do it) | "All layers are in" |
| Print | Click **Print it** | Slicing, then each layer is traced and filled by the nozzle, about 1 minute in total. Each phone shows "Yours is #12" and buzzes when their layer is printing |
| Reveal | Click layers, **Show layers** to pull them apart, **Spin** to stop or start the rotation | "You just 3D printed together." |

Useful extras at the end:
- **Download STL** saves the sculpture as a real, printable file (about 80 mm wide). Print it during the session to close the loop.
- **Save image** saves a picture of the sculpture for a group photo or a slide.
- **Replay** runs the print animation again. **New round** clears all drawings.

Before the day, open the **•••** menu and choose **Rehearse with demo drawings** to watch a full run with 28 made-up drawings. It does not touch real players' drawings.

Keyboard shortcuts on the projector: **F** full screen, **T** timer, **L** lock, **P** print, **S** skip to the end, **E** show layers, **Esc** close.

Removing a drawing: click **Layers** in the bottom bar and press × on it. That player is asked to draw again.

## 3. If phones cannot connect

1. **Same Wi-Fi.** The laptop and the phones must be on the same network.
2. **Firewall.** On Windows, click *Allow* when asked about Node.js. On a Mac, allow incoming connections for `node`.
3. **Guest or venue Wi-Fi** often blocks phones from reaching each other. The easiest fix is to turn on a phone hotspot, connect the laptop to it, and let players join the hotspot. Another option is a tunnel:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Then restart with the address it gives you:
   ```bash
   PUBLIC_URL=https://your-address.trycloudflare.com npm start        # Mac / Linux
   $env:PUBLIC_URL="https://your-address.trycloudflare.com"; npm start  # Windows PowerShell
   ```
4. **Wrong address in the QR code** (the laptop has several network adapters): start with `PUBLIC_URL=http://<your-laptop-ip>:3000 npm start`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PLAYERS` | 28 | Expected number of players (for the progress meter) |
| `PORT` | 3000 | Port to run on |
| `PUBLIC_URL` | auto | Address encoded in the QR code |

Add `?seconds=180` to the projector address to make the timer 3 minutes.

Drawings are saved in `data/session.json`, so restarting the server does not lose them. Delete that file (or use **New round**) to start fresh.

## How the 3D layers are made

Each drawing is sampled onto a grid, thin strokes are thickened, and closed outlines are filled in (unless the player used the fill bucket, in which case empty areas stay as holes). Marching squares traces the outline and it is extruded into a slab with real side walls. The side walls get a ridged "printed bead" texture, the top gets the drawing itself with a fine infill pattern, and everything is lit with soft shadows. The code is in `public/js/layer-geometry.js`.
