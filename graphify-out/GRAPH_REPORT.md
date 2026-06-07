# Graph Report - designtools  (2026-06-07)

## Corpus Check
- 69 files · ~75,508 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 623 nodes · 1210 edges · 36 communities (29 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

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
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `usePalette()` - 24 edges
2. `GLEngine` - 22 edges
3. `setState()` - 21 edges
4. `PaintSim` - 15 edges
5. `oklchToHex()` - 14 edges
6. `setState()` - 14 edges
7. `toOklch()` - 12 edges
8. `markSaved()` - 12 edges
9. `addSwatch()` - 11 edges
10. `DitherTool()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `BGCheck()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/BGCheck.jsx → src/tools/ColorPalette/store.js
- `MaterialPanel()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/MaterialPanel.jsx → src/tools/ColorPalette/store.js
- `ShadowHighlight()` --calls--> `usePalette()`  [EXTRACTED]
  src/tools/ColorPalette/ShadowHighlight.jsx → src/tools/ColorPalette/store.js
- `getChannels()` --calls--> `hexToCmyk()`  [EXTRACTED]
  src/tools/ColorPalette/Picker.jsx → src/lib/cmyk.js
- `getSliderGradient()` --calls--> `hexToCmyk()`  [EXTRACTED]
  src/tools/ColorPalette/Picker.jsx → src/lib/cmyk.js

## Import Cycles
- None detected.

## Communities (36 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (39): hexToRgb(), buildFaviconZip(), buildIco(), svgToPngBlob(), processFile(), readAsDataUrl(), readAsText(), buildTreatmentFilterStr() (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (36): C, parseColorList(), tryParseToHex(), addSwatch(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (12): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, ROLE_COLORS, ROLES, Swatch(), oklchToHex() (+4 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (36): allowScripts, electron@29.4.6, esbuild@0.21.5, sharp@0.34.5, author, build, appId, directories (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (20): buildAco(), buildAse(), buildProcreateSwatches(), C, downloadBinary(), downloadSvgAsPng(), downloadText(), toGpl() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.20
Nodes (20): cmykToHex(), getChannels(), getSliderGradient(), GradientSlider(), hexFromChannels(), hexToHsl(), hexToRgb01(), hexToRgb255() (+12 more)

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
Cohesion: 0.05
Nodes (27): ICONS, C, _dirty, hasUnsavedChanges(), _listeners, markDirty(), _sync(), useUnsavedChanges() (+19 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (7): MaterialPanel(), clamp(), hueLerp(), MATERIAL_BY_ID, MATERIALS, pull(), suggestMaterialColors()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (7): HueChip(), ShadowHighlight(), decimalsFor(), EditableNumber(), NumberSlider(), lumaOklch(), oklchPixel()

### Community 21 - "Community 21"
Cohesion: 0.20
Nodes (8): ContrastMatrix(), RATING_COLOR, PANELS, ExportPanel(), Generators(), HarmonyOverlay(), PaletteStrip(), usePalette()

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (14): ANGLE_SET, buildInks(), buildPaletteCoverage(), channelCoverage(), halftoneToSvg(), luminance(), paintDot(), paintScreen() (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (27): addNoise(), ALGO_IDS, ALGORITHMS, applyLevels(), bayer(), blueNoise(), buildPalette(), clamp8() (+19 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (14): ILL_PANELS, KS8, Mixer(), ColorPalette(), EyeDropperBtn(), interpolate(), ksToReflectance(), linearToSrgb8() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (17): runAutoFix(), autoName(), contrast(), deltaE(), gamutMap(), generateHarmony(), generateRamp(), inSrgbGamut() (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (4): buildGrain(), lin8(), ksToRefl(), spectrumToLinearInto()

### Community 27 - "Community 27"
Cohesion: 0.40
Nodes (3): _cache, cacheKey(), nearestMatch()

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (24): GradMapEditor(), PaletteManager(), PresetStrip(), applyPreset(), clearIncomingColors(), DEFAULT_STATE, getIncomingColors(), getState() (+16 more)

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (8): checkerBg(), DitherTool(), isCurve(), allPalettes(), canRedo(), canUndo(), getPalette(), useDither()

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (5): generateRandomPalette(), h32(), HARMONY_TYPES, HUE_MODES, lerp()

### Community 31 - "Community 31"
Cohesion: 0.24
Nodes (7): isOrdered(), BUILTIN_PALETTES, hexToRgb(), sortByLuma(), isMatrixOrdered(), algoKind(), create()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (5): hexToLinear(), hexToSpectrum(), linearToSpectrum(), linearToSpectrumInto(), reflToKS

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): ditherToSvg(), hex(), wrap()

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): cssRgb01(), GradientEditor(), setInkCtl()

## Knowledge Gaps
- **116 isolated node(s):** `version`, `configurations`, `PreToolUse`, `allow`, `{ app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session }` (+111 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GLEngine` connect `Community 3` to `Community 31`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `markDirty()` connect `Community 18` to `Community 0`, `Community 1`, `Community 28`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `NumberSlider()` connect `Community 20` to `Community 24`, `Community 8`, `Community 30`, `Community 7`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `PreToolUse` to the rest of the system?**
  _116 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05926251097453907 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07390648567119155 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._