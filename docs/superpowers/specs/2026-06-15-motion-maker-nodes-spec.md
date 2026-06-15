# Motion Maker — node catalog spec

_Date: 2026-06-15_

A comprehensive node vocabulary for the Motion Maker tool. This is a **functionality**
spec — it defines every node, its parameters (with real depth), and how it fits the
engine. Presets come later and are just node-graph templates built from this set.

Companion to the design spec: `2026-06-14-motion-maker-design.md`.

## Architecture recap (what every node must respect)

The whole tool hangs off one pure function: `evaluateScene(doc, frame) -> renderList`
(`src/tools/MotionMaker/engine.js`). Nothing animated lives in React state; the
timeline owns a single `frame` and everything derives from it deterministically, so
frame N is always identical (exact scrubbing, reliable export).

Two flows:

- **Object flow** — `Source → Modifier(s) → Scene` on `objout`/`objin` handles. A
  modifier receives an **array** of objects from upstream and returns an array, so a
  modifier may also *duplicate* objects (Array, Stagger, Echo).
- **Value flow** — a value node outputs one number into a target node's `prop:<key>`
  handle, driving that property over `frame`.

Render items are flat 2D:
`{ id, kind, href|shape|color, w, h, x, y, rotate, opacity }`, drawn by `render.jsx`
as `<g transform="translate rotate"><image|shape/></g>`.

### Feasibility tiers (marked on every node)

- ✅ **Works in the engine as-is** — registry entry in `nodes.js` + an engine branch.
- 🔧 **Needs a render-schema + renderer extension** — new visual fields plumbed into
  `render.jsx` (`itemSvg` / `SceneSvg` / `rasterizeScene`).
- 🧩 **Needs an engine extension** — one of the unlocks below.

### Five architectural unlocks

Each multiplies what's possible; many deep nodes depend on them. Decide per-unlock.
The full unlock → gated-nodes map is in the summary table at the end.

1. **Value→value chaining** — let value nodes accept value *inputs* (today they're
   leaf generators). Unlocks the whole Value-operators group (Math, Map Range, Curve,
   Mix, Clamp, Delay, Expression) and Field/Effector driving params.
2. **Anchor / pivot** — transforms currently pivot about object or canvas center. A
   real pivot point unlocks proper scale/rotate/squash & stretch.
3. **Appearance layer** — render items carry optional effects (blur, glow, tint,
   shadow, stroke, blend) via SVG filters. Gates the entire Appearance group.
4. **Multi-frame sampling** — let a modifier re-evaluate its upstream at `frame−k`.
   Unlocks Echo/Trails, time-domain modifiers, particles, and velocity-derived motion
   blur / overshoot / inertia.
5. **Subgraph / nesting** — let a node contain and evaluate a child graph. Gates the
   power tier (Compound, Field+Effector, Data-Driven, State Machine).

Plus a **minor color-value socket** unlock — value sockets that carry a color rather
than a number (Brand Palette, Gradient Map, color-driving Tint).

---

## Group 1 — Sources (produce objects)

| Node | Tier | Purpose |
| --- | --- | --- |
| **Icon** | ✅ | Image object (dataUrl + aspect). _Exists._ |
| **Wordmark** | ✅ | Image object. _Exists._ |
| **Shape** | ✅ | Accent rect/ellipse. _Exists — extend._ |
| **Text** | 🔧 | Live editable type for taglines/dates. |
| **Null / Anchor** | ✅ | Invisible parent object; children inherit its transform — rigging backbone. |
| **Backdrop** | 🔧 | Full-canvas solid/gradient plate. |
| **Path** | 🔧 | Raw SVG path string as an object; natural Trim target. |
| **Pattern** | 🔧 | A Pattern Maker output as an animated fill/background. Ties the app's tools together. |

**Shape** (extend): add `kind` options (triangle/polygon/star/line) with `sides` /
`points` / `innerRatio` for star, plus `cornerRadius`, `stroke`, `strokeWidth`.

**Text** params: `string`, `font`, `weight`, `size`, `tracking` (letter-spacing),
`leading`, `align` (left/center/right), `fill`, `case` (none/upper/lower).

**Null / Anchor** params: `x`, `y`, `rotate`, `scale`.

**Backdrop** params: `mode` (solid/linear/radial), `colorA`, `colorB`, `angle`,
`stops`.

**Path** params: `d` (path data), `fill`, `stroke`, `strokeWidth`.

**Pattern** params: `preset` (Pattern Maker share/code), `scale`, `scroll` (x/y per
frame for animated tiling), `opacity`.

