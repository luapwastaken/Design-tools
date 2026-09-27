# Design Tools: pre-rewrite inventory (2026-09-27)

A map of the old app, made before the full rewrite and UI/UX redesign. For each tool, one agent read the code and a second agent re-checked every claim against it. Problems the checker refuted are left out. Each problem is tagged [confirmed], [plausible] (likely, but not fully traced) or [missed] (added by the checker). Status arrows (`partial -> broken: ...`) are the checker's corrections.

State at time of writing: branch `feat/meteorite-pattern`, 7 commits ahead of origin (the Color Palette rework); the removal of the cobalt downloader is still uncommitted. The app builds with `vite build`.

This is reference material. Luap's answers about what each tool was *meant* to do override anything here.

## Pattern Maker
IDEA: A repeat-pattern generator that outputs SVG. In the Shapes tab you bring one or two vector shapes (a star, a logo mark) and it lays them on a grid, with controls for spacing, size, rotation, jitter and colour. You take away a seamless SVG tile, a clean tile to turn into an Illustrator swatch, or a large filled canvas. The Meteorite tab was added later for a brand-packaging job (Monolith). It generates an etched iron-meteorite crosshatch texture, or duotones a real etch scan, as a seamless tile or as one panel sized in mm and DPI.
IDEA_CORR: 
OUTPUTS: Shapes: TILE download, tile_{cols}x{rows}_{W}x{H}.svg (edge-wrapped and clipped) | Shapes: AI SWATCH download, swatch_*.svg (not edge-wrapped, meant for Illustrator Object > Pattern > Make) | Shapes: canvas_{W}x{H}.svg (a <pattern> fill whose tile is embedded as a base64 SVG <image>) | Shapes: COPY SVG (tile markup to clipboard, no confirmation) | Meteorite: PANEL (Fit mode) or TILE (Tile mode) meteorite_{W}x{H}.svg | Meteorite: AI SWATCH meteorite_swatch_*.svg (non-wrapped), or meteorite_duotone_*.svg in image mode | Meteorite: COPY SVG (in image mode this is a huge string with the raster embedded) | Session JSON: userData/sessions/pattern-maker.json and meteorite.json (Electron); localStorage '-manual' key in a browser | No PNG or raster export, and no send-to-another-tool of any kind
SIZE: 1,418 lines in total: ShapesTab.jsx 503, MeteoriteTab.jsx 391, meteorite.js 224, ui.jsx 220, index.jsx 80. ShapesTab holds 30 separate useState fields and lists every field five times (initialisers 140-169, reset 212-228, auto-save 278-290, getSessionState 295, applySessionState 298-321). MeteoriteTab uses a DEFAULTS + SETTERS map for 36 fields instead, so the two sibling tabs manage the same kind of state in two different ways, and other tools use a store.js module. The meteorite engine itself is compact. The weight shows at runtime: print-size panels produce 2-60 MB SVG strings, rebuilt and URL-encoded on every slider tick. ui.jsx is a third copy of the app's control kit.

