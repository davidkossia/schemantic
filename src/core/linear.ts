/**
 * Dense linear solver: Gaussian elimination with partial pivoting.
 */

/**
 * Solve A x = b. Returns null when the matrix is singular, meaning a pivot's
 * absolute value falls below 1e-12 times the largest absolute entry of A.
 * The inputs are not changed.
 */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  if (n === 0) return [];
  const m = A.map((row) => row.slice());
  const x = b.slice();

  let scale = 0;
  for (const row of m) {
    for (const v of row) scale = Math.max(scale, Math.abs(v));
  }
  if (scale === 0) scale = 1;
  const tolerance = 1e-12 * scale;

  for (let col = 0; col < n; col++) {
    let best = col;
    let bestAbs = Math.abs(m[col]?.[col] ?? 0);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r]?.[col] ?? 0);
      if (v > bestAbs) {
        best = r;
        bestAbs = v;
      }
    }
    if (bestAbs < tolerance) return null;

    if (best !== col) {
      const rowBest = m[best];
      const rowCol = m[col];
      if (rowBest === undefined || rowCol === undefined) return null;
      m[best] = rowCol;
      m[col] = rowBest;
      const xBest = x[best] ?? 0;
      x[best] = x[col] ?? 0;
      x[col] = xBest;
    }

    const pivotRow = m[col];
    if (pivotRow === undefined) return null;
    const pivot = pivotRow[col] ?? 0;
    const xCol = x[col] ?? 0;
    for (let r = col + 1; r < n; r++) {
      const row = m[r];
      if (row === undefined) return null;
      const factor = (row[col] ?? 0) / pivot;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) {
        row[c] = (row[c] ?? 0) - factor * (pivotRow[c] ?? 0);
      }
      x[r] = (x[r] ?? 0) - factor * xCol;
    }
  }

  for (let r = n - 1; r >= 0; r--) {
    const row = m[r];
    if (row === undefined) return null;
    let sum = x[r] ?? 0;
    for (let c = r + 1; c < n; c++) sum -= (row[c] ?? 0) * (x[c] ?? 0);
    x[r] = sum / (row[r] ?? 1);
  }
  return x;
}
