/** 32-bit FNV-1a. Deterministic across processes, which is all it is used for. */
export function fnv1a32(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Uniform number in [0, 1) derived from a key. */
export function unitHash(key: string): number {
  return fnv1a32(key) / 0x1_0000_0000;
}
