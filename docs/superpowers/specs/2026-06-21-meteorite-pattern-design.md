# Meteorite Pattern — Design Spec

Date: 2026-06-21
Status: Approved for planning
Tool: Pattern Maker (new internal tab)

## Summary

Add a procedural abstract pattern generator inspired by Widmanstätten iron-meteorite
etch patterns, as a second tab inside the existing Pattern Maker tool. It is intended
for brand packaging and must produce clean, print-ready vector output. The user wants
multiple variations to choose from and control over how far the pattern reaches across
a panel (e.g. only the bottom of a box, or full coverage).

## Goals

- A stylized, brand-ready crosshatch pattern evoking a cut-and-etched octahedrite.
- Multiple starting variations via named presets, plus a reseed for arrangement variety.
- Control over how far the pattern reaches (vertical and horizontal) with a soft,
  organic stop — not an opacity fade and not a hard cut.
- Print-friendly: solid vector shapes, limited color count, real-world sizing.
- Reuse the existing Pattern Maker export and session machinery.

## Non-goals

- Physically accurate metallurgical simulation (plessite fields, true crystallography).
- CMYK conversion in this tool (handled in the existing Color Palette tool).
- Animation.

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Placement | Internal tab in Pattern Maker: "Shapes" (current) + "Meteorite" (new) |
| Aesthetic | Stylized / brand-ready crosshatch (not photo-realistic etch) |
| Reach control | Vertical + horizontal reach sliders with soft organic stop; not a gradient |
| Opacity | Bands fully opaque by default; optional "Opacity variation" toggle |
| Output | Both modes, switchable: Fit-to-size (mm + DPI) and Seamless tile |
| Variations | Named presets + Seed/Reseed button |
| Colors | Limited palette: matrix + band + optional rim |

## Architecture

`src/tools/PatternMaker.jsx` (currently ~730 lines, single tool) is converted to a folder
so the second generator does not bloat one file:

```
src/tools/PatternMaker/
  index.jsx        — tab shell ("Shapes" | "Meteorite") + shared panel-resize chrome
  ShapesTab.jsx    — the current Pattern Maker tool, moved verbatim (no behavior change)
  MeteoriteTab.jsx — new generator: controls + preview + export wiring
  meteorite.js     — pure pattern engine (params in -> SVG string out, no React)
  ui.jsx           — shared controls (Section, SliderRow, Toggle, HexInput, btn, etc.)
                     extracted from the current file so both tabs reuse them
```

- `App.jsx` import changes from `./tools/PatternMaker.jsx` to `./tools/PatternMaker/index.jsx`.
- The Shapes tab keeps its existing localStorage key (`designtools-patternmaker`), session
  save/load, undo registration, and dirty-tracking unchanged.
- The Meteorite tab gets its own key (`designtools-meteorite`) with the same auto-save +
  markDirty/markSaved pattern.
- The active tab is remembered in localStorage.
- The tab switch is a small segmented control at the top of the left control panel, styled
  like the existing mode buttons. No emoji; use `Icon.jsx` (Material icons) if an icon is needed.

This split follows the existing multi-file tool convention (`LogoMaker/`, `MotionMaker/`,
`ColorPalette/`).

## The engine — `meteorite.js`

A single pure function:

```
buildMeteorite(params) -> { svg, W, H }
```

Seeded RNG reuses the existing `mkRng(seed)` helper.

### Canvas sizing

- Fit mode: `W = round(widthMm / 25.4 * dpi)`, `H = round(heightMm / 25.4 * dpi)`.
- Tile mode: `W`, `H` in px (as the Shapes tab works today).

### Generation algorithm (crossing line-families)

1. For each of N orientations (angle set, 2–4 directions), lay down parallel lamellae
   across the canvas:
   - jittered spacing between lamellae,
   - jittered band width (min/max),
   - each lamella broken into segments along its length with jittered segment length and
     jittered gaps.
