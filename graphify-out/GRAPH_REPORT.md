# Graph Report - designtools  (2026-06-11)

## Corpus Check
- 88 files · ~118,392 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 873 nodes · 1745 edges · 42 communities (34 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `68dd046c`
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
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]

## God Nodes (most connected - your core abstractions)
1. `usePalette()` - 36 edges
2. `GLEngine` - 22 edges
3. `oklchToHex()` - 21 edges
4. `setState()` - 21 edges
5. `setState()` - 17 edges
6. `toOklch()` - 15 edges
7. `PaintSim` - 15 edges
8. `setState()` - 15 edges
9. `markSaved()` - 14 edges
10. `addSwatch()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `buildPaletteCoverage()` --calls--> `dist2()`  [INFERRED]
  src/lib/halftone.js → src/lib/lineart.js
- `BGCheck()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/BGCheck.jsx → src/tools/ColorPalette/store.js
- `ExportPanel()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/ExportPanel.jsx → src/tools/ColorPalette/store.js
- `Generators()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Generators.jsx → src/tools/ColorPalette/store.js
- `Harmony()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Harmony.jsx → src/tools/ColorPalette/store.js

## Import Cycles
- None detected.

## Communities (42 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (33): hexToRgb(), buildFaviconZip(), buildIco(), svgToPngBlob(), processFile(), readAsDataUrl(), buildTreatmentFilterStr(), isSvgLikelyBlack() (+25 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (36): C, parseColorList(), tryParseToHex(), addSwatch(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.29
Nodes (7): MaterialPanel(), clamp(), hueLerp(), MATERIAL_BY_ID, MATERIALS, pull(), suggestMaterialColors()

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (39): allowScripts, electron@29.4.6, esbuild@0.21.5, sharp@0.34.5, author, build, appId, directories (+31 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (49): BLEND_MODES, CATEGORIES, defaultLayer(), EFFECT_LIST, EFFECTS, LIST, C, CAT_LABEL (+41 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (44): buildAco(), buildAse(), buildProcreateSwatches(), C, downloadBinary(), downloadSvgAsPng(), downloadText(), ExportPanel() (+36 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (17): ALGO_GROUPS, applyMaskCpu(), C, cssRgb01(), GradientEditor(), HT_ALGOS, HT_ANGLES, HT_SHAPE_ID (+9 more)

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
Cohesion: 0.15
Nodes (8): snap(), buildGrain(), diffuseBand(), lin8(), PaintSim, smoothstep(), hexToSpectrum(), reflToKS

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (17): configGrid, controls, fallbackWrap, folderBtn, folderText, input, list, LS (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): HueChip(), ShadowHighlight(), decimalsFor(), EditableNumber(), NumberSlider(), lumaOklch(), oklchPixel()

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (17): runAutoFix(), getState(), contrast(), CVD_MATRICES, gamutMap(), inSrgbGamut(), lumaHex(), maxChromaInGamut() (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (4): buildFragment(), create(), hexToRgb01(), PostFXEngine

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (14): ANGLE_SET, buildInks(), buildPaletteCoverage(), channelCoverage(), halftoneToSvg(), luminance(), paintDot(), paintScreen() (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (27): addNoise(), ALGO_IDS, ALGORITHMS, applyLevels(), bayer(), blueNoise(), buildPalette(), clamp8() (+19 more)

### Community 24 - "Community 24"
Cohesion: 0.10
Nodes (19): oklabToHex(), buildRecipe(), CHROMA_REASON, clamp(), clampC(), combineTags(), computeIdentities(), GROUPS (+11 more)

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (10): clusterHues(), critique(), fixBtn, Harmony(), hueDist(), hueName(), mkFix(), nameOf() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (25): GradMapEditor(), LfoBlock(), PaletteManager(), PresetStrip(), applyPreset(), clearIncomingColors(), DEFAULT_STATE, getIncomingColors() (+17 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (43): adjustWeight(), applyLevels(), autoLevels(), blurH(), blurV(), boxBlurF(), chaikin(), collapseCollinear() (+35 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (7): generateRandomPalette(), Generators(), h32(), HARMONY_TYPES, HUE_MODES, lerp(), generateRamp()

### Community 31 - "Community 31"
Cohesion: 0.24
Nodes (7): isOrdered(), BUILTIN_PALETTES, hexToRgb(), sortByLuma(), isMatrixOrdered(), algoKind(), create()

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (18): deltaE(), clamp01(), deltaE(), evalMix(), hexToOklab(), _K, _lab, linearToOklab() (+10 more)

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): ditherToSvg(), hex(), wrap()

### Community 37 - "Community 37"
Cohesion: 0.08
Nodes (22): ContrastMatrix(), RATING_COLOR, PANELS, Grade(), Gradient(), SPACES, chipBtn, PaintMix() (+14 more)

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (3): Option A — Download the prebuilt app (easiest), Option B — Run from source, Running Design Tools on macOS

### Community 39 - "Community 39"
Cohesion: 0.13
Nodes (7): readAsText(), buildSvg(), C, mkRng(), S1, S2, ShapeSlot()

### Community 40 - "Community 40"
Cohesion: 0.20
Nodes (10): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, ROLE_COLORS, ROLES, Swatch(), relativeLuminance() (+2 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (17): HarmonyOverlay(), ILL_PANELS, KS8, Mixer(), rgbToOklab(), ColorPalette(), EyeDropperBtn(), generateHarmony() (+9 more)

### Community 42 - "Community 42"
Cohesion: 0.28
Nodes (7): _dirty, hasUnsavedChanges(), _listeners, markDirty(), _sync(), useUnsavedChanges(), BatchPanel()

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (8): computeMods(), frac(), lfoValue(), mkLfo(), MOTION_PARAMS, noiseWave(), PARAM_BY_KEY, WAVES

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (8): checkerBg(), DitherTool(), isCurve(), allPalettes(), canRedo(), canUndo(), getPalette(), useDither()

## Knowledge Gaps
- **160 isolated node(s):** `version`, `configurations`, `PreToolUse`, `allow`, `{ app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NumberSlider()` connect `Community 19` to `Community 37`, `Community 5`, `Community 7`, `Community 8`, `Community 41`, `Community 29`, `Community 30`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `markDirty()` connect `Community 42` to `Community 0`, `Community 1`, `Community 5`, `Community 39`, `Community 18`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `GLEngine` connect `Community 3` to `Community 31`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `PreToolUse` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08635703918722787 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07315233785822021 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._