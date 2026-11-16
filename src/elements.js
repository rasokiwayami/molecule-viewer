export const ELEMENTS = {
  H: { color: '#cdd6e6', radius: 0.24, ja: '水素' },
  C: { color: '#3f4c61', radius: 0.39, ja: '炭素' },
  N: { color: '#3f6fff', radius: 0.37, ja: '窒素' },
  O: { color: '#ff3f52', radius: 0.35, ja: '酸素' },
  S: { color: '#f5cf58', radius: 0.45, ja: '硫黄' },
  P: { color: '#ffab52', radius: 0.44, ja: 'リン' },
  F: { color: '#83dd95', radius: 0.32, ja: 'フッ素' },
  Cl: { color: '#78d76d', radius: 0.43, ja: '塩素' },
  Br: { color: '#bd6953', radius: 0.46, ja: '臭素' },
  I: { color: '#b789df', radius: 0.5, ja: 'ヨウ素' },
};
export const element = (el) => ELEMENTS[el] || { color: '#c998d8', radius: 0.4, ja: el };
