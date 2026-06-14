# Motion Maker — design spec

_Date: 2026-06-14_

A new tool for motion design, focused on logo animation. Drop in a logo (icon +
wordmark, or either alone), animate it through a **node graph** with a scrubbable,
frame-based timeline, and export to multiple formats. Built to be modular and
procedural; later, one-click "drop-on" presets sit on top of the graph for
set-and-done results.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Animation model | **Node graph (nodes + wires)** |
| Wire model | **Hybrid** — object nodes flow into a Scene; value nodes plug into property sockets |
| Element granularity | **Whole objects + opt-in Split node** (SVG → sub-paths/letters on demand) |
| Timeline | **Frame-based**, global FPS (editable), derived seconds shown alongside |
| Keymap | Houdini-style: `Space` play/pause, `←/→` step, `Ctrl+←/→` first/last, `Shift+←/→` ±10 |
| Editor canvas | **React Flow** (`@xyflow/react`) for pan/zoom/nodes/wires; evaluation engine is custom |
| Logo hand-off | **Structured** (icon + wordmark + layout), one at a time |
| Export | PNG sequence, GIF, WebM (Phase 1); MP4 via Electron ffmpeg (Phase 2); Lottie (Phase 3) |

## Identity & placement

- Tool id `motion-maker`, label **"Motion Maker"** (matches "Pattern Maker" / "Logo Maker").
- Material icon via shared `Icon.jsx` (`animation` / `movie_filter`), accent `#ff7849`.
- Registered by one entry in `src/App.jsx` `TOOLS` + a `src/tools/MotionMaker/` folder.
- Minor version bump in `package.json` (new tool, per version-bump convention).
- Follow conventions: editable number inputs everywhere (shared `NumberField`), no
  emojis (Material icons only).

## Core idea — one deterministic evaluator

Everything hangs off a pure function:

```
evaluateScene(doc, frame) -> renderList
```

No animation lives in React state. The timeline owns a single `frame` number;
playback is a `requestAnimationFrame` loop incrementing it. Live preview,
scrubbing, and **all exporters** consume the same `renderList` for a given frame,
so frame N is always identical — which is what makes export reliable and scrubbing
exact.

## Data model

```
MotionDoc {
  fps, frameStart, frameEnd,
  canvas { w, h, bg = transparent },
  nodes[], edges[], view { pan, zoom }
}
Node {
  id, type, pos,
  params {},                    // static values
  valueBindings { paramKey -> valueNodeId }   // value node drives this property over time
}
```

Two socket kinds:

- **Object flow** — Sources → Modifiers → Scene, left to right. Wires carry
  renderable objects + transforms.
- **Value sockets** — a value node plugs into any property of any node to drive it
  over `frame`.

## Node vocabulary

- **Sources:** `Icon`, `Wordmark` (image object = dataUrl + aspect), `Shape`
  (accent rect/ellipse), `Group`.
- **Object modifiers:** `Transform` (pos/scale/rotate/opacity/anchor), `Split`
  (SVG → sub-paths/letters — opt-in granularity), `Stagger` (offsets a value across
  split children/copies), `Trim` (stroke draw-on), `Mask/Wipe`.
- **Value nodes (→ number/vector at frame t):** `Ramp` (eased in→out over a frame
  range), `Keyframes` (explicit keys + curve), `LFO` (sine/tri/saw — idle loops),
  `Spring` (physics settle), `Noise`, `Ease`/remap, `Math`.
- **Output:** single `Scene` node = what renders & exports.

## UI layout (3 zones)

- **Left inspector** — selected node's params via shared `NumberField`, plus
  Sources / canvas / export panels.
- **Center** — tabbed: **Stage** (SVG live preview at current frame) and **Graph**
  (React Flow node editor, themed to the app).
- **Bottom transport** — scrub bar, readout `frame 45 / 90 · 1.5s / 3.0s · 30 fps`
  (FPS + range editable), play/pause loop. Keymap as above.

## Presets = node-graph templates

A preset instantiates a small subgraph wired to the current Icon/Wordmark. Ships
with: **Pop & Settle**, **Fade + Scale In**, **Slide + Letter Stagger**
(Split+Stagger), **Stroke Draw-On** (Split+Trim), **Idle Breathing Loop** (LFO).
Fully tweakable because they're just graphs; users can save their own.

> Separately (Phase 2): **quick "drop-on" presets** — a curated gallery applied
> directly on the logo from the Stage, set-and-done, without opening the graph.
> These layer on top of the node editor for fast results.

## Logo Maker hand-off (structured, one at a time)

A "Send to Motion" button in Logo Maker writes
`{ icon, wordmark, layout, colors, treatment }` to a `designtools-shared-motion`
localStorage bucket (richer cousin of the existing PostFX `designtools-shared-image`
hand-off in `src/tools/PostFX/store.js`). Motion Maker reads it on mount, clears it,
and builds a starter graph: Icon + Wordmark nodes positioned per the layout, wired
to Scene. Single slot = one-by-one, as requested.

## Export pipeline

All driven by rasterizing each frame's `renderList` to canvas (reusing Logo Maker's
SVG→canvas path):

- **PNG sequence** — numbered PNGs, zipped, alpha.
- **GIF** — `lib/gif.js` (already in repo); matte against chosen bg.
- **WebM** — MediaRecorder, alpha (VP8/VP9).
- **MP4** _(Phase 2)_ — new Electron main-process **ffmpeg** IPC handler; needs
  touching Electron main + preload.
- **Lottie** _(Phase 3)_ — separate behavior→keyframe mapper; only transform/trim
  translate cleanly (raster/noise/spring won't).

## Files & infra

`src/tools/MotionMaker/`:

- `index.jsx` — shell/layout.
- `store.js` — doc state, undo/redo, autosave, hand-off read (mirrors
  `PostFX/store.js` module-store pattern).
- `engine.js` — `evaluateScene` + per-frame value evaluation.
- `nodes/` — type registry: each node type defines params, sockets, `evaluate`, and
  its React component.
- `Graph.jsx` — React Flow editor.
- `Stage.jsx` — SVG live preview.
- `Timeline.jsx` — transport + keymap.
- `Inspector.jsx` — selected-node params.
- `presets.js` — node-graph templates.
- `export/` — gif, webm, pngSeq, (mp4 ipc), (lottie).

Reuses existing undo/autosave/`markDirty` patterns. Run `graphify update .` after
shipping.

## Phasing

**Phase 1 (MVP):** scaffold + registry entry; data model + engine; React Flow
editor with Sources + Transform + Scene + Ramp/Keyframes/LFO/Spring value nodes;
timeline + keymap; SVG preview; **GIF + WebM + PNG-sequence** export; structured
Logo hand-off (send button + receive on mount); ~4 node-graph presets.

**Phase 2:** Split/Stagger/Trim (letter stagger, draw-on); Mask/Wipe; Shape/Group;
Noise/Math; **MP4 via Electron ffmpeg**; **quick drop-on presets** gallery;
**port selected PostFX effects into nodes**; user-saved presets.

**Phase 3:** **Lottie** export.

## Open items / risks

- MP4 requires Electron main/preload changes (ffmpeg bundling or spawn) — confirm
  ffmpeg availability strategy when Phase 2 starts.
- React Flow theming to match the app's hand-rolled dark aesthetic.
- Lottie only covers a subset of behaviors; document which nodes are exportable.
