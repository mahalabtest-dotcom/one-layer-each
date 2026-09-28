// Filament colors shared by the phones and the projector.
export const PALETTE = [
  { name: 'Lava', hex: '#FF5A36' },
  { name: 'Tangerine', hex: '#FF9F1C' },
  { name: 'Lemon', hex: '#FFD60A' },
  { name: 'Mint', hex: '#3DDC97' },
  { name: 'Sky', hex: '#2EC4F1' },
  { name: 'Violet', hex: '#8B7BFF' },
  { name: 'Bubblegum', hex: '#FF5FA8' },
  { name: 'Bone', hex: '#F3EFE6' },
];

export const PALETTE_RGB = PALETTE.map(({ hex }) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

export function nearestPaletteIndex(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < PALETTE_RGB.length; i++) {
    const [pr, pg, pb] = PALETTE_RGB[i];
    const d = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
