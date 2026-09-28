import type { ToolDefinition } from './tool.ts';

/** The real tools, in rail order. Each is registered when it exists (spec §5, §14); none do yet. */
const TOOLS: ToolDefinition<any>[] = [];

/**
 * The rail's tools. The foundation's dev stubs join only when not packaged, and are loaded only
 * then (spec §5); they go when the real tools arrive.
 */
export async function registeredTools(isPackaged: boolean): Promise<ToolDefinition<any>[]> {
  if (isPackaged) return TOOLS;
  const stubs = await Promise.all([import('../tools/dev-palette/index.ts'), import('../tools/dev-image/index.ts')]);
  return [...TOOLS, ...stubs.map((m) => m.tool as ToolDefinition<any>)];
}
