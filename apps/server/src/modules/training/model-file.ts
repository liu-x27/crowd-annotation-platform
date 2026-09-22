import { gunzipSync, gzipSync } from 'node:zlib';

export interface ModelHeader {
  kind: 'classification' | 'ner';
  labels: string[];
  bits: number;
  tags?: number;
}

const MAGIC = 'CAP1';

/**
 * A trained model on disk: `CAP1`, a JSON header, then named float32 arrays; gzipped.
 * Self-describing enough to load without the database.
 */
export function encodeModel(header: ModelHeader, arrays: Record<string, Float32Array>): Uint8Array {
  const names = Object.keys(arrays);
  const headerBytes = Buffer.from(
    JSON.stringify({ ...header, arrays: names.map((n) => [n, arrays[n]!.length]) }),
    'utf8',
  );
  const parts: Buffer[] = [Buffer.from(MAGIC, 'ascii')];
  const len = Buffer.alloc(4);
  len.writeUInt32LE(headerBytes.length);
  parts.push(len, headerBytes);
  const pad = (4 - ((4 + 4 + headerBytes.length) % 4)) % 4;
  parts.push(Buffer.alloc(pad));
  for (const n of names) {
    const a = arrays[n]!;
    parts.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  return gzipSync(Buffer.concat(parts), { level: 6 });
}

export function decodeModel(bytes: Uint8Array): {
  header: ModelHeader;
  arrays: Record<string, Float32Array>;
} {
  const raw = gunzipSync(bytes);
  if (raw.toString('ascii', 0, 4) !== MAGIC) throw new Error('not a model file');
  const headerLen = raw.readUInt32LE(4);
  const parsed = JSON.parse(raw.toString('utf8', 8, 8 + headerLen)) as ModelHeader & {
    arrays: [string, number][];
  };
  let offset = 8 + headerLen;
  offset += (4 - (offset % 4)) % 4;
  const arrays: Record<string, Float32Array> = {};
  for (const [name, length] of parsed.arrays) {
    // Copy into an aligned buffer; the gunzipped one may not be 4-byte aligned.
    const out = new Float32Array(length);
    Buffer.from(out.buffer).set(raw.subarray(offset, offset + length * 4));
    arrays[name] = out;
    offset += length * 4;
  }
  const { arrays: _, ...header } = parsed;
  return { header, arrays };
}
