// Shared controls (spec §10.1, brief §6). Tools and the shell import from here only.
//
// Keys: an open menu and a live drag take their keys in window capture listeners; fields take
// theirs in React handlers. Both stop propagation, so the shell's keymap must listen on window in
// the BUBBLE phase: a capture listener added first would see every key before they do.
export { Icon } from './Icon.tsx';
export { Kbd, formatKeys } from './Kbd.tsx';
export { Button, type ButtonProps } from './Button.tsx';
export { IconButton, type IconButtonProps } from './IconButton.tsx';
export { TextInput, type TextInputProps } from './TextInput.tsx';
export { NumberField, type NumberFieldProps, type NumberGesture } from './NumberField.tsx';
export { Slider, type SliderProps } from './Slider.tsx';
export { Ticks } from './Ticks.tsx';
export { useDocNumber, useDocColour } from './bind.ts';
export { ColorField, type ColorFieldProps } from './ColorField.tsx';
export { Popover } from './Popover.tsx';
export { Picker, pickFromScreen, type PickerProps, type ColourGesture } from './Picker.tsx';
export { PickerStyles, usePickerStyle, usePickerModel, PICKER_STYLE_OPTIONS } from './PickerStyles.tsx';
export type { PickerStyle, PickerModel } from '../../shared/types.ts';
export { Segmented, type SegmentedProps } from './Segmented.tsx';
export { Select, type SelectProps } from './Select.tsx';
export { Toggle } from './Toggle.tsx';
export { Module, type ModuleProps } from './Module.tsx';
export { SectionHeader, type SectionHeaderProps } from './SectionHeader.tsx';
export { ConfirmInline, type ConfirmInlineProps } from './ConfirmInline.tsx';
export { Tooltip } from './Tooltip.tsx';
export { EmptyState, type EmptyStateProps } from './EmptyState.tsx';
export { Progress, type ProgressProps } from './Progress.tsx';
export { LibraryItemRow, ITEM_MIME, type LibraryItemRowProps } from './LibraryItemRow.tsx';
export { SwatchStrip } from './SwatchStrip.tsx';
export { UndoRedo } from './UndoRedo.tsx';
export { FieldError } from './FieldError.tsx';
export { toast, type ToastOptions } from './toast.ts';
export { ToastHost } from './Toast.tsx';
export { menu, type MenuItem, type MenuAction, type MenuAnchor, type MenuOptions } from './menu.ts';
export { MenuHost } from './Menu.tsx';
export { Viewport, cursorXY, type ViewportProps, type ViewTransform, type RulerUnit } from './Viewport.tsx';
export { asZoom, type Zoom } from './viewport.ts';
