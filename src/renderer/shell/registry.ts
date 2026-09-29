import type { ToolDefinition } from './tool.ts';

/**
 * The tools, in rail order. Each is registered when it exists (spec §5, §14). Loaded here, not
 * imported at the top, so no tool module runs before the shell core it imports has.
 */
export const registeredTools = async (): Promise<ToolDefinition<any>[]> =>
  (await Promise.all([import('../tools/design/index.ts'), import('../tools/illustration/index.ts'), import('../tools/pattern/index.ts'), import('../tools/logo/index.ts'), import('../tools/dither/index.ts'), import('../tools/halftone/index.ts')])).map((m) => m.tool as ToolDefinition<any>);
