# Design Tools rewrite: foundation

**Date:** 2026-09-27 · **Branch:** `rewrite` (from `main` at `v1-final`) · **Status:** for Luap's review
**Revision 2:** after four independent reviews (architecture, coverage against the inventory,
simplicity, design critic). The biggest changes: Library items are the document for the tools
that make them, one tool owns an item at a time, fewer dependencies and mechanisms.

This is the first of eight sub-projects. It builds what the tools share: the shell, the Library,
Send to, saving, undo, the keyboard, file loading and exporting, and the shared controls. It ships
no real tool. Each tool gets its own short spec afterwards (§14).

Inputs:
- `docs/rewrite/2026-09-27-inventory.md`: the old app and what broke. The decisions below point
  back to it.
- `docs/rewrite/design-brief.md`: the visual contract (direction C, "Instrument").
- `docs/rewrite/decisions.md`: why each dependency is here.

---

## 1. What the rewrite is

| Group | Tool | One line | Library kind it makes |
|---|---|---|---|
| Colour | **Design** | Build, check and export brand and UI palettes. | palette |
| Colour | **Illustration** | Shadow and highlight ramps, material lighting, paint mixing, paint recipes. | palette |
| Make | **Pattern** | Seamless repeat patterns from vector shapes. SVG for Illustrator, plus PNG. | pattern |
| Make | **Logo** | Lockups from an icon and a wordmark, each lockup with its own proportions. Editable vector out where possible. | logo |
| Image | **Dither** | Pixel and retro dithering. No post effects. | (renders images) |
| Image | **Halftone** | Print halftones: vector SVG for Illustrator matching the preview, screen PNG, separations. | (renders images) |
| Image | **Post FX** | Quick effect stacks for fun. Kept light. | (renders images) |

Cut: Pattern Maker's Meteorite tab, Scan to Lineart, Motion Maker. All readable at tag `v1-final`.

Decided app-wide by Luap: tools keep everything when you switch; Windows only; tools stay
separate; **Library + Send to**, nothing live-linked; look C, dark by default, light in Settings.

## 2. Stack

- Electron 44.1.1, electron-vite 5, Vite 7, React 19, TypeScript 5.9. Same as Album Tile and
  Inbetween.
- State: a small `DocController` (§8) read through React's built-in `useSyncExternalStore`.
  No state library.
- Styling: CSS modules beside each component, plus `styles/tokens.css` and `styles/base.css`.
- Tests: `node --test` on Node 26, importing `.ts` directly (as Album Tile does).
  tsconfig: `allowImportingTsExtensions`, `erasableSyntaxOnly`.
- Fonts: `@fontsource-variable/archivo/wdth.css` (the family is named **`Archivo Variable`**),
  `@fontsource/ibm-plex-mono` 400/500/600. Icons: `material-symbols/rounded.css`. Check them in
  the built app, not only the dev server.
- **The only runtime dependency in the foundation is `culori`.** Each tool's spec adds what it
  needs (utif2, fflate, gifenc…) with a line in `decisions.md`. No installer yet; Album Tile's
  electron-builder setup is copied in the first time Luap wants one.
- `package.json` has `"productName": "Design Tools"` **at the top level**, and main calls
  `app.setPath('userData', <appData>/Design Tools)` before `ready`, so dev and built runs share
  `%APPDATA%\Design Tools` and never touch the old app's `%APPDATA%\designtools`.
- `app.requestSingleInstanceLock()`: a second launch focuses the running window and quits.

## 3. Source layout

```
src/
  main/        window, IPC, LibraryService (§6), workspace files, dialogs, dt:// protocol, logs
  preload/     one typed bridge: window.api; sets the theme before first paint
  shared/      pure TS, no DOM, no Electron: types, colour (§10.2), palette readers,
               history + DocController (§8), library schema. Unit tested.
  renderer/
    shell/     App, TitleBar, Rail, StatusBar, Settings, LibraryPanel, ToolHost, toasts, keymap, drop and paste
    ui/        shared controls (§10.1)
    lib/       image loading, export, SVG helpers; gpu/ arrives with Halftone
    tools/<tool>/   one folder per tool, each exporting a ToolDefinition (§5)
    styles/    tokens.css, base.css, fonts.css
```

