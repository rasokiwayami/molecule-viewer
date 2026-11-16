/** Parse the first V2000 record. Bond indices are zero-based. */
export function parseSDF(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const counts = lines[3] || '';
  if (!counts.includes('V2000')) throw new Error('V2000形式の構造が必要です');
  const n = Number(counts.slice(0, 3)),
    m = Number(counts.slice(3, 6));
  if (!Number.isInteger(n) || n < 1 || n > 5000 || !Number.isInteger(m) || m < 0 || m > 10000)
    throw new Error('原子数・結合数が不正です');
  const atoms = Array.from({ length: n }, (_, i) => {
    const s = lines[4 + i] || '';
    const x = Number(s.slice(0, 10)),
      y = Number(s.slice(10, 20)),
      z = Number(s.slice(20, 30));
    const el = s.slice(31, 34).trim();
    if (s.length < 34 || ![x, y, z].every(Number.isFinite) || !/^[A-Z][a-z]?$/.test(el))
      throw new Error('原子データが不正です');
    return { el, x, y, z };
  });
  const bonds = Array.from({ length: m }, (_, i) => {
    const s = lines[4 + n + i] || '';
    const a = Number(s.slice(0, 3)) - 1,
      b = Number(s.slice(3, 6)) - 1,
      order = Number(s.slice(6, 9));
    if (
      ![a, b, order].every(Number.isInteger) ||
      a < 0 ||
      b < 0 ||
      a >= n ||
      b >= n ||
      a === b ||
      order < 1 ||
      order > 4
    )
      throw new Error('結合データが不正です');
    return { a, b, order };
  });
  return { atoms, bonds };
}