2. Where the orientation families overlap, the interlocking elongated-triangle network
   emerges automatically — the Widmanstätten look.
3. Optional bright `rim` rectangle drawn behind each band segment (taenite edge).
4. Fills are flat: `matrix` (background), `band`, optional `rim`.

### Reach control (coverage)

For each band segment, compute the center point's normalized position along each axis,
measured from the anchor edge:

- `dv` = vertical distance from anchor (bottom by default, or top).
- `dh` = horizontal distance from anchor (left by default, or right).

A reach ramp gives a coverage probability per axis:

```
ramp(d, reach, softness):
  if d <= reach: return 1
  if d >= reach + softness: return 0
  return 1 - (d - reach) / softness
```

`coverage = (vertical enabled ? ramp(dv, vReach, vSoft) : 1)
          * (horizontal enabled ? ramp(dh, hReach, hSoft) : 1)`

The segment is drawn only if `rng() < coverage`. Because whole segments are kept or
dropped (never made translucent), the stop reads as the pattern organically thinning
out and running out — not an opacity fade and not a straight cut. With reach at 100%
the ramp is flat and the pattern fills the whole panel.

### Opacity

Bands render at full opacity by default. When the "Opacity variation" toggle is on,
each segment gets a jittered opacity (e.g. 0.7–1.0) for a more textured, etched feel.

### Tile vs Fit

- Tile mode adds the same edge-wrap logic the Shapes tab uses (`seamless`) so the result
  repeats cleanly.
- Fit mode clips to the panel rect with no wrapping — one composition fitted to exact
  package-panel dimensions.

### Output

Returns one `<svg>` string in the same shape as the current `buildSvg` output, so the
existing export paths (TILE / AI SWATCH / sized canvas / COPY SVG) work unchanged.

## Controls — `MeteoriteTab.jsx`

Reuses shared `ui.jsx` controls and the existing export toolbar + Session section.

- Presets strip (top): `Coarse`, `Fine`, `Etched`, `Triangular`, `Sparse`. Each is a
  parameter bundle; clicking loads it and everything remains tweakable. Plus a
  Seed + Reseed button.
- Structure: orientation count + angles, lamella spacing, band width (min/max),
  segment length, gaps.
- Reach: vertical reach (0–100%), horizontal reach (0–100%), softness, and anchor
  (vertical from bottom/top, horizontal from left/right). Each axis independently
  enable-able.
- Colors: matrix, band, rim (rim has its own on/off toggle).
- Appearance: Opacity variation toggle (default off).
- Output: mode toggle Fit <-> Tile.
  - Fit: width + height in mm, plus DPI.
  - Tile: width + height in px (as today).
- Export toolbar (reused): TILE, AI SWATCH, sized canvas, COPY SVG.
- Session: Save / Load / Reset to defaults (reused pattern, separate key).

All numeric inputs use the shared editable SliderRow / number-input convention already
used across the app.

## Print considerations

- Output is solid vector; no transparency used unless the optional Opacity variation
  toggle is enabled.
- Limited palette (matrix + band + optional rim) maps cleanly to spot inks.
- Fit-to-size in mm + DPI produces correctly scaled output for a known package panel.
- CMYK conversion remains the job of the Color Palette tool.

## Testing

`meteorite.js` is pure and unit-testable. Tests (using the repo's existing test setup —
to be confirmed during planning):

- Output is a valid, parseable SVG with the expected `width`/`height`.
- Fit-size math: `widthMm`/`heightMm` + `dpi` produce the correct pixel dimensions.
- Reach: with reach at 100% (or reach disabled) the pattern covers the full panel; with
  a small vertical reach and modest softness, the top region of the canvas contains no
  band segments.
- Determinism: the same seed + params produce identical SVG output.

## Open items for planning

- Confirm the repo's test runner/setup and where engine tests live.
- Confirm undo/redo registration approach for the new tab (per the global undo feature).
- Finalize the exact preset parameter values during implementation (tuned visually).
