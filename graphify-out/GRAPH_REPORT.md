# Graph Report - designtools  (2026-06-21)

## Corpus Check
- 122 files · ~166,022 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1226 nodes · 2391 edges · 65 communities (57 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f1c82698`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]

## God Nodes (most connected - your core abstractions)
1. `usePalette()` - 36 edges
2. `gatherObjects()` - 28 edges
3. `GLEngine` - 22 edges
4. `oklchToHex()` - 21 edges
5. `setState()` - 21 edges
6. `clamp()` - 17 edges
7. `setState()` - 17 edges
8. `markDirty()` - 16 edges
9. `markSaved()` - 16 edges
10. `toOklch()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `MotionMaker()` --calls--> `tabBtn`  [INFERRED]
  src/tools/MotionMaker/index.jsx → src/tools/CobaltTool.jsx
- `BGCheck()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/BGCheck.jsx → src/tools/ColorPalette/store.js
- `applyParticles()` --calls--> `lerp()`  [INFERRED]
  src/tools/MotionMaker/engine.js → src/tools/ColorPalette/Generators.jsx
- `Generators()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Generators.jsx → src/tools/ColorPalette/store.js
- `Harmony()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Harmony.jsx → src/tools/ColorPalette/store.js

## Import Cycles
- None detected.

## Communities (65 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (16): DEFAULTS, BRACKET, S1, S2, ShapeSlot(), btn(), C, ColorRow() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (36): C, parseColorList(), tryParseToHex(), addSwatch(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.15
Nodes (14): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, oklabToHex(), renderTheme(), ROLE_COLORS, ROLES (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (41): allowScripts, electron@29.4.6, esbuild@0.21.5, sharp@0.34.5, author, build, appId, directories (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (47): BLEND_MODES, CATEGORIES, defaultLayer(), EFFECT_LIST, EFFECTS, LIST, C, CAT_LABEL (+39 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (46): applyAlign(), applyArray(), applyCamera(), applyClip(), applyEcho(), applyEffector(), applyMagnet(), applyMirror() (+38 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (15): ALGO_GROUPS, applyMaskCpu(), C, cssRgb01(), GradientEditor(), HT_ALGOS, HT_ANGLES, HT_SHAPE_ID (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): DiceBtn(), buildRecipe(), CHROMA_REASON, clamp(), clampC(), combineTags(), computeIdentities(), GROUPS (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.20
Nodes (4): { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen }, { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }, fs, path

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (24): B_BLUE, B_CYAN, B_GREEN, B_MAGENTA, B_RED, B_WHITE, B_YELLOW, CMF_X (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.24
Nodes (4): snap(), diffuseBand(), PaintSim, smoothstep()

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (17): ICONS, configGrid, controls, fallbackWrap, folderBtn, folderText, input, list (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (17): Architecture, Canvas sizing, Controls — `MeteoriteTab.jsx`, Decisions (locked), Generation algorithm (crossing line-families), Goals, Meteorite Pattern — Design Spec, Non-goals (+9 more)

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (14): buildFilter(), buildMask(), clampNum(), fxPrimitive(), gooFilterDef(), gradientDef(), hexRgb(), itemSvg() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (4): buildFragment(), create(), hexToRgb01(), PostFXEngine

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (15): ANGLE_SET, buildInks(), buildPaletteCoverage(), channelCoverage(), halftoneToSvg(), luminance(), paintDot(), paintScreen() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (27): addNoise(), ALGO_IDS, ALGORITHMS, applyLevels(), bayer(), blueNoise(), buildPalette(), clamp8() (+19 more)

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (21): ContrastMatrix(), RATING_COLOR, PANELS, ExportPanel(), Grade(), Gradient(), SPACES, chipBtn (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (55): MotionNode(), nodeTypes, socketParams(), CATEGORY_COLOR, defaultParams(), EASE_OPTIONS, FONT_OPTIONS, makeNodeId() (+47 more)

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (15): encodeGif(), framesToZip(), evaluateScene(), downloadBlob(), exportFramesZip(), exportGif(), exportVideo(), frameList() (+7 more)

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (10): clusterHues(), critique(), fixBtn, Harmony(), hueDist(), hueName(), mkFix(), nameOf() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (25): GradMapEditor(), LfoBlock(), PaletteManager(), PresetStrip(), applyPreset(), clearIncomingColors(), DEFAULT_STATE, getIncomingColors() (+17 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (43): buildAco(), buildAse(), buildProcreateSwatches(), C, downloadBinary(), downloadSvgAsPng(), downloadText(), toGpl() (+35 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (14): generateRandomPalette(), Generators(), h32(), HARMONY_TYPES, HUE_MODES, lerp(), HueChip(), ShadowHighlight() (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.14
Nodes (15): checkerBg(), DitherTool(), isCurve(), isOrdered(), BUILTIN_PALETTES, hexToRgb(), sortByLuma(), allPalettes() (+7 more)

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (14): clamp01(), evalMix(), hexToOklab(), _K, _lab, linearToOklab(), preparePaints(), _rgb (+6 more)

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (7): MaterialPanel(), clamp(), hueLerp(), MATERIAL_BY_ID, MATERIALS, pull(), suggestMaterialColors()

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): ditherToSvg(), hex(), wrap()

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (9): ColorPalette(), C, globalRedo(), globalUndo(), useGlobalUndo(), LogoMaker(), PostFX(), usePostFX() (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (13): Core idea — one deterministic evaluator, Data model, Decisions (locked during brainstorming), Export pipeline, Files & infra, Identity & placement, Logo Maker hand-off (structured, one at a time), Motion Maker — design spec (+5 more)

### Community 37 - "Community 37"
Cohesion: 0.23
Nodes (6): buildGrain(), lin8(), hexToSpectrum(), ksToRefl(), reflToKS, spectrumToLinearInto()

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (3): Option A — Download the prebuilt app (easiest), Option B — Run from source, Running Design Tools on macOS

### Community 39 - "Community 39"
Cohesion: 0.18
Nodes (7): Mixer(), useMixingWell(), PIGMENT_BY_ID, PIGMENTS, pigmentTraits(), ks1(), makePaint()

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (8): computeMods(), frac(), lfoValue(), mkLfo(), MOTION_PARAMS, noiseWave(), PARAM_BY_KEY, WAVES

### Community 41 - "Community 41"
Cohesion: 0.20
Nodes (17): applyLevels(), autoLevels(), chaikin(), collapseCollinear(), compose(), despeckle(), fmt(), loopsToSvg() (+9 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (19): BackgroundRow(), ClearspaceSection(), MinSizeStrip(), FaviconView(), PREVIEW_SIZES, BOTH_LAYOUTS, computeLayout(), VARIATIONS (+11 more)

### Community 43 - "Community 43"
Cohesion: 0.13
Nodes (18): HarmonyOverlay(), ILL_PANELS, KS8, Mixer(), rgbToOklab(), EyeDropperBtn(), generateHarmony(), hexToRgb() (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (8): processFile(), readAsDataUrl(), readAsText(), buildTreatmentFilterStr(), isSvgLikelyBlack(), parseSvgText(), svgToDataUrl(), FileSlot()

### Community 45 - "Community 45"
Cohesion: 0.21
Nodes (7): btn(), SegmentedControl(), analyzeTiming(), PresetStrip(), ImageParam(), KeyframesEditor(), TimingFindings()

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (19): 2a — Transform & copy, 2b — Structure & layout, 2c — Motion behaviors, 2d — Generative & transitions, 2e — Time-domain modifiers (re-time the upstream subtree), Architecture recap (what every node must respect), Build-order recommendation, Feasibility tiers (marked on every node) (+11 more)

### Community 47 - "Community 47"
Cohesion: 0.05
Nodes (37): computedHash, skillPath, source, sourceType, computedHash, skillPath, source, sourceType (+29 more)

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (6): Design principles, Frontend Design, Ground it in the subject, More on writing in design, Process: brainstorm, explore, plan, critique, build, critique again, Restraint and self-critique

### Community 49 - "Community 49"
Cohesion: 0.10
Nodes (20): Branch state, Branch state (updated 2026-06-21), Conventions, ✅ Easy — registry + engine branch only, Engine (`src/tools/MotionMaker/engine.js`), Graph editor (`src/tools/MotionMaker/Graph.jsx`), Key architecture facts for the next session, Motion Maker — session handoff (2026-06-16) (+12 more)

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (19): runAutoFix(), autoName(), CVD_MATRICES, CVD_TYPES, deltaE(), gamutMap(), inSrgbGamut(), lumaHex() (+11 more)

### Community 51 - "Community 51"
Cohesion: 0.13
Nodes (7): btnStyle(), C, CHANNELS, colorStyle, LineartTool(), MODES, useLineart()

### Community 52 - "Community 52"
Cohesion: 0.18
Nodes (11): DEFAULT_STATE, getState(), _history, _listeners, notify(), pushHistory(), redo(), resetState() (+3 more)

### Community 53 - "Community 53"
Cohesion: 0.28
Nodes (7): _dirty, hasUnsavedChanges(), _listeners, markDirty(), _sync(), useUnsavedChanges(), BatchPanel()

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (8): Boundaries, Intensity, Output, Persistence, Ponytail, Rules, The ladder, When NOT to be lazy

### Community 55 - "Community 55"
Cohesion: 0.25
Nodes (7): Configure Default Mode, Deactivate, Levels, More, Ponytail Help, Skills, Update

### Community 56 - "Community 56"
Cohesion: 0.43
Nodes (3): buildFaviconZip(), buildIco(), svgToPngBlob()

### Community 57 - "Community 57"
Cohesion: 0.40
Nodes (4): Boundaries, Hunt, Output, Tags

### Community 58 - "Community 58"
Cohesion: 0.40
Nodes (4): Boundaries, Honesty boundary, Ponytail Gain, Scoreboard

### Community 59 - "Community 59"
Cohesion: 0.40
Nodes (4): Boundaries, Examples, Format, Scoring

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (3): Boundaries, Output, Scan

### Community 61 - "Community 61"
Cohesion: 0.26
Nodes (11): anglesFor(), buildDuotone(), buildMeteorite(), f2(), hx(), meteoriteSize(), PANELS, PRESETS (+3 more)

### Community 62 - "Community 62"
Cohesion: 0.29
Nodes (7): adjustWeight(), blurH(), blurV(), boxBlurF(), flatten(), smoothMask(), toInk()

## Knowledge Gaps
- **297 isolated node(s):** `version`, `configurations`, `PreToolUse`, `allow`, `{ app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }` (+292 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NumberSlider()` connect `Community 30` to `Community 5`, `Community 7`, `Community 39`, `Community 43`, `Community 45`, `Community 51`, `Community 24`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `markDirty()` connect `Community 53` to `Community 0`, `Community 1`, `Community 5`, `Community 42`, `Community 18`, `Community 51`, `Community 25`, `Community 28`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `useGlobalUndo()` connect `Community 35` to `Community 1`, `Community 5`, `Community 7`, `Community 42`, `Community 51`, `Community 26`, `Community 31`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `PreToolUse` to the rest of the system?**
  _297 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07390648567119155 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.053994732221246705 - nodes in this community are weakly interconnected._