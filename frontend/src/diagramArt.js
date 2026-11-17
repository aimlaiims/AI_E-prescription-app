// The examination diagrams, drawn as simple medical illustrations (filled
// areas, not only outlines) from the ENT department's sheets
// (docs/client-input/diagrams/) and public-domain references (Gray's
// Anatomy plates 956, 994, 1014; the Commons eardrum diagram). Every diagram
// is 1000 units wide (heights in diagrams.js). Inner SVG markup written here,
// never user text.
//
// Classes (styles.css, "Examination diagrams"): "a" outline, "f" fine line,
// "d" dashed; fills: sk skin, sk2 skin shade, lp lip, mu mucosa, md deep
// mucosa, tg tongue, tn tonsil, cv cavity/airway, th tooth, bn bone,
// cg cartilage, tm eardrum, pf pars flaccida, lt light reflex, ms muscle,
// sn sinus, ir iris, wh white; "vn" vein line; "t" label text.
//
// ART[diagram][version]: a redrawn diagram gets a NEW version (and the same
// number in backend services/diagrams.py); old versions stay, so a drawing
// from an earlier visit is always shown on the picture it was drawn on.
// R and L as on the department's sheets: the patient's right on the viewer's left.

const n = (v) => Math.round(v * 10) / 10;

// A row of teeth on its gum: `opensDown` = the upper teeth seen with the mouth
// open (arch at the top); otherwise the lower teeth (a U).
function teeth(cx, cy, out, inn, count, opensDown) {
  const s = opensDown ? -1 : 1;
  const sweepOut = opensDown ? 0 : 1;
  const gum = `<path class="a md" d="M ${cx + out[0] + 14} ${cy} A ${out[0] + 14} ${out[1] + 14} 0 0 ${sweepOut} ${cx - out[0] - 14} ${cy} L ${cx - inn[0] + 14} ${cy} A ${inn[0] - 14} ${inn[1] - 14} 0 0 ${1 - sweepOut} ${cx + inn[0] - 14} ${cy} Z"/>`;
  const p = (r, t) => `${n(cx + r[0] * Math.cos(t))} ${n(cy + s * r[1] * Math.sin(t))}`;
  let d = gum;
  for (let i = 0; i < count; i++) {
    const t0 = (Math.PI * i) / count + 0.025;
    const t1 = (Math.PI * (i + 1)) / count - 0.025;
    d += `<path class="a th" d="M ${p(inn, t0)} L ${p(out, t0)} L ${p(out, t1)} L ${p(inn, t1)} Z"/>`;
  }
  return d;
}

const mark = (x, letter) =>
  `<circle class="wh f" cx="${x}" cy="80" r="42"/><text class="t" x="${x}" y="96" text-anchor="middle">${letter}</text>`;
const sides = mark(80, "R") + mark(920, "L");
const mirrored = (art) => `<g transform="matrix(-1 0 0 1 1000 0)">${art}</g>`;
const caption = (text, x = 40, anchor = "start") =>
  `<text class="t" x="${x}" y="80" text-anchor="${anchor}">${text}</text>`;
const panel = (h) => `<rect class="sk" x="20" y="20" width="960" height="${h - 40}" rx="90"/>`;

// Right eardrum through the speculum: canal skin, annulus, pars flaccida
// above the malleolar folds, handle of malleus down and back to the umbo,
// cone of light antero-inferior (viewer's right for a right ear).
const TM_RIGHT = [
  `<ellipse class="a sk2" cx="500" cy="520" rx="440" ry="460"/>`,
  `<ellipse class="a sk" cx="500" cy="520" rx="400" ry="424"/>`,
  `<ellipse class="a tm" cx="500" cy="520" rx="372" ry="396"/>`,
  `<path class="a pf" d="M 392 141 C 440 220 494 268 526 286 L 556 288 C 598 250 628 204 648 158 A 372 396 0 0 0 392 141 Z"/>`,
  `<path class="a bn" d="M 514 300 C 506 392 492 472 470 546 Q 472 588 500 574 C 516 482 530 392 542 306 Z"/>`,
  `<circle class="a bn" cx="540" cy="294" r="22"/>`,
  `<circle class="a cv" cx="486" cy="566" r="7"/>`,
  `<path class="f lt" d="M 506 602 L 742 818 L 664 866 Z"/>`,
  `<path class="f" d="M 300 640 C 330 760 400 840 470 870"/>`,
  `<path class="f" d="M 700 470 C 740 540 760 610 760 660"/>`,
].join("");

