# Decisions

One entry per dependency or structural choice, with the reason. Add one before adding a dependency.

## 2026-09-27: foundation stack

- **Electron 44.1.1 + electron-vite 5 + React 19 + TypeScript 5.9 + Vite 7.** Same stack as Album
  Tile and Inbetween, so all of Luap's Electron apps work the same way.
- **No state library.** DocController (about 60 lines) plus React's `useSyncExternalStore`
  covers one document per tool with undo. Zustand would be a second container around the same data.
- **`node --test`, no Vitest.** Node 26 runs `.ts` directly; Album Tile already works this way.
- **`culori`** is the one colour library: gamut checks and mapping, WCAG contrast, CIEDE2000, and
  Machado 2009 CVD filters are all built in, and `formatHex` always gives 6 digits. It replaces
  colorjs.io and the hand-written copies in v1.
- **Fonts:** `@fontsource-variable/archivo` (the width axis via `wdth.css`; the family is
  "Archivo Variable") and `@fontsource/ibm-plex-mono`. Both OFL, bundled, no CDN.
- **Icons:** the `material-symbols` package (Rounded), bundled. Luap's hard rule.
- **No electron-builder yet.** Luap runs from source; Album Tile's NSIS setup gets copied in when
  an installer is wanted.

## Deferred to the tool that first needs them

| Dependency | Arrives with | Why then |
|---|---|---|
| `utif2` (TIFF read) | Halftone, or Design if it extracts from TIFF | the Library's thumbnails already come from `nativeImage.createThumbnailFromPath` |
| `fflate` (zip) | Logo (favicons) or Design (.swatches) | no zip in the foundation |
| `gifenc` (GIF) | Dither (`exportFrames`) | the first animated export |
