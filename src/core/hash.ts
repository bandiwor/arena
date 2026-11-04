/** FNV-1a over raw bytes of typed arrays — used for determinism checks / golden tests. */
export class StateHasher {
  h = 0x811c9dc5;
  reset(): this {
    this.h = 0x811c9dc5;
    return this;
  }
  bytes(u8: Uint8Array): this {
    let h = this.h;
    for (let i = 0; i < u8.length; i++) {
      h ^= u8[i]!;
      h = Math.imul(h, 0x01000193);
    }
    this.h = h;
    return this;
  }
  view(a: ArrayBufferView, count?: number): this {
    const bpe = (a as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const n = count === undefined ? a.byteLength : Math.min(a.byteLength, count * bpe);
    return this.bytes(new Uint8Array(a.buffer, a.byteOffset, n));
  }
  num(v: number): this {
    scratchF64[0] = v;
    return this.bytes(scratchU8);
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
const scratchF64 = new Float64Array(1);
const scratchU8 = new Uint8Array(scratchF64.buffer);
