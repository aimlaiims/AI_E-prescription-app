// Line art of the examination diagrams, redrawn from the ENT department's
// hand-drawn sheets (docs/client-input/diagrams/). Every diagram is 1000
// units wide (heights in diagrams.js). Inner SVG markup, written here, never
// user text. Classes: "a" outline, "f" fine detail, "d" dashed, "p" filled
// with paper (hides lines behind it), "t" label text — styled in styles.css.
//
// ART[diagram][version]: a redrawn diagram gets a NEW version (and the same
// number in backend services/diagrams.py); old versions stay, so a drawing
// from an earlier visit is always shown on the picture it was drawn on.
// R and L as on the department's sheets: the patient's right on the viewer's left.

const n = (v) => Math.round(v * 10) / 10;

// A row of teeth: two half-ellipse arches with a line between neighbours.
// `opensDown`: the upper teeth seen with the mouth open (arch at the top);
// otherwise the lower teeth (a U).
function teeth(cx, cy, out, inn, count, opensDown) {
  const s = opensDown ? -1 : 1;
  const arc = ([rx, ry]) =>
    `M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 ${opensDown ? 0 : 1} ${cx - rx} ${cy}`;
  let d = `<path class="a" d="${arc(out)}"/><path class="a" d="${arc(inn)}"/>`;
  for (let i = 1; i < count; i++) {
    const t = (Math.PI * i) / count;
    const p = (r) => `${n(cx + r[0] * Math.cos(t))} ${n(cy + s * r[1] * Math.sin(t))}`;
    d += `<path class="f" d="M ${p(inn)} L ${p(out)}"/>`;
  }
  return d;
}

const mark = (x, letter) =>
  `<circle class="f" cx="${x}" cy="80" r="42"/><text class="t" x="${x}" y="96" text-anchor="middle">${letter}</text>`;
const sides = mark(80, "R") + mark(920, "L");
const mirrored = (art) => `<g transform="matrix(-1 0 0 1 1000 0)">${art}</g>`;
const caption = (text, x = 40, anchor = "start") =>
  `<text class="t" x="${x}" y="80" text-anchor="${anchor}">${text}</text>`;

// Right tympanic membrane as seen through the speculum: handle of malleus
// running down and back to the umbo, cone of light antero-inferior.
const TM_RIGHT = [
  `<ellipse class="a" cx="500" cy="530" rx="380" ry="400"/>`,
  `<ellipse class="f" cx="500" cy="530" rx="350" ry="370"/>`,
  `<path class="a" d="M 141 400 C 260 300 400 268 494 266"/>`,
  `<path class="a" d="M 859 400 C 740 300 620 270 552 268"/>`,
  `<circle class="a" cx="532" cy="270" r="20"/>`,
  `<path class="a" d="M 498 286 C 490 380 478 470 470 548 Q 478 584 498 562 C 508 480 520 386 528 290"/>`,
  `<path class="d" d="M 512 590 L 744 800 L 672 850 Z"/>`,
].join("");

// Front of the face: brows, eyes, frontal sinus, the nose with the septum
// and three turbinates in each nasal cavity.
const NOSE_HALF = [
  `<path class="a" d="M 150 250 Q 280 170 430 226"/>`,
  `<path class="a" d="M 180 340 Q 300 270 420 336 Q 300 396 180 340 Z"/>`,
  `<circle class="f" cx="300" cy="336" r="34"/>`,
  `<path class="a" d="M 470 320 C 462 450 410 600 355 725 C 340 770 380 805 430 800 C 460 797 480 808 500 810"/>`,
  `<path class="a" d="M 455 438 C 472 420 490 440 488 470 C 486 494 468 494 461 478"/>`,
  `<path class="a" d="M 430 556 C 455 520 486 545 484 592 C 482 628 452 632 441 606"/>`,
  `<path class="a" d="M 392 692 C 420 640 474 642 482 690 C 486 732 442 748 404 736"/>`,
  `<path class="f" d="M 415 790 C 425 772 455 770 470 784"/>`,
].join("");
const NOSE = [
  NOSE_HALF,
  mirrored(NOSE_HALF),
  `<path class="f" d="M 400 230 C 380 170 420 120 460 140 C 470 95 530 95 540 140 C 580 120 620 170 600 230 C 560 250 440 250 400 230 Z"/>`,
  `<path class="a" d="M 470 320 Q 500 306 530 320"/>`,
  `<path class="a" d="M 500 330 L 500 808"/>`,
  sides,
].join("");

