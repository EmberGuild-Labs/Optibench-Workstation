/**
 * Linear solver for the MNA system: LU with partial pivoting on a flat dense matrix, accelerated
 * by re-using the pivot order and fill pattern between solves (the way KLU-style "refactor" works).
 *
 *  - `analyze()` runs a full partial-pivoting elimination once, recording the pivot row order and,
 *    for every elimination step, which rows / columns are structurally non-zero (including fill).
 *  - `solve()` then only touches those entries (near-linear cost for circuit matrices). Each pivot
 *    is checked against the other candidates in its column; if it has become too small relative
 *    to them (threshold pivoting), or the structural pattern grew, the analysis is redone.
 *
 * The matrix is row-major `n × n`; `pattern` flags structurally non-zero entries (superset of the
 * numerically non-zero ones). The solution is written to x[1..n] (x[0] = 0, ground).
 */
export class SparseLU {
  readonly n: number;
  private w: Float64Array;
  private wb: Float64Array;
  private pw: Uint8Array;
  private perm: Int32Array;
  private rowStart: Int32Array;
  private rowList: Int32Array;
  private colStart: Int32Array;
  private colList: Int32Array;
  private valid = false;
  /** Set when the last solve met a numerically singular matrix (a tiny pivot was substituted). */
  singular = false;
  /** Number of analyses performed (diagnostics). */
  analyses = 0;

  constructor(n: number) {
    this.n = n;
    this.w = new Float64Array(n * n);
    this.wb = new Float64Array(n);
    this.pw = new Uint8Array(n * n);
    this.perm = new Int32Array(n);
    this.rowStart = new Int32Array(n + 1);
    this.colStart = new Int32Array(n + 1);
    this.rowList = new Int32Array(Math.max(1, (n * (n - 1)) / 2));
    this.colList = new Int32Array(Math.max(1, (n * (n - 1)) / 2));
  }

  /** Force a new analysis on the next solve (call when the structural pattern changed). */
  invalidate(): void {
    this.valid = false;
  }

  /** Solve A·x = b. A and b are left untouched. */
  solve(a: Float64Array, b: Float64Array, pattern: Uint8Array, x: Float64Array): void {
    this.singular = false;
    if (this.n === 0) return;
    if (!this.valid) this.analyze(a, pattern);
    if (!this.fast(a, b, x)) {
      this.analyze(a, pattern);
      if (!this.fast(a, b, x)) this.dense(a, b, x);
    }
  }

  /** Full partial-pivoting elimination that records pivot order and fill pattern. */
  private analyze(a: Float64Array, pattern: Uint8Array): void {
    const n = this.n;
    const w = this.w, pw = this.pw, perm = this.perm;
    w.set(a);
    pw.set(pattern);
    for (let i = 0; i < n; i++) perm[i] = i;
    let rp = 0, cp = 0;
    for (let k = 0; k < n; k++) {
      let best = k;
      let max = -1;
      for (let m = k; m < n; m++) {
        const r = perm[m];
        if (!pw[r * n + k]) continue;
        const v = Math.abs(w[r * n + k]);
        if (v > max) {
          max = v;
          best = m;
        }
      }
      const t = perm[k];
      perm[k] = perm[best];
      perm[best] = t;
      const pr = perm[k] * n;
      if (!(max > 1e-18)) {
        w[pr + k] = 1e-12;
        pw[pr + k] = 1;
      }
      this.colStart[k] = cp;
      for (let j = k + 1; j < n; j++) if (pw[pr + j]) this.colList[cp++] = j;
      this.rowStart[k] = rp;
      const inv = 1 / w[pr + k];
      const c0 = this.colStart[k];
      for (let m = k + 1; m < n; m++) {
        const r = perm[m];
        const ir = r * n;
        if (!pw[ir + k]) continue;
        this.rowList[rp++] = r;
        const f = w[ir + k] * inv;
        for (let c = c0; c < cp; c++) {
          const j = this.colList[c];
          w[ir + j] -= f * w[pr + j];
          pw[ir + j] = 1;
        }
      }
    }
    this.rowStart[n] = rp;
    this.colStart[n] = cp;
    this.valid = true;
    this.analyses++;
  }

  /** Numeric factorisation + solve along the recorded pattern. Returns false if a pivot went bad. */
  private fast(a: Float64Array, b: Float64Array, x: Float64Array): boolean {
    const n = this.n;
    const { w, wb, perm, rowStart, rowList, colStart, colList } = this;
    w.set(a);
    wb.set(b);
    for (let k = 0; k < n; k++) {
      const prow = perm[k];
      const pr = prow * n;
      let piv = w[pr + k];
      const r0 = rowStart[k], r1 = rowStart[k + 1];
      let max = Math.abs(piv);
      const ap = max;
      for (let r = r0; r < r1; r++) {
        const v = Math.abs(w[rowList[r] * n + k]);
        if (v > max) max = v;
      }
      if (!(max > 1e-18)) {
        this.singular = true;
        piv = 1e-12;
        w[pr + k] = piv;
      } else if (ap < 1e-3 * max) {
        return false;
      }
      const inv = 1 / piv;
      const c0 = colStart[k], c1 = colStart[k + 1];
      const bk = wb[prow];
      for (let r = r0; r < r1; r++) {
        const row = rowList[r];
        const ir = row * n;
        let f = w[ir + k];
        if (f === 0) continue;
        f *= inv;
        for (let c = c0; c < c1; c++) {
          const j = colList[c];
          w[ir + j] -= f * w[pr + j];
        }
        wb[row] -= f * bk;
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const prow = perm[k];
      const pr = prow * n;
      let s = wb[prow];
      for (let c = colStart[k], c1 = colStart[k + 1]; c < c1; c++) {
        const j = colList[c];
        s -= w[pr + j] * x[j + 1];
      }
      x[k + 1] = s / w[pr + k];
    }
    x[0] = 0;
    return true;
  }

  /** Last-resort plain dense partial-pivoting solve. */
  private dense(a: Float64Array, b: Float64Array, x: Float64Array): void {
    const n = this.n;
    const { w, wb, perm } = this;
    w.set(a);
    wb.set(b);
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let k = 0; k < n; k++) {
      let best = k;
      let max = Math.abs(w[perm[k] * n + k]);
      for (let m = k + 1; m < n; m++) {
        const v = Math.abs(w[perm[m] * n + k]);
        if (v > max) {
          max = v;
          best = m;
        }
      }
      const t = perm[k];
      perm[k] = perm[best];
      perm[best] = t;
      const pr = perm[k] * n;
      if (!(max > 1e-18)) {
        this.singular = true;
        w[pr + k] = 1e-12;
      }
      const inv = 1 / w[pr + k];
      for (let m = k + 1; m < n; m++) {
        const ir = perm[m] * n;
        let f = w[ir + k];
        if (f === 0) continue;
        f *= inv;
        for (let j = k + 1; j < n; j++) w[ir + j] -= f * w[pr + j];
        wb[perm[m]] -= f * wb[perm[k]];
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const pr = perm[k] * n;
      let s = wb[perm[k]];
      for (let j = k + 1; j < n; j++) s -= w[pr + j] * x[j + 1];
      x[k + 1] = s / w[pr + k];
    }
    x[0] = 0;
    this.valid = false;
  }
}
