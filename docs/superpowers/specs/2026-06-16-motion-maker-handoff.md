# Motion Maker — session handoff (2026-06-16)

## Branch state

- **Current branch**: `feat/motion-maker-value-ops` — PR #11 merged to `main`
- **Version**: `1.33.0`
- Next branch should be cut from `main` after merging PR #11

---

## What's been built (all 18 waves, merged through PRs #8–11)

| Wave | Nodes | PR | Version |
|------|-------|-----|---------|
| 1 | Array, Mirror, Wiggle, Clip, Physics / Constant, Time, Noise, Pulse, RandomHold | #8 | 1.20.0 |
| 2 | unlock 1 (value→value chaining) / Math, MapRange, Curve, Mix, Clamp, Keyframes | #8 | — |
| 3 | unlock 3 (appearance layer) / Tint, Blur, Glow, DropShadow, Blend | #8 | — |
| 4 | Dither, Glitch | #8 | — |
| 5 | unlock 4 (multi-frame sampling) / Echo, Strobe, Loop, TimeRemap | #9 | 1.21.0 |
| 6 | Particle System | #9 | 1.21.0 |
| 7 | Shatter/Assemble, Sort | #9 | 1.22.0 |
| 8 | Camera, Backdrop, Switch/Selector | #9 | 1.23.0 |
| 9 | 9 built-in presets | #9 | 1.24.0 |
| 10 | Text, Counter, Scramble | #10 | 1.25.0 |
| 11 | color-value socket / ColorSwatch, GradientMap | #10 | 1.26.0 |
| 12 | Align, MotionPath, Magnet, Orient | #10 | 1.27.0 |
| 13 | Effector (mograph backbone) | #10 | 1.28.0 |
| 14 | Delay, SampleHold, BrandPalette | #11 | 1.29.0 |
| 15 | Bypass/Mute, Reroute, Note | #11 | 1.30.0 |
| 16 | Expression (safe shunting-yard parser) | #11 | 1.31.0 |
| 17 | Split (text→letters/words) | #11 | 1.32.0 |
| 18 | Mask/Reveal (canvas-space SVG mask) | #11 | 1.33.0 |

**53 nodes total** (including Scene). Unlocks 1, 3, 4, color-value socket — all done. Unlocks 2 and 5 remain.

---

## What's NOT done (from the spec)

### ✅ Easy — registry + engine branch only

- **Null/Anchor** (Group 1 source) — invisible parent object; children inherit its transform. Rigging backbone.
- **Parent/Pin** (modifier) — constrain one object's transform to another. Depends on Null/Anchor existing.
- **Feel/Personality** (Group 7) — one dial (Snappy/Smooth/Bouncy/Mechanical/Organic) retimes every ease in the graph to a coherent character. Graph-level node, analysis-style.
- **Timing/Readability Check** (Group 7) — flags too-fast reads, off-canvas, low motion contrast, inconsistent easing. Emits findings like the Color Harmony critic. Analysis only.
- **Stagger** (modifier) — offset a driven value across children/copies by index (different from Effector — simpler, delay-based).
- **Marker** (QoL) — labeled flags on the timeline for long comps.
- **Seed/Shuffle** (value) — one global seed re-rolling all randomness; shuffle action.
- **Sequencer** (value) — multi-track value node firing envelopes at chosen frames.

### 🔧 Needs render work

- **Aspect/Reframe** — output the same comp at 1:1/9:16/16:9 with per-format reposition. Needs render viewport concept.
- **Path source** — raw SVG path string as an object. New render kind.
- **Stroke/Outline** appearance effect — outline with dash support. New SVG filter primitive in `render.jsx`.
- **Round Corners** — corner radius for rects/paths.
- **Gooey/Metaball** — SVG goo filter (feMorphology + blur trick).
- **Trim Paths** — stroke draw-on via `stroke-dashoffset`. Needs Path source first.
- **Motion Blur** — velocity-derived smear via multi-frame sampling. Needs unlock 4 (done) + render compositing.
- **Post FX Stack / Dither Preset nodes** — run a saved preset as one node per frame.
- **Pattern source** — Pattern Maker output as animated fill. Ties the tools together.

### 🧩 Needs unlock 5 (subgraph/nesting)

- **Compound/Subgraph** — the single highest-leverage unlock; turns presets into an ecosystem.
- **Field** — spatial falloff node.
- **Data-Driven/List** — feed CSV/list into Repeater for content factories.
- **State Machine** — multi-state animation for interactive/web export.
- **Lockup/Auto-Layout** — responsive icon+wordmark layout node.
- **Overshoot/Follow-through**, **Inertia/Drag** — velocity-derived; need multi-frame (done) + subgraph for clean API.

