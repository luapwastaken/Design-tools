import type { ToolDefinition } from './tool.ts';

/**
 * The real tools, in rail order. Each is registered when it exists (spec §5, §14). Loaded here,
 * not imported at the top, so no tool module runs before the shell core it imports has.
 */
const realTools = async (): Promise<ToolDefinition<any>[]> =>
  (await Promise.all([import('../tools/design/index.ts'), import('../tools/illustration/index.ts'), import('../tools/pattern/index.ts'), import('../tools/logo/index.ts')])).map((m) => m.tool as ToolDefinition<any>);

/**
 * The rail's tools. The foundation's dev image stub joins only when not packaged, and is loaded
 * only then (spec §5); it goes when the image tools arrive.
 */
export async function registeredTools(isPackaged: boolean): Promise<ToolDefinition<any>[]> {
  const tools = await realTools();
  if (isPackaged) return tools;
  return [...tools, (await import('../tools/dev-image/index.ts')).tool as ToolDefinition<any>];
}