// The face from the front: frontal and maxillary sinuses, eyes, the nose
// with its two nasal cavities, septum and three turbinates on each side.
const NOSE_HALF = [
  `<path class="a sn" d="M 190 440 C 230 405 360 405 395 448 C 410 525 400 600 372 642 C 300 662 222 642 196 600 C 181 540 181 482 190 440 Z"/>`,
  `<path class="a" d="M 150 250 Q 280 170 430 226"/>`,
  `<path class="a wh" d="M 180 340 Q 300 270 420 336 Q 300 396 180 340 Z"/>`,
  `<circle class="a ir" cx="300" cy="336" r="36"/>`,
  `<circle class="cv" cx="300" cy="336" r="14"/>`,
  `<path class="a cv" d="M 486 358 C 470 470 432 610 394 720 C 410 754 452 762 490 760 Z"/>`,
  `<path class="a mu" d="M 458 444 C 472 426 490 440 489 470 C 488 494 470 495 464 480 Z"/>`,
  `<path class="a mu" d="M 432 560 C 456 524 489 544 489 592 C 489 626 456 632 444 608 Z"/>`,
  `<path class="a mu" d="M 400 692 C 428 646 484 646 490 690 C 492 730 450 744 408 734 Z"/>`,
  `<ellipse class="a cv" cx="438" cy="788" rx="34" ry="13"/>`,
].join("");
const NOSE = [
  panel(900),
  `<path class="a sn" d="M 400 230 C 380 170 420 120 460 140 C 470 95 530 95 540 140 C 580 120 620 170 600 230 C 560 250 440 250 400 230 Z"/>`,
  `<path class="a sk2" d="M 470 320 C 462 450 410 600 355 725 C 340 770 380 805 430 800 C 460 797 480 808 500 810 C 520 808 540 797 570 800 C 620 805 660 770 645 725 C 590 600 538 450 530 320 Q 500 306 470 320 Z"/>`,
  NOSE_HALF,
  mirrored(NOSE_HALF),
  `<path class="a mu" d="M 489 346 L 511 346 L 511 772 L 489 772 Z"/>`,
  sides,
].join("");

// Mouth wide open (as Gray 1014): lips, upper teeth and hard palate with its
// ridges, soft palate and uvula, tonsils, the throat behind, tongue out.
const ORAL_CAVITY = [
  panel(1100),
  `<path class="a lp" d="M 500 110 C 720 110 850 200 860 340 C 870 470 830 540 860 660 C 890 800 760 920 500 920 C 240 920 110 800 140 660 C 170 540 130 470 140 340 C 150 200 280 110 500 110 Z"/>`,
  `<path class="a mu" d="M 500 160 C 690 160 800 235 808 350 C 815 470 780 545 806 655 C 830 770 720 868 500 868 C 280 868 170 770 194 655 C 220 545 185 470 192 350 C 200 235 310 160 500 160 Z"/>`,
  teeth(500, 470, [215, 250], [168, 204], 14, true),
  `<path class="a pl" d="M 335 470 A 165 200 0 0 1 665 470 Z"/>`,
  `<path class="f" d="M 500 276 L 500 470"/>`,
  `<path class="f" d="M 432 310 Q 462 298 490 312"/>`,
  `<path class="f" d="M 510 312 Q 538 298 568 310"/>`,
  `<path class="f" d="M 420 352 Q 456 340 490 354"/>`,
  `<path class="f" d="M 510 354 Q 544 340 580 352"/>`,
  `<path class="f" d="M 330 520 Q 500 548 670 520"/>`,
  `<path class="a cv" d="M 345 705 C 350 620 420 572 500 570 C 580 572 650 620 655 705 Z"/>`,
  `<path class="md" d="M 400 705 C 430 676 570 676 600 705 Z"/>`,
  `<ellipse class="a tn" cx="380" cy="664" rx="28" ry="46"/>`,
  `<ellipse class="a tn" cx="620" cy="664" rx="28" ry="46"/>`,
  `<path class="a" d="M 336 712 C 340 630 400 584 470 570"/>`,
  `<path class="a" d="M 664 712 C 660 630 600 584 530 570"/>`,
  `<path class="a md" d="M 476 560 C 470 602 478 642 500 648 C 522 642 530 602 524 560 Z"/>`,
  `<ellipse class="a md" cx="232" cy="470" rx="11" ry="20"/>`,
  `<ellipse class="a md" cx="768" cy="470" rx="11" ry="20"/>`,
  `<path class="a tg" d="M 352 722 C 337 840 365 1012 500 1064 C 635 1012 663 840 648 722 C 600 690 400 690 352 722 Z"/>`,
  `<path class="f" d="M 420 742 L 500 786 L 580 742"/>`,
  // Circumvallate papillae along the V of the sulcus terminalis.
  [[440, 753], [460, 764], [480, 775], [520, 775], [540, 764], [560, 753]]
    .map(([x, y]) => `<circle class="a md" cx="${x}" cy="${y}" r="7"/>`)
    .join(""),
  `<path class="f" d="M 500 796 L 500 1046"/>`,
  sides,
].join("");