---

## Group 2 — Object modifiers

A modifier takes an array of objects and returns an array — so it can transform,
multiply, restructure, or re-time them. Sub-grouped for navigation; param schemas for
all of them follow the tables.

### 2a — Transform & copy

| Node | Tier | Purpose |
| --- | --- | --- |
| **Transform** | ✅ | Pos/scale/rotate/opacity deltas. _Exists — extend._ |
| **Array / Repeater** | ✅ | Emit N copies with compounding per-copy delta. |
| **Stagger** | ✅ | Offset a driven value across children/copies by index. |
| **Mirror / Symmetry** | ✅ | Reflect/kaleidoscope objects across an axis. |

### 2b — Structure & layout

| Node | Tier | Purpose |
| --- | --- | --- |
| **Split** | 🧩 | Break SVG/text into sub-paths/letters for per-piece animation. |
| **Trim Paths** | 🔧 | Stroke draw-on. |
| **Parent / Pin** | ✅ | Constrain one object's transform to another (follow with offset). |
| **Align / Distribute** | ✅ | Snap objects to canvas/each other and even out spacing. |
| **Clip / In-Out** | ✅ | Show an object only between two frames, with fade/scale on enter & exit. |
| **Lockup / Auto-Layout** | 🧩 | Arrange icon+wordmark as a responsive lockup and animate between configs — the canonical logo reveal. |

### 2c — Motion behaviors

| Node | Tier | Purpose |
| --- | --- | --- |
| **Motion Path** | ✅ | Drive an object along a bezier/polyline by progress `t` — the missing "move along a curve" core. |
| **Orient / Look-at** | ✅ | Auto-rotate to face motion direction or a target. |
| **Wiggle** | ✅ | Convenience noise straight onto transform (no value wiring). |
| **Magnet / Attractor** | ✅ | Pull/repel objects (great with Split) toward a point. |
| **Physics / Gravity** | ✅ | Drop / bounce / settle via analytic ballistics. |
| **Overshoot / Follow-through** | 🧩 | Auto-add trailing overshoot to any incoming animated transform. |
| **Inertia / Drag** | 🧩 | Lag/smooth an input with momentum (keeps moving after the stop). |

### 2d — Generative & transitions

| Node | Tier | Purpose |
| --- | --- | --- |
| **Particle System** | 🧩 | Emit objects over time (lifespan/velocity/gravity/rate), deterministic via per-particle birth-frame seeding. |
| **Shatter / Assemble** | 🧩 | Fragment an object and fly the pieces apart, or run it in reverse as a reveal. |
| **Scramble / Decode** | 🔧 | Text cycles random glyphs then settles into the real word. Needs Text source. |
| **Morph** | 🧩🔧 | Interpolate one path/logo into another (rebrand transitions). Budget as its own project. |
| **Echo / Trails** | 🧩 | Time-delayed ghosts of upstream motion. |

### 2e — Time-domain modifiers (re-time the upstream subtree)

All require the **multi-frame sampling** unlock (🧩) — they re-evaluate upstream at a
warped `frame`. Architecturally clean because the engine is pure `f(frame)`.

| Node | Tier | Purpose |
| --- | --- | --- |
| **Time Remap / Time Warp** | 🧩 | Rewrite the frame fed upstream: speed ramps, freeze, reverse, ease the timing itself. |
| **Stop-Motion / Strobe** | 🧩 | Sample upstream at a lower frame step for hand-animated/choppy charm. |
| **Loop / Boomerang** | 🧩 | Wrap a subtree's time into a seamless loop (cycle/mirror/ping-pong). |

**Transform** (extend): add `anchorX`, `anchorY` (🧩 unlock 2), `skewX`, `skewY` (🔧),
and split `scale` into `scaleX` / `scaleY` for squash & stretch.

**Array / Repeater** params: `count`, `dx`, `dy`, `dScale`, `dRotate`, `dOpacity`,
`layout` (linear/grid/radial), `radius`, `arc`.

**Stagger** params: `delayPerIndex` (frames), `order`
(forward/reverse/center-out/random), `overlap`, `seed`.

**Split** params: `by` (paths/letters/words), `origin`.

**Trim Paths** params: `start`, `end`, `offset`, `mode`
(simultaneous/individually-per-split-piece).

**Echo / Trails** params: `copies`, `frameDelay`, `opacityFalloff`, `scaleFalloff`,
`mode` (echo/onion-skin).