// Mouth wide open: lips, upper teeth and hard palate, soft palate and uvula,
// tonsils between the pillars, tongue out with its midline groove.
const ORAL_CAVITY = [
  `<path class="a" d="M 500 110 C 720 110 850 200 860 340 C 870 470 830 540 860 660 C 890 800 760 920 500 920 C 240 920 110 800 140 660 C 170 540 130 470 140 340 C 150 200 280 110 500 110 Z"/>`,
  `<path class="a" d="M 500 160 C 690 160 800 235 808 350 C 815 470 780 545 806 655 C 830 770 720 868 500 868 C 280 868 170 770 194 655 C 220 545 185 470 192 350 C 200 235 310 160 500 160 Z"/>`,
  `<path class="f" d="M 262 300 C 240 450 255 650 330 800"/>`,
  `<path class="f" d="M 738 300 C 760 450 745 650 670 800"/>`,
  teeth(500, 470, [215, 250], [165, 200], 14, true),
  `<path class="f" d="M 500 278 L 500 520"/>`,
  `<path class="f" d="M 335 520 Q 500 548 665 520"/>`,
  `<path class="a" d="M 345 700 C 360 600 420 560 470 560 C 468 600 476 626 500 630 C 524 626 532 600 530 560 C 580 560 640 600 655 700"/>`,
  `<ellipse class="a" cx="386" cy="672" rx="26" ry="46"/>`,
  `<ellipse class="a" cx="614" cy="672" rx="26" ry="46"/>`,
  `<path class="f" d="M 418 710 Q 500 690 582 710"/>`,
  `<ellipse class="f" cx="232" cy="470" rx="10" ry="20"/>`,
  `<ellipse class="f" cx="768" cy="470" rx="10" ry="20"/>`,
  `<path class="a p" d="M 360 722 C 345 840 370 1010 500 1060 C 630 1010 655 840 640 722 C 600 694 400 694 360 722 Z"/>`,
  `<path class="f" d="M 425 744 L 500 784 L 575 744"/>`,
  `<path class="f" d="M 500 790 L 500 1046"/>`,
  sides,
].join("");

// Tongue lifted: its underside with the frenulum, the openings of the
// submandibular ducts beside it, the floor of the mouth, lower teeth, lip.
const FLOOR_OF_MOUTH = [
  `<path class="a" d="M 150 230 C 150 640 320 820 500 820 C 680 820 850 640 850 230"/>`,
  `<path class="a" d="M 210 250 C 215 600 350 760 500 760 C 650 760 785 600 790 250"/>`,
  teeth(500, 300, [230, 380], [182, 330], 14, false),
  `<path class="a" d="M 340 420 C 350 260 440 110 500 100 C 560 110 650 260 660 420"/>`,
  `<path class="a" d="M 340 420 C 420 452 580 452 660 420"/>`,
  `<path class="f" d="M 500 130 L 500 470"/>`,
  `<circle class="a" cx="478" cy="480" r="9"/>`,
  `<circle class="a" cx="522" cy="480" r="9"/>`,
  `<path class="f" d="M 466 488 C 420 510 370 508 330 480"/>`,
  `<path class="f" d="M 534 488 C 580 510 630 508 670 480"/>`,
  sides,
].join("");

// Side section through the middle of the head, facing right: nose and nasal
// cavity, palate, tongue, mandible, epiglottis, larynx, cervical spine.
const vertebrae = Array.from(
  { length: 6 },
  (_, i) => `<rect class="a" x="152" y="${420 + i * 110}" width="70" height="88" rx="12"/>`
).join("");
const OROPHARYNX = [
  `<path class="a" d="M 135 300 L 135 1090"/>`,
  `<path class="a" d="M 240 300 L 240 1090"/>`,
  `<ellipse class="a" cx="188" cy="360" rx="30" ry="34"/>`,
  vertebrae,
  `<path class="a" d="M 290 1090 L 290 420 C 290 330 330 282 400 262 C 470 242 560 232 640 242"/>`,
  `<path class="a" d="M 700 40 C 705 120 720 200 735 250 C 770 330 820 400 850 450 C 862 470 850 492 825 490 C 805 488 790 486 780 495"/>`,
  `<path class="a" d="M 780 495 C 792 540 800 572 790 592 C 784 602 776 606 768 607"/>`,
  `<path class="a" d="M 768 614 C 798 630 800 660 782 676 C 770 700 790 760 770 800 C 740 840 690 850 650 852 C 640 900 650 1000 660 1090"/>`,
  `<path class="f" d="M 522 332 C 600 312 680 322 720 346"/>`,
  `<path class="f" d="M 500 382 C 590 362 690 372 742 402"/>`,
  `<path class="f" d="M 470 432 C 580 412 700 422 762 452"/>`,
  `<path class="a" d="M 430 470 L 760 470 C 776 472 778 498 760 500 L 440 500"/>`,
  `<path class="a" d="M 430 470 C 380 482 355 540 352 600 C 351 626 378 628 380 606 C 385 560 405 520 440 500"/>`,
  `<path class="a" d="M 764 620 C 740 560 640 526 540 540 C 460 552 400 600 395 680 C 390 740 410 790 440 822"/>`,
  `<path class="a" d="M 764 620 C 742 662 718 690 690 700"/>`,
  `<path class="a" d="M 690 700 C 720 700 745 720 750 760 C 752 800 730 830 702 830 C 680 830 670 800 672 760 C 674 726 680 706 690 700 Z"/>`,
  `<path class="f" d="M 660 790 L 600 552"/>`,
  `<path class="f" d="M 655 795 L 530 556"/>`,
  `<path class="f" d="M 650 800 L 470 600"/>`,
  `<path class="f" d="M 645 808 L 430 680"/>`,
  `<ellipse class="a" cx="560" cy="862" rx="30" ry="14"/>`,
  `<path class="a" d="M 488 936 C 446 900 412 840 400 770 C 412 768 422 792 432 830 C 446 878 470 914 494 932"/>`,
  `<path class="a" d="M 494 932 C 500 990 504 1040 504 1090"/>`,
  `<path class="a" d="M 398 902 C 382 960 376 1020 376 1090"/>`,
  `<path class="f" d="M 502 995 L 452 1005 L 502 1016"/>`,
  `<path class="f" d="M 380 1050 L 504 1050"/>`,
  `<path class="f" d="M 378 1078 L 504 1078"/>`,
  `<path class="f" d="M 524 900 C 548 950 548 1020 528 1060"/>`,
].join("");