// Tongue lifted: its underside with the veins and the frenulum, the
// openings of the submandibular ducts (caruncles) and the sublingual folds
// on the floor of the mouth, lower teeth and lip.
const FLOOR_OF_MOUTH = [
  panel(850),
  `<path class="a lp" d="M 120 180 C 120 650 310 830 500 830 C 690 830 880 650 880 180 C 700 120 300 120 120 180 Z"/>`,
  `<path class="a cv" d="M 190 210 C 195 610 345 772 500 772 C 655 772 805 610 810 210 C 650 166 350 166 190 210 Z"/>`,
  teeth(500, 300, [240, 392], [192, 340], 14, false),
  `<path class="a mu" d="M 322 300 A 178 326 0 0 0 678 300 Z"/>`,
  `<path class="f" d="M 468 530 C 420 566 368 566 330 534"/>`,
  `<path class="f" d="M 532 530 C 580 566 632 566 670 534"/>`,
  `<path class="a tg" d="M 328 452 C 328 262 428 110 500 100 C 572 110 672 262 672 452 C 600 484 400 484 328 452 Z"/>`,
  `<path class="vn" d="M 456 446 C 444 360 454 262 480 172"/>`,
  `<path class="vn" d="M 544 446 C 556 360 546 262 520 172"/>`,
  `<path class="a md" d="M 494 300 L 500 522 L 506 300 Z"/>`,
  `<circle class="a md" cx="478" cy="524" r="11"/>`,
  `<circle class="a md" cx="522" cy="524" r="11"/>`,
  sides,
].join("");