**Orient / Look-at** params: `target`, `mode` (velocity/point), `offsetAngle`.

**Wiggle** params: `posAmp`, `rotAmp`, `scaleAmp`, `frequency`, `seed`, `smooth`.

**Lockup / Auto-Layout** params: `from`, `to` (horizontal/stacked/icon-only), `gap`,
`align`, `order` (icon-first/wordmark-first), `transition` (frames), `stagger`, `ease`.

**Physics / Gravity** params: `gravity`, `bounce`, `floorY`, `wallX`, `startFrame`,
`friction`, `initialVelocity` (x/y), `mass`.

**Magnet / Attractor** params: `x`, `y`, `strength`, `radius` (influence range),
`falloff` (linear/smooth/inverse-square), `mode` (attract/repel/orbit), `startFrame`.

**Shatter / Assemble** params: `pieces`, `spread`, `rotateChaos`, `direction`
(in/out), `seed`.

**Scramble / Decode** params: `charset`, `settleOrder`
(left-right/random/center-out), `direction` (in/out), `speed`, `holdFrames`,
`duration`.

**Morph** params: `target`, `t`, `pointMatch` (auto/manual), `ease`.

**Time Remap / Time Warp** params: `mode` (remap/freeze/reverse/speed), `inFrame`,
`outFrame`, `ease`, `speed`.

**Stop-Motion / Strobe** params: `step`, `phase`, `jitter`.

**Loop / Boomerang** params: `mode` (cycle/mirror/pingpong), `loopFrames`.

**Motion Path** params: `path` (bezier/polyline), `t` (0–1 progress), `orient`
(auto-rotate to tangent), `align` (start/end offset).

**Align / Distribute** params: `alignX` (left/center/right), `alignY`
(top/middle/bottom), `distribute` (off/horizontal/vertical), `relativeTo`
(canvas/selection).

**Clip / In-Out** params: `inFrame`, `outFrame`, `enter` (fade/scale/slide), `exit`,
`transition` (frames).

**Parent / Pin** params: `target`, `offsetX`, `offsetY`, `inheritRotate`,
`inheritScale`.

**Overshoot / Follow-through** params: `amount`, `damping`. _(velocity-derived →
multi-frame.)_

**Inertia / Drag** params: `damping`, `lag`. _(velocity-derived → multi-frame.)_

**Mirror / Symmetry** params: `axis` (x/y/both), `count`, `center`.

**Particle System** params: `rate`, `lifespan`, `emitShape` (point/line/circle),
`velocity`, `spread`, `gravity`, `rotateVel`, `scaleOverLife`, `opacityOverLife`,
`colorOverLife`, `maxParticles`, `seed`.

---

## Group 3 — Appearance / effects (per-object)

All require the **appearance layer** unlock (🔧, SVG filters in `render.jsx`).

| Node | Tier | Purpose |
| --- | --- | --- |
| **Tint / Color** | 🔧 | Multiply/replace/hue-shift/duotone. |
| **Blur** | 🔧 | Gaussian, optionally directional. |
| **Glow / Bloom** | 🔧 | Blur + screen merge. |
| **Drop Shadow** | 🔧 | Offset shadow. |
| **Stroke / Outline** | 🔧 | Outline with dash support. |
| **Motion Blur** | 🧩🔧 | Velocity-derived smear via multi-frame sampling at export. |
| **Round Corners** | 🔧 | Corner radius for rects/paths. |
| **Blend Mode** | 🔧 | Composite mode via `mix-blend-mode`. |
| **Dither / Halftone** | 🔧 | Port the app's Dither engine as an animated per-object effect — logo resolving through a dither pattern. App-signature. |
| **Glitch / Datamosh** | 🔧 | Block displacement + RGB split + scanline tear on a schedule. App-signature. |
| **Gooey / Metaball** | 🔧 | Liquid blob merge between objects (classic SVG goo filter). |
| **Post FX Stack** | 🔧 | Run an entire saved Post FX preset as one node per frame — whole grade as a single node. |
| **Dither Preset** | 🔧 | Run a saved Dither preset as one node. Companion to Post FX Stack. |

**Tint / Color** params: `mode` (multiply/replace/hue-shift/duotone), `color`,
`amount`, `hueShift`, `saturation`, `brightness`. (`feColorMatrix`)

**Blur** params: `radius`, `direction` (uniform/horizontal/vertical), `angle`.
(`feGaussianBlur`)

**Glow / Bloom** params: `radius`, `intensity`, `threshold`, `color`.

