import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  const chars = Array.from(name.trim());
  // CJK names read better as their last character (the given name); Latin as two letters.
  if (chars.length && /\p{Script=Han}/u.test(chars[0]!)) return chars.at(-1)!;
  return chars.slice(0, 2).join('').toUpperCase();
}

/** A stable hue for an avatar, from the user id. */
export function hueFor(id: number): number {
  return (id * 67) % 360;
}

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