// Side section through the middle of the head, facing right (as Gray 994):
// skull and sinuses, nasal cavity with turbinates, palate, tongue,
// mandible, the airway from nose to trachea, epiglottis, larynx, spine.
const vertebrae = Array.from(
  { length: 6 },
  (_, i) => `<rect class="a bn" x="138" y="${420 + i * 110}" width="94" height="88" rx="14"/>`
).join("");
const OROPHARYNX = [
  `<path class="a sk" d="M 80 40 L 700 40 C 705 120 720 200 735 250 C 770 330 820 400 850 450 C 862 470 850 492 825 490 C 805 488 790 486 780 495 C 792 540 800 572 790 592 C 784 602 776 606 768 610 C 798 630 800 660 782 676 C 770 700 790 760 770 800 C 740 840 690 850 650 852 C 640 900 650 1000 660 1090 L 80 1090 Z"/>`,
  `<path class="a bn" d="M 300 300 L 300 40 L 700 40 C 705 120 720 200 735 250 C 690 240 600 240 432 262 C 380 258 330 268 300 300 Z"/>`,
  `<ellipse class="a cv" cx="380" cy="200" rx="48" ry="36"/>`,
  `<ellipse class="a cv" cx="676" cy="118" rx="22" ry="46"/>`,
  `<path class="a cv" d="M 432 268 C 500 252 600 246 690 252 C 728 282 764 332 802 400 C 816 426 820 446 812 462 L 780 470 L 432 470 Z"/>`,
  `<path class="a mu" d="M 500 300 C 560 285 620 288 652 302 C 620 320 560 320 500 300 Z"/>`,
  `<path class="a mu" d="M 470 346 C 560 326 660 332 722 354 C 670 380 560 380 470 346 Z"/>`,
  `<path class="a mu" d="M 450 406 C 560 386 700 394 772 422 C 700 450 560 450 450 406 Z"/>`,
  `<path class="a cv" d="M 300 300 C 330 268 385 258 432 268 L 432 470 C 402 500 376 560 372 612 L 396 668 C 392 730 408 790 445 830 C 470 870 485 930 495 1000 L 500 1090 L 382 1090 L 382 960 C 350 955 320 955 292 962 L 292 330 C 292 318 295 308 300 300 Z"/>`,
  `<path class="a mu" d="M 292 962 C 320 955 350 955 382 960 L 382 1090 L 292 1090 Z"/>`,
  `<ellipse class="a bn" cx="206" cy="360" rx="34" ry="30"/>`,
  vertebrae,
  `<path class="a bn" d="M 432 470 L 770 470 C 786 472 788 500 770 502 L 440 502 Z"/>`,
  `<path class="a mu" d="M 432 470 C 385 485 358 545 356 605 C 355 632 380 634 384 610 C 390 565 410 525 440 502 Z"/>`,
  `<path class="a th" d="M 750 504 L 770 504 L 768 588 C 764 600 755 600 751 588 Z"/>`,
  `<path class="a th" d="M 744 622 L 762 620 L 760 690 L 746 690 Z"/>`,
  `<path class="a tg" d="M 760 615 C 740 560 640 520 540 535 C 455 548 398 600 396 668 C 392 730 408 790 445 830 C 500 862 600 852 660 802 C 700 762 720 700 745 660 C 752 645 760 630 760 615 Z"/>`,
  ...[[600, 552], [540, 558], [482, 590], [440, 650], [430, 720]].map(([x, y]) => `<path class="f" d="M 655 800 L ${x} ${y}"/>`),
  `<path class="a bn" d="M 690 700 C 725 698 752 725 755 765 C 758 805 735 838 702 838 C 678 838 664 806 668 765 C 671 728 680 705 690 700 Z"/>`,
  `<ellipse class="a bn" cx="560" cy="872" rx="32" ry="14"/>`,
  `<path class="a cg" d="M 488 936 C 446 900 412 840 400 768 C 414 766 426 792 436 830 C 450 878 474 912 496 930 Z"/>`,
  `<path class="a cg" d="M 506 904 C 546 930 562 1000 542 1062 L 514 1062 C 530 1000 522 942 500 922 Z"/>`,
  `<path class="a mu" d="M 498 954 L 456 964 L 498 976 Z"/>`,
  `<path class="a wh" d="M 500 990 L 446 1004 L 500 1018 Z"/>`,
  `<path class="f" d="M 386 1050 L 500 1050"/>`,
  `<path class="f" d="M 386 1076 L 502 1076"/>`,
].join("");