**Drop Shadow** params: `dx`, `dy`, `blur`, `spread`, `color`, `opacity`, `inner`
(toggle for inner shadow). (`feDropShadow`)

**Stroke / Outline** params: `width`, `color`, `position` (in/center/out), `dash`,
`dashOffset`, `cap` (butt/round/square), `join` (miter/round/bevel).

**Motion Blur** params: `shutter` (0–360°), `shutterPhase`, `samples`.

**Round Corners** params: `radius`, `style` (round/bevel/scoop), `perCorner` (per-corner
overrides for rects).

**Blend Mode** params: `mode` (normal/multiply/screen/overlay/add/difference).

**Dither / Halftone** params: `mode` (ordered/halftone/noise), `cells`, `angle`,
`levels`, `animate`.

**Glitch / Datamosh** params: `intensity`, `blockSize`, `rgbSplit`, `interval`,
`seed`.

**Gooey / Metaball** params: `threshold`, `blur`, `color`.

**Post FX Stack** params: `preset` (Post FX share code / saved id), `amount`. Reuses
the Post FX engine on each rasterized frame.

**Dither Preset** params: `preset` (Dither preset id/code), `amount`.

---

## Group 4 — Value generators (→ number/color at frame)

Mostly ✅ (registry entry + engine branch); exceptions noted.

| Node | Tier | Purpose |
| --- | --- | --- |
| **Ramp** | ✅ | Eased from→to over a frame range. _Exists._ |
| **LFO** | ✅ | Sine/tri/saw/square idle loops. _Exists._ |
| **Spring** | ✅ | Physics settle (underdamped). _Exists._ |
| **Keyframes** | ✅ | Explicit keys + per-segment ease — the workhorse. |
| **Noise** | ✅ | Deterministic value noise over time. |
| **Pulse / Beat** | ✅ | Periodic spikes for rhythmic hits. |
| **Constant** | ✅ | Fixed value (essential for math graphs). |
| **Color Swatch** | ✅ | A plain constant color to wire into any fill/tint (color-value socket). |
| **Time** | ✅ | Raw frame/seconds/progress as a value to feed operators. |
| **Random Hold** | ✅ | Stable random that re-rolls on interval. |
| **Brand Palette** | ✅ | Outputs **color** values from the Logo Maker hand-off palette; index/cycle to keep motion on-brand. |
| **Audio-Reactive** | ✅* | Drive motion from an uploaded track's amplitude/bands. *Needs an analysis precompute at load.* |
| **Sequencer** | ✅ | Compact multi-track value node firing envelopes at chosen frames — bridges graph and timeline. |
| **Seed / Shuffle** | ✅ | One global seed re-rolling all randomness; shuffle until you like the take. |
| **Gradient Map** | ✅ | Map a 0–1 input to a **color** along a gradient (pairs with Brand Palette). |
| **Counter / Number Ticker** | 🔧 | Animated counting numbers (stats/prices/dates). Needs Text source. |

**Keyframes** params: array of `{ frame, value, ease }`, plus `extrapolate`
(hold/loop/ping-pong). Flagship node — inspector gets a mini curve editor.

**Noise** params: `frequency`, `amplitude`, `offset`, `octaves`, `seed`, `type`
(perlin/simplex/value). Must be hash-based / deterministic, not stateful.

**Pulse / Beat** params: `interval`, `width`, `shape` (spike/gate/decay), `phase`.

**Constant** params: `value`.

**Color Swatch** params: `color`, `alpha`. Outputs a color (color-value socket).

**Time** params: `mode` (frame/seconds/0-1), `scale`, `offset`.

**Random Hold** params: `interval`, `min`, `max`, `seed`, `smooth`.

**Brand Palette** params: `index`, `cycleFrames`, `mode` (hold/cycle/random). Outputs
a color rather than a number — needs a color-value socket type.

**Audio-Reactive** params: `source` (audio file), `band` (low/mid/high/full), `gain`,
`smooth`, `offset`. Precompute the amplitude/FFT envelope on load → deterministic per
frame.

**Sequencer** params: per-track rows of `{ frame, value, ease }`; `tracks`, `loop`.

**Seed / Shuffle** params: `seed` (+ a "shuffle" action that re-rolls it).

**Gradient Map** params: `stops`, `input` (0–1). Outputs a color (color-value socket).

**Counter / Number Ticker** params: `from`, `to`, `format` (decimals/thousands), `prefix`,
`suffix`, `ease`.

---

## Group 5 — Value operators (value → value)

