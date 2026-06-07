# Graph Report - src  (2026-06-03)

## Corpus Check
- 41 files · ~31,405 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 249 nodes · 564 edges · 8 communities
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

## God Nodes (most connected - your core abstractions)
1. `setState()` - 21 edges
2. `usePalette()` - 20 edges
3. `toOklch()` - 12 edges
4. `oklchToHex()` - 12 edges
5. `btn()` - 11 edges
6. `addSwatch()` - 10 edges
7. `hexToCmyk()` - 9 edges
8. `wcagContrast()` - 9 edges
9. `C` - 9 edges
10. `toHex()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `getChannels()` --calls--> `hexToCmyk()`  [EXTRACTED]
  tools/ColorPalette/Picker.jsx → lib/cmyk.js
- `getSliderGradient()` --calls--> `hexToCmyk()`  [EXTRACTED]
  tools/ColorPalette/Picker.jsx → lib/cmyk.js
- `Swatch()` --calls--> `wcagContrast()`  [EXTRACTED]
  tools/ColorPalette/Swatch.jsx → lib/color.js
- `defaultSwatch()` --calls--> `toOklch()`  [EXTRACTED]
  tools/ColorPalette/store.js → lib/color.js
- `buildAco()` --calls--> `toRgb255()`  [EXTRACTED]
  tools/ColorPalette/ExportPanel.jsx → lib/color.js

## Import Cycles
- None detected.

## Communities (8 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (23): cmykToHex(), getChannels(), getSliderGradient(), GradientSlider(), hexFromChannels(), hexToHsl(), hexToRgb01(), hexToRgb255() (+15 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (15): TOOLS, C, processFile(), readAsDataUrl(), readAsText(), buildTreatmentFilterStr(), isSvgLikelyBlack(), parseSvgText() (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (34): PANELS, C, parseColorList(), tryParseToHex(), bulkRemove(), bulkUpdate(), clearSelected(), DEFAULT_STATE (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (18): runAutoFix(), HARMONY_TYPES, HarmonyOverlay(), ILL_PANELS, Mixer(), addSwatch(), getState(), contrast() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (13): toJson(), PrintPanel(), setPrintProfile(), setRisoMode(), getProfile(), hexToCmyk(), rgbToCmyk(), richBlackSuggestion() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (30): hexToRgb(), buildFaviconZip(), buildIco(), svgToPngBlob(), BackgroundRow(), ClearspaceSection(), MinSizeStrip(), FaviconExport() (+22 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (18): BGCheck(), ContrastCard(), findLForContrast(), PRESETS, ContrastMatrix(), RATING_COLOR, DesignMode(), ColorPalette() (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (7): buildAco(), buildAse(), buildProcreateSwatches(), C, ExportPanel(), toGpl(), toRgb255()

## Knowledge Gaps
- **22 isolated node(s):** `TOOLS`, `C`, `_cache`, `PRESETS`, `RATING_COLOR` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `usePalette()` connect `Community 6` to `Community 2`, `Community 3`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `oklchToHex()` connect `Community 3` to `Community 0`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `toOklch()` connect `Community 3` to `Community 0`, `Community 2`, `Community 7`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `TOOLS`, `C`, `_cache` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08172043010752689 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0783673469387755 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.13446969696969696 - nodes in this community are weakly interconnected._