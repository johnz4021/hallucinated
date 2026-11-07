// Flat black tee on a bone ground, 1200×1500 (4:5). Same silhouette as the drop-1 flats.
// Print boxes are in output pixels: where a print of that side sits on the real shirt.
export const MOCKUP = { width: 1200, height: 1500 };

const S = 1200 / 740; // svg units -> px (viewBox -70 -120 740 925)
const px = (x: number, y: number) => ({ left: Math.round((x + 70) * S), top: Math.round((y + 120) * S) });

// back: up to ~12.7 in wide (drop-1 was 12.6 in), top just under the collar.
// front: chest, up to ~10 in wide.
export const PRINT_BOX = {
  back: { ...px(186, 104), width: Math.round(228 * S), height: Math.round(270 * S) },
  front: { ...px(210, 150), width: Math.round(180 * S), height: Math.round(180 * S) },
};

const BODY = "L490 72 L590 196 L516 252 L478 214 L478 636 L122 636 L122 214 L84 252 L10 196 L110 72 Z";
const NECK = { front: "M212 38 C238 92 362 92 388 38", back: "M212 38 C246 58 354 58 388 38" };

export function teeSvg(side: "front" | "back") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -120 740 925" width="${MOCKUP.width}" height="${MOCKUP.height}">
  <rect x="-70" y="-120" width="740" height="925" fill="#F2EEE6"/>
  <ellipse cx="300" cy="650" rx="210" ry="10" fill="#000" opacity="0.06"/>
  <path d="${NECK[side]} ${BODY}" fill="#1A1A1A"/>
  <path d="${NECK[side]}" fill="none" stroke="#2A2A2A" stroke-width="6"/>
  <path d="M122 214 L122 636" stroke="#000" stroke-opacity="0.25" stroke-width="2"/>
  <path d="M478 214 L478 636" stroke="#000" stroke-opacity="0.25" stroke-width="2"/>
</svg>`;
}

// "flat": the print alone on shirt black, 4:5, for the gallery (light ink is invisible on a light tile).
export const FLAT_BOX = { left: 150, top: 190, width: 900, height: 1120 };
export function flatSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCKUP.width}" height="${MOCKUP.height}"><rect width="100%" height="100%" fill="#1A1A1A"/></svg>`;
}