All require the **value→value chaining** unlock (🧩).

| Node | Tier | Purpose |
| --- | --- | --- |
| **Math** | 🧩 | a op b. |
| **Map Range** | 🧩 | Remap an input range to an output range — the glue node. |
| **Curve / Shaper** | 🧩 | Apply any easing (incl. cubic-bezier) to a 0–1 value. |
| **Mix** | 🧩 | Blend two value inputs. |
| **Clamp / Quantize** | 🧩 | Limit / posterize a value (stepped/robotic motion). |
| **Delay** | 🧩 | Time-shift a value input. |
| **Sample & Hold** | 🧩 | Freeze a value's last sample on a schedule — stepped/robotic motion, or lock a random pick. |
| **Expression / Formula** | 🧩 | Tiny safe formula of `frame`/`t`/inputs — deterministic power-user escape hatch. |

**Math** params: `op` (+ − × ÷ mod pow min max; unary abs/neg/sin/cos/floor/round),
`b` (constant if no second input), `clamp`.

**Map Range** params: `inMin`, `inMax`, `outMin`, `outMax`, `clamp`, `ease`.

**Curve / Shaper** params: `ease` (full library + cubic-bezier `x1,y1,x2,y2`).

**Mix** params: `t`, `mode` (lerp/add/multiply).

**Clamp / Quantize** params: `min`, `max`, `steps`.

**Delay** params: `frames`, `mode` (hold/wrap/mirror).

**Sample & Hold** params: `interval` (frames between samples), `trigger`
(interval/on-input-change), `phase`.

**Expression / Formula** params: `expr` (e.g. `sin(t*2)*40 + a`), named inputs
`a`,`b`,`c`. Evaluate with a small safe parser — never `eval`.

---

## Group 6 — Layout / composition / output

| Node | Tier | Purpose |
| --- | --- | --- |
| **Scene** | ✅ | What renders & exports. _Exists._ |
| **Camera** | 🔧 | Global zoom/pan/rotate of the whole comp (drivable). |
| **Mask / Track Matte** | 🔧 | One object's alpha/luma masks another. |
| **Sort / Layer** | ✅ | Reorder / Z-index objects. |
| **Switch / Selector** | ✅ | Route between multiple object/value inputs by a drivable index — A/B variants, simple state machines. |
| **Aspect / Reframe** | 🔧 | Output the same comp in 1:1 / 9:16 / 16:9 with per-format reposition — one graph, many social deliverables. |

**Camera** params: `x`, `y`, `zoom`, `rotate`, `anchorX`, `anchorY` (zoom/rotate
origin), `dolly` (z for 2.5D push). Drivable like any node.

**Mask / Track Matte** params: `mode` (alpha/luma/invert), `source`, `feather`,
`expand` (choke/spread), `invert`.

**Sort / Layer** params: `mode` (by-index/by-Y/reverse/manual), `z`.

**Switch / Selector** params: `index`, `inputs` (n), `kind` (object/value),
`crossfade` (frames, for soft switches).

**Aspect / Reframe** params: `ratios` (1:1/9:16/16:9/4:5/custom), per-format `offset`,
`scale`, `safeArea`.

---

## Group 7 — Power / meta nodes

The ceiling-raisers and graph-level meta. The first five change what the tool can
express, not just add an effect; the last two act on the whole graph rather than a
single object.

| Node | Tier | Purpose |
| --- | --- | --- |
| **Compound / Subgraph** | 🧩 | Collapse a cluster of nodes into one reusable node with promoted params — user-defined nodes, saved to a library. The single highest-leverage addition. |
| **Field** | 🧩 | A spatial falloff (linear/radial/noise/by-index) sampled per-object — the mograph effector backbone. |
| **Effector** | 🧩 | Apply transform/color offsets across Array/Split copies weighted by a Field — "a wave of scale across a grid." |
| **Data-Driven / List** | 🧩 | Feed a list/CSV (names, numbers, colors, image paths) into a Repeater → N variations from one graph (content factory). |
| **State Machine** | 🧩 | Define states (idle/hover/active/exit) + transitions → a multi-state animation for interactive/web export. |
| **Feel / Personality** | ✅ | One dial (Snappy/Smooth/Bouncy/Mechanical/Organic) retimes every ease in the graph to a coherent character. Graph-level. |
| **Timing / Readability Check** | ✅ | Flags too-fast reads, off-canvas elements, low motion contrast, inconsistent easing — the motion-side critic. Analysis only. |