The old `src/` and `electron/` are deleted on this branch. Porting reads from the tag
(`git show v1-final:src/lib/dither.js`), so nothing old is copied in by accident.

## 4. Shell

- **Window:** `titleBarStyle: 'hidden'` with `titleBarOverlay: { height: 40, color, symbolColor }`
  so Windows draws its own caption buttons. Never `frame: false` (that removes them). The overlay
  and `backgroundColor` take hex, so main uses the hex values listed in the brief (§3.4 there),
  generated from the tokens, and updates them on theme change. Minimum window 1280×800.
- **Theme before first paint:** main reads the saved theme from `settings.json` and passes it to
  preload (`additionalArguments`), which sets `data-theme` on `<html>` before React runs. Light
  users never see a dark flash.
- **No default menu:** `Menu.setApplicationMenu(null)` (removes Ctrl+R reload, Ctrl+W close and
  the whole-UI zoom keys). `setVisualZoomLevelLimits(1, 1)`. DevTools on F12 in dev only. Text
  fields keep native copy, paste and undo.
- **Title bar (40px, draggable):** app mark, breadcrumb (group, tool, document name, separated
  by the `chevron_right` icon), the document state readout (§7.5), then the caption area. Title
  bar content is sized with `env(titlebar-area-width)`, not a hard-coded gutter.
- **Rail:** COLOUR, MAKE, IMAGE groups with tool names; Ctrl+1 to Ctrl+7. SHARED: Library
  (Ctrl+L), Settings (Ctrl+,).
- **Status bar (22px):** left slot for the active tool (`StatusSlot`), right slot for live readouts
  and any persistent warning (§11).
- **Start-up:** the shell creates all seven DocControllers and restores their state (§7) before
  the UI takes input. Tools' views mount the first time they are shown and **never unmount**.
  Assets decode lazily when a tool is first shown.
- **Hidden tools:** hidden with `display: none` and `inert`, and told `active: false`. A hidden
  tool stops preview loops, frees decoded pixels and GPU textures (keeping only asset ids), and
  re-decodes when shown. Exports and imports keep running and report by toast. Viewports ignore
  0×0 size reports.
- **Crash containment:** each tool sits in an error boundary. The error module offers
  "Reload tool", "Start empty (keeps the broken document)" and "Copy details". Start empty moves
  the workspace document to `workspace/<tool>/crashed/<time>.json`. If a restored document fails
  to migrate (§5) or crashes the view twice, the shell does that automatically and says so.
  A renderer crash (`render-process-gone`) makes main reload the window; restore brings everything
  back.
- **Global error handlers:** the renderer's `error` and `unhandledrejection` handlers show a
  toast and log. Main logs `uncaughtException`. Every call from the shell into a tool hook goes
  through a wrapper that turns a throw into a toast and a log line.
- **Quit:** main holds `close`, asks the renderer whether anything is still writing, waits for
  in-flight writes (up to 3s, logged if cut short), and asks once only if an export or import is
  still running ("An export is still running. Quit anyway?"). There is no "unsaved changes"
  prompt, because every commit is already written (§7).
- **Settings:** theme (Dark default, Light); Library folder (change points the app at another
  folder, moves nothing; open documents from the old folder are detached; reveal in Explorer);
  version.
- **StrictMode** stays on in dev. Everything that runs on mount is idempotent (restore, GPU
  set-up, listeners), and nothing on mount creates a history step or a write.

## 5. Tool contract

