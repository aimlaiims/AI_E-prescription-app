// Examination diagrams the doctor draws on with a finger or stylus (beside
// On examination). Saved with the visit, not printed, shown in history.
// The names and versions exist twice — here and in backend
// services/diagrams.py — change both or neither. Artwork: diagramArt.js.
import { ART, HEIGHT } from "./diagramArt.js";

export const DIAGRAM_WIDTH = 1000;

export const DIAGRAMS = {
  "tm-right": { label: "Tympanic membrane, right", short: "Right tympanic membrane", version: 1, height: HEIGHT["tm-right"] },
  "tm-left": { label: "Tympanic membrane, left", short: "Left tympanic membrane", version: 1, height: HEIGHT["tm-left"] },
  nose: { label: "Nose", short: "Nose", version: 1, height: HEIGHT["nose"] },
  "oral-cavity": { label: "Oral cavity", short: "Oral cavity", version: 1, height: HEIGHT["oral-cavity"] },
  "floor-of-mouth": { label: "Floor of mouth", short: "Floor of mouth", version: 1, height: HEIGHT["floor-of-mouth"] },
  oropharynx: { label: "Oral cavity and oropharynx, side view", short: "Side view", version: 1, height: HEIGHT["oropharynx"] },
  larynx: { label: "Larynx", short: "Larynx", version: 1, height: HEIGHT["larynx"] },
  "neck-right": { label: "Head and neck, right side", short: "Right side", version: 1, height: HEIGHT["neck-right"] },
  "neck-left": { label: "Head and neck, left side", short: "Left side", version: 1, height: HEIGHT["neck-left"] },
};

export const REGIONS = [
  { id: "ear", label: "Ear", diagrams: ["tm-right", "tm-left"] },
  { id: "nose", label: "Nose", diagrams: ["nose"] },
  { id: "throat", label: "Throat", diagrams: ["oral-cavity", "floor-of-mouth", "oropharynx", "larynx"] },
  { id: "neck", label: "Neck", diagrams: ["neck-right", "neck-left"] },
];

// The form's order: drawings are saved and shown in this order.
export const DIAGRAM_ORDER = REGIONS.flatMap((r) => r.diagrams);

export const PENS = [
  { id: "black", label: "Black pen" },
  { id: "red", label: "Red pen" },
  { id: "blue", label: "Blue pen" },
];

// A finger is less precise than a stylus: a slightly thicker line.
export const PEN_WIDTH = { pen: 4, mouse: 4, touch: 7 };

// Same limit as the server: far beyond a real drawing.
export const MAX_POINTS = 20000;
const MIN_STEP = 3; // units between recorded points: smooth lines, small data

export function artFor(diagram, version) {
  return ART[diagram]?.[version ?? DIAGRAMS[diagram]?.version] ?? null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A pointer position (diagram units) added to a stroke's [x, y, x, y, ...],
// rounded and kept on the picture. Points closer than MIN_STEP to the last
// one are skipped. Returns a new array, or the same one when nothing changed.
export function addPoint(points, x, y, height) {
  const px = Math.round(clamp(x, 0, DIAGRAM_WIDTH));
  const py = Math.round(clamp(y, 0, height));
  const n = points.length;
  if (n >= 2 && Math.hypot(px - points[n - 2], py - points[n - 1]) < MIN_STEP) return points;
  return [...points, px, py];
}

// SVG path through the points, smoothed with curves through the midpoints.
// A single point is a dot.
export function strokePath(points) {
  if (points.length < 2) return "";
  const [x0, y0] = points;
  if (points.length === 2) return `M ${x0} ${y0} l 0.01 0`;
  let d = `M ${x0} ${y0}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2;
    const my = (points[i + 1] + points[i + 3]) / 2;
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`;
  }
  return `${d} L ${points[points.length - 2]} ${points[points.length - 1]}`;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The eraser removes whole strokes: the index of the topmost stroke passing
// within `radius` of (x, y), or -1.
export function strokeAt(strokes, x, y, radius) {
  for (let s = strokes.length - 1; s >= 0; s--) {
    const p = strokes[s].points;
    const reach = radius + strokes[s].width / 2;
    if (p.length === 2 && Math.hypot(x - p[0], y - p[1]) <= reach) return s;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return s;
    }
  }
  return -1;
}

export const pointCount = (strokes) => strokes.reduce((sum, s) => sum + s.points.length / 2, 0);

// { diagram: strokes } -> what the server stores: only diagrams with marks,
// in the form's order.
export function drawingsForSave(drawings) {
  return DIAGRAM_ORDER.filter((k) => drawings[k]?.length).map((k) => ({
    diagram: k,
    version: DIAGRAMS[k].version,
    strokes: drawings[k],
  }));
}

// Region buttons' state: which of a region's diagrams have marks.
export const drawnIn = (region, drawings) => region.diagrams.filter((k) => drawings[k]?.length);