### ✅* Needs precompute/analysis design

- **Audio-Reactive** — drive from uploaded audio track. Amplitude/FFT precomputed at load → deterministic per frame.

---

## Key architecture facts for the next session

### Engine (`src/tools/MotionMaker/engine.js`)

- Pure function: `evaluateScene(doc, frame) → renderList`. No state.
- `evalValueNode(node, frame, ctx, seen)` — all value nodes; cycle guard via `seen` Set; handles color vtype.
- `resolveParams(node, frame, ctx, seen)` — skips bypassed value bindings.
- `gatherObjects(nodeId, frame, ctx, seen)` — exposes `gather(f)` closure for time-domain modifiers.
- `hash01(n, seed)`, `valueNoise(t, seed)`, `fbmSigned(t, seed, octaves)` — deterministic noise.
- `parseHex`, `lerpColor`, `hexToRgba` — color helpers (wave 11).
- Safe expression: `tokenizeExpr`, `compileExpr`, `getExpr` (cached shunting-yard, never eval).
- `EASES` object covers linear/easeIn/easeOut/easeInOut/cubic variants/outBack/inBack/inOutBack/outElastic/outBounce.

### Nodes registry (`src/tools/MotionMaker/nodes.js`)

- `EASE_OPTIONS` exported (shared with Inspector).
- `defaultParams` deep-clones object/array defaults via `JSON.parse(JSON.stringify(...))` — important for keyframes.
- `socketParams(def)` includes both `number` AND `color` params.
- `CATEGORY_COLOR` includes `note: '#ffd36b'` and `appearance: '#f472b6'`.
- `NODE_MENU` groups: Sources, Modifiers, Appearance, Color, Values, Operators, Utility, Output.

### Render (`src/tools/MotionMaker/render.jsx`)

- `fxPrimitive(e, IN, OUT)` — per-effect SVG filter primitive (blur/tint/glow/dropShadow/glitch/dither).
- `buildFilter(item)` — compiles fx chain to one stacked `<filter>`.
- `buildMask(item)` — canvas-space `<mask maskUnits="userSpaceOnUse">` for Mask/Reveal.
- `itemSvg(it, filterId, maskId)` — wraps inner in `<g mask="url(#...)">` if maskId present.
- Both `sceneToSvgString` (export) and `SceneSvg` (preview) collect filter + mask defs.

### Graph editor (`src/tools/MotionMaker/Graph.jsx`)

- `MotionNode` — bypass dimming, strikethrough, bypass button with `Icon name="block"`.
- `NoteNode` — sticky with `<textarea className="nodrag">`.
- `COLOR_SOCKET = '#e879f9'` for color-vtype valout edges/handles.
- `isValidConnection` — type-matches objout→objin; color↔color / number↔number for value sockets.
- `vtypeById` memo maps nodeId to `'color'` or `'number'`.

### Store (`src/tools/MotionMaker/store.js`)

- `toggleBypass(id)` — maps nodes, flips `n.bypass`, calls `patchDoc`.

---

## Suggested next wave (Wave 19)

**Rigging: Null/Anchor + Parent/Pin + Stagger**

All ✅ (registry + engine), no render work needed. These unlock clean multi-object rigs. Null/Anchor is the "invisible parent" source; Parent/Pin is the modifier that makes a child follow it. Stagger is the delay-per-index modifier (simpler than Effector, complements it).

After that: **Feel/Personality + Timing/Readability Check** (Group 7 graph-level nodes) — both ✅, no unlocks needed, and they're high-value for the "critique suite" identity.

---

## Conventions

- Version: patch `0.0.1` for fixes, minor `0.1.0` for major feature additions (new tool = minor).
- No emojis in UI — use `Icon.jsx` (Material icons).
- Every editable number in a panel must use `NumberField.jsx`.
- After modifying code: `graphify update .` to refresh the graph.
- Pre-push hook validates graphify — it runs automatically.
- Commit messages: plain English, what + why. Co-author line: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

---

## Troubleshooting notes

- **Stale localStorage**: if inspector is corrupt after eval experiments, run `localStorage.removeItem('designtools-motion')` in the browser console then reload.
- **HMR module identity**: `preview_eval` dynamic imports are separate from the app's HMR module — store mutations from eval don't trigger app React state. Verify via DOM inspection (`preview_snapshot`) instead of relying on preview_eval store calls to update the UI.
- **Commit messages with `@`**: use `git commit -F .git/COMMIT_EDITMSG_TMP` (write message to file first) to avoid PowerShell here-string issues with `@` characters.
- **Keyframes default**: `keys` array must be deep-cloned in `defaultParams` or all instances share the same reference.