```ts
type ItemKind = 'palette' | 'pattern' | 'logo' | 'image' | 'svg'
type Use = { mode: 'open' | 'apply'; label: string }   // label shows in Send to: 'PALETTE', 'INKS', 'AS SHAPE'

interface ToolDefinition<Doc> {
  id: ToolId; label: string; group: 'colour' | 'make' | 'image'; icon: IconName; shortcut: number
  docVersion: number
  createEmptyDoc(): Doc
  migrate?(raw: unknown, fromVersion: number): Doc      // throws when it can't; shell then starts empty (§4)
  isEmpty?(doc: Doc): boolean                            // default: deep-equals createEmptyDoc()
  docName(doc: Doc): string                              // breadcrumb; shell falls back to the item name, then "Untitled"

  itemKind?: 'palette' | 'pattern' | 'logo'              // a Library item of this kind IS this tool's document (§7)
  toItem?(doc: Doc): ItemPayload                         // with itemKind: the file contents, including its preview SVG
  fromItem?(item: LoadedItem): Doc                       // with itemKind

  accepts: Partial<Record<ItemKind, Use>>                // what Send to and the Library can hand this tool
  receive(item: LoadedItem, use: Use, doc: DocController<Doc>): Promise<void>
  render?(doc: Doc, opts: { maxEdge?: number }): Promise<{ blob: Blob; name: string }>
                                                         // image tools: the full-resolution result from the
                                                         // base settings (no animation phase, no preview scale)

  onFiles?(files: File[], how: 'drop' | 'paste'): Promise<boolean>   // false: the shell offers them to the Library
  shortcuts?: Shortcut[]                                 // only while active; the shell owns the listeners
  StatusSlot?: React.ComponentType<{ doc: DocController<Doc> }>
  View: React.ComponentType<{ doc: DocController<Doc>; active: boolean }>
}
```