FEATURES:
- Tab switcher: Shapes | Meteorite [works] :: Switches between the two generators. Both stay mounted so their state survives, and the last tab is remembered.
- Control-panel resize handle [partial] :: Drag the right edge of the left panel to widen it (200-480px). The width is shared by both tabs.
- Surprise me (Shapes) [works] :: Randomises layout: mode, grid, gaps, size, rotation, jitter, half-drop and seed. Shapes and colours are left alone.
- Shapes: Shape A / Shape B slots + Replace SVG [partial] :: Shows a thumbnail of each shape. You can load your own SVG into either slot.
- Arrangement: A / B / Checker / Random [works -> partial: Checker breaks at the tile seam whenever cols or rows is odd: two copies of the same shape end up next to each other. In mode B the cell is still sized from Shape A, so B only fits properly if A and B have the same proportions.] :: Uses only A, only B, alternates them in a checkerboard, or mixes them at random by seed.
- Bracket → A / Bracket → B [works] :: One click loads the Monolith bracket logomark into a slot for brand-mark tessellation.
- Grid: Cols / Rows / Link cols & rows [works] :: Sets how many items the tile holds (1-10 each way), optionally linked.
- Grid: Half-drop offset (Row/Col, Amount) [partial] :: Shifts every other row or column to get a brick or half-drop repeat.
- Spacing: Horizontal / Vertical / Link H & V [partial] :: Gap between items, from -100 to 300 px.
- Spacing: Jitter [works] :: Nudges each item randomly off its grid position.
- Item Size: Min / Max [works] :: Random size per item between min and max. The cell size comes from Max.
- Rotation: Random rotation (Min/Max + RESEED) or fixed Angle [partial] :: Rotates each item randomly within a range, or all items to one angle. RESEED re-rolls the random seed.
- Options: Seamless edge wrapping [partial] :: Copies items that cross an edge to the opposite side and clips, so the tile repeats without cut shapes.
- Options: Background fill + BG colour [works] :: Adds a solid background rectangle to the tile.
- Options: Color A / Color B [works] :: Flat fill colour for shape A and shape B.
- Palette: Use palette [partial] :: Gives each item a random colour from 4 fixed colour slots, replacing Color A/B.
- Session (Shapes): Save / Load / Reset to defaults + auto-save [works] :: Auto-saves to localStorage. Save/Load use one fixed file in the app-data folder. Reset asks first, then restores defaults.
- Export Size: Width / Height / Link W & H [works] :: Sets the pixel size of the large-canvas export.
- Toolbar: TILE [works -> partial: The exported tile has the missing seam gap (the reader's problem #1), so it does not repeat with even spacing. With 'Seamless edge wrapping' off, TILE gives the same file as AI SWATCH under another name.] :: Downloads the wrapped, clipped tile SVG.
- Toolbar: AI SWATCH [unclear] :: Downloads a non-wrapped tile meant for Illustrator Object > Pattern > Make.
- Toolbar: W×H canvas [partial] :: Downloads a large SVG filled with the repeated tile.
- Toolbar: COPY SVG [works] :: Copies the tile SVG to the clipboard.
- Shapes preview + readout [works] :: Shows the tile repeated across the canvas at 1:1 over a checkerboard, plus tile size, grid and item count.
- Meteorite: Source (Generated / Real-etch image) [works] :: Chooses between the procedural crosshatch generator and duotoning an uploaded scan.
- Meteorite: Duotone (Upload scan, Contrast) [partial -> partial: Two things to add to the reader's points: Tile output is not seamless for a scan, and DPI/mm do not affect the raster. The scan is stretched to the panel's pixel size whatever its real resolution, so the '@300dpi' readout means nothing in this mode.] :: Maps the scan's brightness between the matrix and band colours, with a contrast slider.
- Meteorite: Presets (Coarse, Fine, Etched, Triangular, Sparse, Monolith) + RESEED [partial] :: One-click parameter bundles; Monolith also sets its brand colours. RESEED re-rolls the arrangement.
- Structure: Lamellae / Hairline style [partial -> partial: Hairline does not 'ignore reach'. Reach still gives a gradient, but it leaks, because whole lines are kept or dropped by their midpoint. It is not seamless in Tile mode, and the extra copies stop in the middle of the tile, not at the tile edge.] :: Lamellae are broken bands with gaps. Hairline is thin continuous lines (the 'machined grid' look).
- Structure: Families + Angle [works] :: 2-4 crossing line directions, spread evenly over 180 degrees from a base angle.
- Structure: Spacing / Spc jit [works] :: Distance between parallel bands, plus random variation.
- Structure: Band min/max (Line w in Hairline) [partial] :: Band thickness range. In Hairline it is a single line width.
- Structure: Seg min/max, Gap min/max [works] :: Length of each band piece and the gaps between pieces (lamellae only).
- Reach — vertical / horizontal [partial -> partial: In Hairline, reach is leaky, not ineffective (see above). It is exact only for Lamellae in Fit mode.] :: Limits the pattern to a share of the panel from an edge. It thins out gradually by dropping whole pieces rather than fading.
- Colors: Matrix, Band, Bright rim (Rim colour, Rim width) [works] :: Background ink, band ink, and an optional outline behind each band (the taenite edge).
- Appearance: Opacity variation [partial] :: Gives each band a random 70-100% opacity for an etched feel.
- Appearance: Deboss preview (bevel) + Depth [partial] :: An SVG lighting filter that makes bands look pressed or embossed, for blind-deboss mockups.
- Output: Fit to size (panel buttons, Width/Height mm, DPI) [partial] :: One composition at an exact panel size. Five Monolith packaging sizes are one click away.
- Output: Seamless tile (Width/Height px) [partial -> partial: Beyond the reader's two points, Lamellae is also not seamless whenever a segment is longer than the tile. That happens with default settings at a 100px tile, or at 300px with Seg max near 500. With the Real-etch image source, 'Seamless tile' is just the photo cropped to size. There is no wrap at all, yet the preview repeats it.] :: A repeating tile, 100-4000 px.
- Session (Meteorite): Save / Load / Reset to defaults + auto-save [works] :: Same as the Shapes session but stored under its own keys. The uploaded image is excluded on purpose.
- Toolbar: PANEL / TILE [works] :: Downloads the current meteorite SVG.
- Toolbar: AI SWATCH (Meteorite) [partial] :: Downloads a non-wrapped version for Illustrator.
- Toolbar: COPY SVG (Meteorite) [works] :: Copies the SVG to the clipboard.
- Meteorite preview + footer [works] :: Fit mode shows the panel scaled to fit. Tile mode repeats it at 1:1. The footer gives Illustrator and CMYK hints.
- (missed) Slider rows: drag-to-scrub label + click-to-type value [works] :: Every numeric control can be dragged by its label (the full range over about 200px) or clicked to type a value. Enter commits and Esc cancels. Typed values are clamped to the slider's range, so the slider max is a hard cap (for example 1000mm panels, 4000px tiles, 300px gaps).
- (missed) Live hex entry [works] :: Hex fields apply the colour as soon as 6 valid digits are typed, with or without '#'. Invalid input reverts on blur.
- (missed) Meteorite toolbar size readout + panel-button highlight [works] :: The toolbar shows 'W×H mm @ dpi · px' in Fit mode or 'tile px' in Tile mode. The packaging-panel button that matches the current mm size is outlined.
PROBLEMS:
- [confirmed/bug] The Shapes tile has no gap on its right and bottom edges, so the pitch across the seam is cW instead of cW+gap. With a positive gap, shapes bunch up at the seams; with a negative gap the seam spreads out instead. With 1 column the Horizontal gap has no effect on spacing. The same applies to AI SWATCH and the canvas export.
- [confirmed/bug] A large negative Spacing collapses the tile to 2px.
- [confirmed/bug] Half-drop breaks at the seam when rows (or cols) is odd.
- [confirmed/bug] A repeated Meteorite tile is over-dense: bands generated outside the canvas (over the rotated bounding box) are wrapped back in on top of the bands already there. The effect is strongest near the edges but reaches well into the tile.
- [confirmed/bug] Hairline is not seamless in Tile mode. Every line gets extra copies (4x the rects), and those copies end in the middle of the tile, so lines stop abruptly inside it.
- [confirmed/bug] In Hairline, reach is leaky rather than broken. Whole lines are kept by their midpoint, so kept lines run past the reach line into the upper half.
- [confirmed/bug] Fit-to-size writes unitless pixel width/height, so the physical size depends on the app that opens the file (Illustrator reads 1px as 1pt, which makes 1417px about 500mm). Because spacing and band sizes are in px, DPI changes the design itself.
- [confirmed/bug] Fit mode does not clip to the panel, so off-panel bands stay in the file. The spec says Fit should clip.
- [confirmed/bug] In Real-etch image mode the two duotone ink colours cannot be edited, although the hint points to 'the two ink colours below'.
- [confirmed/bug] The uploaded scan is lost when you switch tools or restart, but the tab reopens in image mode showing a flat rectangle.
- [confirmed/bug] In Hairline, 'Line w' is capped by the hidden Band max.
- [confirmed/disconnected] Ctrl+Z/Y do nothing in Pattern Maker, including inside text fields, because App.jsx always calls preventDefault. Pattern Maker never had undo: the pre-split PatternMaker.jsx has none either, so the spec's 'keeps its existing undo registration' was wrong from the start.
- [confirmed/disconnected] Color Palette's 'Send to Pattern' writes colours that Pattern Maker never reads.
- [confirmed/ux-confusing] RESEED is visible only while random rotation is on, although the seed drives jitter, the Random mix, size and palette picks.
- [confirmed/bug] Uploaded SVGs lose their look: outline icons become solid, CSS-class styling is lost, and id-based gradients, clip paths and <use> references break.
- [confirmed/bug] Shapes whose viewBox does not start at 0,0 are drawn off-centre (and wrap with the wrong extent). A failed parse gives no message. Also, an SVG without a viewBox whose width carries units (for example '100mm') falls back to 100x100.
- [confirmed/half-built] The W×H canvas export embeds the tile as a base64 SVG <image> inside a <pattern>, so it is not editable as vectors.
- [confirmed/inconsistent] The 'Deboss preview' filter is written into every exported file.
- [confirmed/bug] With the rim on, Opacity variation is mostly hidden, because each translucent band sits on its own opaque rim.
- [confirmed/ux-confusing] Reach in Tile mode puts bands at the top of the tile. Some of this is correct wrapping of bands that cross the bottom edge, but bands generated below the canvas get coverage 1 and wrap in as well.
- [confirmed/duplicated] Meteorite AI SWATCH gives the same file as the main download in Fit mode and in image mode.
- [confirmed/ux-confusing] Presets reset only part of the state (style, reach, opacity, deboss and rim colour carry over, and Monolith's inks stick to later presets). The Monolith button always looks selected.
- [confirmed/inconsistent] The Monolith preset's second line family is at 121°, while the bracket's other edge runs at about 149°.
- [confirmed/bug] Large print panels rebuild multi-MB SVG strings on every slider tick, with no debounce and no error boundary. At the slider maxima the string overflows. Both tabs compute at launch, and Pattern Maker is the startup tool.
- [confirmed/ux-confusing] The panel resize handle scrolls away with the controls.
- [confirmed/ux-confusing] Toggles respond only to the pill, not to the label text.
- [confirmed/ux-confusing] Colour controls stay visible with no effect: Color A/B while the palette is on, and Color B in mode A (or Color A in mode B).
- [confirmed/half-built] The palette is fixed at 4 slots.
- [confirmed/ux-confusing] Saving is confusing: auto-save plus a quit warning that clears only on export or Save; one hidden slot per tab; Load overwrites silently and cannot be undone (and does nothing silently when there is no saved file).
- [confirmed/bug] The cell size comes from Shape A only, so a differently proportioned B is packed wrongly in B, Checker and Random modes.
- [confirmed/ux-confusing] The Export Width/Height fields cannot be emptied to type a fresh number.
- [confirmed/dead-code] Dead code: Slider is unused, the CtrlRow `val` prop is never passed, and MeteoriteTab imports CtrlRow without using it.
- [confirmed/duplicated] The control kit duplicates LogoMaker/ui.jsx and components/NumberField.jsx. parseSvg overlaps lib/svg.js parseSvgText (both read viewBox), although they return different things: inner markup versus a data URL.
- [confirmed/inconsistent] The Pattern Maker sidebar icon is a unicode glyph, against the Icon.jsx rule. Logo Maker ('◫') and Color Palette ('◉') break the same rule, so it is app-wide.
- [missed/bug] Checker arrangement breaks at the tile seam when cols or rows is odd: the same shape sits next to itself across the edge.
- [missed/bug] Meteorite Lamellae tiles are not seamless when a segment is longer than the tile. The wrap makes one copy per axis and picks +W or -W, never both, and never more than one.
- [missed/bug] Real-etch image source + 'Seamless tile' output is not seamless: the photo is cropped to the tile, and the preview repeats it with hard seams.
- [missed/duplicated] With 'Seamless edge wrapping' off, TILE and AI SWATCH export identical content under different names.
- [missed/ux-confusing] After you replace a shape, the built-in Star 1 / Star 2 cannot be re-selected without 'Reset to defaults', which wipes every setting. Only the bracket has a one-click button.
- [missed/bug] When run with `npm run dev`, React StrictMode re-runs the auto-save effects on mount, which marks both tabs dirty at launch. The quit warning then appears even if nothing was edited.
- [missed/ux-confusing] The previews have no zoom. Large tiles (Meteorite up to 4000px; Shapes with 10 cols at 500px, which is over 5000px) show less than one repeat, so you cannot judge the seam. The Fit preview cannot be enlarged to inspect detail.
- [missed/bug] Uploaded shapes are auto-saved inline (the full SVG markup) to localStorage. A large SVG, such as a traced lineart, can exceed the quota, and the error is swallowed, so auto-save silently stops for the whole Shapes tab.
- [missed/ux-confusing] Every random value comes from one sequential RNG stream, so changing Cols/Rows (or Meteorite spacing/segments) re-rolls every item's rotation, jitter, shape mix and colour. Small tweaks reshuffle the whole pattern.
INTENT Q:
- Is Pattern Maker meant to be one tool with several generators (Shapes, Meteorite, more later), or was Meteorite a one-off for the Monolith packaging job that should become its own tool or a saved preset?
- Should the Monolith items (bracket logomark, Monolith preset, the five packaging panel sizes) stay built in, or become brand presets you save yourself and pull from Logo Maker?
- Where does the output usually go: Illustrator swatches, print packaging at real mm size, or textures for C4D/Corona and AE? Right now it only exports SVG, with no PNG.
- When you repeated a Shapes tile, did you see shapes touching at the seams, or the half-drop breaking? Is that one of the things that did not turn out right?
- In Fit mode, should the pattern scale be fixed in mm, so changing DPI only changes resolution and not the look?
- For Hairline style with Reach, should lines stop or thin out at the reach edge, the way Lamellae segments do?
- Line families: always evenly spread, or free angles per family (e.g. 31° and 149° to match the bracket)?
- Deboss: on-screen mockup only, or did you want something exported from it, such as a bump/height map for Corona or a deboss plate?
- Duotoning a real etch scan: does that belong in Pattern Maker, or with the duotone in Dither / Post FX?
- Palette: was Color Palette's 'Send to Pattern' meant to fill it, and do you want any number of colours instead of 4?
- Uploaded shapes are forced to one flat colour. Is that intended, or should outline and multi-colour SVGs keep their look?
- The W×H canvas export: was it meant to give a big, editable, pattern-filled artboard in Illustrator? It currently embeds the tile as an image.
- Surprise me exists only on Shapes and presets only on Meteorite. Do you want both on both?
- Save/Load: is one hidden slot per tab enough, or do you want named presets or save-to-file?
- When you change the grid count or spacing, should the existing items stay put (a stable per-cell seed) rather than the whole pattern reshuffling?
- For the Illustrator swatch route: should the tool bake half-drop and brick offsets into the SVG, or hand Illustrator a clean single cell and let its Pattern Options do the offset?
- Real-etch scans: are they only for Fit panels, or should the tool make a scan tileable (offset-blend or mirror) for Tile mode?
- Which app opens the Monolith panels (Illustrator, InDesign, Affinity, or a printer's RIP)? That decides whether the SVG should carry mm units directly instead of pixels at a chosen DPI.
- For the deboss: do you need a separate plate or layer (the band shapes alone, named for the finisher) rather than a lighting filter?
- Should uploaded shapes ever keep multiple colours or strokes (a multi-colour logo or outline icon), or is 'one flat ink per shape' the intended rule?
- Is a 100-300px Meteorite tile a real use case, or were small tiles never used (they are where the seams break)?
CROSS:
- Color Palette → Pattern Maker: the 'Send to Pattern' button (ColorPalette/index.jsx:178, store.js:280-285) writes colours that Pattern Maker never reads. This is a dead hand-off.
- Color Palette (CMYK): the Meteorite footer says 'CMYK conversion happens in the Color Palette tool' (MeteoriteTab.jsx:385), but nothing carries the matrix/band/rim colours there. Color Palette converts swatch values only, not SVG files.
- Logo Maker: it already holds your logo SVG and supports pasting (LogoMaker/index.jsx:164-176), yet the Shapes tab has its own hardcoded Monolith bracket (ShapesTab.jsx:21-25) and no 'use current logo' option. Pattern Maker has no paste or drag-drop.
- Scan to Lineart: it exports traced SVG (LineartTool/index.jsx:341-344) that could feed Shape A/B. The only route is download and re-upload, and the fill stripping in parseSvg would flatten it.
- Post FX: Dither and Lineart have 'Send to Post FX' through PostFX/store.js:202 sendImageToPostFX. Pattern Maker has no send and no PNG export, and lib/export.js:8 svgToPngBlob is never used here.
- Motion Maker: no hand-off. Logo Maker has sendLogoToMotion (MotionMaker/store.js:277), but a pattern cannot become an animated background.
- Duotone exists four times: Meteorite real-etch (meteorite.js:174-194), Logo Maker treatments (lib/svg.js:57-72), Dither 'Crisp Duotone' (DitherTool/presets.js:82) and Post FX 'Duotone / Tritone' (PostFX/effects.js:432).
- Shared UI kit: PatternMaker/ui.jsx duplicates LogoMaker/ui.jsx (Section/SliderRow/HexInput/Toggle/btn), and neither uses components/NumberField.jsx. parseSvg duplicates lib/svg.js parseSvgText.
- Global undo (lib/undo.js): used by all six other tools, never registered by Pattern Maker.
- Unsaved-changes tracker (lib/unsavedChanges.js): Pattern Maker marks ids 'pattern-maker' and 'meteorite' dirty on every edit, and only an export or Save clears them. That drives the quit warning in electron/main.js:37-50, even though state auto-restores.
- App shell: App.jsx:99 mounts only the active tool, which is why the Meteorite scan is lost on a tool switch. Pattern Maker is the default startup tool (App.jsx:14-19,66), and both its tabs compute at launch.
- Sessions: they use the shared Electron session IPC (preload.js saveSession/loadSession → userData/sessions/{key}.json), the same single-slot scheme as Logo Maker (LogoMaker/index.jsx:286).

## Logo Maker
IDEA: A brand-lockup generator, not a logo drawing tool. You drop in two finished parts, an icon (symbol) and a wordmark, and it lays them out as 13 standard lockups (horizontal, stacked, inline, divided, compact and so on). You tune the icon-to-wordmark size, the gap and the alignment, and check the logo in mono/spot/duotone treatments, with clearspace, at small sizes and on different backgrounds. You leave with SVG/PNG files for every lockup plus a favicon bundle.
IDEA_CORR: 
OUTPUTS: SVG download of the current variation (logo-<variation>.svg): transparent background, logo parts embedded as base64 <image> data URLs, colour changes done with SVG filters, width attribute set to the export width | PNG download of the current variation at the chosen width: background always filled, guides optional | Copy SVG markup to the clipboard; copy PNG to the clipboard (always filled, never includes guides) | Guides-only SVG overlay (guides-<variation>.svg) | Export All to Folder (Electron only): svg/logo-<id>.svg and png/logo-<id>.png for each ticked variation. These SVGs include a background rect, unlike the single SVG export | Favicon bundle .zip: favicons/favicon.ico (16/32/48), favicon-16/32/48 PNGs, apple-touch-icon 180, android-chrome 192/512, icon.svg. Background always filled; no webmanifest or HTML snippet | Session JSON saved to <userData>/sessions/logo-maker.json, plus a continuous autosave to localStorage | Send to Motion Maker: a localStorage hand-off containing icon, wordmark, scale/gap/alignment/layout and bgColor
SIZE: The src/tools/LogoMaker folder is about 1,930 lines. index.jsx alone is 910 lines (45 KB): one component with about 38 useState hooks, and the state list is hand-copied in five places (applyDocState 80-107, undo snapshot and deps 117-141, autosave and deps 206-222, getSessionState 224-234, applySessionState 236-267), so adding a setting means editing about seven spots. The rest: LockupSvg.jsx 236, FaviconView.jsx 163, layout.js 138, ui.jsx 134, Clearspace.jsx 72, BackgroundRow.jsx 69, FileSlot.jsx 59, VariationCard.jsx 54, Treatments.jsx 50, ExportPanel.jsx 42 (dead). Supporting libs: lib/export.js 156, lib/svg.js 78, lib/file.js 41. The bloat is concentrated in index.jsx: the export pipelines (single, copy, Export All string builder and PNG helpers) repeat each other, and the SVG filters are defined twice.

FEATURES:
- Resizable left panel [works] :: Drag the panel's right edge to make it 200-480 px wide; the width is remembered.
- Import: Icon / Wordmark slots [works -> works: The 'swap' button does not swap the icon and wordmark. It opens the file picker to replace that slot's file, and there is no way to swap the two slots. The slot hint and empty state say 'SVG / PNG', but JPG is accepted too. Auto-tint fires on any SVG that has a black fill anywhere or no 'fill' text at all, not only on black-looking SVGs.] :: Drop or browse an SVG, PNG or JPG for each part, with a thumbnail, aspect readout, swap and clear buttons. Black-looking SVGs get a tint override switched on automatically.
- Paste SVG (Ctrl+V) [partial] :: Pasting SVG markup or an SVG file fills the icon slot first, then the wordmark slot. It is silently ignored once both are filled, and raster images on the clipboard are not accepted.
- Overview grid (13 variations) [works] :: Shows every lockup variation live on the canvas colour. Variations that need a missing file show 'Load ...', and clicking an applicable card opens Refine.
- Refine view: top bar [partial] :: Shows the variation name and a proportion readout, has Copy SVG / Copy PNG buttons, and a row of all 13 variation buttons for switching.
- Refine canvas + drag handles [partial] :: A large preview with four corner handles on the icon (or on the wordmark when the anchor is Icon). Dragging vertically changes the icon's scale.
- Proportions: Lock anchor / Icon scale / Gap / readout [partial -> partial: The reader missed Compact Stack, which is worse than a wrong readout there. The icon-to-wordmark height ratio is fixed at wordmarkAspect/iconAspect, so Icon scale and the handles only change how big the gap looks relative to the lockup, and they work in the opposite direction.] :: Sets how big the icon is relative to the wordmark and the space between them, with a readout like 'Icon = 85% of wordmark height'.
- Alignment [partial] :: Top/centre/bottom for side-by-side layouts, or left/centre/right for stacked ones. Only shown for h, hr, v, vr, dh, dhr.
- Canvas: Background colour, Guides, Guide colour [works] :: Sets the preview background and shows dashed centre lines and bounding boxes.
- Canvas: Background contexts + Brand colour [partial] :: In Refine, adds a strip showing the logo on white/light/mid/dark/black/brand backgrounds, each with a WCAG contrast badge.
- Colors: Override icon / wordmark colour [partial] :: Flattens the icon and/or wordmark to a single solid colour.
- Treatment [works] :: Original, Mono Black, Mono White, Spot Color, Knockout (white logo on a spot-colour field) or Duotone (a dark-to-light colour map), applied to the whole lockup.
- Session: Save / Load [works -> works: Outside Electron, Save and Load use a localStorage key ('designtools-logomaker-manual'), not a file. Load also sends you back to the Overview (setStep(1)), immediately flags the tool as unsaved, and restores icons without their raw SVG, so black detection is lost.] :: Save writes one fixed JSON slot in the app data folder; Load replaces the current state from it.
- Send to Motion Maker [partial] :: Hands the icon, the wordmark and the lockup proportions to Motion Maker, which builds an animation graph from them the next time it opens.
- Overlays: Safe zone / clear space [partial] :: Draws a dashed box at a fixed 50% of the lockup height around the logo.
- Clearspace: overlay + N x slider [partial] :: Draws a red dashed clearspace box at N x the lockup height (0.1-3).
- Clearspace: Min-size strip [partial -> broken: It never shows the logo at N px. The whole padded canvas, including the 38% margin, is stretched non-uniformly into a square. It shows the previous state, and it does not appear on entering Refine until some other state change re-renders the tool. Nothing about it does what it claims.] :: In Refine, shows the logo rendered at 16/24/32/48/96/128 px squares to test legibility at small sizes.
- Favicon View [works] :: Pick any applicable variation (Icon Only by default), preview it at 16-256 px, and download a favicon .zip bundle.
- Export: width, include guides, SVG, PNG, Export guides [works] :: Exports the current variation as SVG or PNG at the chosen width, plus a guides-only SVG overlay. Only visible in Refine.
- Export All to Folder [works] :: Tick which variations and formats you want, pick a folder, and it writes svg/ and png/ files for each applicable variation. Needs Electron.
- Undo / redo (Ctrl+Z / Ctrl+Y) [partial] :: A 100-step history of the document state, with snapshots debounced by 400 ms, registered with the app-wide undo handler.
- Autosave + unsaved-changes flag [partial -> partial: Every change serialises the whole state to localStorage, including both image data URLs. That includes every slider tick, every colour-picker drag event and every mousemove of the panel resize, and on mount lmLoad() parses that JSON about 30 times. In dev (React.StrictMode) just opening the tool marks it unsaved, because the doubled mount effect gets past the lmFirstRun guard.] :: Writes all settings, including image data URLs, to localStorage on every change and flags the tool as unsaved for the close prompt.
- (missed) Typed slider values [works] :: Clicking a slider's number readout lets you type an exact value, clamped to the slider range. This applies to Icon scale, Gap, N x and Width.
- (missed) Hex + native colour picker inputs [works] :: Every colour has a native colour swatch plus a hex text field that commits as soon as six valid hex digits are typed.
- (missed) Browser-mode Save/Load fallback [works] :: Without Electron, Save/Load uses the localStorage key 'designtools-logomaker-manual' instead of the app-data file.
PROBLEMS:
- [confirmed/half-built] SVG exports are not editable vector artwork: the parts are base64 <image> data URLs and all recolouring is done with SVG filters.
- [confirmed/bug] On Inline and Inline Rev., Icon scale and the handles do nothing, but the readout still claims a percentage.
- [confirmed/bug] The proportion readout is wrong for Superscript/Subscript (the real gap is half) and for Compact Stack (the wordmark is rescaled to the icon's width).
- [confirmed/duplicated] Superscript and Subscript are just Vertical and Word on Top with right alignment and half the gap.
- [confirmed/inconsistent] All 13 variations share one scale, one gap and one alignment. Alignment switches between top/bottom and left/right depending on the layout, so after switching nothing is highlighted and the layout falls back to centre.
- [confirmed/duplicated] Treatments silently disable the colour overrides, which still show as on, and Mono Black/White/Spot duplicate the overrides.
- [confirmed/duplicated] There are two separate clearspace features: 'Safe zone' in Overlays (fixed 50%, guide colour) and 'Clearspace overlay' with an N x slider (red).
- [confirmed/bug] Clearspace and safe-zone boxes are clipped because the margin is fixed at 38% of the longest side.
- [confirmed/bug] The Min-size strip and Background contexts are one render behind, and are empty or hidden on entering Refine.
- [confirmed/bug] The Min-size strip stretches the padded canvas into a square, so it is not a real N px test.
- [confirmed/bug] The contrast badges use a guessed logo colour (white unless the icon looks black), ignore the wordmark, lose black detection after a restart, and are wrong in Knockout.
- [confirmed/bug] Any SVG with a black fill anywhere, or with no fill attribute, turns on the override (default white), flattening multi-colour icons.
- [confirmed/bug] JPGs, or any image without alpha, become solid rectangles under a tint or treatment.
- [confirmed/inconsistent] Background handling differs between exports: the single SVG is transparent, Export All SVGs have a bg rect, every PNG is filled, and Copy PNG ignores the guides toggle.
- [confirmed/duplicated] There are two parallel renderers (a live React SVG clone vs a string builder with duplicated filters and a local PNG helper).
- [confirmed/inconsistent] Every export bakes in a fixed 38% margin, and favicons show the icon at about 57% of the tile.
- [confirmed/bug] Drag handles do not track the cursor: vertical-only, wrong px-per-unit when the view is width-limited, the view refits during the drag, and they clamp at 5 against a slider max of 3.
- [confirmed/ux-confusing] 'Lock anchor' only moves the handles and rewords the readout.
- [confirmed/bug] Undo can swallow or skip steps (stuck isApplying flag; Ctrl+Z inside the 400 ms debounce).
- [confirmed/ux-confusing] The Refine switcher lists all 13 variations without an applicability check, and the non-wrapping 38 px bar overflows.
- [confirmed/inconsistent] Icon Only and Wordmark Only are labelled 'preview only' yet are exported everywhere.
- [confirmed/ux-confusing] Export All is only in Refine, silently does nothing outside Electron, and hangs on 'Exporting...' if a write fails.
- [confirmed/ux-confusing] Panel controls with no visible effect on the current screen, and two Back buttons in Favicon view.
- [confirmed/bug] The Divided rule is white unless an override is on, a fixed 1.5% of height, and has no control.
- [confirmed/inconsistent] Autosave and the unsaved prompt contradict each other; quota failures are silent; one fixed Save slot; Load overwrites without asking.
- [confirmed/ux-confusing] Leaving the tool resets Refine to the Overview and wipes undo history.
- [confirmed/ux-confusing] An SVG with no viewBox and no width/height is silently rejected.
- [confirmed/disconnected] Colour Palette's 'Send to -> Logo' does nothing.
- [confirmed/disconnected] Send to Motion Maker drops colours/treatment/divider, ignores bgColor, sends both files for single-part variations, and replaces Motion's document.
- [confirmed/dead-code] Dead code: LogoMaker/ExportPanel.jsx and lib/export.js svgToPngBase64.
- [missed/bug] On Compact Stack, Icon scale (slider and handles) cannot change the icon-to-wordmark size relationship. The wordmark is always resized to the icon's width, so the ratio is fixed by the two files' aspect ratios, and Icon scale only shrinks or grows the gap relative to the lockup, in the opposite direction. The gap is measured in the unscaled wordmark unit, not the scaled wordmark's height.
- [missed/half-built] Gap, scale and alignment are measured against the file's box (the SVG viewBox or the PNG's pixel size), not the visible artwork. An SVG exported with artboard padding, or a PNG with transparent margins, gets a larger real gap and wrong alignment, and 'wordmark height' means the box, not the cap or x-height. There is no trim-to-content step.
- [missed/bug] The global Ctrl+Z/Ctrl+Y handler ignores focus. Pressing Ctrl+Z while typing in a hex field or a slider's number box calls preventDefault and undoes the whole Logo Maker document instead of the text edit.
- [missed/ux-confusing] Undo history mixes view state with design edits. Switching the active variation, toggling guides, safe zone, min-size or background contexts, or ticking Export All checkboxes are all undo steps, so Ctrl+Z often flips a view setting or the selected variation back instead of undoing the last design change.
- [missed/inefficient] Autosave is expensive. Every state change, including each slider tick, each native colour-picker drag event and each panel-resize mousemove, JSON-serialises both image data URLs and writes them to localStorage. On mount the same blob is parsed about 30 times, once per useState initialiser.
- [missed/bug] The single SVG export and Copy SVG clone the live DOM node, so they carry React's inline style='width:100%;height:100%;display:block'. Opened in a browser or embedded in HTML, that CSS overrides the width/height attributes and the logo fills its container. Copy SVG sets no width/height at all.
- [missed/compat] The exported SVGs use SVG2 plain href on <image> with no xlink:href, which older SVG importers (older Illustrator and Inkscape versions) may not resolve, so the placed images would be missing. Not verified against a specific editor version.
- [missed/ux-confusing] 'Export guides (SVG overlay)' with guides, safe zone and clearspace all off downloads an empty SVG with no warning.
- [missed/bug] SVG size parsing without a viewBox is a regex: \bwidth= also matches stroke-width="...", and width="100%" parses as 100, so such files get a wrong aspect ratio without any message.
- [missed/inconsistent] The contrast badge labels 3-4.5:1 as 'A', which is not a WCAG contrast level (3:1 is the large-text / non-text-graphics threshold), and the badge is orange. For a logo, the 3:1 non-text threshold is arguably the relevant pass.
INTENT Q:
- Should each lockup variation keep its own scale, gap and alignment, or is one shared proportion system for the whole logo what you want?
- Superscript/Subscript: did you mean a small icon beside the wordmark at the top or bottom right, like a trademark mark? Right now they are just stacked, right-aligned layouts.
- What should 'Lock anchor' do? For example, keep the wordmark's on-screen size fixed while the icon grows, or the reverse? Today it only changes the readout.
- Treatments: one active mode for the whole tool, or a sheet showing the logo in every treatment side by side, like a brand-guidelines page? And should the separate 'Override colour' section go away?
- Clearspace: one feature, and measured in what unit (icon height, wordmark cap height, lockup height)? Should it also set the export margin?
- Export framing: tight to the artwork, padded by the clearspace, or a padding value you set? Currently a fixed 38% margin.
- Do you need true vector SVG out (real paths with recoloured fills, editable in Illustrator), or are embedded-image SVGs fine because you mostly use the PNGs?
- Should PNG exports be transparent for After Effects comps, with the background colour only for previews?
- Min-size strip: was it meant to show the logo at an actual N px height (a legibility test) rather than the whole framed canvas squeezed into an N px square?
- Background contexts: a real contrast check against the logo's actual colours, or just a visual 'how it looks on these backgrounds' strip?
- Favicons: icon-only with little or no padding, a transparent or rounded tile option, and a webmanifest/HTML snippet in the zip?
- Is raster input (PNG/JPG) meant to be supported, or should the tool be SVG-only?
- Session: is autosave enough, or do you want named project files (open/save as) per brand?
- Send to Motion Maker: should colours, treatment and background travel too, and should it replace or add to what is already in Motion Maker?
- Colour Palette's 'Send to Logo': what should those colours drive here (tints, spot/duotone colours, the brand background)?
- Two-step flow (Overview grid, then Refine one variation): keep it, or have a single canvas with a variation strip?
- Should gap and scale be measured to the visible artwork (trimmed bounds, or the wordmark's cap height) rather than to the file's artboard or pixel box?
- Compact Stack: is the wordmark meant to be stretched to exactly the icon's width? If so, what should Icon scale control there?
- Should Ctrl+Z undo only design edits (proportions, colours, files), or also view changes like switching variation and toggling guides?
- The auto 'make black logos white' behaviour exists because the default canvas is black. Keep it, or start on a neutral canvas and never recolour without asking?
- Divided lockups: do you want control over the rule (colour, thickness, length, or matching the gap)?
- Is a single brand-sheet output (all lockups, clearspace, min sizes and treatments on one page or PDF) something you wanted, as opposed to a folder of separate files?
CROSS:
- Motion Maker: Logo Maker's 'Send to Motion Maker' writes { icon, wordmark, layout:{iconScale,gapRatio,alignment,layout}, bgColor } to localStorage 'designtools-shared-motion' (index.jsx:293-302 -> MotionMaker/store.js:277-279). Motion reads it once on mount (MotionMaker/index.jsx:42-45) and replaces its doc. Colours, treatment and divider are not sent and bgColor is ignored (store.js:336-344). The spec promised colours and treatment (motion-maker-design.md:103-106).
- Motion Maker reuses Logo Maker's layout maths directly (MotionMaker/store.js:12 imports computeLayout and BOTH_LAYOUTS, used at 283-307), so changing layout.js changes Motion's lockups too.
- Motion Maker builds its whole UI on Logo Maker's ui.jsx (C, btn, Section, HexInput imported in MotionMaker/index.jsx:8-9, Inspector.jsx:3, Graph.jsx:5, Stage.jsx:6, Timeline.jsx:6). Meanwhile Color Palette (panelUi.jsx), Dither, Lineart and Post FX each define their own Section/SliderRow/HexInput, so there are several parallel UI kits.
- Color Palette: its 'Send to -> Logo' button (ColorPalette/index.jsx:176) writes swatches to 'designtools-shared-colors'['logo-maker'], but Logo Maker never reads them. The link is broken.
- Color Palette (missing link): Logo Maker's brand colour, tints, spot and duotone colours are typed in by hand with no way to pull from a palette.
- Scan to Lineart (missing link): Lineart already traces scans to SVG (LineartTool/index.jsx:337-344), a natural source for the Icon slot, but there is no hand-off.
- Post FX / Dither & Halftone (missing link): both use a shared-image hand-off ('designtools-shared-image', PostFX/store.js:13, 202), but Logo Maker cannot send its lockup to them.
- Shared libs: lib/file.js processFile is also used by Dither, Lineart, Post FX and the Motion Maker Inspector. lib/color.js keeps legacy hexToRgb/wcag helpers 'for LogoMaker / PatternMaker compat' (color.js:4). lib/export.js (favicon/ICO/zip) is used only by Logo Maker.
- App shell: only the active tool is mounted (App.jsx:99), so switching away drops Logo Maker's undo history and Refine step. Undo/redo goes through the global lib/undo.js registry (index.jsx:158).
- All tools share one localStorage quota. Logo Maker autosaves full image data URLs there (index.jsx:204-214) and the Motion hand-off does the same, so one large raster logo can starve other tools' autosaves.
- Pattern Maker: no link in either direction (for example, using the icon as a pattern motif).

## Color Palette
IDEA: A single-palette colour workbench. You build a palette (OKLCH picker, generators, image extraction, industry/style "recipes"), check it (value structure, contrast, colour blindness, print, a UI mockup), and develop it for illustration (lit shadow/highlight ramps by material, real-paint mixing and paint recipes). You leave with a named, role-tagged palette exported to Adobe/Procreate/GIMP/CSS files, or pushed to another tool.
IDEA_CORR: A colour workbench for a single palette. You build it (OKLCH picker, generators, image extraction, industry/style Recipes), check it (value, WCAG contrast, colour blindness, print reproduction, a UI mockup) and extend it for illustration (material-aware shadow/highlight ramps, a spectral paint canvas), with a separate real-paint recipe solver under Design. It ends in file exports (CSS/Tailwind/JSON/TXT/GPL/ASE/ACO/Procreate, SVG/PNG sheet) and a one-way push that only Dither reads. The print side is advisory: one naive CMYK formula that ignores the chosen profile.
OUTPUTS: Color sheet as SVG or PNG (2x), with 2-8 columns (ExportPanel.jsx:161-214) | CSS custom properties, oklch() plus a -hex twin (ExportPanel.jsx:12-18) | Tailwind config JS (ExportPanel.jsx:20-24) | Plain-text spec sheet .txt with HEX/RGB/CMYK/OKLCH, role and material (ExportPanel.jsx:44-62) | JSON with name, role, material, hex, oklch, rgb, cmyk, locked, spot flag (ExportPanel.jsx:35-41) | GIMP/Krita .gpl (ExportPanel.jsx:26-33) | Adobe .ase with the spot flag honoured (ExportPanel.jsx:66-107) | Photoshop .aco v1, which carries no names (ExportPanel.jsx:110-126) | Procreate .swatches zip (ExportPanel.jsx:129-153); the format may be wrong, see problems | Clipboard: a CSS linear-gradient from the Gradient panel (Gradient.jsx:35-39) | Send to Dither: the selected swatches, or all of them, land in Dither's 'incoming' bucket (index.jsx:179-181) | Send to Logo and Send to Pattern: they write data that nothing reads, so there is no real output
SIZE: The ColorPalette folder has 33 files and 6,808 lines, plus about 1,458 lines of colour libraries (color.js 380, paintSim.js 288, spectral.js 226, materials.js 192, paintRecipe.js 174, eyedropper.js 101, cmyk.js 63, colorMatch.js 34) and about 30 KB of JSON data (316 inks, 117 colour names, 6 profiles). The largest files are Picker.jsx (571), index.jsx (566), Recipes.jsx (444 lines / 35 KB, mostly tables of 60 industries, 26 styles and 14 tags), panelUi.jsx (410) and Mixer.jsx (403). About a third of the files are check panels, and the reported findings come from four separate implementations (checks.js, Harmony.jsx, AutoFix.jsx, inContextSlots.js). Heavy duplicated math: OKLCH to linear sRGB is written three times (Picker.jsx:12, color.js:272 and 311), sRGB to OKLab twice (ImageExtract.jsx:11, paintRecipe.js:28), three Kubelka-Munk implementations (color.js, unused; spectral.js; paintSim.js), and isLightHex and hueDist each twice. There are 11 design panels plus 3 illustration panels, all kept mounted and re-rendered on every palette edit. There is a lot of explanatory comment prose per file, much of it history from the Aug 30 rework.

FEATURES:
- Active swatch header [works] :: Shows the selected swatch's colour, name and hex at the top of the left column.
- Picker - OKLCH / HSL / RGB / CMYK [partial -> partial: There is one more failure. When the colour lands on a doubled-digit hex (pure white or black at the edges of the square, pure primaries), oklchToHex returns a 3-digit string. The RGB/HSL/CMYK sliders then vanish and the HSL maths goes NaN.] :: Edits the active swatch: an OKLCH lightness-by-chroma square with a hue strip and L/C/H number fields, an HSL square, or gradient sliders for RGB and CMYK.
- Hex field + eyedropper [partial] :: A typable hex box and a screen picker that works across all monitors, with a live hover preview.
- Value lock / Hue lock / Greyscale [partial] :: Value lock holds the greyscale value while you change hue or chroma, Hue lock freezes hue, and Greyscale desaturates the picker and palette grid.
- Send to Logo / Pattern / Dither [partial] :: Pushes the palette's hexes to another tool.
- Keyboard: Ctrl+V paste, I pick, Y greyscale [partial] :: Paste colours as text, grab a screen colour onto the active swatch, toggle greyscale.
- View tabs: Design | Illustration || Print | Export [works] :: One radio group. Design and Illustration swap the tool drawer under the palette; Print and Export replace the whole right pane.
- Palette grid [works] :: Large swatch cards: click to select, Ctrl+click to multi-select, Shift+click for a range, drag to reorder, dashed + to add a grey swatch.
- Palette header: Reset panes / Clear / Reset palette [works] :: Two-click reset buttons for the pane sizes, for emptying the palette, and for going back to the 4 defaults.
- Bulk bar (2+ selected) [works] :: Auto-name, set role, or delete every selected swatch.
- Active swatch bar [works] :: Name field, Auto-name from 117 colour names, Name all, role dropdown (black/main/accent/white/pop/freeform), per-swatch lock, duplicate, remove.
- Tool drawer [partial] :: A resizable, collapsible bottom drawer that holds the Design or Illustration panels. Its height is remembered.
- Per-panel Reset [works] :: Resets the current panel's settings by remounting it.
- Design > Build > Generators [partial] :: A seeded random palette (AcerolaFX port) with per-slot locks and reroll, a colour-wheel harmony from the active swatch (Comp/Analog/Triadic/Split/Tetrad), and a lightness ramp from the active swatch.
- Design > Build > Recipes [works] :: Builds a brand colour system (primary, secondary, accent, text, muted, surface, background) from 60 industries x 26 styles x 14 keyword tags, with an optional brand hex, role locks, Vary / Surprise me, matched light and dark themes, and its own mini website mockup.
- Design > Build > Image [works] :: Drop or choose an image; k-means in OKLab pulls out 2-10 dominant colours to add.
- Design > Build > Gradient [partial] :: Interpolates between two palette swatches in OKLCH, OKLab or sRGB, with 2-16 stops and an angle; adds the stops or copies the CSS.
- Design > Check > Report [partial -> partial: The TAC check can fail. It cannot fail on the default FOGRA39, on GRACoL or on Japan Color, but it can on FOGRA52 (260), SWOP (240) and Newsprint (220), since naive CMYK tops out at 300%. The Riso-only matching and the missing Critique are disclosed in the Report's own footnote, although the verdict still says 'Sound'.] :: One verdict ('Sound' or 'N problems to fix') rolled up from value, accessibility, reproduction and role coverage, with 'Open panel' links.
- Design > Check > Structure > Value [works] :: The palette sorted by OKLCH lightness in colour and greyscale, flagging swatches that share a value and missing mid-tones.
- Design > Check > Structure > Critique [partial] :: Prose critique of value, hue scheme and clashes, chroma hierarchy and warm/cool balance, with one-click fixes and 'Apply all'.
- Design > Check > Accessibility > Against a background [works] :: WCAG report card: every swatch against one background swatch you pick, with AA/AAA badges.
- Design > Check > Accessibility > One swatch everywhere [works] :: The active swatch on white, black, paper, grey and an optional custom background, with a 'Fix to AA' lightness nudge.
- Design > Check > Accessibility > Every pair [works] :: A labelled contrast matrix of every swatch against every other.
- Design > Check > Accessibility > Colour vision [broken -> partial: Not fully broken. The simulated strips render correctly for 6-digit hexes. Only the collision list is dead, and it always shows a false 'CVD-safe' all-clear. The strips go blank for 3-digit hexes, because simulateCVD returns '#NaNNaNNaN'.] :: Palette strips simulated for protan, deutan, tritan and mono, plus a list of colour pairs that collapse together.
- Design > Check > Reproduction [partial] :: Whole-palette print check: print profile, TAC ink limit, flat-black warning, out-of-sRGB warning, and nearest Riso/HKS/RAL/NCS ink by ΔE in a table.
- Design > Check > In context [partial] :: Your palette rendered as a website (nav, card, buttons), status pills and a data chart, with automatic or pinned slot assignment, Shuffle, a light + dark pair and a palette-coverage readout.
- Design > Check > AutoFix [broken] :: Analyse, then tick and apply fixes: snap near-duplicates, gamut-map, nudge low-contrast role colours to AA.
- Design > Paint > Paint Mix [works] :: 'How do I mix this?' Solves 1-3 pigment Kubelka-Munk recipes from 14 real paints you tick as owned, for one colour or for the whole palette.
- Illustration > Shadow/Highlight [works] :: A 5-stop ramp around the active swatch, with shadow and light hue, drop, rise and hue-shift sliders; adds the 4 non-base stops.
- Illustration > Materials [works] :: Material-aware lighting ramp (12 materials such as skin, velvet, metal and water) in Grounded, Expressive or Extreme mode, with a 'priority/hero' colour the suggestions defer to.
- Illustration > Mixer [partial] :: A spectral paint sim: watercolour or oil canvas with paint, smudge and pick tools, a mixing well to knead pigments, brush settings, and sampling back into the palette.
- Print tab [partial -> partial: Beyond the dead gamut check and the Riso stub: the Print view replaces the whole right pane, palette grid included. You can only inspect the swatch that was active when you opened the tab, and to check another one you must go back to Design. CMYK and TAC show NaN for 3-digit-hex swatches.] :: Per-swatch print inspector: profile, CMYK values and TAC bar, rich-black suggestion, sRGB gamut and 'Map to gamut', spot-colour flag, nearest RAL/HKS/NCS/Riso, Risograph mode toggle.
- Export tab [partial] :: Colour sheet (SVG/PNG preview and download), CSS/Tailwind/TXT/JSON/GPL, and ASE/ACO/Procreate.
- (missed) Undo / redo [partial] :: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z step through up to 100 debounced snapshots of the palette store, registered through the app-wide undo registry.
- (missed) Resizable picker column [works] :: A 9px splitter between the picker column and the main pane (252-500px). Its width is persisted, along with panel choice, drawer state and greyscale, in a separate UI store.
- (missed) Value-lock contour overlay [works] :: With Value lock on, the picker square draws the iso-luma curve at the current hue in OKLCH and HSL modes. The locked L/H number fields become read-only, and the HSL L slider is disabled.
- (missed) Unsaved-changes flag [partial] :: Every store change marks the tool dirty, which drives Electron's warn-before-close prompt. Only an export clears it.
PROBLEMS:
- [confirmed/bug] AutoFix's near-duplicate pass compares a 0-1 ΔE with a threshold of 1, so almost every pair counts as a near-duplicate. On the default palette it proposes recolouring every swatch after the first to #1a1a2e, and 'Select all, Apply' collapses the palette.
- [confirmed/bug] The Vision collision test can never fire and always reports 'CVD-safe'.
- [confirmed/bug] Nearest-ink ΔE is on the 0-1 scale but is shown and judged against CIELAB-style thresholds, so every match reads as a near-perfect green badge and Report always says every colour is within ΔE 3.
- [confirmed/dead-code] The out-of-sRGB checks test hex codes, so they can never fire: 'Map to gamut', AutoFix's gamut pass and Reproduction's sRGB finding are all dead.
- [confirmed/bug] The TAC warning cannot trigger on FOGRA39, GRACoL or Japan Color (naive CMYK maxes at 300%), and the CMYK numbers are identical for every profile despite the profile label.
- [confirmed/bug] In context: pinning Background leaves Text on the old ground's text, so a dark background gets dark text and the warning blames the palette.
- [confirmed/bug] Paste splits on commas before parsing, so rgb(255, 128, 0) becomes #112288 and '100, 200' adds junk swatches. hsl(), percentage oklch() and the oklab() the comment promises are not handled.
- [confirmed/disconnected] 'Send to Logo' and 'Send to Pattern' write a bucket nothing reads, with no feedback. Only Dither consumes it.
- [confirmed/bug] In OKLCH mode the hue strip is painted with HSL hues but a click is read as an OKLCH hue.
- [confirmed/bug] The picker can show a colour the swatch never received: when dragging on a locked swatch, or after hovering with the eyedropper and cancelling.
- [confirmed/inconsistent] The global Value and Hue locks re-apply to any hex-path edit of any swatch, silently undoing Critique and AutoFix fixes, while BG Check's oklch-path fix bypasses them.
- [confirmed/bug] Collapsing the drawer, switching Design and Illustration, or opening Print or Export unmounts every panel and loses its state (Recipes brief, loaded image, AutoFix result, In context pins, the Mixer painting).
- [confirmed/inconsistent] Report always matches Riso regardless of the library chosen in Reproduction, and it excludes the Critique, so it can say 'Sound' while Critique lists Issues.
- [confirmed/duplicated] Structure's Value and Critique views apply different value rules despite the comment saying pairing them keeps them from disagreeing.
- [confirmed/inconsistent] 'Value' means OKLCH L in some places and Rec.709 luma in others.
- [confirmed/inconsistent] Every contrast check chooses 'the background' differently, so pass/fail numbers differ between panels.
- [confirmed/ux-confusing] The Random Palette spreads lightness by at most 0.2 around one base L, so it always trips Value checks, and its Comp/Triad/Tetrad chips only scale hue spread.
- [confirmed/inconsistent] The Clear tooltip says Ctrl+Z cannot undo it, but it can.
- [confirmed/ux-confusing] Selection, tab switches and lock toggles push undo steps and mark the tool dirty (the close prompt), although the palette autosaves; only exports clear it.
- [confirmed/half-built] The Risograph mode toggle is a stub that points to a panel that does not exist.
- [confirmed/half-built] The app tells you to import your own .ase, but there is no palette import or save/open of named palettes at all.
- [confirmed/bug] CSS variable and Tailwind keys come only from swatch names with no dedupe or sanitising, so repeated names overwrite each other. Roles are unused despite checks.js claiming otherwise.
- [plausible/bug] The Procreate .swatches export probably won't import: it writes '<name>.json' holding one object instead of 'Swatches.json' holding an array of palettes.
- [confirmed/bug] The Gradient header always says OKLCH, and 'Add N stops' re-adds both endpoints as duplicates.
- [confirmed/inconsistent] Recipes maps its 7 roles onto the palette's 6 colour-named roles (secondary, muted and surface become freeform), and adding both themes yields two whites and two blacks.
- [confirmed/duplicated] Recipes has its own mockup whose button labels use the background colour with no contrast check, duplicating In context.
- [confirmed/duplicated] The Print tab and the Reproduction panel duplicate the profile selector and nearest-ink matching.
- [confirmed/duplicated] Shadow/Highlight and Materials both build shadow-to-highlight ramps from the active swatch. One lets you set the light and shadow hues; the other hardcodes them.
- [confirmed/ux-confusing] The Mixer's well hint says clicking a pigment drops it into the well, while the tray says a click loads the brush and a double-click drops it in. The well readout is only its centre pixel.
- [confirmed/bug] Hidden-but-mounted panels all re-render on every palette edit, including Paint Mix's recipe solve when it follows the active swatch, and Vision and Grade memoise on fresh arrays.
- [confirmed/bug] Ctrl+Z inside a text field undoes palette state instead of the typing.
- [confirmed/dead-code] Dead state and exports: per-swatch history, uiState mode/group, resetUi, the index.jsx C shim, color.js single-constant K-M mixing, getSharedColors, mixHexPaint, nearestMatches, clearMatchCache, isPicking, PIGMENT_BY_ID.
- [missed/bug] oklchToHex and toHex return 3-digit hex (#fff, #000, #f00, #eee, #111) whenever the channels are doubled digits, because colorjs collapses by default. Those strings get stored as swatch hexes: dragging the picker to either edge, grey ramps, BG Check, harmony fixes, gradients. Half the codebase parses hex by fixed slices, so they then turn to NaN: value-lock luma, wcagContrast (BG Check, Logo Maker), CVD simulation, CMYK/TAC (Print, Reproduction, TXT/JSON export), spectral paint (Mixer, Paint Mix), the Picker's sliders and HSL, isLightHex and In context tint().
- [missed/bug] BG Check's 'Fix to AA' always searches the darker half, because its dark probe is '#000', which yields NaN contrast. Against the Black preset (or any dark custom background) it sets the swatch to black at 1.00:1. Against White it over-darkens, since the search is capped at L 0.5. Against Grey it can stop at 4.49:1, still failing.
- [missed/bug] With Value lock on, any hex-path edit of a black swatch stays black: paste, the I-key eyedropper, AutoFix or Critique fixes. The store re-solves L for luma 0 without the near-black guard the Picker has, and the store's own comment describes this trap as fixed. A 3-digit hex gives luma NaN, which also drives L to 0.
- [missed/ux-confusing] The Print view hides the palette grid, so you can only inspect the swatch that was active when you opened the tab. There is no way to step through swatches without going back to Design.
- [missed/bug] Undo race: pressing Ctrl+Z within 400ms of an edit steps back two states (the latest edit's snapshot has not been pushed yet), and the pending debounced snapshot then truncates the redo stack. Because Ctrl+Z is not blocked in text fields, typing a name and immediately pressing Ctrl+Z hits this path.
- [missed/bug] Undo snapshots include mode, print profile, lock toggles and risoMode, so Ctrl+Z can flip the Design/Illustration tab (unmounting every panel) or silently turn Value lock back on.
- [missed/inconsistent] Structure > Value shows two different greys for the same swatch on one row. The bar is filled with hsl(0 0% L%) using OKLCH L, and the grey chip is CSS grayscale() luma. The hint then says equal bar lengths mean 'one colour in greyscale'.
- [missed/bug] Critique's 'Apply all' fires every fix as a whole-hex replacement. When two findings target the same swatch (for example Mute X and Pull X toward Y), the last one silently wins.
- [missed/bug] AutoFix results are a snapshot. If you edit the palette before clicking Apply, it overwrites your newer edits with hexes computed from the old palette.
- [missed/bug] Gradient keeps the From and To swatch ids from mount. Because the panel now stays mounted, after Reset or Clear the To dropdown shows the first swatch while the gradient uses the last one.
- [missed/bug] The hex field's Escape does not revert the colour. A 6-digit hex is applied on every keystroke, and a 3-digit draft is committed anyway by the onBlur that Escape triggers, via a stale closure. Commit c01ff3d says 'Escape reverts'.
- [missed/performance] Paint Mix's 'Whole palette' mode re-solves a recipe for every swatch on every palette change, even while hidden, and every picker drag frame writes the whole palette JSON to localStorage.
- [missed/ux-confusing] With an empty palette (after Clear) the picker still drags and accepts hex input, but the changes go nowhere.
- [missed/dead-code] The Image panel's 'extracting…' indicator never appears, because busy is set true and false within the same synchronous call.
- [missed/inconsistent] The contrast matrix labels 3:1 as 'A', which is not a WCAG contrast level, while Grade calls the same threshold 'AA Large'.
- [missed/duplicated] Critique renders its own SEV table and Card findings instead of the shared Finding/SEV that every other Check panel uses.
- [missed/inconsistent] The tool's own 'faint' text token is 4.3:1 on its card surface, below the AA 4.5:1 its checks enforce, yet it is used for hints and captions throughout.
INTENT Q:
- Design vs Illustration: were these meant to be two different jobs (brand/UI palettes vs painting/illustration palettes), or just two groups of panels over the same palette?
- Should Value lock and Hue lock only govern the picker you're dragging, or should they also block fixes and pastes on other swatches, as they do now?
- When you say 'value', do you mean how dark it looks in greyscale (luma) or perceptual lightness (OKLCH L)? The tool currently uses both.
- Paint Mix (recipe solver, under Design) and the Mixer (paint canvas, under Illustration) are both about real paint. One 'Paint' area, or keep them separate?
- Shadow/Highlight and Materials both light a colour. Merge them into one 'light this colour' panel, and should you be able to set the light colour yourself?
- How web/UI-focused should this be? Recipes (industries, Tailwind, light/dark themes), In context (website mockup) and WCAG grading pull toward web design. Is that what you wanted, or brand palettes for motion, 3D and print?
- One autosaved palette, or a library of named palettes you can save, open, and import (ASE from Illustrator, GPL, etc.) as well as export?
- Roles are named after colours (black / main / accent / white / pop) while In context and Recipes think in jobs (background / surface / text / primary / accent / muted). Which vocabulary should the palette use?
- Should the palette be the shared 'brand palette' that Logo, Pattern, Dither and Motion Maker read live, rather than a one-off 'Send to' push?
- The Random Palette (AcerolaFX port): did you want it to produce usable full-range palettes, and are Mono/Analog/Comp/Triad/Tetrad meant as real harmonies or just 'how much hue spread'?
- Print: do you need profile-accurate CMYK for handoff (FOGRA39 etc.), or are rough numbers enough? And what was Risograph mode supposed to do, snap the palette to a chosen set of Riso drums?
- AutoFix's 'near-duplicates': should it merge or delete duplicates, or really recolour one to match the other?
- Is the Mixer paint canvas a scratch pad for finding colours, or meant to be a proper painting surface whose work survives switching tabs?
- Print tab (one swatch) vs Reproduction (whole palette): keep both, or fold them into one print view?
- Print and Export currently replace the whole palette view. Should they stay separate destinations, or be panels that keep the palette visible so you can pick which swatches to inspect or export?
- How big are your palettes in practice: 4-8 brand colours, or 20-40 illustration colours with ramps? Shadow/Highlight and Materials append loose, generically named swatches. Should a ramp stay grouped under its base colour?
- Should checks show inline (a marker on the swatch or pair with a problem) instead of six Check panels plus a Report you have to visit?
- What should Ctrl+Z undo: only colour and palette edits, or also selection, tab and lock changes as it does now?
- Your own stack is C4D/Corona plus After Effects. Should export target those (ASE for AE, linear or ACEScg values for Corona materials) rather than web formats like Tailwind and CSS variables?
- For contrast, is WCAG 2 ratios what you want, or APCA-style perceptual contrast for UI work?
CROSS:
- Dither & Halftone: the one working link. 'Send to Dither' writes selected (or all) hexes to localStorage 'designtools-shared-colors'.dither-maker, and Dither shows an incoming bucket with 'Save as palette' / 'Dismiss' (index.jsx:179-181; DitherTool/store.js:273-289; DitherTool/index.jsx:97, 806, 950).
- Logo Maker: 'Send to Logo' writes a bucket Logo Maker never reads. Logo Maker has its own colour inputs and its own WCAG contrast check (LogoMaker/BackgroundRow.jsx:2, 24), which duplicates Accessibility here.
- Pattern Maker: 'Send to Pattern' is never read. Pattern Maker's Shapes tab keeps its own hardcoded 4-colour palette list (PatternMaker/ShapesTab.jsx:161-162, 421-428). Its Meteorite tab says 'CMYK conversion happens in the Color Palette tool' (MeteoriteTab.jsx:385), but there is no way to send its colours here, and the CMYK here is a naive, profile-agnostic formula.
- Motion Maker: its 'Brand Palette' value node holds 5 hardcoded colours (MotionMaker/nodes.js:619-633; engine.js:378-386), with no link to this palette. Motion Maker can't be sent colours either.
- Post FX and Scan to Lineart: no link at all. Their colour controls are native <input type=color> pickers (PostFX 1, Lineart 2; Pattern 2, Dither 4, Logo 1), not this tool's OKLCH Picker or its multi-monitor eyedropper (lib/eyedropper.js is only used here).
- No inbound path: nothing in any other tool can push colours into the palette (for example a Logo's colours or a Dither palette), and the palette can't import files.
- Shared libraries: lib/color.js is also used by Logo Maker (wcagContrast, hexToRgb). components/NumberField.jsx is the shared slider; panelUi.jsx, tokens.js and colorpalette.css are a Color-Palette-only design vocabulary that the other tools don't use.
- App shell: App.jsx renders only the active tool, so switching tools unmounts all panel state (the palette itself persists in localStorage). The global Ctrl+Z handler (App.jsx:71-75) has no text-field guard. The unsaved-changes tracker (lib/unsavedChanges.js) is shared, and this tool marks itself dirty on every click.

## Dither & Halftone
IDEA: You open it to turn a photo, render or GIF into a stylised image made of a limited set of colours: retro pixel dithering (1-bit Mac, Game Boy, CGA, PICO-8) or a print halftone (newsprint dots, CMYK rosettes, Riso-style spot inks). Optional glow/CRT/glitch treatments and looping animation sit on top. You leave with a PNG or SVG, per-ink separation PNGs, an animated GIF/MP4/frame ZIP, or you send the still on to Post FX.
IDEA_CORR: 
OUTPUTS: PNG of the current result. Dither mode has a 1-8x integer 'PNG scale'; Halftone mode always exports at render size, max 2048 px (index.jsx:642-653) | SVG: halftone as vector dots (one <g> per ink), or ordered/threshold dither as run-length pixel rects. Not offered when dither + post FX (index.jsx:654-675, halftone.js:211-248, ditherSvg.js) | Copy result to the clipboard as PNG (index.jsx:676-681) | Per-ink separation PNGs with transparent gaps (CMYK or palette halftone), one at a time or 'Export each layer' (index.jsx:682-695) | For GIF or sequence input: an animated GIF plus a ZIP of numbered PNG frames (index.jsx:703-729) | Motion loop: GIF, MP4/WebM (MediaRecorder) or a ZIP of PNG frames covering exactly one loop (index.jsx:734-803) | 'Send to Post FX': a PNG dataURL written to localStorage for the Post FX tool (index.jsx:635-639) | Saved presets and saved palettes, stored in localStorage only. They cannot be exported or shared as files or codes (store.js:159)
SIZE: About 4,280 lines for this unit. index.jsx is 1,514 lines: one ~1,190-line component (lines 37-1229) holding the render pipeline, every exporter, motion recording and the whole panel, plus ~15 inline UI primitives copied in other tools. glDither.js is 892 lines (7 shaders, including a ~180-line halftone shader with 11 SDF shapes). dither.js is 664 lines (32 algorithms incl. void-and-cluster blue noise and a Hilbert-curve dither). presets.js is 341 (59 presets), store.js 289, halftone.js 248 (now only the CPU fallback and SVG export, 3 shapes), motion.js 124, gif.js 107, ditherSvg.js 56, palettes.js 45. The bloat is structural. There are two dither paths (GPU ordered vs CPU diffusion) with different colour maths, two halftone engines (GPU preview vs CPU/SVG export) with different features, and a full private post-FX stack that duplicates Post FX. Legacy state keys (dpi, lpi, cell, htShape, htScale) are still saved in every preset. Last touched in git on 2026-06-11/15 (commits 68dd046, 954c7e1).

FEATURES:
- Open image / drop / paste [partial -> partial: Still partial, but there is a bigger fault than the silent SVG drop. The render only re-runs when the image's name plus width plus height changes. A second pasted screenshot (Chrome names clipboard files 'image.png') or a re-rendered file with the same name and size is loaded but never rendered, and exports still carry the old picture.] :: Loads a still, an animated GIF, or several stills as a frame sequence.
- Debug (test pattern) [works] :: Loads a 512px synthetic gradient/step-wedge chart for judging dot growth and banding.
- Undo / Redo buttons (+ Ctrl+Z/Y) [partial -> partial: Snapshots are taken on a 350 ms debounce. Pressing Ctrl+Z within 350 ms of a change goes back two steps, and the pending snapshot then clears redo. The Undo/Redo buttons read canUndo()/canRedo() at render time, before the snapshot lands, so they lag one step (Undo stays greyed after the first edit). This comes on top of the reader's point that undo also covers the libraries.] :: Steps back through debounced snapshots of every setting.
- Result / Separations switch [works] :: In CMYK or palette halftone, swaps the canvas for a grid of each ink plate with Show/Hide and Export buttons.
- Canvas viewport (pan / zoom / Fit / 1:1) [works] :: Scroll to zoom, Space or middle-drag to pan, with Fit and 1:1 buttons and a 'CPU' badge when WebGL is missing.
- Right-click menu [partial] :: Open/replace, copy, save PNG/SVG, delete image, fit, 100%, Randomize, Reset all settings.
- Sequence timeline (GIF / multi-file input) [broken] :: Play/pause, a frame scrubber and a frame counter, plus GIF and Frames ZIP export of the whole sequence.
- Incoming colours banner [works] :: Shows colours sent from Color Palette and saves them as a new palette, or dismisses them.
- Mode switch: Dither / Halftone [works] :: Picks one of two engines; the whole panel below re-labels itself per mode.
- Presets [partial] :: 59 built-in looks in 7 groups (Basic, Halftone, Print & Riso, Retro Hardware, Aesthetic, Experimental, New looks), with a dropdown, ‹ › and scroll-wheel stepping, and save/delete of your own.
- Input (Dither): Sizing Detail / Pixel size, Resampling [works -> partial: 'Pixel size' only shrinks the working image (long edge divided by N). Output is 1 px per block, and the export block size comes from the separate PNG scale (default 4x). Pixel size 8 exported at the default scale gives 4-px blocks, not 8-px ones.] :: Sets the working resolution, either as a long-edge px count or as a chunky block size, and crisp or smooth downscaling.
- Input (Dither): Algorithm picker [works -> works: The 32 are threshold, random noise, interleaved gradient (IGN, which the reader left out), 12 diffusion, 2 Riemersma, 4 Bayer, 8 halftone-screen and 3 blue-noise. The picker also has ‹ › steppers, wheel stepping and an 'N / 32 · group' counter.] :: 32 algorithms: threshold, noise, 12 error-diffusion kernels, 2 Hilbert-curve, 4 Bayer, 8 'halftone screen' matrices and 3 blue-noise.
- Input (Dither): Spread / Strength / Serpentine / Jitter [works] :: Per-family strength controls plus threshold jitter for a grittier ordered screen.
- Animate screen (shimmer) [partial] :: Drifts the ordered-dither screen origin so the dither sparkles live.
- Input (Halftone): Screen shape, DPI, Tone γ, Dot size [works] :: 11 dot shapes (circle to stochastic), dots across the long edge, tone curve and dot scale.
- Print feel: Dot gain, Paper grain, Misregister, Freq vary [works] :: Printed-look imperfections: fatter dots, paper noise, per-ink offset and per-ink screen frequency.
- Screen angle (mono) / CMYK screen angles [works] :: Rotation of the dot grid, one angle for mono and C/M/Y/K sliders for process.
- Effect controls [works] :: Brightness, contrast, blur, sharpen, denoise/noise, black/white point, gamma and posterize applied to the source before screening.
- Colour: mode (Mono/Tonal/Indexed/RGB or Mono/CMYK/Palette), Tones, Hue, Saturation, Invert [works] :: Chooses how colours are quantised (dither) or which inks print (halftone), with hue/sat/invert.
- Gradient map (luma → palette) + stop editor [works -> partial: The ramp always comes from the current palette, even in Dither RGB and Halftone CMYK where the palette picker is hidden, so you cannot change those colours without leaving the mode. Saved stop positions carry over to any other palette with the same colour count.] :: Remaps the image's tones onto the palette ramp before screening, with draggable stops.
- Palette / Inks manager + 'From image' [partial -> partial: The rename-box bug is narrower than stated. React updates defaultValue, so an untouched box does follow the selected palette. The stale name only sticks after you have typed in the box once, because that DOM node is then 'dirty'. Switching straight to another saved palette and blurring then renames it.] :: Picks a built-in or saved palette, renames or deletes saved ones, and extracts N colours from the photo. You cannot edit individual colours.
- Region mask [works -> partial: Subject mode measures the background from the raw image's corners but compares it with the adjusted pixel luma, after brightness, contrast, levels and Invert. With Invert on (which auto-invert often switches on) and 'Keep raw original' off, the background counts as subject. The CPU halftone and SVG ignore the mask entirely. With Round or Diamond edges, the kept photo area is also cut into dots.] :: Limits the effect to a tone band or a rough 'subject' (differs from the corner colour), with feather, invert, and a raw-original option; the photo shows elsewhere.
- Output (Dither): Edges Pixel/Round/Diamond + Gap fill [works] :: Draws each dither cell as a square, dot or diamond over a gap colour.
- Output (Halftone): Paper colour / Transparent [partial] :: Sets the sheet colour, or transparent gaps.
- Output (Halftone): Layers list [broken -> broken: Besides the CMYK index shift, hiding every layer brings them all back in the composite (an empty filter falls back to all inks).] :: Toggles individual ink plates on or off in the composite.
- PNG / PNG scale [partial] :: Downloads the current result; the scale slider appears in Dither only.
- SVG [partial] :: Vector export of halftone dots or ordered pixel runs.
- Copy [works] :: Copies the result PNG to the clipboard.
- Send to Post FX [partial] :: Hands the current still to the Post FX tool.
- Export each layer (PNG) [works] :: Downloads every visible ink plate as its own PNG, staggered 250 ms apart.
- Post-processing (10 effects) [works] :: Glow/bloom, CRT/scanlines/phosphor mask, chromatic aberration, anamorphic streaks, ink outline, wave warp, VHS, glitch, film grain and colour grade, rendered on the GPU after the dither.
- Animate (glitch · grain · warp · VHS) [works -> partial: Works live on its own. In Halftone and in diffusion algorithms, renderFrame never passes time to the post stack, so post noise and wave freeze while Play motion runs and in their loop exports. Only ordered GPU dither animates them.] :: Runs the noise-based post effects live at a set speed.
- Motion · seamless loop (LFO modulators) [partial -> partial: Still partial, but the live preview is likely broken, not just the exports. The render key is built from the Proxy `s`, so it includes the LFO values. Each non-quiet render (70 ms after the key changes) calls present() → setResultDims → re-render with new modulated values → new key → the animation effect restarts with start=now. Play motion would then keep replaying roughly the first 70-90 ms of the loop (traced, not run). Exports go through renderMotionFrames and are unaffected. The reader's wave and noise caveats hold only for ordered dither (see Animate).] :: Adds sine/tri/square/saw/noise/spin modulators to ~35 numeric settings with integer cycles per loop, plays them live, and exports one loop as GIF, video or frames.
- Per-ink tone editor (GradientEditor) [stub] :: Built so each ink/palette colour could be dragged to a tone position with intensity and spread; it is never rendered.
- Auto-invert on halftone load [partial] :: Flips Invert automatically when the corners are darker than the centre, so the subject gets the ink.
- Randomize / Reset all settings [works] :: Randomises algorithm, palette, edges and a few post FX, or restores defaults (context menu only).
- (missed) Settle-to-PNG preview [works] :: While you edit, the live WebGL canvas is shown. 160 ms after edits stop, it is swapped for a PNG <img> of the same result so zoomed-out views scale cleanly. The swap is skipped while animating.
- (missed) Unsaved-changes close warning [partial] :: Every store change marks the tool dirty, and any file download marks it saved. Electron then warns on window close. Loading an image does not count as a change, and Copy or Send to Post FX do not count as saving.
PROBLEMS:
- [confirmed/bug] GIF and sequence playback looks frozen: the frame counter and scrubber move, but the picture keeps the last rendered frame. It updates only after an export or any settings change.
- [confirmed/disconnected] Switching to another tool and back loses the loaded image or sequence. The settings survive because they live in the module store.
- [confirmed/bug] In CMYK halftone, hiding one ink shifts the separation data onto the wrong inks.
- [confirmed/bug] In palette halftone, hiding a layer reassigns its colours to other inks and reshuffles misregistration and frequency offsets.
- [confirmed/inconsistent] Halftone SVG uses a different renderer from the preview: only 3 shapes; it ignores paper, γ, dot size, gain, misregister, grain, mask and post; palette mode turns the lightest colour into the sheet.
- [confirmed/bug] Halftone export size follows DPI (about 12 px per dot on big images), caps at 2048 and is not monotonic; PNG scale is hidden and forced to 1.
- [confirmed/inconsistent] PNG scale multiplies an output that is already 5× whenever post FX or round/diamond edges are on.
- [confirmed/inconsistent] Dither SVG re-runs the dither on the CPU without jitter, mask or per-colour controls, and uses the CPU colour order, so it can differ from the preview.
- [confirmed/inconsistent] Ordered (GPU) and diffusion (CPU) paths apply the adjustments in a different order and with different colour maths, so switching algorithm family changes the tone. With Gradient map on, Hue/Sat barely act in diffusion.
- [confirmed/half-built] A per-ink tone editor is fully plumbed but has no UI.
- [confirmed/bug] The Riso Fluoro preset renders almost black.
- [confirmed/dead-code] Presets carry settings that do nothing: resolution in halftone presets, paperColor in Dither presets (Blueprint, Woodcut), and legacy dpi/lpi/cell/htShape. htScale matters only for the CPU fallback.
- [confirmed/bug] Presets do not save CMYK screen angles or hidden layers. Built-in presets do not reset the angles either.
- [confirmed/ux-confusing] Applying a built-in preset that has its own palette permanently adds that palette to Saved. 40 of the 59 presets do this, not about 30.
- [confirmed/ux-confusing] Scrolling the wheel over the Presets or Algorithm row steps them. preventDefault cannot stop the panel scrolling because React 18 wheel listeners are passive, so scrolling the panel can apply presets.
- [confirmed/bug] Undo can un-save presets and palettes and also toggles Play motion.
- [confirmed/bug] In ordered-dither motion exports, Wave warp breaks the seamless loop and post noise animates even with Animate off. In Halftone and diffusion modes, post time is never passed, so noise and wave stay frozen in loop exports.
- [confirmed/half-built] Animate screen (shimmer) cannot be exported; PNG export freezes whatever phase is current.
- [confirmed/bug] The loop video renders one extra frame identical to the first (n+1 frames) and is paced by setTimeout.
- [confirmed/disconnected] Animated input and LFO motion are separate systems that don't combine, and video files cannot be loaded (Post FX can load them).
- [confirmed/bug] Dropping or opening an SVG does nothing and shows no message.
- [confirmed/bug] 'Delete image' leaves a loaded sequence (Play brings it back). '100%' throws only if no image has been loaded in this session, because Delete does not clear resultDims.
- [plausible/bug] The saved-palette rename box shows a stale name only after you have typed in it once; switching to another saved palette and blurring then renames that palette.
- [confirmed/bug] Palette halftone handles only 16 inks, but 'From image' allows 32. Extra inks are missing from the composite yet still listed, and their separations index past the shader arrays.
- [confirmed/ux-confusing] Auto-invert flips Invert the first time an image (keyed by name and size) is shown in Halftone. That includes switching to Halftone or applying a halftone preset after loading in Dither, where it overrides the preset's invert and flips the picker to Custom.
- [confirmed/bug] Transparent paper is lost as soon as the Post FX master toggle is on, even with every effect inside it off, and the SVG always has a background rect.
- [confirmed/disconnected] Send to Post FX gives no feedback and no tool switch, errors are swallowed, and it only sends stills.
- [confirmed/duplicated] The tool has its own post-FX stack that heavily overlaps the Post FX tool.
- [confirmed/ux-confusing] The panel duplicates and scatters controls: two gammas and two dot enlargers in Halftone, 'Mono' meaning two things, the algorithm under Input, exports in five places, and Output placed mid-panel.
- [confirmed/ux-confusing] Randomize always switches to Dither mode.
- [confirmed/inconsistent] Without WebGL, halftone falls back to a CPU renderer with 3 shapes that ignores paper, γ, dot size, print feel, mask and post.
- [confirmed/bug] Multi-file sequences keep the order the browser hands the files over, with no sort by name.
- [confirmed/dead-code] Dead code: htSourceRef is never read, exportGif's single-still branch is unreachable, and rgbToHex, ALGO_IDS and glDither's hexToRgb re-export are unused.
- [missed/bug] Loading a different image with the same file name and pixel size does not re-render. Pasting a second screenshot (clipboard files are named image.png) or re-dropping a re-rendered C4D/AE frame with the same name keeps showing, and exporting, the old result.
- [missed/bug] Play motion's live preview likely keeps restarting. The render key includes the LFO-modulated values through the Proxy, so each debounced non-quiet render re-renders with new values, changes the key and restarts the animation effect from time 0. The preview would loop over only the first ~70-90 ms of the cycle. Traced, not run.
- [missed/bug] Subject mask breaks under Invert or strong adjustments: the background reference comes from the raw image's corners, but pixels are compared after brightness, contrast, levels and Invert. Auto-invert often turns Invert on, so the background gets classed as subject unless 'Keep raw original' is on.
- [missed/bug] The undo history is debounced by 350 ms. Pressing Ctrl+Z within 350 ms of a change skips a step and wipes redo, and the Undo/Redo buttons show the previous step's enabled state.
- [missed/inconsistent] In Halftone and diffusion modes, post time is never passed, so glitch, grain, VHS and wave freeze in motion loop exports and during Play motion. This contradicts the Motion note that noise 're-rolls per frame'. Only ordered dither animates them.
- [missed/inconsistent] The ordered-dither SVG is vertically mirrored against the preview. The GPU anchors the threshold matrix at the image bottom (flip-Y upload), the CPU at the top. For example, 'Line screen 45°' (the Woodcut preset) would export lines on the opposite diagonal. Traced, not rendered.
- [missed/ux-confusing] Gradient map pulls its ramp from a palette you cannot see or change in Dither RGB and Halftone CMYK. Custom stop positions carry over to any palette with the same colour count.
- [missed/ux-confusing] 'Pixel size' does not set the exported block size. Export is 1 px per block times a separate PNG scale (default 4), so Pixel size 8 exports 4-px blocks.
- [missed/bug] PNG, Copy and Send to Post FX read the live canvas. During Play motion or Animate they capture whichever modulated frame happens to be on screen, not your base settings.
- [missed/ux-confusing] 'Keep raw original' shows the photo at dither working resolution. With Round or Diamond edges, the untouched area is also cut into dots on the gap colour, because the shape pass runs on every cell.
- [missed/bug] Hiding every halftone layer brings all of them back in the composite.
- [missed/ux-confusing] 'Export each layer' fires several downloads 250 ms apart. Electron has no will-download handler, so each one likely opens its own Save dialog (four for CMYK, up to 32 for a palette).
- [missed/disconnected] Post FX downscales anything it receives to 1600 px with smoothing on, blurring dither pixels and halftone dots from large results (for example 2048-px halftone, or 4096-px round-edge dither).
- [missed/disconnected] Dither and Scan to Lineart write to the same single Post FX inbox slot, so a second send silently overwrites the first.
- [missed/bug] Loop GIF frame delays are rounded to 10 ms, so loop length and speed drift. 24 fps gives 40 ms frames (a 3 s loop plays in 2.88 s); 60 fps is clamped to 20 ms (plays slower).
- [missed/perf] Play motion in diffusion and Halftone modes redoes the full CPU prep every animation frame: new canvases, getImageData, levels, gradient map, and full CPU error diffusion for diffusion algorithms. The comment calls this path 'cheap, GPU'.
- [missed/bug] Ctrl+Z inside a text field (preset name, palette rename) undoes the tool's settings instead of the typing, because the app-wide handler never checks focus.
INTENT Q:
- Should Dither and Halftone be one tool or two? Today they share a panel but run separate engines with separate controls and exports.
- The Dither algorithm list has its own 'Halftone screen' group (clustered dot, diamond, line screens), separate from Halftone mode. Keep both, or keep halftone only in Halftone?
- Should this tool keep its own glow/CRT/VHS/glitch/grain stack, or drop it and hand off to Post FX, which already does all of that?
- Halftone: is the main deliverable print or vector (SVG into Illustrator, big PNG), or screen-size images? Right now SVG doesn't match the preview and PNG maxes out at 2048 px.
- What were the motion loops for: social GIF/MP4, or frames you comp in AE/C4D? Should animated input (GIF, render sequences, video) and LFO motion work together?
- The hidden per-ink editor (drag each ink to a tone, set intensity/spread) was never switched on. Was that meant for Riso-style 'this ink only in the shadows' control, or did Gradient map replace it?
- Riso Fluoro puts inks on near-black paper. Did you want light or opaque inks on dark paper (screen-print style)? The current ink mixing can't do that.
- Auto-invert when an image loads in Halftone: keep it automatic, turn it into a button, or drop it?
- Should Dither let you edit palette colours itself, or always take them from Color Palette? And should the two tools share one palette library?
- Region mask 'Subject': was the aim a real subject cut-out, or is a tone-band limiter enough?
- Are the 59 built-in presets starting points you actually use, or should the set be cut down to a few strong ones?
- Pixel size vs Detail sizing: was Pixel size meant for exact pixel-art output (clean integer upscales), or just a friendlier resolution slider?
- Should 'Pixel size' mean the actual block size in the exported file (for example, output at source size with N-px blocks), replacing the separate PNG scale?
- In palette halftone, is one palette colour meant to be the paper (as the SVG and CPU paths do), or are all colours inks on a separate paper colour (as the preview does)?
- For Riso work, should separations come out as greyscale or black plates (what a Riso master needs) instead of ink-coloured transparent PNGs, and as one ZIP instead of one download per plate?
- Should the tool keep the loaded image across tool switches and app restarts, like a project or document, or is it fine for it to start fresh each time?
- Did Play motion ever look right to you live, or did you only judge loops from the exports? The preview looks like it keeps restarting.
- Was 'Animate screen (shimmer)' meant to end up in exported loops, so it should become a motion target?
- Do you repeatedly paste screenshots or re-drop re-rendered frames with the same filename? The preview currently ignores those.
- Is the no-WebGL CPU fallback worth keeping in the rewrite, given the app always runs in Electron on your GPU?
- Should 'Keep raw original' show the full-resolution photo outside the mask, rather than the dither-resolution copy (cut into dots when edges are Round or Diamond)?
CROSS:
- Color Palette → Dither: one-way colour push. ColorPalette/index.jsx:180 writes to localStorage 'designtools-shared-colors' under 'dither-maker'; Dither reads it only on mount and shows a 'Save as palette' banner (store.js:275-289, index.jsx:97, 946-952). You must switch tools by hand, and doing so loses the image loaded in Dither.
- Dither → Post FX: 'Send to Post FX' puts a PNG dataURL in localStorage (index.jsx:635-639 → PostFX/store.js:202-208), which Post FX loads on mount as 'from-dither.png' (PostFX/index.jsx:81-84). Stills only, no confirmation, no auto-switch, silent failure if the PNG is too big for localStorage, and no way back from Post FX to Dither.
- Every tool unmounts on switch (App.jsx renders only the active tool), so Dither's loaded image and sequence are lost on any round trip to another tool.
- Duplicated with Post FX: bloom/glow, CRT/scanlines, chromatic aberration, VHS, glitch, film grain, wave, edge/outline, vignette, levels, posterize, gradient map and brightness/contrast/sharpen exist in both, as separate GLSL (glDither.js:175-309 vs glPostFX.js + PostFX/effects.js).
- Post FX's effects.js:17 says 'Halftone is intentionally absent — the Dither & Halftone tool owns it', yet Post FX has 'Stipple Dots' (effects.js:948), 'Cross-Hatch / Engraving' (896) and a noise 'Dither' slider inside Posterize (393-400). These overlap with Dither's stochastic and cross screens.
- Motion Maker has a node called 'Dither / Halftone' (MotionMaker/nodes.js:765-774, render.jsx:101-117) that is really an SVG turbulence dissolve or posterize. It shares no code with this tool, and the name suggests a link that doesn't exist.
- Motion Maker and this tool's Motion section both make looping animations with their own GIF/video export. There is no path to send a Motion Maker animation into Dither, or a Dither loop into Motion Maker.
- Shared code: lib/gif.js (encodeGif/framesToZip/decodeGif) is also used by Post FX (index.jsx:7) and Motion Maker (exporters.js:10). NumberField, Icon, lib/undo.js (global Ctrl+Z) and lib/unsavedChanges.js (close warning) are shared app-wide.
- Copy-pasted rather than shared: PresetStrip, StepBtn, Section/Row/Toggle/MiniBtn/ZoomBtn, the pan/zoom viewport and downloadBlob are re-implemented in Post FX (index.jsx:786-1128), Scan to Lineart (index.jsx:571-643) and Motion Maker (Stage.jsx), with comments saying 'mirrors the Dither tool'.
- hexToRgb exists in at least four copies (DitherTool/palettes.js:22, lib/color.js:6, LineartTool/index.jsx:637, lib/glPostFX.js:296 as hexToRgb01), and lib/glDither.js imports it from the tool folder (glDither.js:19).
- Missing link from Logo Maker: there is no way to send a logo in, and SVG input is silently ignored (index.jsx:126-127), even though a dithered or halftoned logo is an obvious use.
- Missing link from Pattern Maker: patterns can't be sent in to be dithered or halftoned.
- Missing link from Scan to Lineart: it sends to Post FX (LineartTool/index.jsx:360) but not to Dither, although lineart is a natural source for 1-bit dither or halftone.
- Missing link back to Color Palette: a palette extracted with 'From image' stays in Dither's own library ('designtools-dither' localStorage key) and can't be sent to Color Palette. The two tools keep separate palette libraries.
- lib/export.js (SVG→PNG, ICO, favicon ZIP) is not used by this tool; it belongs to Logo Maker.

## Post FX
IDEA: A finishing pass that runs on the GPU, like a stack of After Effects adjustment effects. You drop in a still, an animated GIF or a video, stack effects from a library of 52 (colour grade, blur, lens, film and retro, stylize, distort, datamosh, light), check the result with a before/after split, and save the look as a preset. You leave with a processed PNG, a looping GIF, a WebM/MP4, or a zip of batch-processed images.
IDEA_CORR: 
OUTPUTS: PNG of the current frame, '<name>-fx.png', at working resolution (long edge capped at 1600 px) and always opaque (index.jsx:364-375) | Animated looping GIF with one shared 256-colour palette via gifenc, '<name>-loop.gif' for stills and '<name>-fx.gif' for GIF/video (index.jsx:416-437, lib/gif.js:66-99) | Video recorded from the canvas with MediaRecorder at 12 Mbps, MP4 if the platform supports it and WebM otherwise, no audio (index.jsx:388-393, 441-500) | Batch ZIP 'postfx-batch.zip' of '<name>-fx.png' files, one per input image (index.jsx:533-568) | Preset share code copied to the clipboard as text (index.jsx:517-521) | Saved presets kept in localStorage under 'designtools-postfx' (store.js:12, 75, 168-181)
SIZE: About 3,180 lines in total. src/tools/PostFX/index.jsx is 1,150 lines: one component handling media loading, the playback loop, three exporters, batch, share codes and pan/zoom, plus 12 inline helper components, all with inline styles. This file is the bloated one. src/tools/PostFX/effects.js is 1,345 lines: 52 GLSL effect descriptors, pure data driving both uniforms and UI. It is the cleanest and most reusable part. presets.js is 179 lines (31 presets), store.js 208, and src/lib/glPostFX.js 300 (a generic ping-pong effect engine with frame-feedback history, also clean). Export and video code is duplicated with Dither and Motion Maker.

FEATURES:
- Empty-state drop zone / drag-drop / paste [works -> partial: Paste has a stale-closure bug. If Animate is off, a pasted image is drawn with the effect stack as it was when Post FX opened, not the current one. Dropping only works on the viewport. Unsupported raster files (TIFF/PSD/HEIC) never finish loading and give no message.] :: Drop, paste or import a file to start. Dropping one file loads it; dropping several starts Batch.
- Import (still / GIF / video) [partial -> partial: Besides SVG being ignored and video errors going only to the console: TIFF, PSD and HEIC files (typical C4D/Corona render outputs) are accepted by the picker (accept image/*), but processFile's promise never resolves, so nothing happens. loadFromUrl also has no onerror.] :: Opens a file picker and sends the file to the still, GIF or video loader by its type.
- Debug test card [works] :: Loads a synthetic card (hue band, grey ramp, skin swatches, rings, checker grid, bright dots, text) for tuning effects.
- Undo / Redo [partial] :: Header buttons plus global Ctrl+Z/Y that step through snapshots of the whole tool state.
- Export PNG [partial] :: Downloads the processed current frame as a PNG.
- Effect stack [works] :: An ordered list of effect layers, applied top to bottom. Each row has show/hide, up/down, duplicate, delete and drag-to-reorder; a Clear button empties the stack.
- Add effect menu [works] :: A dropdown of all 52 effects grouped under 8 category headings.
- Tab command palette [works] :: Press Tab anywhere to search effects by name or category. Arrows move the selection, Enter adds the effect.
- Selected effect: Opacity + Blend [partial] :: A per-layer opacity slider and one of 10 blend modes that mix the effect over the image coming into that layer.
- Selected effect: parameters [works] :: Sliders, colour pickers, toggles and dropdowns generated from each effect's param schema.
- Effects: Color & Tone (9) [works] :: Brightness/Contrast, Saturation/Vibrance, Hue/HSL, Levels, Tone (Lift/Gamma/Gain), Gradient Map, Split Tone, Solarize, Channel Mixer.
- Effects: Blur & Sharpen (6) [works] :: Gaussian, Motion, Radial/Zoom, Sharpen, Tilt-Shift, Bokeh.
- Effects: Lens & Camera (5) [works] :: Vignette, Chromatic Aberration, Lens Distortion, Prism Dispersion, Anaglyph 3D.
- Effects: Stylize (13) [works -> works: Stylize has 12 effects, not 13 (the reader's own list names 12). The total of 52 is still right. Per category: 9 colour, 6 blur, 5 lens, 12 stylize, 7 film, 6 distort, 4 datamosh, 3 light. All param keys are declared as uniforms of the right GLSL type and used in the shader (checked with node). Whether each shader compiles on the GPU was not checked.] :: Bloom, Pixelate, Posterize, Edge/Outline, Duotone/Tritone, Kuwahara oil paint, Cross-hatch, Cel shade, Stipple, Crystallize, Oil-slick iridescence, Photocopy.
- Effects: Film & Retro (7) [works] :: Film Grain, Static/Noise, Scanlines/CRT, Glitch/RGB Shift, VHS, Film Stock (6 emulated stocks), Analog Artifacts (weave, flicker, scratches, dust, burn).
- Effects: Distort & Warp (6) [works] :: Wave/Ripple, Twirl, Bulge/Pinch, Kaleidoscope, Droste spiral, Heat Haze.
- Effects: Datamosh & Glitch (4) [partial] :: Datamosh motion smear and P-frame blocks, which feed back the previous frame, plus Pixel Stretch and DCT compression blocks.
- Effects: Light & Atmosphere (3) [works] :: Light Leak/Gradient, God Rays, Caustics.
- Animation: Animate + Speed [partial] :: A global switch and speed multiplier that drive time for the animated effects in the live preview.
- Loop export: Duration, FPS, GIF, MP4/WebM [partial] :: Exports a loop of the animated stack for stills, or re-exports the processed GIF/video.
- Presets strip (31 built-ins in 4 groups + saved) [works -> partial: The 31 presets break down as Cinematic 7, Retro & Analog 8, Stylized 10, Lens & FX 6, and every override key is valid. The strip is not clean, though. Wheel-flipping also scrolls the panel (passive listener). On 'Custom', any wheel direction jumps to preset #1 and wipes the stack. Ctrl+Z right after saving deletes the saved preset. Saved presets cannot be renamed or overwritten. 16 of the 31 presets contain time-based effects that look frozen until Animate is on.] :: A grouped dropdown with prev/next arrows and scroll-wheel flipping that replaces the stack with the preset. Also has Save current as preset, Copy code and Delete for saved ones.
- Share codes [works] :: Copies the current stack as a 'PFX1.' text code and imports a pasted code as the new stack.
- Batch [partial -> partial: Add a lock-up. A TIFF, PSD or HEIC in the selection passes the image/* filter, then processFile never resolves. The batch waits forever with exporting='batch' and busyRef=true, so GIF, video and Batch stay disabled and the animation loop stays frozen until you switch tools.] :: Applies the current stack to several images, at t=0, and downloads a zip.
- Viewport HUD: Fit / 1:1 / zoom % [works] :: Fit-to-view and 100% buttons with a zoom readout. Scroll zooms; Space-drag or middle-drag pans.
- Before / After split [partial] :: A draggable divider that shows the original on the left and the processed image on the right.
- Timeline (GIF / video) [works -> works: For GIFs the readout shows percent played and the total frame count, not the current frame or time. After loading a second GIF while one is playing, the progress bar keeps the old GIF's duration (see missed problems).] :: Play/pause, a scrub bar and a time or frame readout under the viewport when a GIF or video is loaded.
- Incoming image from Dither / Lineart [partial] :: On mount, loads an image another tool left in localStorage, then clears it.
- (missed) Unsaved-changes tracking / quit warning [partial] :: Every store change marks Post FX dirty. Any export (PNG, GIF, video, batch) marks it saved. Electron shows 'You have unsaved changes' on close while something is dirty.
- (missed) Viewport info label + WebGL-unavailable notice [partial] :: The top-left HUD shows the file name and dimensions, plus a warning when WebGL2 could not start. If the engine fails, the canvas stays empty and the 'before' image shows through.
- (missed) GIF fallback without ImageDecoder [works] :: If ImageDecoder is missing, an animated GIF loads as a single still.
PROBLEMS:
- [confirmed/half-built] All output (PNG, GIF, video, batch) comes out at the working resolution, with the long edge capped at 1600 px. There is no full-resolution export path.
- [confirmed/bug] Alpha is discarded. Transparent pixels become black and every output is opaque. Lineart's default transparent output arrives as near-black lines on black.
- [confirmed/bug] Datamosh feeds back the final output of the whole stack. Every re-render (each slider tick) advances the smear, Export PNG adds one more step, effects below Datamosh compound every frame, and the preview steps per display frame while GIF export steps per exported frame.
- [confirmed/bug] The 'GIF loops seamlessly' hint is false for periodic and noise-driven effects. Time just wraps at Duration, so Wave, Heat Haze, Caustics, Analog weave and Scanline roll jump at the loop point, in the live preview as well as in exports.
- [confirmed/inconsistent] Preview and export disagree. With Animate off, the still preview is frozen but GIF/video exports still animate time-based effects. For loaded GIF/video, Speed is applied in preview but not in exports.
- [confirmed/ux-confusing] Animate is ignored while a GIF or video plays: media time drives the effects, and they snap to t=0 on pause. On stills, 13 time-based effects (in 16 of the 31 presets) look frozen until Animate is on, and the hint lists only some of them.
- [confirmed/bug] The Before/After cut lines up with the divider only when the image is centred and the split is at 0.5.
- [confirmed/bug] For GIF/video, the 'before' side is always the first frame.
- [confirmed/bug] Video export of loaded footage fires seeks without waiting and grabs whatever frame is currently decoded, so frames lag, repeat or stutter. Audio is always dropped. On Electron 29 the recording is probably WebM.
- [confirmed/ux-confusing] Duration is ignored for GIF/video exports of loaded media, and FPS is ignored when re-encoding a loaded GIF. The hint still says 'Video records Ns'.
- [confirmed/ux-confusing] The Batch button reuses the Import picker, so picking one file just loads it. Batch drops videos, uses only the first frame of GIFs, renders at t=0 and applies the 1600 px cap.
- [confirmed/inconsistent] Dropping several files makes a batch zip here, while Dither turns them into an animated frame sequence. A render sequence dropped here is processed as unrelated stills.
- [confirmed/bug] The 'Dodge' blend mode always returns the base image, so the layer has no visible effect.
- [confirmed/bug] Undo snapshots include the saved-preset library and layer selection. Clicking a layer adds an undo step and marks the tool dirty. The Undo button stays greyed out after an edit because the debounced push never triggers a re-render.
- [confirmed/ux-confusing] Switching tools unmounts Post FX. The loaded image/video is lost, but the module-level stack remains. A reload loses the stack too.
- [confirmed/disconnected] The hand-off from Dither/Lineart is silent and one-way. No tool switch, no confirmation, write failures are swallowed, and the file is always named 'from-dither.png'.
- [confirmed/ux-confusing] Wheel over the preset row flips presets and replaces the stack, and the panel scrolls too because React's wheel listener is passive.
- [confirmed/duplicated] The panel has two near-identical copy-code buttons.
- [confirmed/duplicated] Dither & Halftone has its own post-processing panel and engine that overlap Post FX, and its animated post FX are preview-only.
- [confirmed/bug] Some inputs fail with no message: SVG is ignored, and an undecodable video (e.g. ProRes .mov) only logs to the console.
- [plausible/bug] Every stack change during video playback tears down the playback effect, which pauses and then replays the video.
- [confirmed/bug] GIF export keeps every frame as a full-size canvas with no cap, so long videos or 10 s at 60 fps can exhaust memory.
- [confirmed/duplicated] The effect library overlaps itself: several Saturation and Gamma controls, and Glitch filed under Film & Retro instead of Datamosh & Glitch.
- [confirmed/dead-code] Dead code: unused icon fields, unused imports (EditableNumber, resetState), a Reset with no UI, and lib/export.js not used here.
- [confirmed/inconsistent] Vignette 'Roundness' is inverted: 1 gives an oval stretched to the frame, 0 a true circle.
- [missed/bug] Pasting an image while Animate is off shows it processed with the stack from when Post FX was opened (often empty), not the current stack, until you touch a control. Export PNG calls the current render, so the file differs from what the preview showed.
- [missed/bug] TIFF, PSD and HEIC files never finish loading, with no message. In Batch they lock the tool: exporting stays 'batch', GIF, video and Batch buttons stay disabled and the animation loop stays frozen until the tool is remounted. These are common render formats from C4D/Corona.
- [missed/limitation] The pipeline is 8-bit and clamped at every pass. Each effect in the stack re-quantises to 8 bits, so stacked grades band. Bloom, exposure and god rays have no highlight headroom, and blurs and bloom run in gamma space, not linear.
- [missed/ux-confusing] The HUD reports the capped working size as the image size. A 3840×2160 render reads '1600×900', and nothing says it was reduced.
- [missed/ux-confusing] Keyboard use is broken across the tool. Tab opens the effect palette from any focused slider, colour input, select or button, so Tab focus navigation is impossible. Space is swallowed on focused buttons and selects. Toggles and stack-row icons are spans with onClick and cannot be focused.
- [missed/performance] During GIF/video playback the whole Post FX component, including the right panel, stack and effect controls, re-renders on every animation frame. The Animate loop also re-renders the full stack at display rate even when no effect uses time.
- [missed/bug] Dropping an image file on a stack row reorders layers (moves the top layer) instead of loading the file. A drop anywhere else in the right panel is unhandled. With no global dragover guard and no will-navigate handler, Electron's default navigates the window to the file, losing the session without the unsaved-changes prompt.
- [missed/bug] If an effect's shader fails to compile on the user's GPU, the engine silently substitutes a pass-through shader. The layer sits in the stack with working sliders and does nothing.
- [missed/bug] Transparent animated GIFs probably ghost. Each decoded frame is drawn onto a persistent canvas that is never cleared, but ImageDecoder already returns fully composited frames, so earlier frames show through transparent areas.
- [missed/bug] Loading a second GIF while one is playing does not restart the playback loop: React batches setPlaying(false) and setPlaying(true), and mediaKind stays 'gif'. The old closure keeps the previous GIF's length for the progress bar and the old start time.
- [missed/bug] Export failures are silent. Nothing in exportGif, exportVideo or runBatch catches errors from encodeGif, MediaRecorder, toBlob or zip, and exportVideo restores playback only on success.
INTENT Q:
- Is Post FX meant as a finishing pass for stills (posters, render stills), or as a footage/loop tool for C4D and AE work? The code half-does both: 1600 px cap, WebM video, no PNG-sequence export.
- Dither & Halftone has its own post-processing panel (bloom, CRT, grain, glitch, VHS…). Should that panel go, so Dither always hands off to Post FX, or should Post FX absorb Dither?
- When you drop many files, did you mean a batch of separate images (what Post FX does) or a frame sequence such as a render (what Dither does)?
- Should exports be at the original full resolution and keep transparency (alpha from renders, transparent lineart)?
- Was Datamosh meant only for video and GIFs, or should it also give a stable, repeatable look on a still?
- Should animation be one global Animate switch, or set per effect with loop-safe timing like Dither's modulators, so every GIF loops cleanly?
- After 'Send to Post FX', should the app jump to Post FX automatically? And should Post FX be able to pass its result on (to Motion Maker, or back to Dither)?
- The Motion Maker spec planned to 'port selected PostFX effects into nodes'. Should one shared effect library drive both tools?
- Should the colour-driven effects (Gradient Map, Duotone, Split Tone, Light Leak) take their colours from Color Palette the way Dither does?
- Keep all 52 effects, or trim to a curated set? Several overlap (three Saturation controls, three Gamma controls).
- Is the Debug test card for your own tuning, or a feature for users?
- Which file types come out of your render pipeline: PNG only, or TIFF, PSD or EXR from Corona/C4D? Right now TIFF, PSD and HEIC hang silently. Do you need 16-bit or linear-light processing so stacked grades don't band?
- Should the working stack survive an app restart, and should the loaded image survive switching tools? Right now the stack survives a tool switch but not a reload, and the image survives neither.
- Do you want per-effect masks or regions (luma matte, gradient, drawn mask) like AE adjustment layers, or is whole-frame only fine?
- For Before/After, do you want only 'original vs final', or a way to solo or bypass a single layer to judge what that one effect adds?
- The live preview auto-plays flicker and strobe effects (Analog flicker, Scanline flicker, Static/Noise) once Animate is on. Should animated preview be opt-in per effect, or scrub-only, rather than running continuously?
- Should saved presets be manageable (rename, overwrite, reorder, export as a file), or is 'save as new + share code' enough?
- Is keyboard-first use (Tab to search effects) important to you? The rewrite needs to decide between a hotkey that doesn't break normal Tab focus movement and dropping it.
CROSS:
- Receives images from Dither & Halftone ('Send to Post FX', DitherTool/index.jsx:17, 635-639, 1129) and Scan to Lineart (the 'Post FX' button, LineartTool/index.jsx:6, 357-361, 483). Both write a PNG dataURL to localStorage key 'designtools-shared-image' (PostFX/store.js:13, 202-208), which Post FX reads once on mount (index.jsx:81-84). Neither sender switches tools; the user must click Post FX in the sidebar.
- Nothing goes out of Post FX: there is no send to Motion Maker, Dither, Pattern Maker or Logo Maker. It is a dead end in the pipeline.
- Color Palette's sendToTool targets only logo-maker, pattern-maker and dither-maker (ColorPalette/index.jsx:176-180). Post FX's colour-driven effects (Gradient Map, Duotone, Split Tone) cannot receive a palette.
- Heavy duplication with Dither & Halftone: Dither has its own Post-processing panel with its own engine (DitherTool/index.jsx:1135-1191, lib/glDither.js post pass) covering bloom, CRT/scanlines, vignette, chromatic aberration, streaks, edge outline, wave, VHS, glitch, grain and grade.
- Halftone is deliberately left out of Post FX because Dither owns it (effects.js:17).
- Motion Maker has a third set of effects implemented as SVG filters (glow, glitch, blur, tint, dither nodes: MotionMaker/render.jsx:64-110, nodes.js:737-785, 875). Its design spec planned to 'port selected PostFX effects into nodes' (docs/superpowers/specs/2026-06-14-motion-maker-design.md:152), which was never done.
- Export code is copied three times: pickVideoMime/MediaRecorder in PostFX index.jsx:388-393, DitherTool/index.jsx:766-771 ('same approach as the Post FX tool's video export') and MotionMaker/exporters.js:57-75. All three share lib/gif.js encodeGif.
- Post FX has no PNG-sequence/frames ZIP export, although lib/gif.js framesToZip exists and Dither (DitherTool/index.jsx:756-763) and Motion Maker (exporters.js:10) both use it.
- Dropping several files means batch here but a frame sequence in Dither (DitherTool/index.jsx:133-136).
- Two animation models side by side: Post FX has a global Animate + Speed; Dither has LFO modulators with integer cycles per loop (DitherTool/index.jsx:1194-1218).
- Shared infrastructure: lib/undo.js (global Ctrl+Z), lib/unsavedChanges.js (markDirty/markSaved), and the module-level store pattern, which Motion Maker copied (MotionMaker/store.js:3). Motion Maker also copied the Tab command palette (MotionMaker/Graph.jsx:208) and the pan/zoom viewport model (MotionMaker/Stage.jsx:2).
- lib/export.js (SVG→PNG, favicon/ICO) is not used by Post FX.
- The old outputs in 'export test' (Screenshot-…-fx.png ×2, debug-testcard-loop.gif, image-loop.gif, postfx-batch.zip) show the PNG, still-loop GIF and Batch paths were exercised. There are no video exports there.

## Scan to Lineart
IDEA: You drop in a photo or scan of a pencil or ink sketch. The tool removes the paper, uneven lighting and dust and gives back clean line art in a colour you choose, as a transparent or solid-background PNG, a filled-outline SVG, or a clipboard copy. It tunes itself when the image loads, so the main job is "drop sketch, tweak three sliders, export". The full cleanup chain sits behind a Fine-tune toggle.
IDEA_CORR: 
OUTPUTS: PNG at full scan resolution. Transparent, white or custom background. In Clean-vector mode it is rendered from the traced shapes; in Keep-texture mode it is the raster alpha (index.jsx:310-336) | SVG: a single compound <path> of filled outlines (evenodd), not centreline strokes, with an optional background rect. Traced at up to 2200px (index.jsx:337-347, lineart.js:272-281) | Copy: a full-resolution PNG on the clipboard (index.jsx:348-356) | Send to Post FX: a full-resolution PNG data URL left in localStorage for Post FX to pick up the next time it opens (index.jsx:357-362, PostFX/store.js:202-207) | Settings persist in localStorage under 'designtools-lineart'. The image itself does not persist (store.js:9, 88-90)
SIZE: About 1,170 lines in total. src/tools/LineartTool/index.jsx is 643 lines: about 280 of pipeline, viewport and export logic, about 200 of panel JSX, and about 75 of inline style and UI helpers copied from other tools. store.js is 112 lines of boilerplate copied from the Post FX and Dither stores. src/lib/lineart.js is 413 lines: a pure, self-contained pipeline (grey, flatten, levels, threshold, despeckle, weight, smooth, marching-squares trace with RDP and Chaikin) that is tidy and reusable, with one dead export (traceSvg). Nothing is badly bloated; the cost is the duplicated shell code. There are 2 commits (2026-06-10, 2026-06-15) and no uncommitted changes.

FEATURES:
- Empty-state drop zone (Open image / drop / paste) [partial -> partial: The failure modes are worse than 'ignored'. A TIFF (image/tiff) passes the image/* check and then hangs for good, because processFile's Image has no onerror and its promise never settles. HEIC phone photos probably behave the same way. A PDF cannot be picked in the Open dialog (accept=image/*) and returns silently on drop. An SVG is parsed as SVG and then dropped silently. A PNG with a transparent background loads, but the result is blank or a solid block (see missed problems).] :: Blank viewport that asks you to drop, paste or open a photo or scan of a sketch.
- Original / Lineart view toggle + size/zoom readout [works] :: Flips the viewport between the untouched source and the processed result, and shows pixel size and zoom.
- Pan / zoom viewport [works -> partial: Wheel zoom, middle-drag and fit-on-load all work. Two parts of the claim do not hold. (1) Vector previews do not stay sharp at every zoom level: the repaint scale is capped at 4x a 1600px trace, so above 400% zoom on a 1x display the preview is CSS-upscaled and soft (max zoom is 4000%). (2) Space-drag stops working after you touch any slider or colour picker. The range input keeps focus, and the space handler ignores keys while an INPUT is focused, so you have to click somewhere else before space-pan works again.] :: Wheel zooms around the cursor, and space-drag or middle-drag pans. The view fits to the window on load, and vector previews repaint sharp at every zoom level.
- Header: Undo / Redo / Reset settings [partial -> partial: On top of the reader's points: Reset also resets line colour, background and Clean/Keep mode. Pressing Ctrl+Z within 350ms of a change skips a step and wipes redo, because the pending debounced snapshot fires after the undo and records the undone state.] :: Steps back and forward through settings history (also Ctrl+Z/Y), or puts every setting back to its default.
- Source (Open/Replace image + filename) [works] :: Loads or replaces the scan and shows its filename.
- Quick adjust: Auto adjust [partial] :: Analyses the image and sets invert, black/white points, a threshold from the image histogram (Otsu), and resolution-scaled cleanup. It also runs by itself on every image load.
- Quick adjust: Line pickup [partial] :: Global threshold: higher values catch fainter lines.
- Quick adjust: Cleanup [partial] :: One macro slider that drives Despeckle size and Edge smooth together, scaled to scan resolution.
- Quick adjust: Line weight [works -> partial: The core dilate and erode works in Clean-vector mode, but the change is about N px per side, so the stroke width changes by about 2N. In Keep-texture mode any value other than 0 binarises the alpha first, which destroys grain and pressure (the reader says this in its own problem list, which contradicts 'works'). At +4 at native scale (the full-res raster export, or scans of 1600px or less), the threshold clamp leaves a flat haze of about 6% alpha over the whole background. Edge smooth hides it, but it shows once Edge smooth is 0.] :: Thickens or thins strokes by roughly N pixels (-4 to +4).
- Output: Line colour / Background (None, White, Colour) [works] :: Picks the ink colour and whether the result has a transparent, white or custom background.
- Export: PNG [works -> works: It downloads at native pixel size, but in Clean-vector mode (the default) the detail comes from a trace capped at 2200px that is then rendered up to native size. For scans over 2200px, 'full scan resolution' is only true of the pixel count, not the detail. Only Keep-texture runs the pipeline at native size.] :: Downloads the result at full scan resolution.
- Export: SVG [works] :: Downloads the traced outlines as one filled compound path.
- Export: Copy [works] :: Puts a full-resolution PNG on the clipboard.
- Export: Post FX [partial] :: Hands the result to the Post FX tool.
- Fine-tune toggle [works] :: Shows or hides the full pipeline controls below.
- Fine-tune > Input: Channel (Luma/Red/Green/Blue) + Invert [partial] :: Chooses which colour channel becomes the line source (Blue drops non-photo-blue pencil) and whether the scan is white-on-dark.
- Fine-tune > Paper clean-up: Flatten (Radius, Strength) + Despeckle + specks count [partial] :: Divides out paper shading and uneven light, and deletes ink islands smaller than N px²; shows how many specks were removed.
- Fine-tune > Levels: Black point / White point / Gamma + Auto levels [works] :: Manual levels on the flattened grey image, plus a one-click black/white-point suggestion.
- Fine-tune > Line extraction: Mode Smooth / Hard / Adaptive (+ Threshold, Softness, Block size, Sensitivity) [works] :: Decides which pixels count as ink: a soft ramp, a hard cut, or a comparison against the local average for faint lines.
- Fine-tune > Line quality: Result Clean vector / Keep texture (+ Edge smooth, Simplify, Round corners) [partial] :: Chooses traced smooth shapes or raster output that keeps pencil grain, and tunes edge smoothing, path simplification and corner rounding.
- (missed) Busy indicator during exports [works (but the pipeline runs synchronously on the UI thread, so the window freezes behind it)] :: Shows 'Processing full resolution…' at the bottom left and disables the export buttons while the full-size pipeline runs.
- (missed) Type-in values on every slider [works (typed values are clamped to the slider max, which is what cuts the Cleanup-driven Despeckle values)] :: Every slider's number can be clicked and typed into. Arrow keys step the value and Shift steps it by 10x. This comes from the shared NumberSlider/EditableNumber component.
- (missed) Pixel-exact zoom in Keep-texture mode [works] :: Above 300% zoom the raster preview switches to nearest-neighbour (pixelated) rendering, so you can inspect the actual pixels.
- (missed) Drag-over highlight [works (it can flicker, because dragleave fires when the pointer crosses child elements)] :: A dashed accent outline appears on the viewport while a file is dragged over it.
PROBLEMS:
- [confirmed/bug] With the default settings the Lineart preview is almost invisible: #1a1a1a lines on a #26262c/#1b1b20 checkerboard, because the default background is None.
- [confirmed/bug] TIFF (and other formats Chromium cannot decode) hangs silently. SVG and PDF are rejected silently.
- [confirmed/disconnected] Switching tools throws away the loaded scan, because only the active tool is mounted.
- [confirmed/half-built] The Post FX button writes a full-res PNG into localStorage with no navigation and no feedback, the write can fail silently, and Post FX reads it only on mount, downscales it to 1600px and names it 'from-dither.png'.
- [confirmed/bug] 'Keep texture' does not keep texture. Edge smooth re-thresholds around 0.5 (0.3 goes to 0, 0.6 goes to 0.87), and any Line weight binarises the lines.
- [confirmed/inconsistent] Each image load and each Auto adjust overwrites channel (to Luma), mode (to Smooth), Flatten (to on), levels, threshold, despeckle and smoothing. The analysis always uses Luma at flatten strength 1.
- [confirmed/bug] Paper flattening hollows out large solid ink areas.
- [confirmed/duplicated] 'Line pickup' and 'Threshold' are the same setting, and Line pickup does nothing in Adaptive mode.
- [confirmed/bug] The Cleanup macro pushes Despeckle past the slider's max of 120 on scans over about 3400px, the Cleanup value goes stale, and the defaults don't match cleanup 30.
- [confirmed/inconsistent] On scans over 1600px the preview does not match the exports (Edge smooth has a 1px floor, the trace size differs, Simplify is unscaled), even though the hint says preview, PNG and SVG share the shapes.
- [confirmed/inconsistent] SVG and PNG export at different pixel sizes.
- [confirmed/ux-confusing] In Keep-texture mode the SVG export uses the Simplify and Round-corner values that the panel hides in that mode.
- [confirmed/ux-confusing] 'Reset settings' restores generic defaults (and closes Fine-tune), while 'Auto adjust' is the useful reset.
- [confirmed/bug] Opening or closing Fine-tune is recorded in undo history.
- [confirmed/bug] The close-window unsaved warning is unreliable: it is set only on image load, cleared by PNG/SVG export, never set again by later edits, and left set after a tool switch drops the scan.
- [confirmed/bug] Invert detection samples four single corner pixels, so dark corners flip the result.
- [confirmed/ux-confusing] Copy gives no confirmation, and failures only go to the console.
- [confirmed/dead-code] traceSvg is dead code that the header comment still names.
- [confirmed/duplicated] Store, pan/zoom, panel helpers, download helpers, hexToRgb and levels are copied from other tools.
- [missed/bug] A PNG with a transparent background (a digital sketch exported from Procreate, or this tool's own transparent export fed back in) comes out blank or as a solid block. toGray reads only RGB and ignores alpha, and the source is drawn onto an unfilled canvas. Transparent pixels read as (0,0,0), which is 'black ink'. The four corners then read 0, so auto-invert switches on. Black lines on transparent become one uniform field with nothing to separate.
- [missed/bug] Pressing Ctrl+Z within 350ms of a change jumps back two states and destroys redo. The debounced snapshot is not cancelled by undo(), so when it fires it truncates history at the new index and pushes the undone state as a duplicate. The same code is in the Post FX and Dither stores.
- [missed/ux-confusing] Space-drag panning silently stops working after you use any slider or colour picker, because the focused range or colour INPUT makes the space handler bail out.
- [missed/bug] Loading a second image with the same name and the same pixel size can leave the old result on screen. The preview effect is keyed on the settings plus name+w+h. Chromium names every pasted clipboard image 'image.png', so two same-size pastes whose auto-tune produces identical quantised levels and threshold never re-run the pipeline. Switching Original and Lineart forces a refresh.
- [missed/performance] Full-resolution exports run the whole pipeline synchronously on the UI thread at native size (Keep-texture always, and Clean-vector up to 2200px). On an A4 600dpi scan (about 35M px) despeckle alone allocates about 315MB (Uint8 plus two Int32 arrays), alongside several 140MB Float32 buffers from blur, flatten and levels. The window freezes and may run out of memory. The 'Processing…' label cannot update while it runs.
- [missed/performance] Changes that only need a repaint re-run the whole downstream pipeline, including the vector trace: line colour, background mode and colour, and even opening or closing Fine-tune. The preview effect is keyed on the entire state object.
- [missed/bug] Line weight +4 at native scale leaves a faint haze of line colour (about 6% alpha) over the whole background, visible in a Keep-texture PNG when Edge smooth is 0.
INTENT Q:
- Should the SVG be filled outline shapes (what you get now, one compound path) or centreline strokes you can restyle, and animate with Trim Paths in AE or Motion Maker?
- When you load a new scan, should the tool auto-tune everything (current) or keep your last recipe, e.g. a Blue-channel non-photo-blue setup?
- Is this for pencil sketches only, or also inked drawings with solid black fills? Paper flattening currently hollows out large blacks.
- With 'Keep texture', did you want real pencil grain and pressure kept, or just a raster version of the clean line?
- Should 'Post FX' jump straight into Post FX with the image, and should the scan still be here when you come back?
- Should the traced line art also feed Logo Maker, Pattern Maker (as a motif) or Motion Maker directly? All three already accept SVG files.
- Should the quick 'Line pickup' slider always control whichever line mode is active (including Adaptive), or should the modes be simplified?
- Do your scans come as TIFF, PDF or high-DPI files, and do you need the exports to keep the physical size or DPI (SVG and PNG at the same size)?
- Is this meant to stay its own tool, or become a mode of Dither & Halftone, which already has levels, a threshold algorithm and vector export?
- Do you ever feed it digital drawings with a transparent background (Procreate or PNG exports), or only paper scans and phone photos? Transparent PNGs currently come out blank.
- Do your phone photos need a crop, rotate or perspective-correction step before cleanup? Photos taken at an angle, or with a table edge in shot, currently break auto-invert and leave borders as ink.
- Would you want a manual touch-up brush or eraser for smudges and stray marks that despeckle can't catch, or should cleanup stay fully automatic?
- Should one recipe apply to a batch of scans, e.g. a sketchbook's worth of pages at once, or is it always one drawing at a time?
- Do you need more than one line colour kept apart (for example red or blue construction lines and black ink as separate layers or colours), or is a single flat line colour always enough?
- When you pick 'Keep texture', what should the SVG button do: be hidden, or export an embedded raster instead of a traced outline?
CROSS:
- Post FX: one-way hand-off through localStorage key 'designtools-shared-image' (index.jsx:6, 357-362 → PostFX/store.js:202-207). Post FX reads it only when it mounts (PostFX/index.jsx:81-84) and names it 'from-dither.png'. Its 1600px working cap throws away the full-res render (PostFX/index.jsx:26, 116). There is no auto-navigation.
- Dither & Halftone: sends to Post FX the same way (DitherTool/index.jsx:635-639). There is no Lineart→Dither link, although line art is a natural input for halftoning. The two tools overlap: both have levels (lib/dither.js vs lib/lineart.js), a threshold or hard mode, vector export, and copy-pasted viewport, pan/zoom and panel helpers.
- Logo Maker: accepts SVG/PNG through processFile (LogoMaker/FileSlot.jsx:13-18, 55), so a traced hand-drawn mark is an obvious input, but the only route is export then re-import.
- Motion Maker: its Inspector accepts image/SVG (MotionMaker/Inspector.jsx:87, 101-102). There is no direct link, and the outline-only SVG could not be stroke-animated anyway.
- Pattern Maker: the Shapes tab takes .svg (PatternMaker/ShapesTab.jsx:128). There is no link to use a traced motif as a tile.
- Color Palette: no link. Line and background colours come from the native colour picker, not from a palette.
- Shared code: lib/file.js processFile (shared by every tool, missing the image-error path), components/NumberField.jsx, components/Icon.jsx, lib/undo.js useGlobalUndo, lib/unsavedChanges.js. The app shell (App.jsx:99) mounts one tool at a time, so no tool keeps its loaded image across a switch.

## Motion Maker
IDEA: A node-based logo animator. You bring in an icon and a wordmark (usually sent over from Logo Maker as a finished lockup), pick an animation preset or wire up nodes that drive position, scale, opacity and so on over time, scrub it on a frame timeline, and leave with a GIF, a transparent PNG sequence or a video. Over about a week it grew into a general 2D motion-graphics node sandbox with 73 node types (particles, text scramble, counters, physics, effects), and most of those have nothing to do with the logo presets.
IDEA_CORR: Mostly right, but the history is wrong. It is a node-based logo animator: you bring in an icon and a wordmark (usually sent from Logo Maker's 'Send to Motion Maker' as a lockup), pick one of 9 presets or wire value nodes into properties, scrub a frame timeline, and export a GIF, a transparent PNG sequence or a video. It was built in two days, not a week: all 17 code commits are dated 2026-06-15 and 2026-06-16, in 26 'waves'. The '06-21' date appears only in the uncommitted handoff edit. In those two days it grew into a general 2D motion-graphics node sandbox with 73 node types, of which the presets use 12.
OUTPUTS: Animated GIF of the whole frame range, 1080x1080, flattened onto a matte colour (lib/gif.js) | ZIP of numbered transparent PNG frames (motion-001.png ...) | Video (.mp4 or .webm, whichever MediaRecorder supports), recorded in real time onto the matte colour, with no alpha | Project JSON written to app data sessions/motion-maker.json (one slot, overwritten on each save; there is no file picker) | Saved presets (whole-document snapshots in localStorage) | Not available: Lottie, ffmpeg MP4, SVG export, single-frame PNG, sending to another tool
SIZE: About 4,100 lines in 11 files: engine.js 1,282 (all 73 node behaviours in one file), nodes.js 899 (node schema tables), store.js 346, Graph.jsx 329, index.jsx 327, render.jsx 311 (two hand-synced renderers, one SVG-string for export and one JSX for preview), Inspector.jsx 180, presets.js 177, exporters.js 90, Stage.jsx 89, Timeline.jsx 89. There are also 822 lines of spec and handoff docs. It was built in about a week (2026-06-15 to 06-21) in 26 'waves' that each added nodes, so the catalogue is wide but shallow: 73 node types (the handoff says 64, which is stale), and only 12 are used by any preset. The handoff's uncommitted edit says feat/motion-maker-rigging has 9 unpushed commits, but that branch is already in origin/main, so that line is wrong. Verified with node against a scratch copy of engine.js: Motion Blur opacity, Color Swatch rgba into Tint, Shatter on Text, Sequencer ease, Split spacing, Feel on Map Range, and the loop seam.

FEATURES:
- Logo hand-off from Logo Maker [works] :: When you open Motion Maker after pressing 'Send to Motion Maker', it builds a fresh graph with your icon and wordmark placed as the same lockup and switches to the Stage view.
- Presets strip (‹ dropdown ›, scroll to flip) [partial] :: Picks one of 9 built-in animations (Pop & Settle, Fade + Scale In, Slide In, Idle Breathing Loop, Echo Trails, Dither Resolve, Glitch In, Shatter Assemble, Camera Push-In), which rebuilds the graph around your current logo and starts playing.
- Save current as preset / delete saved preset [partial] :: Stores the whole current document under a name so you can pick it later from the same dropdown.
- Arrange lockup [partial] :: Repositions the icon and wordmark source nodes into an icon+wordmark lockup.
- Reset [works] :: Replaces everything with the starter graph (empty Icon + Wordmark wired to Scene).
- Project: Save project / Load [works] :: Writes or reads the whole graph and timeline to one fixed save slot in the app's data folder (localStorage in a browser).
- Inspector (selected node) [works] :: Shows the selected node's controls: sliders with typed numbers, dropdowns, hex colours, text fields, delete button. Properties driven by a wire are dimmed and marked with a diamond.
- Image drop zone (Icon / Wordmark nodes) [works] :: Drop or browse an SVG/PNG into the node. When both images are set and untouched, they auto-arrange as a lockup.
- Keyframes table [partial -> partial: Each row's Ease shapes the segment arriving at that key, so the first row's Ease never does anything. 'Add key' copies the value of the last row in list order, not of the latest frame.] :: Edits keys as rows of frame / value / ease with add and remove. Keyframes and Sequencer nodes both use it.
- Timing / Readability findings [works] :: While a Timing Check node is selected, lists warnings such as 'moves too fast to track', 'off-canvas most of the time' or 'almost no movement'.
- Export: Matte colour [works] :: Sets the solid background colour that GIF and video are flattened onto.
- Export: GIF [works] :: Renders every frame in the range and encodes a looping GIF.
- Export: PNG seq [works] :: Renders every frame with transparency and downloads them as a ZIP.
- Export: Video [partial] :: Plays the frames onto a hidden canvas in real time and records it as MP4 or WebM.
- Lottie + ffmpeg MP4 note [stub] :: Placeholder text promising Lottie and true MP4 export later.
- View tabs: Split / Stage / Graph [works] :: Shows the preview, the node graph, or both side by side with a draggable divider.
- Undo / Redo buttons (and Ctrl+Z / Ctrl+Y) [partial] :: Steps back and forward through whole-document snapshots.
- Stage (live preview) [works] :: Shows the current frame on a checkerboard artboard. Drag to pan, scroll to zoom, with Fit and 1:1 buttons. It is view-only: nothing on it can be clicked or moved.
- Graph editor [partial] :: React Flow canvas of nodes. Blue wires carry objects from Sources through Modifiers into the Scene; green and pink wires carry numbers and colours into property sockets. Each node has a mute (bypass) button, and Delete removes the selected node.
- Tidy [works] :: Auto-arranges all nodes in left-to-right columns by dependency.
- Add node palette (Tab / Add button) [works] :: Searchable list of all 73 node types, with '!' to filter by category. The picked node appears unconnected in the middle of the view.
- Sticky notes [works] :: Yellow comment boxes with editable text in the graph.
- Timeline / transport [works] :: First, back, play/pause, forward, last and loop buttons; a scrub bar; frame / seconds / fps readout (fps editable); editable start–end frame range; Space and arrow-key shortcuts.
- Timeline markers [works] :: Marker nodes show as coloured flags on the scrub bar. Clicking one jumps to that frame.
- Nodes: Sources (Icon, Wordmark, Shape, Text, Counter/Ticker, Backdrop, Path, Null/Anchor) [works] :: Things that appear on screen: logo images, rectangles and ellipses, live text, counting numbers, a full-canvas solid or gradient plate, a raw SVG path, and an invisible parent for rigs.
- Nodes: Arrange & transform (Transform, Parent/Pin, Array, Mirror, Align/Distribute, Motion Path, Magnet, Orient, Camera, Sort, Switch, Reroute) [works -> partial: Rotate does not pivot on the canvas centre. Transform turns each object about its own centre, and only scale (with position) is taken about the canvas centre. Mirror only reflects position and negates rotation, so the artwork is never actually flipped. Motion Path writes the same absolute x/y into every object, so an icon and wordmark sent through it land on top of each other. It also offers only 4 fixed curves (line, circle, arc, wave), not a drawn path.] :: Move, copy, mirror, align, orbit, aim, camera-move, reorder or route objects. Scale and rotate always pivot on the canvas centre.
- Nodes: Motion behaviours (Wiggle, Physics/Gravity, Clip In-Out, Effector, Stagger) [works] :: Add noise shake, drop and bounce, timed in/out transitions, a mograph-style falloff wave across copies, and per-copy delay cascades.
- Nodes: Text tricks (Split, Scramble/Decode) [partial] :: Split live Text into per-letter or per-word pieces, or cycle random glyphs that settle into the word.
- Nodes: Shape tricks (Round Corners, Trim Paths, Mask/Reveal) [partial] :: Round rectangle corners, draw a Path stroke on and off, or clip everything to a fixed rectangle or ellipse window.
- Nodes: Time modifiers (Echo/Trails, Stop-Motion/Strobe, Loop/Boomerang, Time Remap, Motion Blur) [partial] :: Re-time everything upstream: ghost trails, choppy stepped frames, looping, freeze/reverse/speed ramps, and sub-frame motion smear.
- Nodes: Generators (Particle System, Shatter/Assemble) [partial -> partial: Add: the Particle System replaces its input, so the original object disappears and only particles remain. Shatter pieces also lose any upstream Mask, Trim or Round Corners, because a piece copies only blend and fx.] :: Emit copies of an object as particles, or break it into a grid of flying pieces (run backwards to assemble).
- Nodes: Appearance (Tint, Blur, Glow, Drop Shadow, Stroke/Outline, Blend Mode, Dither, Glitch, Gooey) [partial -> partial: Add: effects are keyed by object id. When one source branches into two chains (for example one copy blurred and one tinted), both objects keep the source's id, both filters get id fx_<id>, and both copies render with the first chain's filter.] :: SVG-filter effects stacked per object, plus one scene-wide liquid 'goo' filter.
- Nodes: Value drivers (Ramp, LFO, Spring, Keyframes, Sequencer, Constant, Time, Noise, Pulse/Beat, Random Hold) [works -> partial: The reader's own evidence shows a dead control: the Sequencer's Ease column does nothing. Spring also runs in seconds (it uses fps) while Ramp, Keyframes, LFO and Pulse run in frames, so changing fps retimes springs differently from everything else.] :: Produce a number that changes over frames. Wire one into any property socket to animate that property.
- Nodes: Colour values (Color Swatch, Gradient Map, Brand Palette) [partial] :: Produce a colour, fixed, blended from a 0–1 input, or held/cycled/randomised from five hand-entered brand colours, to wire into colour sockets.
- Nodes: Operators (Math, Map Range, Curve/Shaper, Mix, Clamp/Quantize, Delay, Sample & Hold, Expression) [works -> partial: Delay and Sample & Hold look up their input driver directly and ignore whether that driver is muted, so a bypassed Ramp still drives through them. Map Range and Curve are also bent by the Feel node.] :: Combine and reshape value wires: arithmetic, remapping, easing, blending, stepping, time-shifting, and a safe typed formula.
- Nodes: Graph-wide dials (Feel/Personality, Seed/Shuffle, Timing Check) [partial] :: Feel pushes every ease toward a character (snappy/smooth/bouncy/mechanical/organic). Seed re-rolls all randomness at once. Timing Check critiques the animation.
- Bypass / mute per node [works -> partial: Mute works in the object flow and for direct value wires. It leaks through Delay and Sample & Hold, and a muted Timing Check still shows its findings.] :: Header button that switches a node off without deleting it. Upstream objects pass through, and a muted source disappears.
- Autosave [works] :: Every change is written to localStorage, and the last document is restored on launch.
- (missed) Resizable left panel [works] :: The Presets/Project/Inspector/Export column can be dragged between 240 and 460 px wide. This is separate from the Stage/Graph split divider.
- (missed) Live node cards [works] :: Each graph node shows a one-line summary for value nodes (e.g. '0→1 · f0-30'), the current value per socket row, a diamond when a row is driven by a wire, colour chips, and a thumbnail on image nodes.
- (missed) Typed wiring with one driver per property [works] :: Colour outputs only plug into colour sockets and numbers into number sockets. Plugging a new driver into an already-driven property replaces the old wire, which is the only way to swap a property wire.
- (missed) Keyframes extrapolation [works] :: Before the first key and after the last, Keyframes can hold, loop or ping-pong.
- (missed) Preset position / 'Custom' readout [partial] :: The strip shows 'n / total · Built-in/Saved' and switches to 'Custom' after a structural or parameter edit. Changing fps, frame range, Arrange lockup or Tidy does not count as an edit, so the preset name stays.
PROBLEMS:
- [confirmed/inconsistent] Picking a built-in preset keeps only the icon and wordmark images and their source transforms. Everything else is deleted (Text, Shape, Backdrop, effects), and fps, range and canvas reset to 30 fps / 0–90 / 1080x1080.
- [confirmed/bug] Mouse-wheel over the preset strip applies a new preset on every tick, replacing the graph, and preventDefault doesn't stop the panel scrolling.
- [confirmed/ux-confusing] Sending a logo from Logo Maker silently replaces the current graph (undo can recover it).
- [confirmed/bug] The 'Arrange lockup' button always uses the default horizontal layout, because the incoming layout is never stored. A vertical lockup sent from Logo Maker goes horizontal when pressed. The auto-arrange paths also use horizontal, but they fire only for untouched images, so presets keep a sent lockup.
- [confirmed/inconsistent] Saved presets are whole-document snapshots, including the images they were saved with. Applying one to a new logo brings back the old logo.
- [confirmed/inconsistent] Reset also deletes the logo images (tooltip says 'Reset graph'), while presets keep them.
- [confirmed/half-built] The logo cannot be split into letters or drawn on. Logo Maker sends only a flat image, Split works only on typed Text, Trim only on Path nodes, and the spec's 'Slide + Letter Stagger' and 'Stroke Draw-On' presets were never built.
- [confirmed/bug] Wires cannot be selected or deleted, and reconnecting is not enabled. They go away only when a node is deleted, or when a property wire is replaced by plugging in another driver.
- [confirmed/bug] The Scene node can be deleted with Delete/Backspace, which blanks preview and export, although the Inspector hides its delete button. A second Scene can be added but is ignored.
- [confirmed/bug] Feel, Seed, Gooey, Timing Check and Marker show wireable sockets that accept drivers, but the wires do nothing.
- [confirmed/inconsistent] Feel bends value mapping and Effector falloff, not just timing, while Clip transitions and Random Hold ignore it. Correction on the number: at Feel's default intensity of 0.6, a linear Map Range of 0.5 into 0–100 gives about 85. The ~109 figure only happens at intensity 1.
- [confirmed/bug] Motion Blur makes static objects about 66% opaque (8 copies at 1/8 opacity each).
- [confirmed/bug] Shatter turns Text, Path and Backdrop into black squares, because pieces copy a `color` those objects don't have.
- [confirmed/bug] A Color Swatch with alpha below 1 outputs an rgba() string that Tint's multiply mode and Gradient Map read as black. Tint 'replace' and plain fills handle rgba fine.
- [confirmed/bug] Split places letters as if the font were monospaced (0.55 × size per character) and forces centre alignment, so proportional or left/right-aligned text re-spaces and jumps.
- [confirmed/bug] The Sequencer's per-trigger Ease dropdown has no effect; the envelope is always a linear attack and decay.
- [confirmed/half-built] Dither's 'ordered' mode is only a posterize with no pattern; Reveal/Grain/Seed are ignored in that mode and Levels in 'noise' mode. It does not use the app's Dither engine.
- [confirmed/bug] Gooey has no visible effect when a Backdrop is in the scene.
- [confirmed/bug] Loops are not seamless. The range is inclusive, so the last frame duplicates frame 0 in GIF, video and preview, even though Idle Breathing claims to be seamless.
- [confirmed/bug] Video export records in real time: each frame is held for rasterise time plus 1/fps, so the video runs longer and less evenly than the comp.
- [confirmed/bug] The Undo/Redo toolbar buttons show a stale enabled state: history is pushed 350 ms later without notifying the UI, so Undo stays disabled (and Redo stays enabled) until something else re-renders.
- [confirmed/bug] Ctrl+Z within 350 ms of an edit skips back past the previous committed state. The pending timer then pushes a duplicate and wipes redo, losing both the skipped step and the new edit. If only the initial state is committed, the Ctrl+Z does nothing.
- [confirmed/ux-confusing] In the Stage-only tab nothing can be selected, and a logo can only be brought in through the Graph plus the Inspector drop zone. A first-time user without a hand-off sees an empty checkerboard.
- [confirmed/half-built] The canvas is fixed at 1080x1080 with no size or aspect control, exports are always full size (91 full canvases held in memory for a 0–90 GIF), and canvas.bg is never used.
- [plausible/bug] Autosave writes the whole document (image data URLs and all saved presets) to localStorage on every drag tick, slider tick and selection click. A quota error is swallowed, so autosave could silently stop.
- [confirmed/inconsistent] Merely selecting or deselecting a node marks Motion Maker dirty (close warning), and export never clears the flag.
- [confirmed/duplicated] There are three overlapping ways to keep work (autosave, one Save-project slot, and 'Save as preset', which is really a named snapshot). They share the left column with the Inspector, and Export sits below the Inspector, so long nodes such as Particles (16 params) push it off screen.
- [confirmed/ux-confusing] Value-node sliders run from -5000 to 5000 (step 0.01), so dragging is useless for 0–1 values.
- [confirmed/dead-code] Dead code and state: NODE_MENU is never imported, doc.view is never updated and fitView overrides it, and the presets' view zoom is unused.
- [confirmed/ux-confusing] While the Graph is mounted, Tab opens the add-node palette from anywhere except text inputs/selects, breaking Tab focus movement between buttons.
- [confirmed/bug] Ctrl+Z inside a text field (Text string, Expression, Inspector note text) undoes the whole graph instead of the typing.
- [confirmed/inconsistent] The seconds readout ignores the range start (range 30–90, frame 45 → 1.50 s of 2.00 s).
- [confirmed/half-built] Keyframes have no visual editing: no curve editor (the spec asked for one) and no keys or per-element bars on the timeline, only marker flags.
- [plausible/bug] Time-based nodes multiply per-frame work (Stagger re-evaluates once per object, Motion Blur ×samples, Echo per copy, Physics re-simulates from its start every frame), and Timing Check reruns ~61 scene evaluations on every doc change while selected, including drag ticks.
- [plausible/inconsistent] Blend Mode may look different in the preview (the SVG sits on the checkerboard) than in the export (the SVG is rasterised alone, then drawn onto the matte).
- [missed/bug] Branching one source into two chains breaks effects. Both copies keep the source's object id, so their filter/mask ids collide (fx_<id>, m_<id>) and the second copy renders with the first copy's effect. React also gets duplicate keys, and Motion Blur/Orient match objects by the wrong id.
- [missed/half-built] Mirror / Symmetry never flips the artwork. The mirrored copy is only moved to the reflected position with its rotation negated, so a mirrored wordmark still reads left to right.
- [missed/ux-confusing] Motion Path sets every incoming object to the same absolute point, so an icon and wordmark sent through it stack on top of each other. The same happens with Align's default (Align X = center).
- [missed/inconsistent] Scale pivots on the canvas centre, so in Pop & Settle and Fade + Scale In each logo element slides out from the middle of the canvas as it grows, and overshoots its position with the spring, instead of popping in place.
- [missed/bug] Muting a driver does not stop it driving through Delay or Sample & Hold, which re-evaluate their input node directly.
- [missed/inconsistent] Mixed time units: Spring and Particle rate run in seconds (using fps), while Ramp, Keyframes, LFO, Pulse, Clip and every preset's start frames run in frames. Changing fps shifts springs relative to everything else.
- [missed/ux-confusing] The preview never shows the export background. The Stage is always a dark checkerboard, while GIF and video default to a white matte, so a white logo can look fine and export invisible. The matte is component state, not saved, and resets to white each time the tool opens.
- [missed/bug] Export failures are silent: errors only go to console.error. For example, a Path 'd' containing a double quote is inserted unescaped into the export SVG string, so preview works but every export fails with no message.
- [missed/bug] The same object wire can be connected twice, because onConnect builds edges by hand without React Flow's addEdge duplicate check. The object then renders twice with the same id, and the duplicate wire can't be deleted.
- [missed/bug] Likely: after picking a preset from the dropdown, the <select> keeps focus, so pressing Up or Down (natively) applies the adjacent preset and wipes the graph. Left and Right are hijacked for frame stepping because the transport's typing check ignores SELECT.
- [missed/bug] The GIF palette is built from only 6 sampled frames, and frame 0, often a blank matte in fade/slide presets, is always one of them. Colours that appear only in other frames (glitch fringes, palette cycles, particles) can be remapped badly.
- [missed/bug] Shatter pieces drop an upstream Mask/Reveal clip, Trim and Round Corners (a piece copies only blend and fx), so masking before a Shatter stops working.
- [missed/ux-confusing] Switching to another tool unmounts Motion Maker (only the active tool is mounted), resetting the playhead, tab, export matte, panel width and split ratio.
- [missed/bug] An SVG with no viewBox and no numeric width/height is silently rejected when dropped on an Icon/Wordmark node. Width='100%' is read as 100, which gives a wrong aspect.
INTENT Q:
- Is Motion Maker meant to be 'drop a logo, pick an animation, export', or a general node-based motion sandbox? There are 73 node types, and the 9 presets use only 12 of them.
- Should presets be 'drop-on' animations that layer onto your current graph (as the spec planned), instead of rebuilding everything around the two logo images?
- Should a saved preset be a reusable animation you can apply to any logo, or a snapshot of a whole project with its images?
- Was animating the actual wordmark letter by letter (or drawing the logo on) the main goal? Right now only typed Text can be split and only raw Path strings can draw on.
- Did you want an After Effects-style timeline with bars and keys per element, or should all timing live in the node graph?
- Should scale and rotate pivot on each object (an anchor point) instead of the canvas centre?
- Which output sizes do you need? It is 1080x1080 only today; 16:9, 9:16 and 4:5 were listed as 'Aspect/Reframe'.
- Should the Dither, Glitch, Blur and Motion Blur nodes use the real Dither and Post FX engines, or should Motion Maker just hand its animation to Post FX?
- Should Brand Palette pull colours automatically from Color Palette or Logo Maker instead of five hand-typed swatches?
- Should Logo Maker's colour treatment (mono/duotone/spot) and background colour come across with the logo?
- Should Timing Check be an always-visible critique panel rather than a node you have to add and select?
- Do you expect to click and drag the logo directly on the Stage?
- Is the Feel dial supposed to change only timing (eases), or every curve in the graph?
- Are Lottie and true (ffmpeg) MP4 export still wanted?
- Should the Stage preview show the real export background (a matte, or Logo Maker's bgColor) instead of a checkerboard?
- Should timing be in frames or in seconds? Today Spring and Particles run in seconds and everything else in frames, so changing fps changes their relationship.
- Did you want to branch one logo into several differently styled copies (e.g. a blurred echo plus a sharp original)? That case is currently broken by duplicate ids.
- Should Mirror actually flip the artwork (a kaleidoscope), or just place copies symmetrically?
- Should Motion Path follow a path you draw, or a Path node's own 'd', instead of 4 fixed curves? Should it keep the lockup's relative offsets instead of stacking everything on one point?
- Did you use the single 'Save project' slot, or do you expect normal Save/Open to files with several projects?
- When you scale the lockup (Pop & Settle), should each element pop in place, or grow out from the canvas centre as it does now?
CROSS:
- Logo Maker → Motion Maker (the only live link): the 'Send to Motion Maker' button writes {icon, wordmark, layout, bgColor} to localStorage key 'designtools-shared-motion' (LogoMaker/index.jsx:293-299 via store.sendLogoToMotion, store.js:277-279). Motion Maker reads it once on open and clears it (index.jsx:42-45). This works only because App.jsx mounts just the active tool.
- What the Logo Maker hand-off drops: bgColor is sent but ignored (store.js:336-344). The colour treatment and spot/duotone colours are never sent. The SVG source text is stripped, so the logo arrives as a flat image (LogoMaker/index.jsx:294). The divider rule of the 'Divided' layouts is dropped (layout.js returns 'divider', store.js:306-312 ignores it). The layout is not kept, so 'Arrange lockup' falls back to horizontal.
- Shared code with Logo Maker: lockup maths from LogoMaker/layout.js (computeLayout, BOTH_LAYOUTS, store.js:12, 289-313), and the whole UI kit (C colours, btn, Section, HexInput) is imported from LogoMaker/ui.jsx (index.jsx:8-9, Inspector.jsx:3). Logo Maker's folder acts as the app's unofficial shared UI library.
- Shared libs: lib/gif.js encodeGif/framesToZip (also used by Dither and Post FX), lib/file.js processFile, lib/undo.js (global Ctrl+Z dispatch), lib/unsavedChanges.js, components/NumberField.jsx. The store mirrors PostFX/store.js (module pub/sub + debounced undo + localStorage autosave).
- Duplicated with Dither and Post FX: the MediaRecorder video export and pickVideoMime are copied three times (MotionMaker/exporters.js:55-63, DitherTool/index.jsx:768, PostFX/index.jsx:388).
- Overlap with Post FX: Motion Blur, Glitch/Datamosh, Blur and Glow exist in both, reimplemented here as simple SVG filters with no shared engine. The spec's 'Post FX Stack' node was never built. Dither and Scan to Lineart can 'send to Post FX' (PostFX/store.js sendImageToPostFX); Motion Maker cannot send frames or its animation anywhere.
- Overlap with Dither & Halftone: the 'Dither / Halftone' node shares the name but not the engine (a noise-dissolve or posterize SVG filter, no halftone). The Dither tool also has its own separate LFO 'Motion · seamless loop' animation and export system (DitherTool/motion.js, index.jsx:1195-1217), a second animation system in the app. The 'Dither Preset' node was never built.
- Pattern Maker: no link. The 'Pattern source' node (an animated Pattern Maker fill) is listed as remaining in the handoff and was never built.
- Color Palette: no link. The Brand Palette node is five hand-typed colours (nodes.js:619-634), though the spec wanted it fed from the hand-off palette.
- Scan to Lineart: no link. Lineart exports traced SVG paths, but Motion Maker's Path node only takes a pasted 'd' string in a one-line field (no SVG import), so the natural chain of trace, then draw on with Trim Paths, is missing.
- App shell: App.jsx's global Ctrl+Z/Ctrl+Y handler dispatches to Motion Maker's store undo even while typing in a text field (App.jsx:72-76).

## App shell & cross-tool wiring
IDEA: Design Tools is Luap's own desktop toolbox: seven single-purpose tools behind one icon sidebar. They make patterns, lay out logo lockups, build and check colour palettes, dither or halftone images, stack post effects, turn scans into clean line art, and animate a logo. You open a tool, give it a file or some colours, adjust, and export SVG, PNG, GIF, video or palette files. A few "Send to" buttons are meant to pass colours, images or a logo from one tool to the next, but most of that chain is unfinished.
IDEA_CORR: Mostly right, with two fixes. Pattern Maker is really two generators in one tool: Shapes, and Meteorite, a Monolith-brand faceplate pattern. There are six "Send to" buttons. Four of them do move data (Color to Dither, Dither to Post FX, Lineart to Post FX, Logo to Motion), though they drop resolution or colour on the way. Two do nothing (Color to Logo, Color to Pattern). So "most of that chain is unfinished" goes too far. The accurate version: the chain is thin, lossy and one-way.
OUTPUTS: Pattern Maker: SVG tile, SVG swatch, SVG canvas at a set size, SVG copied to the clipboard. Meteorite: SVG | Logo Maker: SVG/PNG of the current variation, guides SVG, PNG/SVG copied to the clipboard, 'Export all' of every variation as SVG+PNG into a chosen folder (Electron only), favicon bundle .zip (PNG sizes, .ico and .svg) | Color Palette: sheet as SVG/PNG, CSS variables, Tailwind config, TXT, JSON, GPL, ASE, ACO, Procreate .swatches | Dither & Halftone: PNG (upscaled), SVG, one PNG per ink layer, GIF, PNG-frame ZIP, MP4/WebM loop, clipboard | Post FX: PNG, GIF, MP4/WebM, batch-processed ZIP of PNGs, text share codes for effect stacks | Scan to Lineart: PNG at full scan size, traced SVG, clipboard | Motion Maker: GIF, PNG-sequence ZIP, MP4/WebM | Session JSON files in the app-data 'sessions' folder (one fixed slot each for pattern-maker, meteorite, logo-maker, motion-maker)
SIZE: About 25k lines of JS/JSX/CSS in src/, not counting data JSON. The shell itself is small: App.jsx 103, Sidebar 67, Icon 69, NumberField 101, lib/undo 27, lib/unsavedChanges 40, lib/file 41, lib/export 156, lib/eyedropper 101, electron/main.js 114, preload 16. By tool: Color Palette 6.8k across 27 files, Motion Maker 4.1k, Post FX 2.9k, Dither 2.3k, Logo Maker 1.9k, Pattern Maker 1.4k, Scan to Lineart 0.76k. lib/ is 4.5k, mostly single-tool engines (glDither 892, dither 664, lineart 413, color 380, glPostFX 300). Largest files: DitherTool/index.jsx 1514, PostFX/effects.js 1345, MotionMaker/engine.js 1282, PostFX/index.jsx 1150, LogoMaker/index.jsx 910 (about 27 useState hooks with hand-rolled snapshotting). The bloat is structural: six private UI kits, five copy-pasted undo stores plus one ref-based copy, three video recorders, and Dither's second post-FX engine. The uncommitted working-tree diff removes the cobalt.tools downloader (354-line CobaltTool.jsx, ~100 lines of Electron webview/download/SoundCloud code, the webviewTag flag and two icons). The removal is clean: nothing references it anymore. Repo clutter: a stray '{src...' empty folder, and committed graphify outputs in graphify-out/ (6.6 MB) and src/graphify-out/ (516 KB).

FEATURES:
- Sidebar tool switcher (Pattern Maker, Logo Maker, Color Palette, Dither & Halftone, Post FX, Scan to Lineart, Motion Maker) [works] :: A 64px column of icon buttons. Clicking one swaps the main area to that tool. Tool names appear only as hover tooltips.
- Window chrome / title strip [works] :: Frameless window with a 36px draggable strip on top and the Windows min/max/close buttons drawn over its right end.
- Switching tools [partial -> partial: Tools do remount, but their settings are not rebuilt from scratch. App.jsx imports all seven tools at startup (lines 4-10). Color, Dither, Post FX, Lineart and Motion keep their state in module-level stores, so settings and undo history survive a switch. Pattern, Meteorite and Logo re-read their localStorage autosave when they mount. What is actually lost: component-local state. That means loaded images, GIF/video sequences and frame lists (Dither, Post FX, Lineart, Meteorite faceplate), zoom and pan, Logo's step and undo history, and Motion's tab, frame and panel sizes.] :: Only the active tool is rendered. Every switch unmounts the old tool and mounts the new one from scratch.
- Undo / Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) [partial -> partial: Coverage is uneven in more ways than 'Pattern never registers'. (1) Logo's history lives in refs and dies on every tool switch; the other five tools keep theirs for the app's lifetime. (2) Dither and Post FX snapshot their whole state, including the saved preset and palette libraries, so undo can un-save a preset. (3) Color Palette snapshots the active swatch and Post FX snapshots the selected layer, so plain clicks become undo steps. Motion keeps selection out of its history.] :: One global key handler sends undo/redo to whichever tool registered for it.
- Unsaved-changes warning on quit [partial -> partial: Pattern Shapes, Meteorite and Logo skip their first autosave with a 'firstRun' ref. main.jsx wraps the app in React.StrictMode, which runs effects twice in development. So the second run calls markDirty straight away. Pattern Maker is the default tool and keeps both of its tabs mounted, so under launch.bat / npm run dev the app is already 'unsaved' at launch and every quit prompts. Also, Lineart settings changes never mark dirty; only loading an image does.] :: Tools flag themselves dirty on edits and clean on save/export. Closing the window with any dirty tool shows a Cancel / Quit anyway dialog.
- Save / Load (per tool) [partial -> partial: The behaviour is as described, but it has barely been used. The app-data sessions folder holds only logo-maker.json and pattern-maker.json, both from June 3. Outside Electron, Save falls back to localStorage keys '<key>-manual' and 'designtools-motion-project'.] :: Writes the tool's settings to one fixed JSON file in app data, and Load reads that same file back.
- Autosave [partial] :: Each tool keeps its own localStorage key, but what gets kept differs from tool to tool.
- Pick colour from screen (eyedropper, all monitors, live preview) [works] :: Grabs any pixel on any monitor and shows the hovered colour live while picking.
- Color Palette > Send to Dither [works] :: Sends the palette (or the selected swatches) to Dither, which offers them as a new saved palette the next time Dither opens.
- Color Palette > Send to Logo [broken] :: Meant to push the palette into Logo Maker.
- Color Palette > Send to Pattern [broken] :: Meant to push the palette into Pattern Maker.
- Dither > Send to Post FX [partial -> partial: It sends the live WebGL buffer: working resolution times Dither's internal upscale. That upscale is 1x for plain square-cell dithers, up to 5x with post-FX or round/diamond cells, and up to 4x for halftone. It never uses the export scale (default 4x). At default settings that is a 320 px image. Post FX never upscales and exports at its working size.] :: Hands the current dithered result to Post FX as its source image.
- Scan to Lineart > Post FX [partial -> partial: Besides the wrong file name and the 1600 px cap, the hand-off writes a full-resolution PNG data URL into localStorage inside a try/catch that swallows errors. A large scan can go over the storage quota, and then the send silently does nothing.] :: Hands the cleaned line art to Post FX.
- Logo Maker > Send to Motion Maker [partial] :: Passes the icon, wordmark and lockup layout so Motion Maker opens with them as separate animatable nodes.
- Shared number slider / click-to-type number [partial] :: One slider-plus-typeable-number control meant for every numeric setting in the app.
- Shared icon set [partial] :: Inline Material icon paths, so icons render offline.
- Favicon / ICO export helper [works] :: Renders an SVG into favicon PNGs plus a multi-size .ico and zips them.
- GIF / frame-zip helper [works] :: Decodes animated GIFs, encodes looping GIFs, zips PNG frames.
- File loader (image / SVG) [partial] :: Reads a dropped or picked file into an image or parsed SVG for the tools.
- Builds and Mac guide [works -> unclear: Nothing shows that the packaged app is used. %APPDATA% holds only the dev-mode 'designtools' folder, with no 'Design Tools' folder, so the built .exe has never been run on this machine. The Mac target has no icon and its guide names the wrong workflow. Whether CI still passes can't be checked from here.] :: A GitHub Action builds a portable Windows .exe and a universal macOS .dmg on version tags. RUN-ON-MAC.md explains how to install or run from source.
- (missed) Pattern Maker keeps both of its tabs mounted [works] :: Shapes and Meteorite are both rendered all the time and hidden with display:none, so each keeps its state and autosave when you flip between them. That is the fix the App shell never applied to its seven tools, and it is already in the codebase.
- (missed) Paste to load [partial] :: Ctrl+V loads content in five tools, and each takes something different. Color Palette takes hex lists. Dither, Post FX and Lineart take clipboard images. Logo takes only SVG, as a file or as text. Pattern and Motion have no paste at all.
- (missed) Export goes through the native Save dialog [works (Electron default behaviour, not run)] :: Most exports trigger an <a download> click. Electron has no will-download handler set, so each export falls back to its default Save As prompt. The only export that writes straight to a folder is Logo's 'Export all' (pickFolder plus the fs:writeFile IPC).
- (missed) Runs partly in a plain browser [partial] :: Every Electron call is guarded with window.electron. Under plain Vite, Save/Load falls back to localStorage, the eyedropper runs without its live preview, and 'Export all' does nothing.
- (missed) Per-tool accent in the sidebar [works] :: The active sidebar icon takes the colour from each tool's accentColor in the registry. Pattern has none and falls back to the sidebar's own #e8a838.
PROBLEMS:
- [confirmed/disconnected] Color Palette's 'Send to Logo' and 'Send to Pattern' write to a bucket nobody reads, and show no confirmation.
- [confirmed/bug] Switching tools loses loaded images (Dither, Post FX, Lineart, Meteorite faceplate), plus Logo's undo history and step. Settings survive because they sit in module stores or autosave.
- [confirmed/bug] Ctrl+Z / Ctrl+Y inside a text or number field undoes the whole tool instead of your typing.
- [confirmed/half-built] Pattern Maker (Shapes and Meteorite) has no undo, and Ctrl+Z is still swallowed there.
- [confirmed/ux-confusing] The Send buttons in Color Palette, Dither and Lineart give no feedback; the receiver only picks the item up once you switch to it. Only Logo says 'Sent'.
- [confirmed/disconnected] Logo to Motion drops colour overrides, treatments and background colour; the spec asked for colours and treatment.
- [confirmed/ux-confusing] Opening Motion Maker after a logo send replaces the current graph with a starter graph; undo is the only way back.
- [confirmed/bug] Images passed to Post FX lose resolution: Dither sends its on-screen buffer instead of the export size, and Post FX caps at 1600 px and exports at its working size.
- [confirmed/bug] Everything handed to Post FX is named 'from-dither.png', so line-art exports come out as 'from-dither-fx.png'.
- [confirmed/disconnected] SVGs are silently ignored by Dither, Post FX and Lineart, so Pattern, Logo, Meteorite and palette-sheet SVGs can't be chained into them.
- [confirmed/bug] Image files the browser can't decode (TIFF, HEIC, PSD) do nothing: no error, and the promise never settles.
- [plausible/bug] Big base64 payloads (Logo and Motion autosave, the Lineart hand-off) can fill localStorage, after which unguarded setItem calls throw and controls stop updating.
- [confirmed/bug] Some icon buttons are blank because the icon name is missing: Color Palette's drawer collapse and Motion's node mute.
- [confirmed/inconsistent] The quit warning cries wolf: selection-only changes mark tools dirty, Motion export never clears the flag, and Color Palette clears only on export.
- [confirmed/inconsistent] Motion Maker uses Logo Maker's UI kit, so its active buttons, toggles and hex-field underlines are Logo blue inside an orange tool.
- [confirmed/inconsistent] Visual tokens differ per tool: 7 accents, 3 border greys, 3 font stacks, about 2.7:1 label contrast in most tools against 7:1 in Color Palette, and controls on different sides.
- [confirmed/duplicated] Six private UI kits, each with its own Section, Toggle, slider, hex field and button. Controls behave differently (label scrub only in Pattern; Toggle is a switch in some tools and a checkbox in others).
- [confirmed/duplicated] Dither has its own copy of many Post FX effects in a separate WebGL engine.
- [confirmed/duplicated] Plumbing is copy-pasted: undo stores, video recorder, download helper, hex-to-RGB, SVG parse, SVG-to-PNG, pan/zoom, command palette, preset strip.
- [confirmed/dead-code] Dead code: Logo's ExportPanel.jsx, svgToPngBase64, getSharedColors, hasUnsavedChanges/useUnsavedChanges, isPicking, Post FX icon fields, risoInks/setRisoInks.
- [confirmed/inconsistent] 'Save' means something different in each tool, and survival across restarts depends on the tool.
- [confirmed/inconsistent] Keys are mapped inconsistently: Space is play/pause in Motion but pan in Dither, Post FX and Lineart. Post FX and Motion grab Tab for a search palette.
- [confirmed/inconsistent] Reset works three ways: an armed 'Sure?' button (Color), window.confirm (Pattern, Meteorite), and no confirmation (Motion, Dither).
- [confirmed/bug] A render error in any tool blanks the whole window, sidebar included.
- [confirmed/ux-confusing] Some hint text is nearly invisible (C.dim #2e2e33, about 1.4:1), including Meteorite's CMYK note and Logo's 'Auto-saved'.
- [confirmed/inconsistent] Unicode glyphs are used as icons despite the Icon.jsx rule.
- [confirmed/inconsistent] Running from source and running the built exe keep separate autosaves, presets and sessions.
- [confirmed/inconsistent] The Mac guide names the 'Build macOS app' workflow, which is now 'Build apps', and the Mac build has no icon.
- [confirmed/dead-code] Repo clutter: an empty '{src/tools,src/components,public}' folder tree and a second committed graphify output in src/graphify-out.
- [missed/bug] In daily use (launch.bat → npm run dev) the quit warning fires even when you've changed nothing. React.StrictMode runs mount effects twice in development. That defeats the 'skip first autosave' ref in Shapes, Meteorite and Logo, so they mark themselves dirty the moment they mount. Pattern Maker is the default tool and mounts both of its tabs, so the app is 'unsaved' as soon as it opens.
- [missed/bug] Ctrl+Z in Dither and Post FX can delete a preset or palette you just saved. Their undo snapshots include the saved libraries, and notify() writes the rolled-back library back to storage. In Dither, undoing 'Save as palette' on colours from Color Palette loses those colours for good, because the shared bucket was already cleared.
- [missed/inconsistent] Undo granularity differs per tool. Clicking a swatch in Color Palette, or selecting a layer in Post FX, creates an undo step, so Ctrl+Z just moves the selection back. Motion Maker keeps selection out of its history.
- [missed/duplicated] There's a third effects engine. Motion Maker's Dither, Glitch, Blur, Glow, Tint and Drop Shadow nodes are separate SVG-filter implementations that share no code with Dither's WebGL engine or Post FX's WebGL engine. The same look now has three sets of controls and three renderers.
- [missed/bug] Dropping a file outside a tool's small drop zone probably navigates the whole window to that file and replaces the app. That covers anywhere in Pattern Maker, the Logo preview, the Motion stage, any control panel and the sidebar. There is no global dragover/drop preventDefault and no will-navigate guard, so Electron's default navigation applies.
- [missed/dead-code] The cobalt downloader's code is gone, but its data isn't. The persist:cobalt partition still takes 4.7 GB in app data (4.3 GB 'File System', 369 MB Cache), and nothing will ever clear it now.
- [missed/inconsistent] The repo is split across branches. The working tree is on feat/meteorite-pattern, 7 commits ahead of its remote: an unpushed Color Palette UX rework dated 2026-08-30. Six feature branches remain, and the handoff doc still calls local main 'stale' even though main now holds only merge commits. The rewrite needs a single source of truth.
- [missed/inconsistent] Every hand-off is a single overwrite slot. Sending twice before visiting the target (Dither then Lineart to Post FX, or two palettes to Dither) silently drops the first. And Color Palette sends its selected swatches to Dither but always the full palette to Logo and Pattern.
INTENT Q:
- Should the app have one shared 'brand kit' (logo + palette) that every tool reads, instead of each tool keeping its own colour fields (Logo brand colour, Pattern palette, Motion Brand Palette node, Post FX duotone, Meteorite inks)?
- When you press 'Send to X', should the app switch you to X straight away, or quietly queue it for later?
- When you switch tools and come back, should everything, including the loaded image, be exactly as you left it?
- Should every tool's working settings survive a restart (like Color Palette and Lineart do), or reset (like Dither and Post FX do)?
- Was 'Save / Load' meant to be one quick-save slot per tool, or named project files you choose where to keep?
- What should 'Send to Logo' do with a palette: set the logo colour, the brand/background colours, or the duotone/spot treatment colours?
- Should Logo to Motion bring the recoloured/treated logo and its background, rather than the raw uploaded file?
- Should Dither keep its own glow/CRT/glitch/grain section, or should those looks live only in Post FX?
- Should the image tools (Dither, Post FX, Lineart) accept SVGs from Pattern and Logo Maker so the tools can be chained?
- Should Scan to Lineart's traced SVG be sendable to Logo Maker as an icon or wordmark?
- Motion Maker's spec planned a Pattern source node and 'Post FX Stack' / 'Dither Preset' nodes to tie the tools together. Still wanted?
- Is the built-in Monolith content (bracket logomark in Pattern Maker, Monolith preset and packaging panels in Meteorite) meant to stay hard-coded, or become a loadable brand preset?
- One accent colour for the whole app, or keep a colour per tool? And one side for the controls panel?
- Is macOS still a target (there's a .dmg build and a Mac guide), or Windows only?
- Is the cobalt.tools downloader gone for good (the removal isn't committed yet)?
- Do you only ever run it from source (launch.bat)? Only the dev app-data folder exists on this machine. If so, is the packaged .exe/.dmg pipeline worth keeping in the rewrite?
- Color Palette got a full UX rework in August (7 unpushed commits, with a tokens.js that solves text colours for contrast). Should that be the visual baseline for the whole app?
- Should all the effects live in one engine shared by Dither, Post FX and Motion Maker? Right now there are three: Dither's WebGL, Post FX's WebGL and Motion's SVG filters.
- Should Meteorite stay a tab inside Pattern Maker, or become its own tool (or a brand preset)?
- If every tool autosaves, do you want the 'unsaved changes' quit prompt at all? Or should it only guard things that really would be lost, like loaded images and unexported renders?
- Can the stale feature branches and the 4.7 GB of leftover cobalt data be deleted before the rewrite starts?
- Should the sidebar show tool names or have keyboard switching (e.g. Ctrl+1..7)? Right now names appear only as hover tooltips.
CROSS:
- Color Palette to Dither: works. It goes through localStorage 'designtools-shared-colors'. Dither reads it once when it opens and offers 'Save as palette', and each send adds another saved palette called 'From Color tool' (DitherTool/index.jsx:806).
- Color Palette to Logo Maker: broken. The button writes colours that Logo Maker never reads. Logo keeps its own brandColor, bg, spot and duotone fields (LogoMaker/index.jsx:30-59).
- Color Palette to Pattern Maker: broken. The button writes colours that Pattern Maker never reads, even though ShapesTab has a palette list sitting right there (ShapesTab.jsx:161-162,421-430).
- Color Palette to Post FX / Motion / Lineart / Meteorite: no link. Post FX gradient-map, duotone and split-tone colours, Motion's Brand Palette node (5 hard-coded defaults, nodes.js:619-634; the spec at nodes-spec.md:294 says it should come from the Logo hand-off), Lineart's line colour and Meteorite's inks are all typed by hand.
- Meteorite to Color Palette: the footer says CMYK conversion happens in Color Palette (MeteoriteTab.jsx:385), but there's no way to send Meteorite's colours there.
- Dither to Post FX: works through localStorage 'designtools-shared-image', but at Dither's working resolution. Dither imports sendImageToPostFX from PostFX/store.js.
- Scan to Lineart to Post FX: works through the same channel, labelled 'from-dither.png', sent at full size and then capped at 1600px in Post FX.
- Logo Maker to Motion Maker: works through localStorage 'designtools-shared-motion'. Motion also imports Logo's computeLayout (MotionMaker/store.js:12) so the lockup lines up. Colours, treatments and background are dropped.
- Motion Maker imports Logo Maker's UI kit (LogoMaker/ui.jsx: C, btn, Section, HexInput), so the two tools are tied at the component level and Motion shows Logo's blue accent.
- All three receivers (Dither colours, Post FX image, Motion logo) read their hand-off only on mount and rely on the app remounting tools on every switch. If the rewrite keeps tools alive, these hand-offs need a real event or shared store.
- Missing: Pattern Maker to Motion (the spec'd 'Pattern' source node, unbuilt: nodes-spec.md:71, handoff.md:16). Post FX preset / Dither preset as Motion nodes (nodes-spec.md:236-240, unbuilt).
- Missing: Logo Maker to Pattern Maker. Pattern ships a hard-coded Monolith bracket logomark instead (ShapesTab.jsx:20-25).
- Missing: Scan to Lineart to Logo Maker. Lineart exports traced SVG, but you have to save it and re-upload it in Logo.
- Missing: SVG outputs (Pattern, Logo, Meteorite, palette sheet) can't be dropped into Dither, Post FX or Lineart, because the loaders reject SVG.
- The screen eyedropper (lib/eyedropper.js plus the Electron capture IPC) is only wired into Color Palette. Every other tool's colour fields use the plain native picker.
- Riso inks: Color Palette has a riso.json ink library and a Riso mode, while Dither's Riso presets hard-code their own ink hexes (DitherTool/presets.js:149-160). There's no shared ink list.
- Three separate animation systems, each with its own GIF/video export: Dither's LFO loops (DitherTool/motion.js), Post FX's 'animate' time uniform, and Motion Maker's node graph.
- Shared code that does work: lib/gif.js (Dither, Post FX, Motion), lib/file.js processFile (Dither, Post FX, Lineart, Logo, Motion), lib/undo.js (every tool except Pattern), lib/unsavedChanges.js (all), NumberField (Color, Dither, Post FX, Lineart, Motion), Icon (all), lib/color.js (Color Palette plus Logo's contrast check).
- Different ideas of 'saved' across tools feed one app-wide quit warning: autosaving tools and ephemeral tools raise the same prompt.