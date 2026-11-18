# Chimborazo — a 15-second Three.js explainer

**Why is Chimborazo Ecuador's highest mountain?** A 15 s, 1080p30 video built entirely
with [Three.js](https://threejs.org) (procedural geometry, no image assets) and rendered
frame-by-frame in headless Chromium.

▶ **Output:** [`out/chimborazo.mp4`](out/chimborazo.mp4) (1920×1080, 30 fps, H.264 + AAC)

| Time | Shot | What it shows |
| --- | --- | --- |
| 0–3 s | **Hook** | Golden-hour flyover of a procedural Chimborazo massif; summit pin counts up to 6,263 m |
| 3–6 s | **The record** | Ecuador's four highest peaks rise to scale: Chimborazo 6,263 m, Cotopaxi 5,897 m, Cayambe 5,790 m, Antisana 5,753 m (+366 m over Cotopaxi) |
| 6–9 s | **Reason 1 · Plate tectonics** | Cut-away block: the Nazca plate subducts under South America, melts, and magma feeds a volcano on the already-high Western Andes |
| 9–12 s | **Reason 2 · Built in layers** | Cut-away volcano growing as three stacked edifices — Basal (~120–60 ka), Intermediate (~60–35 ka), Young cone (today's Whymper summit) |
| 12–15 s | **Bonus · Earth's bulge** | Oblate Earth diagram: Chimborazo's summit is 6,384.4 km from Earth's center vs Everest's 6,382.3 km |

## How it works

- `src/main.js` — the timeline. Each shot is its own `THREE.Scene`; shots render into
  multisampled half-float render targets and a final pass cross-dissolves them, adds a
  vignette, tone-maps (Neutral) and a touch of grain. Every frame is a pure function of `t`.
- `src/shots/*.js` — one file per shot (terrain from seeded simplex noise, low-poly peaks,
  extruded cross-section, lathe-built cut-away volcano, shader globe).
- `index.html` + `src/style.css` — captions and 3D-pinned labels (HTML projected from 3D anchors).
- `scripts/render.mjs` — serves the page, calls `window.__video.renderAt(t)` for each frame
  in headless Chromium (Playwright), screenshots it, and encodes with ffmpeg.
- `scripts/soundtrack.py` — synthesises the ambient soundtrack (numpy): a pad that follows
  the shots, pulse, whooshes on cuts, bell pings on reveals.

## Run it

```bash
npm install
npx playwright install chromium   # once, if you don't already have a Playwright Chromium

npm run preview                   # http://localhost:5173  (Space = pause, ←/→ = seek, ?t=4.2 = still)
python3 scripts/soundtrack.py     # optional: regenerate assets/soundtrack.wav (needs numpy)
npm run render                    # -> out/chimborazo.mp4  (needs ffmpeg on PATH)
node scripts/render.mjs --stills=1.5,4.5,7.5   # single frames -> out/stills/
```

Rendering uses software WebGL (SwiftShader) so it works on machines without a GPU;
expect roughly 0.3–1 s per frame. Use `--workers=N` to render in parallel.

## Sources

- Summit elevation 6,263 m — 2016 GPS survey by Ecuador's IGM and France's IRD.
- Distance from Earth's center (6,384.4 km vs Everest 6,382.3 km) — same survey / [Wikipedia: Chimborazo](https://en.wikipedia.org/wiki/Chimborazo).
- Three successive edifices and their ages — Samaniego et al. (2012), *Eruptive history of Chimborazo volcano (Ecuador)*, J. Volcanol. Geotherm. Res.
- Peak elevations of Cotopaxi, Cayambe and Antisana — commonly cited survey values.

The diagrams are schematic: vertical scales and Earth's bulge are exaggerated for clarity.