- `receive` with `mode: 'open'` replaces the document; with `mode: 'apply'` it merges into the
  current one (a palette becomes Dither's colours; a logo becomes a Pattern shape). Either way the
  shell wraps it in **one history step** ("Open Monolith core", "Colours from Monolith core"), so
  Ctrl+Z goes back. There is no separate "previous document" slot.
- The shell reads and validates item files and passes a typed `LoadedItem`; tools never touch
  paths. `LibraryItemRef = { id, kind, name, collection, locked }`.
- **Only the shell sets a document's `source`** (the item it is linked to), and only when an
  item of the tool's `itemKind` is received with `mode: 'open'`. Every other received item is an
  input. So ownership, locking and forking (§7.3) are enforced in one place.
- A tool is registered only when it exists. During the foundation, one dev-only stub tool
  (registered when `!app.isPackaged`) exercises Send to and holds the controls board for the
  design critic. It is deleted when the real tools arrive.

## 6. Library

**A folder on disk,** `Documents\Design Tools\Library` by default. Collections are folders one
level deep; items are single files. Browsable, backed up and synced like any folder.

```
Library/
  Monolith/
    .collection.json            { "locked": true }       (absent = unlocked)
    Monolith core.palette.json
    Bracket mark.logo.json
    Packaging stars.pattern.json
    Etch scan 04.tif
    bracket.svg
  Scratch/                      always exists, never locked
```

### 6.1 Item kinds

| Kind | File | Contents |
|---|---|---|
| palette | `<name>.palette.json` | `{ id, version, swatches: [Swatch], notes }` |
| pattern | `<name>.pattern.json` | `{ id, version, …generator settings with shapes as SVG markup, preview: { svg, tileWidth, tileHeight } }` |
| logo | `<name>.logo.json` | `{ id, version, icon: svg, wordmark: svg, …lockup settings, preview: { svg } }` |
| image | the file | png, jpg, jpeg, webp, gif, bmp, avif, tif, tiff |
| svg | the file | any loose `.svg` |

```ts
type Swatch = {
  id: string; name: string; role: string | null
  oklch: [number, number, number]                         // the truth, full float precision
  type: 'process' | 'global' | 'spot'
  source?: { space: 'rgb' | 'cmyk' | 'lab' | 'gray'; values: number[] }  // from an import; dropped when edited
}
```

- The **filename is the display name**. Names are made safe for Windows (`<>:"/\|?*` become `-`,
  trailing dots and spaces trimmed, reserved names like `CON` get a suffix). Collisions are
  checked without regard to case and get " 2", " 3".
- `role` stays a free string until the Design tool's spec fixes the vocabulary.
- Pattern and logo items carry a `preview` SVG, rewritten on every save by their tool. The Library
  shows it as the thumbnail, and "as an image" (§7.4) draws it. No tool imports another tool's code.
- Files at the Library root show in a "Library root" group that offers Move to. Deeper folders
  and unknown files are ignored and counted in the panel footer. `.ase`, `.aco` and `.gpl` files
  found in a collection are listed as **Not imported** with an Import action.

### 6.2 LibraryService (main)

One service in main owns every Library read and write.
- **Index:** scans with readdir and stat only at start-up (file contents are read lazily, so
  OneDrive on-demand files aren't downloaded). JSON items are identified by the `id` inside them;
  images and SVGs by path.
- **Watching:** `fs.watch` recursive, treated only as a hint to rescan that collection (debounced
  250ms). On a watcher error, or when the window regains focus, it rescans everything and restarts
  the watcher. It records `{ mtimeMs, size }` of every write it makes and ignores events that match.
- **Writes:** one queue per item, so writes to an item happen in order. Every write goes to a temp
  file in the same folder, then is renamed over the target, retrying for about 1s on EBUSY or EPERM
  (sync clients, antivirus, Explorer previews). A write that still fails raises the persistent
  status-bar warning (§11).
- **Thumbnails:** images use `nativeImage.createThumbnailFromPath` (Windows caches them; checked
  to work for 8-bit and 16-bit TIFFs). Palettes draw from their JSON. Patterns and logos use their
  `preview`. No thumbnail cache of our own.
- **Files reach the renderer through `dt://`:** a custom protocol (`dt://item/<id>`,
  `dt://asset/<tool>/<hash>`) that serves only files inside the Library root and the workspace.
  Dev runs on http://localhost, which may not load file:// URLs.

### 6.3 Operations

- New collection, rename, duplicate, move, delete, lock and unlock.
- **Delete** arms the inline confirm (brief §6). Confirming hides the item and shows an Undo toast.
  When the toast closes, the file goes to the Windows Recycle Bin (`shell.trashItem`); items still
  pending at quit are trashed then. A crash before that leaves the file where it was.
- **Move** (menu or drag) arms the same confirm, then moves, with Undo in the toast.
- Rename, duplicate, lock and unlock are undone by doing them again; no toast.
- Import (drag onto the Library, or the import button): `.ase`, `.aco`, `.gpl` become palettes
  (readers only in the foundation; writers come with Design); images and SVGs are copied in. Each
  import says what it made, or why not.

### 6.4 Library panel

A docked module beside the rail (Ctrl+L). Filters by kind, searches by name, shows the `accepts`
labels of the active tool on matching items (brief §7 states). Drag an item into a tool, or
double-click: it goes to the active tool if that tool accepts the kind, otherwise to the tool whose
`itemKind` matches. An image with no accepting active tool can't be double-clicked open; the
tooltip says why. The item menu: Open, Send to (tools that accept it, with their labels), Rename,
Duplicate, Move to, Reveal in Explorer, Delete. Rows show which tool has the item open.

## 7. Documents, saving and Send to

### 7.1 Tools that make an item kind (Design, Illustration, Pattern, Logo)

**The Library item is the document.**
- A new document stays in memory until its first commit. The first commit creates
  `Scratch/Untitled <kind> N` and from then on **every commit writes the item file at once**
  (through the LibraryService queue). There is no Save dialog and no debounce. Luap renames or
  moves it whenever they like.
- `workspace/<tool>/state.json` holds only the open item's id and the view state (zoom, tabs,
  panel sizes), so the tool reopens where it was.
- Undo and redo also write, so the file always matches what's on screen.

### 7.2 Tools that render images (Dither, Halftone, Post FX)

Their document is settings plus a source. `workspace/<tool>/doc.json` holds it, written on every
commit (temp file plus rename, keeping `doc.prev.json` as the last good copy). Source images are
copied into `workspace/<tool>/assets/<sha256>.<ext>` at full resolution, so the document survives
the original being deleted, and repeats are stored once. At start-up, assets no `doc.json`
references are deleted.

The item an image tool opens is always an **input**. Nothing is ever written back to it.

### 7.3 One owner per item

An item is the live document of **at most one tool**. Opening it in a second tool (from the
Library or by Send to) moves it there: the first tool's pending write finishes, then its document
is **detached**. The same rule covers every case where a document loses its file:

| Case | Title bar reads | What the next edit does | Offered |
|---|---|---|---|
| Item opened in another tool | `OPEN IN ILLUSTRATION` | forks a copy into Scratch | Take back (reloads from the file, moves ownership back) |
| Item is in a locked collection | `LOCKED · MONOLITH` | forks `Scratch/<name> copy` | none needed |
| Deleted or moved outside the app | `NOT IN LIBRARY` | forks into Scratch | none |
| Changed outside the app (sync, Explorer, another program) | `CHANGED ON DISK` | writing is paused | Reload from disk, or keep mine as a copy |

"Changed outside" is detected by comparing the file's `{ mtimeMs, size }` with what the service
last read or wrote, before each write and on watcher events. Locking a collection detaches any of
its items that are open.

### 7.4 Send to

From a tool's Send to button or the Library item menu. The submenu lists tools that accept the
kind, with their `Use` label.
1. **From a tool with `itemKind`:** the item already exists (first commit made it). If the document
   is still empty, Send to is disabled.
2. **From an image tool:** `render()` produces the full-resolution result from the base settings,
   saved as a new image `Scratch/<source name> · <tool>.png`.
3. The shell switches to the target and calls `receive(item, use)`, one history step there. The
   toast says what happened and that Ctrl+Z goes back.

"As an image": when an image target receives a pattern, logo or svg, the shell rasterises it
through an `<img>` onto a canvas. A pattern is its preview tile repeated to fill a square of
`maxEdge` pixels at the tile's own scale; a logo is its preview lockup, trimmed and transparent;
an svg is drawn at `maxEdge` on its long side. `maxEdge` is 4096 unless the target's spec says
otherwise.

Starting points for `accepts` (each tool's spec can refine them):

| Target | palette | pattern | logo | svg | image |
|---|---|---|---|---|---|
| Design | open | | apply: brand colours | apply: colours | apply: extract palette |
| Illustration | open | | | | apply: pick colours |
| Pattern | apply: shape colours | open | apply: as shape | apply: as shape | |
| Logo | apply: brand colours | | open | apply: as part | |
| Dither | apply: palette | as image | as image | as image | open |
| Halftone | apply: inks | as image | as image | as image | open |
| Post FX | apply: effect colours | as image | as image | as image | open |

This runs on an in-app event. There's no localStorage, no single slot, no "read it when you next
mount", and no downscaling. Every one of those was an inventory bug.

### 7.5 Document state readout

The title bar shows one of: `SAVED 14:32 · SCRATCH`, the detached states in §7.3, or for image
tools `WORKSPACE`. Restoring, opening and load-time analysis never count as edits: they don't
create history steps, don't write and don't change the readout.

## 8. Undo

- **Per tool.** A history entry is `{ data, source }`, so undoing an Open restores the previous
  document and its item link. If another tool took that item in the meantime, the restored
  document comes back detached (`OPEN IN …`, §7.3) rather than taking the item back. View state (zoom, selection, tabs, panel sizes) is never in history.
  Saved presets are not document state either: they live in `presets/<tool>.json`, never enter
  history, and a preset delete uses the confirm plus an Undo toast.
- **DocController API** (`shared/doc.ts`, about 60 lines over `shared/history.ts`):
  `get`, `subscribe`, `begin()`, `set(fn)`, `commit(label)`, `cancel()`, `transact(label, fn)`,
  `undo`, `redo`, `undoLabel`, `redoLabel`, `source`, `state`, `ready`.
  - Gestures call `begin` at the start and `commit` at the end: pointer up, Enter or blur, a click.
    `cancel` restores the state from `begin` and adds no step. One-off changes use `transact`.
    `set` outside a gesture throws in dev.
  - The shell commits an open gesture on `lostpointercapture`, window blur and tool hide.
  - A commit that changes nothing adds no step.
  - **Key repeat coalesces:** a commit with the same control and label as the previous step, within
    1s and with nothing in between, replaces that step. The step still lands at once, so the old
    fast-undo race (a debounced snapshot wiping redo) cannot happen.
  - History is an array of immutable document references (spread updates share structure).
    It keeps 200 steps and **lasts for the session**; it isn't saved across restarts.
- **Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z routing, in order:**
  1. A text field holding an uncommitted edit takes it (its own native undo).
  2. While an Undo toast is showing and no tool commit has happened since it appeared, it triggers
     the toast's Undo (Library delete and move). After the next tool commit the toast stays
     clickable but drops its `Ctrl Z` hint.
  3. Otherwise the active tool's history. During an open gesture, Ctrl+Z cancels the gesture.
- The undo button's tooltip names the step ("Undo: change frequency").

## 9. Keyboard, pointer and drag

The shell owns every window-level listener and routes to the active tool only.
- **Tab and Shift+Tab only move focus.** No tool may bind them. F6 cycles regions (brief §6).
- **Bare-letter shortcuts, Space, and Ctrl+C/V/X are ignored by tools while a text field has
  focus.**
- **Space held with the pointer over a Viewport pans**, whatever else has focus (except a text
  field). Tools with a timeline use a quick tap of Space for play and pause (After Effects).
- **Viewport zoom:** Ctrl+0 Fit, Ctrl+Alt+0 100%, Ctrl+= and Ctrl+- zoom, wheel over the canvas
  zooms. Registered as native non-passive listeners.
- **The mouse wheel never changes a value.** Over panels it scrolls; over a Viewport it zooms.
  Selects, steppers and number fields change only by click, drag or keys.
- **Paste:** a text field gets it; otherwise the active tool's `onFiles(…, 'paste')`; if the tool
  declines, it is offered to the Library.
- **Drag types** route by `dataTransfer.types`: Library items carry
  `application/x-designtools-item`, internal reorders carry `application/x-designtools-reorder`,
  and OS files are files. An OS file drop anywhere in a tool, including over lists, goes to
  `onFiles(…, 'drop')`; reorder targets ignore it. A **global guard** prevents drops from navigating
  the window, and main denies `will-navigate`.
- Every control is a focusable native element; a Toggle's label toggles it.

## 10. Shared parts

### 10.1 Controls (`renderer/ui`)

The foundation builds what the shell uses plus the primitives that set the look: Button,
IconButton, TextInput, **NumberField**, **Slider** (always with a NumberField), Segmented,
Select, Toggle, Module, SectionHeader, ConfirmInline, Toast, Tooltip, ContextMenu (with
submenus), LibraryItem, EmptyState, Progress. Behaviour and states follow the brief.
`IconName` is a string-literal union generated from the icon font's codepoints file, so a typo
fails type-checking (the inventory had blank icon buttons from misspelt names).

Built later, with the tool that first needs them, so real use shapes them:
- **ColorField, Picker and the eyedropper** come with Design. The eyedropper is the native
  `EyeDropper` API; the old desktopCapturer version is ported only if the native one can't reach
  the second monitor.
- **Viewport** comes with Pattern; rulers with Halftone.

### 10.2 Colour (`shared/color`)

A thin wrapper over culori, the one colour library (the inventory found three OKLCH↔sRGB copies,
three Kubelka-Munk copies, four `hexToRgb` copies, and a 3-digit-hex bug that turned half the
checks into NaN).
- OKLCH is stored. Hex out is always 6 digits (`formatHex`); hex in accepts 3 digits and no `#`.
- Out-of-gamut colours map to sRGB by reducing chroma in OKLCH (CSS Color 4). Gamut checks run on
  OKLCH, never on hex (a hex can't be out of gamut, which is why the old checks never fired).
- `wcagContrast`, and `wcagGrade(ratio)` returning `'AAA' | 'AA' | 'AA large · non-text' | 'Fail'`,
  used by every contrast readout. CIEDE2000 on its 0–100 scale. CVD through culori's Machado 2009
  filters.
- ≈CMYK is hand-written and always labelled as an estimate.
- Palette **readers** for ASE (keeps global and spot flags and the original CMYK or Lab values in
  `source`), ACO v1 and v2, and GPL.
- Reference ink libraries (Riso, RAL, HKS, NCS) will live once in `shared/color/inks`, as OKLCH,
  when Design first needs them. Halftone and Dither presets use the same list.
- Tests cover only the wrapper's traps (3-digit input comes out 6 digits, ΔE on 0–100, readers
  on real sample files), not culori itself.

### 10.3 Loading files (`renderer/lib/load`)

- Images: `createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`
  for png, jpg, webp, gif (first frame), bmp and avif. **Full resolution, alpha kept.** It rejects
  on bad data, so nothing hangs. TIFF, all GIF frames and DPI arrive with the tools that need them.
  Anything unsupported gets a plain message ("PSD files aren't supported. Export a PNG or TIFF.").
- SVG: the app never places a user SVG in the page DOM as-is. Thumbnails and rasterising go
  through `<img>` from a Blob URL, a separate document where nothing leaks. Tools that must inline
  SVG (Logo, Pattern) run it through `shared/svg.namespace()` first, which prefixes ids, rewrites
  `url(#…)` and `href`, and scopes `<style>` rules. Measuring artwork bounds is specified with Logo.

### 10.4 Exporting (`renderer/lib/export` + main)

- `saveFile` through the native save dialog, remembering the last folder per tool and file type.
- Overwriting is reversible: write `<name>.tmp` first; if that works, send the old file to the
  Recycle Bin, then rename the temp into place. On drives without a Recycle Bin (removable and
  network drives, checked once per volume), the old file is renamed to
  `<name> (replaced YYYY-MM-DD HHMM).<ext>` instead.
- Multi-file exports write into one chosen folder with the same rule per file, never a burst of
  dialogs.
- **Every failure is shown** as a toast with a plain message; details go to
  `%APPDATA%\Design Tools\logs\`.
- Animated exports (GIF, frame ZIP, maybe video) must be **one shared path**,
  `exportFrames(render(i), count, fps)`, built with Dither: exactly `count` frames rendered offline,
  streamed to the encoder, GIF delays carrying their rounding so the loop length is exact.

### 10.5 GPU passes (`renderer/lib/gpu`)

Designed here, built with Halftone. **One WebGL2 context for the whole app** (Chromium drops
contexts past about 16). Tools show results on 2D or bitmaprenderer canvases. Half-float targets,
ping-pong chains, full-resolution readback, context-loss recovery. A shader that fails to compile
or link throws with the GPU log. It never silently falls back to pass-through (inventory: Post FX
did). Hidden tools free their targets.

## 11. Errors and edge cases

- Empty states in every tool and the Library say what to drop, paste or pick.
- The Library folder is missing or unreadable: the Library shows the problem with "Choose folder";
  tools keep working, and their documents stay in memory and workspace.
- A write that keeps failing (disk full, permissions, locked by sync): a persistent warning in
  the status bar until it succeeds, never a toast that goes away.
- Document shape changed between builds: `migrate`, or start empty and keep the old file (§4).

## 12. Testing and verification

- **Unit (`node --test`):** colour wrapper traps; palette readers against real .ase, .aco and .gpl
  files; history (begin, commit, cancel, redo truncation, key-repeat coalescing, no-op commits);
  DocController; LibraryService against a temp folder (safe names, case-insensitive collisions,
  one owner per item, locked fork, changed-outside detection, ignoring its own writes, atomic writes,
  delete then undo).
- **Smoke:** `electron . --smoke` with a temp user-data folder and a temp Library:
  - it opens every registered tool, imports a sample palette and image, and sends between two
    stub tools
  - it opens one palette in two tools and checks ownership moved
  - it exports, and checks the files exist
  - then it relaunches with that workspace, quits with no input, and checks that no Library file's
    mtime changed and every history depth is 0
  - it exits non-zero on any failure, and checks userData ends in `Design Tools`
- **Visual:** screenshots of the shell and the controls board in both themes; the
  `design-critic` agent reviews them against the brief before the foundation is called done.

**Done means:** the app launches into the shell with a dev stub tool. The Library works on a real
folder, including import, delete with confirm and undo, move, lock and fork, and outside changes.
Send to and ownership work between stubs. Undo routing works as in §8. State survives a restart.
Both themes pass the design critic. `npm test` and `--smoke` pass.

## 13. Not in the foundation

Command palette, a custom accent colour, APCA, ICC-accurate CMYK, PSD import, macOS, an installer,
importing the old app's saved data (export anything worth keeping from `v1-final` as ASE or PNG
and drop it into the Library).

## 14. Build order after the foundation

Each starts with a short spec of what to keep, cut and add, which Luap approves before it is built.

1. **Colour: Design**: brings ColorField, Picker, eyedropper, palette writers, ink libraries.
2. **Colour: Illustration**
3. **Pattern**: brings the Viewport.
4. **Logo**: brings SVG artwork measuring.
5. **Halftone**: brings the GPU runner, rulers, TIFF, DPI.
6. **Dither**: brings `exportFrames`, GIF frames.
7. **Post FX**
