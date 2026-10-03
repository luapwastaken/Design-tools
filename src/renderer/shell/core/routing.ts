import type { ImportResult, ItemKind, LoadedItem, ToolId } from '../../../shared/types.ts';
import type { ToolDefinition, Use } from '../tool.ts';

// Where items go and what the history step and toast say (spec §6.4, §7.4). Pure, so it is unit
// tested (test/shell-routing.test.ts).

type Tool = ToolDefinition<any>;

export const KIND_WORD: Record<ItemKind, string> = { palette: 'palette', pattern: 'pattern', logo: 'logo', image: 'image', svg: 'SVG' };
const PLURAL: Record<ItemKind, string> = { palette: 'Palettes', pattern: 'Patterns', logo: 'Logos', image: 'Images', svg: 'SVGs' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const swatchOk = (w: unknown): boolean =>
  isObj(w) && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.oklch) && w.oklch.length === 3 && w.oklch.every(num);

/**
 * Spec §5: the shell checks an item file before a tool gets it, so a hand edit or a sync conflict
 * becomes a toast, not a crashed view. Only what tools rely on is checked. null when it's fine.
 */
export function itemProblem(item: LoadedItem): string | null {
  const bad = `${item.ref.name} isn't a readable ${KIND_WORD[item.kind]}.`;
  switch (item.kind) {
    case 'palette':
      return Array.isArray(item.payload?.swatches) && item.payload.swatches.every(swatchOk) ? null : bad;
    case 'pattern': {
      const p = item.payload?.preview;
      return isObj(p) && typeof p.svg === 'string' && num(p.tileWidth) && num(p.tileHeight) ? null : bad;
    }
    case 'logo':
      return isObj(item.payload?.preview) && typeof item.payload.preview.svg === 'string' ? null : bad;
    default:
      return typeof item.url === 'string' ? null : bad;
  }
}

/** Why a double-click can't open this kind here (spec §6.4), named from the tools that do take it. */
export function cantOpen(kind: ItemKind, takers: string[]): string {
  if (!takers.length) return `No tool opens ${PLURAL[kind].toLowerCase()} yet.`;
  const names = takers.length < 2 ? takers[0] : `${takers.slice(0, -1).join(', ')} or ${takers.at(-1)}`;
  return `${PLURAL[kind]} open in ${names}. Switch to ${takers.length < 2 ? 'it' : 'one'}, or use Send to.`;
}

/** `from`: a tool sending its render, which is never offered to one that needs transparency if it is flat (Dither's) */
export function targetsFor(kind: ItemKind, tools: Tool[], from?: Tool): { tool: Tool; use: Use }[] {
  return tools.flatMap((tool) => {
    const use = tool.accepts[kind];
    return use && !(from?.opaque && kind === 'image' && tool.needsAlpha) ? [{ tool, use }] : [];
  });
}

/** Double-click and drop: the active tool if it accepts the kind, else the tool whose itemKind it is. */
export function openTarget(kind: ItemKind, active: Tool | undefined, tools: Tool[]): { tool: Tool; use: Use } | null {
  const own = active?.accepts[kind];
  if (active && own) return { tool: active, use: own };
  const maker = tools.find((t) => t.itemKind === kind);
  return maker ? { tool: maker, use: maker.accepts[kind] ?? { mode: 'open', label: 'OPEN' } } : null;
}

/** "As an image" (spec §7.4): an image tool gets patterns, logos and SVGs rasterised. */
export const rasterises = (target: Tool, kind: ItemKind): boolean =>
  !target.itemKind && !!target.accepts.image && (kind === 'pattern' || kind === 'logo' || kind === 'svg');

/** What a tool can send: its item kind, or an image for tools that render; null while empty. */
export function sendKindOf(tool: Tool, empty: boolean): ItemKind | null {
  if (empty) return null;
  return tool.itemKind ?? (tool.render ? 'image' : null);
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The history step: "Open Monolith core", "Inks from Monolith core", "Shape from Bracket mark". */
export const receiveLabel = (name: string, use: Use): string => (use.mode === 'open' ? `Open ${name}` : `${sentence(use.label.toLowerCase())} from ${name}`);

/** The Send to toast (spec §7.4 step 3): what happened. Its Undo button and Ctrl Z hint say the rest (brief §6). */
export function sentMessage(name: string, use: Use, toolLabel: string): string {
  return use.mode === 'open' ? `Opened ${name} in ${toolLabel}.` : `${receiveLabel(name, use)} in ${toolLabel}.`;
}

export const toolForShortcut = (n: number, tools: Tool[]): ToolId | null => tools.find((t) => t.shortcut === n)?.id ?? null;

/** hashes of a tool's workspace assets that its document refers to (dt://asset/<tool>/<sha256>.<ext>) */
export function assetHashes(tool: ToolId, doc: unknown): string[] {
  const text = JSON.stringify(doc) ?? '';
  const found = text.matchAll(new RegExp(`dt://asset/${tool}/([0-9a-f]{64})`, 'g'));
  return [...new Set([...found].map((m) => m[1]))];
}

export const collectionLabel = (name: string): string => name || 'the Library root';

function listNames(names: string[]): string {
  if (names.length <= 3) return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

const stop = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** Each import says what it made, or why not, and what the palette readers noticed (spec §6.3). */
export function importSummary(r: ImportResult, collection: string): { made: string | null; failed: string | null; warned: string | null } {
  const made = r.made.length ? `Added ${listNames(r.made.map((i) => i.name))} to ${collectionLabel(collection)}.` : null;
  // one sentence per reason: "Couldn't import a.psd and b.psd. PSD files aren't supported. …"
  const why = new Map<string, string[]>();
  for (const f of r.failed) why.set(f.reason, [...(why.get(f.reason) ?? []), f.name]);
  const failed = why.size ? [...why].map(([reason, names]) => `Couldn't import ${listNames(names)}. ${stop(reason)}`).join(' ') : null;
  const warned = r.warnings?.length ? r.warnings.map((w) => `${w.name}: ${w.messages.map(stop).join(' ')}`).join(' ') : null;
  return { made, failed, warned };
}
