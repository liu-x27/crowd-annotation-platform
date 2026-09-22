/**
 * Label colours are chosen to stay distinguishable on both the light and the dark theme;
 * the UI derives tints from them with color-mix, so only the base hue is stored.
 */
export const LABEL_PALETTE = [
  '#3b6fe0', // blue
  '#1f9d63', // green
  '#d4861b', // amber
  '#d9483b', // red
  '#8250df', // violet
  '#0f97aa', // cyan
  '#d0418d', // pink
  '#6b9b1d', // lime
  '#e06a1f', // orange
  '#5461d6', // indigo
  '#119488', // teal
  '#9a7b12', // ochre
] as const;

/** Keys the annotation workspaces bind to actions; labels may not use them. */
export const RESERVED_HOTKEYS = ['a', 's', 'f', 'z'] as const;

/** Digits first, then the keyboard rows, skipping the reserved action keys. */
export const DEFAULT_HOTKEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
  'd',
  'g',
  'h',
  'j',
  'k',
  'l',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
] as const;

export function defaultLabelColor(index: number): string {
  return LABEL_PALETTE[index % LABEL_PALETTE.length]!;
}

export function defaultHotkey(index: number): string | null {
  return DEFAULT_HOTKEYS[index] ?? null;
}

export interface LabelDef {
  name: string;
  color: string;
  hotkey: string | null;
  description: string;
}

/** Build label definitions from bare names, assigning colours and hotkeys in order. */
export function labelsFromNames(names: readonly string[]): LabelDef[] {
  return names.map((name, i) => ({
    name,
    color: defaultLabelColor(i),
    hotkey: defaultHotkey(i),
    description: '',
  }));
}
