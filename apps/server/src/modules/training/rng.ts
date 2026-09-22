/** mulberry32: small, fast, seedable. Training is reproducible given the seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(values: T[], random: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Split indices into (held out, rest), stratified by key: each key contributes the same
 * fraction, with at least one held out whenever a key has two or more members.
 */
export function stratifiedSplit(
  keys: string[],
  fraction: number,
  random: () => number,
): { held: number[]; rest: number[] } {
  const groups = new Map<string, number[]>();
  keys.forEach((k, i) => {
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const held: number[] = [];
  const rest: number[] = [];
  for (const members of groups.values()) {
    const shuffled = shuffle(members, random);
    let n = Math.round(shuffled.length * fraction);
    if (n === 0 && shuffled.length >= 2) n = 1;
    if (n === shuffled.length && shuffled.length > 1) n = shuffled.length - 1;
    held.push(...shuffled.slice(0, n));
    rest.push(...shuffled.slice(n));
  }
  return { held: held.sort((a, b) => a - b), rest: rest.sort((a, b) => a - b) };
}