// The larynx as seen with the mirror / scope: epiglottis at the top, vocal
// cords meeting at the front, arytenoids at the back.
const LARYNX = [
  `<circle class="f" cx="500" cy="520" r="420"/>`,
  `<path class="a" d="M 95 420 C 160 400 210 390 250 382"/>`,
  `<path class="a" d="M 905 420 C 840 400 790 390 750 382"/>`,
  `<path class="a" d="M 250 382 C 300 212 700 212 750 382 L 712 388 C 660 262 340 262 288 388 Z"/>`,
  `<path class="a" d="M 262 400 C 250 540 320 700 410 784"/>`,
  `<path class="a" d="M 738 400 C 750 540 680 700 590 784"/>`,
  `<path class="a" d="M 470 362 C 420 452 380 582 362 700"/>`,
  `<path class="a" d="M 530 362 C 580 452 620 582 638 700"/>`,
  `<path class="a" d="M 498 366 L 446 722"/>`,
  `<path class="a" d="M 488 362 L 420 716"/>`,
  `<path class="a" d="M 502 366 L 554 722"/>`,
  `<path class="a" d="M 512 362 L 580 716"/>`,
  `<ellipse class="a" cx="440" cy="762" rx="48" ry="40"/>`,
  `<ellipse class="a" cx="560" cy="762" rx="48" ry="40"/>`,
  `<path class="f" d="M 488 774 Q 500 800 512 774"/>`,
  sides,
].join("");

// Head and neck from the right: jaw line, ear, sternocleidomastoid,
// clavicle — for marking swellings and nodes.
const NECK_RIGHT = [
  `<path class="a" d="M 320 560 C 260 430 270 220 430 145 C 560 90 690 125 722 235 C 732 268 734 296 728 318 C 748 352 772 392 800 428 C 808 440 800 452 786 455 C 772 458 762 456 756 462 C 760 478 768 488 766 500 C 762 512 754 516 750 520 C 760 530 762 545 752 556 C 744 566 742 578 750 592 C 760 618 744 646 712 654 C 680 660 645 662 625 668 C 615 720 628 780 640 840 L 645 900"/>`,
  `<path class="a" d="M 320 560 C 312 650 300 740 260 810 C 230 860 190 885 120 905"/>`,
  `<path class="a" d="M 110 912 C 300 905 500 905 700 915"/>`,
  `<path class="f" d="M 290 872 C 400 860 520 875 640 890"/>`,
  `<path class="f" d="M 712 652 C 650 628 575 612 528 600 C 518 572 514 545 518 512"/>`,
  `<path class="a" d="M 478 380 C 440 365 410 395 412 440 C 414 490 440 525 470 528 C 488 530 492 512 482 500 C 470 485 470 470 478 455"/>`,
  `<path class="f" d="M 465 405 C 445 405 438 430 445 455"/>`,
  `<path class="a" d="M 640 320 Q 670 335 700 322"/>`,
  `<path class="f" d="M 630 290 Q 670 278 710 288"/>`,
  `<path class="f" d="M 714 534 L 752 527"/>`,
  `<path class="a" d="M 488 545 C 520 650 580 780 640 882"/>`,
  `<path class="a" d="M 460 560 C 470 680 495 790 520 872"/>`,
  `<path class="f" d="M 624 758 Q 642 772 628 792"/>`,
  `<path class="f" d="M 330 610 C 325 700 300 790 220 870"/>`,
].join("");

export const ART = {
  "tm-right": { 1: TM_RIGHT + mark(80, "R") },
  "tm-left": { 1: mirrored(TM_RIGHT) + mark(920, "L") },
  nose: { 1: NOSE },
  "oral-cavity": { 1: ORAL_CAVITY },
  "floor-of-mouth": { 1: FLOOR_OF_MOUTH },
  oropharynx: { 1: OROPHARYNX },
  larynx: { 1: LARYNX },
  "neck-right": { 1: NECK_RIGHT + caption("Right side") },
  "neck-left": { 1: mirrored(NECK_RIGHT) + caption("Left side", 960, "end") },
};
