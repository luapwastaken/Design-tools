# Foundation: build plan

Implements `docs/superpowers/specs/2026-09-27-rewrite-foundation-design.md` (the spec) to the look in
`docs/rewrite/design-brief.md` (the brief). Contracts already in the repo, which every unit codes
against and must not change without saying so in its report:

- `src/shared/types.ts`: Library, settings, workspace types
- `src/shared/api.ts`: every IPC call and event (`Api`, `ApiEvents`, `Bridge`)
- `src/shared/doc-api.ts`: `DocController`, `DocSource`, `DocState`
- `src/renderer/shell/tool.ts`: `ToolDefinition`, `Use`, `Shortcut`, `IconName`
- `src/renderer/styles/tokens.css`, `base.css`, `fonts.css`

One deliberate change from spec §5: `receive(item, use, current)` **returns the next document** and
the shell commits it as the one history step, so tools can never produce a partial history.

Conventions: TypeScript strict, `.ts`/`.tsx` imports with extensions, no new dependencies (culori is
the only runtime one), tests in `test/*.test.ts` run by `node --test` (Node 26 strips types; tests
may only import modules that don't import `electron` or `.css`), CSS modules beside components,
colours only through tokens, icons only through `<Icon>`.

## Phase 1 (parallel; each unit owns only its files)

### Unit C: colour (`src/shared/color/`)
- `index.ts`: thin wrapper over culori. `parseHex(s)` (3 or 6 digits, `#` optional; returns null on
  junk), `toHex(oklch)` (always 6 digits, gamut-mapped to sRGB by chroma reduction),
  `hexToOklch(hex)`, `inSrgb(oklch)`, `inP3(oklch)`, `toSrgbGamut(oklch)`, `contrast(a, b)` (WCAG 2,
  hex or oklch in), `wcagGrade(ratio)` → `'AAA' | 'AA' | 'AA large · non-text' | 'Fail'`,
  `deltaE(a, b)` (CIEDE2000, 0–100), `simulateCvd(oklch, 'protan' | 'deutan' | 'tritan' | 'achromat', severity = 1)`,
  `cmykEstimate(oklch)` → `[c, m, y, k]` 0–100 (clearly an estimate), `cssColor(oklch)` →
  `oklch(L C H)` string for inline styles of **content** colours.
- `palette-readers.ts`: `readPaletteFile(ext: 'ase' | 'aco' | 'gpl', bytes: Uint8Array, fallbackName: string): { name: string; swatches: Swatch[]; warnings: string[] }`.
  ASE keeps groups flattened (group name prefixed as `Group / Name`), global/spot/process flags, and
  the original RGB/CMYK/Lab/Gray values in `source`. ACO v1 and v2 (v2 names). GPL. Swatch ids are
  fresh random ids (`crypto.randomUUID()`).
- Tests: `test/color.test.ts` (the 3-digit trap, gamut mapping keeps 6 digits, ΔE scale, grades at
  4.5/3/7 boundaries, CVD returns valid colours), `test/palette-readers.test.ts` using the real files
  in `D:/stuff/!projects/Design tool/export test/` (copy the `.ase` files into `test/fixtures/`), plus
  hand-built ACO v1/v2 and GPL buffers.

### Unit H: history and document controller (`src/shared/history.ts`, `src/shared/doc.ts`)
- `history.ts`: generic bounded undo stack of immutable entries with labels and keys.
- `doc.ts`: `createDocController<D>(toolId, initial, options?): DocController<D>` implementing every
  method in `doc-api.ts` exactly as documented there and in spec §8 (gestures, cancel, transact,
  no-op commits add nothing, key-repeat coalescing within 1s via injected `now`, redo truncation,
  200 limit, `reset` without history, `receive` as one step, `onChange` with causes, entries are
  `{ data, source }`). No DOM, no timers.
- Tests: `test/doc.test.ts` covering every rule, including "fast undo right after a commit" (the old
  race) and "undo of receive restores the previous source".

### Unit L: Library service (`src/main/library/`)
Pure Node modules; anything Electron is injected so tests run under `node --test`.
- `names.ts`: `safeName(name)` (Windows-forbidden characters to `-`, trailing dots and spaces
  trimmed, reserved names suffixed, empty to "Untitled"), `uniqueName(dir, base, suffix)`
  (case-insensitive, " 2", " 3").
- `scan.ts`: build a `LibraryIndex` from the root with readdir and stat only (spec §6.1 rules:
  collections one level deep, root files in collection `''`, `.collection.json` `{ locked }`,
  unknown files and deeper folders counted in `ignored`, `.ase/.aco/.gpl` listed in `notImported`,
  doc kinds identified by the `id` inside the JSON, read lazily and cached by `{mtimeMs,size}`;
  images and SVGs by path; a JSON with no id gets `path:<relative path>`).
- `service.ts`: `class LibraryService` with methods mirroring the `library.*` and `collection.*`
  entries of `Api` (same names in camelCase: `index()`, `read(id)`, `stat(id)`, `write(id, payload, expected)`,
  `create(collection, name, payload)`, `createImage(...)`, `rename`, `move`, `duplicate`, `hide`,
  `unhide`, `trash`, `import(paths, collection)`, `collectionCreate`, `collectionRename`,
  `collectionSetLocked`, plus `pathOf(id): string | null`, `setRoot(root)`, `start()`, `stop()`,
  `rescanAll()`). Constructor: `new LibraryService(root, platform, onChange)` where
  `platform = { trashItem(path): Promise<void>; now(): number }` and `onChange(index)` fires after
  any change (debounced 100ms). Rules: one write queue per item; atomic writes (temp file in the same
  folder, rename, retry ~1s on EBUSY/EPERM); `write` compares the file's current `{mtimeMs,size}`
  with `expected` and returns `changed-outside` / `missing` without writing; records stamps of its
  own writes and ignores matching watcher events; `fs.watch(root, { recursive: true })` only
  schedules a debounced (250ms) rescan of the affected collection; a watcher error rescans all and
  restarts it; `hide` removes the item from `index()` until `unhide` or `trash`; `trash` calls
  `platform.trashItem`; `create` always makes Scratch if missing; `Scratch` can't be locked,
  renamed or deleted; import converts `.ase/.aco/.gpl` through `readPaletteFile` from
  `src/shared/color/palette-readers.ts` (Unit C; code against the signature above) and copies images
  and SVGs; every import result names what it made or why not.
- Tests: `test/library.test.ts` against a temp folder (names, collisions, scan rules, create/read/
  write round trip, changed-outside and missing, own writes don't trigger changes, hide/unhide/trash,
  move and rename keep ids, lock blocks nothing at this level (locking is enforced in the shell),
  import of an .ase fixture once Unit C's reader exists: skip if absent).

### Unit M: main process (`src/main/` except `library/`, plus `src/preload/`)
- `index.ts`: single-instance lock (second launch focuses and quits); userData set before ready
  (already there); `--smoke` → temp userData and temp Library (under `os.tmpdir()`), passes
  `--dt-smoke` to the renderer, exits with the code the renderer reports via `app.smokeDone`
  (timeout 120s → exit 2); window as in spec §4 (overlay hex per theme from `THEME_HEX`, theme from
  settings, `additionalArguments` with `--dt-theme`); `Menu.setApplicationMenu(null)`;
  `setVisualZoomLevelLimits(1,1)` and block Ctrl+= / Ctrl+- / Ctrl+0 page zoom via
  `before-input-event` only for the page-zoom accelerators (the renderer gets Ctrl+= etc. for canvas
  zoom through its own keydown); F12 toggles DevTools when not packaged; `will-navigate` and
  `setWindowOpenHandler` deny; `render-process-gone` → reload; close handshake (spec §4: hold
  `close`, send `app.closeRequest`, wait for `app.closeReply` up to 3s, ask "An export is still
  running. Quit anyway?" only when busy); logging of `uncaughtException`.
- `settings.ts`: `settings.json` in userData with defaults (`theme: 'dark'`, `libraryRoot:
  Documents\Design Tools\Library`, `exportFolders: {}`); atomic writes; `settings.set` applies theme
  to the window (`setBackgroundColor`, `setTitleBarOverlay`) and restarts the LibraryService on a
  root change.
- `workspace.ts`: everything under `workspace.*` and `presets.*` in `Api` (atomic, `state.prev.json`
  fallback, `crashed/`, sha256 assets, gc).
- `export.ts`: `export.save` and `export.toFolder` exactly as the `Api` comments say; drive type
  (fixed vs removable/network) checked once per volume letter with
  `powershell -NoProfile -Command "(Get-Volume -DriveLetter X).DriveType"`, cached, defaulting to
  "no Recycle Bin" when unknown.
- `protocol.ts`: `dt://` registered as privileged (standard, secure, supportFetchAPI, stream,
  corsEnabled): `dt://item/<encodeURIComponent(id)>` → the item's file (via `library.pathOf`),
  `dt://thumb/<id>?s=256` → `nativeImage.createThumbnailFromPath` PNG for images (fallback: the file),
  `dt://asset/<tool>/<hash>.<ext>` → workspace asset. Refuse anything outside those roots.
- `log.ts`: append-only daily log files in `userData/logs/`.
- `ipc.ts`: registers every `Api` entry (library ones delegate to `LibraryService` from Unit L; code
  against the class signature above) and forwards `library.changed`.
- Preload: already written; extend only if needed.
- No unit tests required beyond pure helpers; this unit is verified by the smoke run in phase 3.

### Unit U: shared controls (`src/renderer/ui/`)
Built to brief §3–§8 and the Primitives board of `docs/rewrite/directions/c-instrument.html`
(look at its screenshots `c-instrument-primitives-*.png`). One `.tsx` + `.module.css` per component,
all exported from `ui/index.ts`. Props (keep these names; add optional props freely):

```ts
Icon({ name: IconName; size?: 14 | 16 | 18 | 20; fill?: boolean; className?: string })
Kbd({ children })
Button({ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'xs' | 'md' | 'lg'; icon?: IconName;
         children?; onClick?; disabled?; tooltip?: string; shortcut?: string; type?: 'button' | 'submit' })
IconButton({ icon: IconName; label: string /* tooltip + aria-label */; size?: 'md' | 'sm' | 'xs';
             latched?: boolean; onClick?; disabled?; shortcut?: string })
TextInput({ value: string; onCommit(v: string): void; placeholder?; label?: string /* mono caps inside */;
            validate?(v: string): string | null; autoFocus?; selectOnFocus?; onCancel?() })
// Gesture props shared by NumberField and Slider; `useDocNumber` below builds them from a DocController.
type NumberGesture = { onBegin?(): void; onChange(v: number): void; onCommit?(): void; onCancel?(): void }
NumberField({ label: string; value: number; min: number; max: number; step?: number; unit?: string;
              precision?: number; disabled?: boolean } & NumberGesture)
Slider({ label: string; value: number; min: number; max: number; step?: number; unit?: string;
         precision?: number; disabled?: boolean } & NumberGesture)            // track + its NumberField
useDocNumber<D>(doc: DocController<D>, o: { label: string; key: string; get(d: D): number;
         set(d: D, v: number): D }): { value: number } & NumberGesture          // in ui/bind.ts
Segmented<T extends string>({ options: { value: T; label: string; icon?: IconName }[]; value: T; onChange(v: T): void; label?: string })
Select<T extends string>({ label?: string; options: { value: T; label: string; swatch?: string /* css colour of content */ }[];
         value: T; onChange(v: T): void; disabled? })
Toggle({ checked: boolean; onChange(v: boolean): void; label: string; disabled? })
Module({ title: string; sub?: string; readout?: ReactNode; actions?: ReactNode; children; scroll?: boolean; className?; footer?: ReactNode })
SectionHeader({ title: string; sub?: string; actions?: ReactNode })
ConfirmInline({ icon?: IconName; title: string; detail?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm(): void; onKeep(): void })
Tooltip({ content: string; shortcut?: string; children: ReactElement })
EmptyState({ icon: IconName; title: string; detail?: ReactNode; action?: { label: string; icon?: IconName; onClick(): void } })
Progress({ label: string; value: number | null; detail?: string; onCancel?(): void })
LibraryItemRow({ item: LibraryItemRef; thumb: ReactNode; selected?: boolean; accepted?: string /* active tool's use label */;
                 openIn?: string /* tool label when owned elsewhere */; onOpen(): void; onMenu(e: React.MouseEvent): void;
                 onSelect?(): void; dragData?: string })
SwatchStrip({ colors: string[] /* css colours */; height?: number })       // palette thumbnails, each inside --edge
// imperative singletons, each with a Host component mounted once by the shell:
toast.show({ icon?: IconName; message: ReactNode; kind?: 'info' | 'error'; undo?: () => void | Promise<void>;
             ctrlZ?: boolean; duration?: number; onClose?(reason: 'timeout' | 'undo' | 'dismiss'): void }): string
toast.dismiss(id); toast.activeCtrlZ(): { id: string; run(): void } | null; toast.noteCommit(); <ToastHost />
menu.open(anchor: { x: number; y: number } | DOMRect, items: MenuItem[]); <MenuHost />
type MenuItem = { label: string; icon?: IconName; shortcut?: string; hint?: string; danger?: boolean; disabled?: boolean;
                  onSelect?(): void; submenu?: MenuItem[] } | 'separator' | { header: string }
```
- Every input sets `data-dirty="true"` on its `<input>` while it holds an uncommitted edit (the
  keymap uses this for Ctrl+Z routing, spec §8). NumberField: `type=text inputmode=decimal`, scrub
  on the label (1 step per 2px, Shift ×10, Alt ×0.1), arrows ±step (Shift ×10), Enter commits, Esc
  reverts, out-of-range shows the danger state and message and isn't committed. The wheel never
  changes values.
- Tooltips, menus and selects are our own popovers in a portal (hard rule 6: no `title`, no native
  `<select>`). Popover positioning keeps clear of the caption area (top-right 140px of the window).
- Motion: only transform (toast slide, popover scale .98→1), ≤120ms; no opacity or colour
  transitions (hard rule 4).
- `ControlsBoard.tsx`: every control in every state on one scrolling page, for the design critic
  (mounted by the dev stub tool in phase 2).
- No tests required; the design critic reviews it in phase 4.

## Phase 2 (after phase 1)

### Unit S: shell (`src/renderer/shell/` except `tool.ts`, plus `src/renderer/main.tsx` if needed)
App layout (title bar, rail, Library panel, work area, status bar), registry, ToolHost (mount once,
hide with `display:none` + `inert`, `active` prop, error boundary with Reload / Start empty /
Copy details), all seven DocControllers created and restored at start-up before input (spec §4),
persistence hook (doc-kind tools write through `library.write`/`library.create` with forking per
§7.3; image tools write `workspace.save`), ownership map (one owner per item), locked and missing
and changed-outside handling, Send to (§7.4, including `render()` → `library.createImage` for image
tools and rasterising pattern/logo/svg "as an image"), Library panel (filter, search, collections,
lock toggle, rename inline, drag, double-click routing, context menu, delete and move with
ConfirmInline + Undo toast + `library.trash` on toast close + trash pending items on close
request), Settings screen, keymap (spec §9 including the Ctrl+Z routing order), drop and paste
routing, global error handlers, close-request reply, title-bar readout (§7.5), status bar slots.

### Unit D: dev stub tools (`src/renderer/tools/dev-palette/`, `src/renderer/tools/dev-image/`)
- `dev-palette`: `itemKind: 'palette'`, a tiny swatch list editor (add, remove, rename, L/C/H
  sliders via `useDocNumber`) so Send to, ownership, forking and undo can be exercised. Its view
  also has a "Controls" tab showing `ControlsBoard`.
- `dev-image`: accepts `image`, `svg`, `pattern`, `logo` (as image) and `palette` (apply: a tint
  list), shows the received image, `render()` returns it with the tint applied at full resolution.
- Both registered only when `!isPackaged` (from `app.info`).

## Phase 3: integration and smoke
- `src/renderer/smoke.ts` run when `window.api.smoke`: exercises spec §12's smoke list end to end
  through the real shell and IPC, then `app.smokeDone`.
- `scripts/check-rules.mjs`: the brief's mechanical checks (token blocks identical, colour literals
  only in tokens.css, no `title=`/`<select`/`type="number"`/`type="color"`, transitions only on
  transform/clip-path ≤120ms, non-ASCII allowlist, `content:` only `""`).
- `npm run check` and `npm run smoke` both pass.

## Phase 4: verification
Design critic (both themes, shell + ControlsBoard + Library panel), wiring auditor (every `Api`
entry has a caller; every event is handled), and an adversarial review of the code against the spec
(ownership, forking, undo routing, atomic writes, no write on launch). Fix what survives.
