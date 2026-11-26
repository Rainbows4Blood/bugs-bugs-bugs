import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
// Helvetiker Bold (MgOpen licence, see assets/fonts/LICENSE), subset to the glyphs the film needs.
import fontData from '../assets/fonts/helvetiker_bold.subset.json';

export const font = new Font(fontData);

const UNITS = fontData.resolution;

/** Horizontal advance of a glyph at the given size. */
export function advance(ch, size) {
  const g = fontData.glyphs[ch] ?? fontData.glyphs['?'];
  return (g.ha * size) / UNITS;
}

/** Height of a capital letter per unit of font size (measured from the outline of "I"). */
export const CAP_HEIGHT = (() => {
  const shapes = font.generateShapes('I', 1);
  let top = 0;
  for (const s of shapes) for (const p of s.getPoints(4)) top = Math.max(top, p.y);
  return top;
})();

const cache = new Map();

/** Extruded glyph geometry, cached per character/size/depth. Material 0 = faces, 1 = sides. */
export function glyphGeometry(ch, size, depth, bevel = 0.012) {
  const key = `${ch}|${size}|${depth}|${bevel}`;
  let geo = cache.get(key);
  if (!geo) {
    geo = new TextGeometry(ch, {
      font,
      size,
      depth,
      curveSegments: 6,
      bevelEnabled: bevel > 0,
      bevelThickness: size * bevel,
      bevelSize: size * bevel * 0.8,
      bevelSegments: 2,
    });
    cache.set(key, geo);
  }
  return geo;
}
