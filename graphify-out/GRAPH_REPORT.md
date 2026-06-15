# Graph Report - designtools  (2026-06-15)

## Corpus Check
- 104 files · ~142,889 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1053 nodes · 2118 edges · 52 communities (45 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b94cd56`
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
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]

## God Nodes (most connected - your core abstractions)
1. `usePalette()` - 36 edges
2. `GLEngine` - 22 edges
3. `oklchToHex()` - 21 edges
4. `setState()` - 21 edges
5. `setState()` - 17 edges
6. `toOklch()` - 15 edges
7. `PaintSim` - 15 edges
8. `markDirty()` - 15 edges
9. `markSaved()` - 15 edges
10. `setState()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `TreatmentFilter()` --calls--> `hexToRgb()`  [EXTRACTED]
  src/tools/LogoMaker/LockupSvg.jsx → src/lib/color.js
- `MotionMaker()` --calls--> `tabBtn`  [INFERRED]
  src/tools/MotionMaker/index.jsx → src/tools/CobaltTool.jsx
- `BGCheck()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/BGCheck.jsx → src/tools/ColorPalette/store.js
- `Generators()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Generators.jsx → src/tools/ColorPalette/store.js
- `MaterialPanel()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/MaterialPanel.jsx → src/tools/ColorPalette/store.js

## Import Cycles
- None detected.

## Communities (52 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (20): BackgroundRow(), ClearspaceSection(), MinSizeStrip(), FaviconView(), PREVIEW_SIZES, BOTH_LAYOUTS, computeLayout(), VARIATIONS (+12 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (35): C, parseColorList(), tryParseToHex(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE, defaultSwatch() (+27 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (41): allowScripts, electron@29.4.6, esbuild@0.21.5, sharp@0.34.5, author, build, appId, directories (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (49): BLEND_MODES, CATEGORIES, defaultLayer(), EFFECT_LIST, EFFECTS, LIST, C, CAT_LABEL (+41 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (26): renderTheme(), applyArray(), applyClip(), applyMirror(), applyPhysics(), applyTransform(), applyWiggle(), clamp() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (15): ALGO_GROUPS, applyMaskCpu(), C, cssRgb01(), GradientEditor(), HT_ALGOS, HT_ANGLES, HT_SHAPE_ID (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (7): Mixer(), useMixingWell(), PIGMENT_BY_ID, PIGMENTS, pigmentTraits(), ks1(), makePaint()

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
Nodes (23): _dirty, hasUnsavedChanges(), _listeners, markDirty(), _sync(), useUnsavedChanges(), BatchPanel(), configGrid (+15 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (26): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, rgbToOklab(), ROLE_COLORS, ROLES, Swatch() (+18 more)

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
Cohesion: 0.11
Nodes (16): DiceBtn(), buildRecipe(), CHROMA_REASON, clamp(), clampC(), combineTags(), computeIdentities(), GROUPS (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.08
Nodes (43): defaultParams(), makeNodeId(), doc(), imagesFromDoc(), mk(), objEdge(), PRESETS, skeleton() (+35 more)

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (18): ColorPalette(), encodeGif(), framesToZip(), useGlobalUndo(), LogoMaker(), evaluateScene(), downloadBlob(), exportFramesZip() (+10 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (17): runAutoFix(), clusterHues(), critique(), fixBtn, hueDist(), hueName(), mkFix(), nameOf() (+9 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (25): GradMapEditor(), LfoBlock(), PaletteManager(), PresetStrip(), applyPreset(), clearIncomingColors(), DEFAULT_STATE, getIncomingColors() (+17 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (7): btnStyle(), C, CHANNELS, colorStyle, LineartTool(), MODES, useLineart()

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (14): generateRandomPalette(), Generators(), h32(), HARMONY_TYPES, HUE_MODES, lerp(), HueChip(), ShadowHighlight() (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.14
Nodes (15): checkerBg(), DitherTool(), isCurve(), isOrdered(), BUILTIN_PALETTES, hexToRgb(), sortByLuma(), allPalettes() (+7 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (17): autoName(), deltaE(), clamp01(), deltaE(), evalMix(), hexToOklab(), _K, _lab (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (7): MaterialPanel(), clamp(), hueLerp(), MATERIAL_BY_ID, MATERIALS, pull(), suggestMaterialColors()

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): ditherToSvg(), hex(), wrap()

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (13): Core idea — one deterministic evaluator, Data model, Decisions (locked during brainstorming), Export pipeline, Files & infra, Identity & placement, Logo Maker hand-off (structured, one at a time), Motion Maker — design spec (+5 more)

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (22): ContrastMatrix(), RATING_COLOR, PANELS, ExportPanel(), Grade(), Gradient(), SPACES, Harmony() (+14 more)

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (3): Option A — Download the prebuilt app (easiest), Option B — Run from source, Running Design Tools on macOS

### Community 39 - "Community 39"
Cohesion: 0.13
Nodes (7): readAsText(), buildSvg(), C, mkRng(), S1, S2, ShapeSlot()

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (43): buildAco(), buildAse(), buildProcreateSwatches(), C, downloadBinary(), downloadSvgAsPng(), downloadText(), toGpl() (+35 more)

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (8): computeMods(), frac(), lfoValue(), mkLfo(), MOTION_PARAMS, noiseWave(), PARAM_BY_KEY, WAVES

### Community 44 - "Community 44"
Cohesion: 0.23
Nodes (6): buildGrain(), lin8(), hexToSpectrum(), ksToRefl(), reflToKS, spectrumToLinearInto()

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (12): processFile(), readAsDataUrl(), buildTreatmentFilterStr(), isSvgLikelyBlack(), parseSvgText(), svgToDataUrl(), FileSlot(), btn() (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (19): 2a — Transform & copy, 2b — Structure & layout, 2c — Motion behaviors, 2d — Generative & transitions, 2e — Time-domain modifiers (re-time the upstream subtree), Architecture recap (what every node must respect), Build-order recommendation, Feasibility tiers (marked on every node) (+11 more)

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (7): computedHash, skillPath, source, sourceType, skills, frontend-design, version

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (6): Design principles, Frontend Design, Ground it in the subject, More on writing in design, Process: brainstorm, explore, plan, critique, build, critique again, Restraint and self-critique

### Community 49 - "Community 49"
Cohesion: 0.18
Nodes (13): HarmonyOverlay(), ILL_PANELS, KS8, Mixer(), EyeDropperBtn(), addSwatch(), generateHarmony(), hexToRgb() (+5 more)

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (5): ICONS, C, globalRedo(), globalUndo(), TOOLS

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (17): applyLevels(), autoLevels(), chaikin(), collapseCollinear(), compose(), despeckle(), fmt(), loopsToSvg() (+9 more)

### Community 53 - "Community 53"
Cohesion: 0.18
Nodes (11): DEFAULT_STATE, getState(), _history, _listeners, notify(), pushHistory(), redo(), resetState() (+3 more)

### Community 55 - "Community 55"
Cohesion: 0.23
Nodes (6): buildFilter(), clampNum(), fxPrimitive(), hexRgb(), sanitizeId(), SceneSvg()

### Community 57 - "Community 57"
Cohesion: 0.43
Nodes (3): buildFaviconZip(), buildIco(), svgToPngBlob()

### Community 58 - "Community 58"
Cohesion: 0.29
Nodes (7): adjustWeight(), blurH(), blurV(), boxBlurF(), flatten(), smoothMask(), toInk()

## Knowledge Gaps
- **206 isolated node(s):** `version`, `configurations`, `PreToolUse`, `allow`, `{ app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }` (+201 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `markDirty()` connect `Community 18` to `Community 0`, `Community 1`, `Community 5`, `Community 39`, `Community 25`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `GLEngine` connect `Community 3` to `Community 31`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `NumberSlider()` connect `Community 30` to `Community 37`, `Community 5`, `Community 7`, `Community 8`, `Community 45`, `Community 49`, `Community 29`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `PreToolUse` to the rest of the system?**
  _206 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13446969696969696 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07372549019607844 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._