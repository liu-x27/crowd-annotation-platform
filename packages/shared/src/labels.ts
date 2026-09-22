/**
 * Default label colours: an eight-hue categorical order validated for colour-vision
 * deficiency on neighbouring pairs (OKLab ΔE ≥ 8 under protan/deutan simulation) on both
 * themes. The stored value is the light-theme step; the UI swaps in the matching dark step.
 * A ninth label repeats a hue rather than inventing one: labels always show their name,
 * so colour is never the only thing telling them apart.
 */
export const LABEL_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

/** Dark-theme steps of the same hues. */
export const LABEL_PALETTE_DARK: Record<string, string> = {
  '#2a78d6': '#3987e5',
  '#eb6834': '#d95926',
  '#1baf7a': '#199e70',
  '#eda100': '#c98500',
  '#e87ba4': '#d55181',
  '#008300': '#008300',
  '#4a3aa7': '#9085e9',
  '#e34948': '#e66767',
};

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
