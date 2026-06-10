# Graph Report - designtools  (2026-06-10)

## Corpus Check
- 83 files · ~103,353 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 817 nodes · 1619 edges · 42 communities (34 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1353ff9f`
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
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]

## God Nodes (most connected - your core abstractions)
1. `usePalette()` - 32 edges
2. `GLEngine` - 22 edges
3. `setState()` - 21 edges
4. `oklchToHex()` - 19 edges
5. `setState()` - 17 edges
6. `PaintSim` - 15 edges
7. `markSaved()` - 14 edges
8. `addSwatch()` - 14 edges
9. `setState()` - 14 edges
10. `toOklch()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `BGCheck()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/BGCheck.jsx → src/tools/ColorPalette/store.js
- `ExportPanel()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/ExportPanel.jsx → src/tools/ColorPalette/store.js
- `Generators()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/Generators.jsx → src/tools/ColorPalette/store.js
- `MaterialPanel()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/MaterialPanel.jsx → src/tools/ColorPalette/store.js
- `ShadowHighlight()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/ShadowHighlight.jsx → src/tools/ColorPalette/store.js

## Import Cycles
- None detected.

## Communities (42 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (33): buildFaviconZip(), buildIco(), svgToPngBlob(), processFile(), readAsDataUrl(), readAsText(), buildTreatmentFilterStr(), isSvgLikelyBlack() (+25 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (36): C, parseColorList(), tryParseToHex(), addSwatch(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (20): oklabToHex(), DiceBtn(), buildRecipe(), CHROMA_REASON, clamp(), clampC(), combineTags(), computeIdentities() (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (39): allowScripts, electron@29.4.6, esbuild@0.21.5, sharp@0.34.5, author, build, appId, directories (+31 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (42): BLEND_MODES, CATEGORIES, defaultLayer(), EFFECT_LIST, EFFECTS, LIST, C, EffectControls() (+34 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (44): buildAco(), buildAse(), buildProcreateSwatches(), C, downloadBinary(), downloadSvgAsPng(), downloadText(), ExportPanel() (+36 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (14): ALGO_GROUPS, applyMaskCpu(), C, HT_ALGOS, HT_ANGLES, HT_SHAPE_ID, selectStyle, SHAPE_IDX (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (7): Mixer(), useMixingWell(), PIGMENT_BY_ID, PIGMENTS, pigmentTraits(), ks1(), makePaint()

### Community 9 - "Community 9"
Cohesion: 0.20
Nodes (4): { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen }, { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }, fs, path

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (22): B_BLUE, B_CYAN, B_GREEN, B_MAGENTA, B_RED, B_WHITE, B_YELLOW, CMF_X (+14 more)

### Community 17 - "Community 17"
Cohesion: 0.24
Nodes (4): snap(), diffuseBand(), PaintSim, smoothstep()

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (17): configGrid, controls, fallbackWrap, folderBtn, folderText, input, list, LS (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (7): MaterialPanel(), clamp(), hueLerp(), MATERIAL_BY_ID, MATERIALS, pull(), suggestMaterialColors()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (7): HueChip(), ShadowHighlight(), decimalsFor(), EditableNumber(), NumberSlider(), lumaOklch(), oklchPixel()

### Community 21 - "Community 21"
Cohesion: 0.23
Nodes (4): buildFragment(), create(), hexToRgb01(), PostFXEngine

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (15): ANGLE_SET, buildInks(), buildPaletteCoverage(), channelCoverage(), halftoneToSvg(), luminance(), paintDot(), paintScreen() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (26): addNoise(), ALGO_IDS, ALGORITHMS, applyLevels(), bayer(), blueNoise(), buildPalette(), clamp8() (+18 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (16): ContrastMatrix(), RATING_COLOR, PANELS, Grade(), Gradient(), SPACES, PaletteStrip(), AddBtn() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (18): runAutoFix(), autoName(), contrast(), CVD_MATRICES, deltaE(), gamutMap(), inSrgbGamut(), lumaHex() (+10 more)

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (4): buildGrain(), lin8(), ksToRefl(), spectrumToLinearInto()

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (5): buildSvg(), C, mkRng(), S1, S2

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (24): GradMapEditor(), PaletteManager(), PresetStrip(), applyPreset(), clearIncomingColors(), DEFAULT_STATE, getIncomingColors(), getState() (+16 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (42): adjustWeight(), applyLevels(), autoLevels(), blurH(), blurV(), boxBlurF(), chaikin(), collapseCollinear() (+34 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (8): generateRandomPalette(), Generators(), h32(), HARMONY_TYPES, HUE_MODES, lerp(), ICONS, generateRamp()

### Community 31 - "Community 31"
Cohesion: 0.24
Nodes (7): isOrdered(), BUILTIN_PALETTES, hexToRgb(), sortByLuma(), isMatrixOrdered(), algoKind(), create()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (5): hexToLinear(), hexToSpectrum(), linearToSpectrum(), linearToSpectrumInto(), reflToKS

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): ditherToSvg(), hex(), wrap()

### Community 35 - "Community 35"
Cohesion: 0.28
Nodes (7): _dirty, hasUnsavedChanges(), _listeners, markDirty(), _sync(), useUnsavedChanges(), BatchPanel()

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (3): Option A — Download the prebuilt app (easiest), Option B — Run from source, Running Design Tools on macOS

### Community 40 - "Community 40"
Cohesion: 0.20
Nodes (10): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, ROLE_COLORS, ROLES, Swatch(), relativeLuminance() (+2 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (19): HarmonyOverlay(), ILL_PANELS, KS8, Mixer(), rgbToOklab(), ColorPalette(), EyeDropperBtn(), generateHarmony() (+11 more)

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (8): checkerBg(), DitherTool(), isCurve(), allPalettes(), canRedo(), canUndo(), getPalette(), useDither()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): cssRgb01(), GradientEditor(), setInkCtl()

## Knowledge Gaps
- **148 isolated node(s):** `version`, `configurations`, `PreToolUse`, `allow`, `{ app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }` (+143 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NumberSlider()` connect `Community 20` to `Community 5`, `Community 7`, `Community 8`, `Community 41`, `Community 24`, `Community 29`, `Community 30`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `markDirty()` connect `Community 35` to `Community 0`, `Community 1`, `Community 5`, `Community 18`, `Community 27`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `GLEngine` connect `Community 3` to `Community 31`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `PreToolUse` to the rest of the system?**
  _148 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08635703918722787 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07390648567119155 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09971509971509972 - nodes in this community are weakly interconnected._