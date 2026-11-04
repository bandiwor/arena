/**
 * Uniform grid rebuilt every tick by counting sort into flat typed arrays (zero alloc).
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellStart: Int32Array;
  readonly cellCount: Int32Array;
  readonly items: Int32Array;
  private readonly itemCell: Int32Array;
  private n = 0;

  constructor(
    readonly minX: number,
    readonly minY: number,
    width: number,
    height: number,
    readonly cell: number,
    capacity: number,
  ) {
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    const cells = this.cols * this.rows;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.items = new Int32Array(capacity);
    this.itemCell = new Int32Array(capacity);
  }

  cellX(x: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }
  cellY(y: number): number {
    const c = Math.floor((y - this.minY) / this.cell);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  /** Build from active ids. xs/ys indexed by id. */
  build(ids: Int32Array, count: number, xs: Float32Array, ys: Float32Array): void {
    const cc = this.cellCount;
    cc.fill(0);
    for (let k = 0; k < count; k++) {
      const id = ids[k]!;
      const c = this.cellY(ys[id]!) * this.cols + this.cellX(xs[id]!);
      this.itemCell[k] = c;
      cc[c] = cc[c]! + 1;
    }
    const cs = this.cellStart;
    let acc = 0;
    for (let c = 0; c < cc.length; c++) {
      cs[c] = acc;
      acc += cc[c]!;
    }
    cs[cc.length] = acc;
    // reuse cellCount as cursor
    for (let c = 0; c < cc.length; c++) cc[c] = cs[c]!;
    for (let k = 0; k < count; k++) {
      const c = this.itemCell[k]!;
      this.items[cc[c]!] = ids[k]!;
      cc[c] = cc[c]! + 1;
    }
    this.n = count;
  }

  get size(): number {
    return this.n;
  }

  /**
   * Writes ids of items in cells overlapping the AABB of (x,y,r) into out; returns count.
   */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const x0 = this.cellX(x - r);
    const x1 = this.cellX(x + r);
    const y0 = this.cellY(y - r);
    const y1 = this.cellY(y + r);
    let n = 0;
    const cap = out.length;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const c = row + cx;
        const e = this.cellStart[c + 1]!;
        for (let k = this.cellStart[c]!; k < e; k++) {
          if (n >= cap) return n;
          out[n++] = this.items[k]!;
        }
      }
    }
    return n;
  }
}