// The larynx seen with the mirror / scope (as Gray 956): tongue base and
// vallecula, epiglottis, aryepiglottic folds, false cords, the white vocal
// cords meeting at the front, the dark glottis, arytenoids at the back.
const LARYNX = [
  panel(1000),
  `<circle class="a cv" cx="500" cy="520" r="420"/>`,
  `<path class="a mu" d="M 112 360 C 240 140 760 140 888 360 C 760 300 640 282 500 284 C 360 282 240 300 112 360 Z"/>`,
  `<path class="a mu" d="M 220 380 C 230 300 330 250 500 250 C 670 250 770 300 780 380 C 790 520 700 690 600 800 C 560 845 440 845 400 800 C 300 690 210 520 220 380 Z"/>`,
  `<path class="a cg" d="M 250 386 C 260 300 360 268 500 268 C 640 268 740 300 750 386 C 720 350 620 322 500 324 C 380 322 280 350 250 386 Z"/>`,
  `<path class="a md" d="M 300 400 C 330 360 420 344 500 344 C 580 344 670 360 700 400 C 700 540 640 680 575 760 C 545 792 455 792 425 760 C 360 680 300 540 300 400 Z"/>`,
  `<ellipse class="a mu" cx="500" cy="350" rx="34" ry="14"/>`,
  `<path class="a mu" d="M 472 366 C 410 422 360 562 364 702 L 410 722 C 410 592 440 452 486 370 Z"/>`,
  `<path class="a mu" d="M 528 366 C 590 422 640 562 636 702 L 590 722 C 590 592 560 452 514 370 Z"/>`,
  `<path class="a cv" d="M 500 374 L 448 736 Q 500 758 552 736 Z"/>`,
  `<path class="a wh" d="M 494 374 L 410 722 L 448 736 L 498 380 Z"/>`,
  `<path class="a wh" d="M 506 374 L 590 722 L 552 736 L 502 380 Z"/>`,
  `<ellipse class="a mu" cx="422" cy="762" rx="46" ry="36"/>`,
  `<ellipse class="a mu" cx="578" cy="762" rx="46" ry="36"/>`,
  `<circle class="a md" cx="464" cy="784" r="18"/>`,
  `<circle class="a md" cx="536" cy="784" r="18"/>`,
  sides,
].join("");

// Head and neck from the right: the sternocleidomastoid from behind the ear
// to the breastbone and collarbone, jaw line, Adam's apple; dashed: the
// hyoid and cricoid levels, for marking swellings and nodes.
const NECK_RIGHT = [
  `<path class="a sk" d="M 320 560 C 260 430 270 220 430 145 C 560 90 690 125 722 235 C 732 268 734 296 728 318 C 748 352 772 392 800 428 C 808 440 800 452 786 455 C 772 458 762 456 756 462 C 760 478 768 488 766 500 C 762 512 754 516 750 520 C 760 530 762 545 752 556 C 744 566 742 578 750 592 C 760 618 744 646 712 654 C 680 660 645 662 625 668 C 615 715 640 748 630 774 C 626 800 636 840 645 900 L 760 930 C 800 950 820 980 822 1000 L 60 1000 C 80 960 100 920 120 905 C 190 885 230 860 260 810 C 300 740 312 650 320 560 Z"/>`,
  `<path class="a ms" d="M 500 534 C 536 650 598 790 656 888 L 612 896 C 596 870 566 846 534 878 L 502 880 C 486 780 472 680 458 560 Z"/>`,
  `<path class="f" d="M 486 560 C 500 680 520 790 540 872"/>`,
  `<path class="f" d="M 516 600 C 546 700 586 800 630 884"/>`,
  `<path class="a bn" d="M 280 868 C 380 856 520 868 660 890 C 668 898 664 910 655 910 C 520 892 380 882 285 888 C 275 885 273 872 280 868 Z"/>`,
  `<path class="f" d="M 330 610 C 325 700 300 790 220 870"/>`,
  `<path class="f" d="M 712 652 C 650 628 575 612 528 600 C 518 572 514 545 518 512"/>`,
  `<path class="d" d="M 622 708 L 520 694"/>`,
  `<path class="d" d="M 632 806 L 560 806"/>`,
  `<path class="a sk2" d="M 478 380 C 440 365 410 395 412 440 C 414 490 440 525 470 528 C 488 530 492 512 482 500 C 470 485 470 470 478 455 C 486 430 492 400 478 380 Z"/>`,
  `<path class="f" d="M 465 405 C 445 405 438 430 445 455 C 452 470 462 470 466 458"/>`,
  `<path class="a" d="M 640 320 Q 670 335 700 322"/>`,
  `<path class="a" d="M 630 290 Q 670 276 712 288"/>`,
  `<path class="f" d="M 714 534 L 752 527"/>`,
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