**Compound / Subgraph** params: promoted inputs (any inner param), `label`, `icon`,
`color`. Saveable to a node library; instances share definition, override promoted
params.

**Field** params: `type` (linear/radial/box/noise/by-index), `center`, `size`,
`falloff`, `falloffCurve` (ease applied to the falloff), `remap` (in/out range),
`invert`.

**Effector** params: `field`, `posOffset` (x/y), `scaleOffset`, `rotateOffset`,
`opacityOffset`, `colorOffset`, `strength`, `seedPerCopy`.

**Data-Driven / List** params: `data` (pasted CSV / rows), `mapping` (column → target
param), `loop`, `index` (drivable). Pairs with Array (copy-per-row) and
Aspect/Reframe + batch export for a deliverable matrix.

**State Machine** params: `states` (named graph snapshots), `transitions`
(from→to, duration, ease), `default`, `trigger` (frame/event for interactive export).

**Feel / Personality** params: `character`
(snappy/smooth/bouncy/mechanical/organic), `intensity`. Overrides ease selection
across nodes (respects nodes set to "manual").

**Timing / Readability Check** params: `minReadFrames`, `checkOffCanvas`,
`checkContrast`, `checkEaseConsistency`. Emits findings (Issue/Note/Good) like the
Color Harmony critic — analysis only, doesn't alter the scene.

---

## Group 8 — Graph utilities / QoL

Not evaluation nodes — editor affordances that make large graphs pleasant to work in.
All ✅ and cheap, but disproportionately loved once graphs grow past ~10 nodes. (Color
Swatch lives in Group 4 and Sample & Hold in Group 5, since those are real value
nodes.)

| Node | Tier | Purpose |
| --- | --- | --- |
| **Note / Frame** | ✅ | Sticky comments + a labeled box around a cluster of nodes — the biggest readability win. |
| **Reroute / Dot** | ✅ | A tiny pass-through to bend wires and kill spaghetti. |
| **Bypass / Mute & Solo** | ✅ | Toggle any node off without deleting it, or solo a branch to preview alone — the iteration accelerator. |
| **Marker** | ✅ | Labeled flags on the timeline ("logo in", "tagline", "end card") for navigating long comps. |

**Note / Frame** params: `text`, `color`, `collapsed`, `bounds` (auto-fits enclosed
nodes).

**Reroute / Dot** params: — (just an input→output pass-through; carries object or
value).

**Bypass / Mute & Solo** params: per-node `bypass` and `solo` flags (a graph-wide
property, surfaced as node-header toggles rather than a separate node).

**Marker** params: `frame`, `label`, `color`.

---

## Build-order recommendation

Highest impact-per-effort first:

1. **Procedural-motion core** — Stagger, Array/Repeater, Keyframes, Noise, Map Range
   (mostly ✅, with chaining unlock for Map Range). This is what makes motion feel
   designed rather than linear.
2. **QoL layer** (Group 8) — Note/Frame, Reroute, Bypass/Mute & Solo. Trivial to
   build, and they pay back immediately by making every later graph workable. Do these
   alongside step 1.
3. **Appearance layer** (Group 3) — visual polish; requires unlock 3.
4. **Rigging & advanced** — Null/Anchor, Split, Trim, Echo, Camera, Mask.
5. **Power tier** (Group 7) — Compound/Subgraph first (turns presets into an
   ecosystem), then Field+Effector (the mograph paradigm), then Data-Driven for the
   deliverable factory.

## Unlock dependency summary

| Unlock | Gated nodes |
| --- | --- |
| 1. Value→value chaining | Entire Group 5 (Math, Map Range, Curve, Mix, Clamp, Delay, Expression); Effector/Field driving params |
| 2. Anchor / pivot | Transform anchor; clean squash & stretch |
| 3. Appearance layer | Group 3 (Tint, Blur, Glow, Shadow, Stroke, Round Corners, Blend, Dither, Glitch, Gooey, Post FX Stack, Dither Preset) |
| 4. Multi-frame sampling | Echo/Trails, Motion Blur, Time Remap, Stop-Motion, Loop/Boomerang, Shatter, Morph, velocity-driven Orient, Overshoot, Inertia, Particle System |
| 5. Subgraph / nesting | Compound nodes; Field+Effector; Data-Driven; State Machine (Group 7) |
| (color-value socket) | Brand Palette, Gradient Map, Tint color-driving |

> **Color-value socket** (minor unlock): Brand Palette and Tint want value sockets
> that carry a color, not just a number — a small addition to the value-binding type.
