// The examination diagrams are the ENT department's own drawings: each one
// cropped from the photographed sheets (docs/client-input/diagrams/) and
// cleaned to dark lines on white, in public/diagrams/ (1000 px wide; heights
// in diagrams.js). Made by the cleaning script described in CHANGELOG §39.
// Head and neck: her right side view, mirrored for the left until she sends
// her own. Inner SVG markup, written here, never user text.
//
// ART[diagram][version]: while the app is a demo (no live data), a diagram is
// replaced in place; once live, a redrawn diagram gets a NEW version (and the
// same number in backend services/diagrams.py) and the old one stays.
// R and L as on her sheets: the patient's right on the viewer's left.

// Each picture's height at 1000 wide (its PNG's own proportions).
export const HEIGHT = {
  "tm-right": 976,
  "tm-left": 976,
  nose: 752,
  "oral-cavity": 1654,
  "floor-of-mouth": 939,
  oropharynx: 1494,
  larynx: 921,
  "neck-right": 1209,
  "neck-left": 1209,
};

const image = (name, height) =>
  `<image href="/diagrams/${name}.png" x="0" y="0" width="1000" height="${height}" preserveAspectRatio="none"/>`;
const mark = (x, letter) =>
  `<circle class="wh f" cx="${x}" cy="70" r="40"/><text class="t" x="${x}" y="86" text-anchor="middle">${letter}</text>`;
const sides = mark(70, "R") + mark(930, "L");
const caption = (text, x, anchor) => `<text class="t" x="${x}" y="70" text-anchor="${anchor}">${text}</text>`;

const h = (key) => HEIGHT[key];

export const ART = {
  "tm-right": { 1: image("tm-right", h("tm-right")) + mark(70, "R") },
  "tm-left": { 1: image("tm-left", h("tm-left")) + mark(930, "L") },
  nose: { 1: image("nose", h("nose")) + sides },
  "oral-cavity": { 1: image("oral-cavity", h("oral-cavity")) + sides },
  "floor-of-mouth": { 1: image("floor-of-mouth", h("floor-of-mouth")) + sides },
  oropharynx: { 1: image("oropharynx", h("oropharynx")) },
  larynx: { 1: image("larynx", h("larynx")) + sides },
  "neck-right": { 1: image("neck-right", h("neck-right")) + caption("Right side", 40, "start") },
  "neck-left": {
    1:
      `<g transform="matrix(-1 0 0 1 1000 0)">${image("neck-right", h("neck-left"))}</g>` +
      caption("Left side", 960, "end"),
  },
};
