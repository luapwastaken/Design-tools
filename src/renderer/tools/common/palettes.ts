// The Library's palettes as menu rows, the same in every tool that picks one (Dither, Halftone,
// Post FX, Logo, Pattern): by collection, each with its colours and how many there are. Picking one
// arrives as Send to would bring it, with its use label and its step in the tool's history.
import { useEffect } from 'react';
import type { LibraryItemRef, ToolId } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { itemInfo } from '../../shell/library/item-info.ts';
import type { MenuItem } from '../../ui/index.ts';

type Library = ReturnType<typeof shell.getState>['library'];

/** the Library's palettes by collection */
export const libraryPalettes = (library: Library): { name: string; items: LibraryItemRef[] }[] =>
  (library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((x) => x.kind === 'palette') })).filter((g) => g.items.length);

/** read the palettes' colours ahead (while `on`), so the menu can show them the moment it opens */
export function useReadAhead(on = true): void {
  const library = useShell((st) => st.library);
  useEffect(() => {
    if (on) libraryPalettes(library).forEach((g) => g.items.forEach((ref) => itemInfo(ref, true)));
  }, [on, library]);
}

/** `checked`: the one the tool is using now */
export function paletteMenu(tool: ToolId, checked?: (ref: LibraryItemRef) => boolean): MenuItem[] {
  const groups = libraryPalettes(shell.getState().library);
  if (!groups.length) return [{ label: 'No palettes in the Library yet', disabled: true }];
  return groups.flatMap((g) => [
    { header: g.name },
    ...g.items.map((ref) => {
      const colours = itemInfo(ref)?.colors;
      return { label: ref.name, strip: colours, hint: colours && `${colours.length}`, checked: checked?.(ref), onSelect: () => void shell.sendItem(ref, tool) };
    }),
  ]);
}
