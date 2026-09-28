import type { ToolDefinition } from './tool.ts';

/**
 * The real tools, in rail order. Each is registered when it exists (spec §5, §14). Loaded here,
 * not imported at the top, so no tool module runs before the shell core it imports has.
 */
const realTools = async (): Promise<ToolDefinition<any>[]> => [(await import('../tools/design/index.ts')).tool as ToolDefinition<any>];

/**
 * The rail's tools. The foundation's dev stubs join only when not packaged, and are loaded only
 * then (spec §5); they go when the real tools arrive. A smoke pass adds a second palette tool, so
 * one palette can be open in two tools (spec §12).
 */
export async function registeredTools(isPackaged: boolean, smokeRun = false): Promise<ToolDefinition<any>[]> {
  const tools = await realTools();
  if (isPackaged) return tools;
  const [palette, image] = (await Promise.all([import('../tools/dev-palette/index.ts'), import('../tools/dev-image/index.ts')])).map((m) => m.tool as ToolDefinition<any>);
  const second: ToolDefinition<any>[] = smokeRun ? [{ ...palette, id: 'smoke-palette', label: 'Smoke palette', shortcut: 0 }] : [];
  return [...tools, palette, image, ...second];
}
