import { PenLine } from "lucide-react";
import DiagramImage from "./DiagramImage.jsx";
import { DIAGRAMS, DIAGRAM_ORDER, REGIONS, drawnIn } from "../diagrams.js";

// Under On examination: a button per region (Ear, Nose, Throat, Neck) that
// opens its diagrams for drawing, and a thumbnail of each diagram drawn on.
// onOpen(keys, start, title). After saving (readOnly) only the thumbnails
// stay, opening the drawings to look at.
export default function ExamDiagrams({ drawings, readOnly, onOpen }) {
  const drawn = DIAGRAM_ORDER.filter((k) => drawings[k]?.length);
  if (readOnly && !drawn.length) return null;

  const openThumb = (k) => {
    if (readOnly) return onOpen(drawn, k, "Examination diagrams");
    const region = REGIONS.find((r) => r.diagrams.includes(k));
    onOpen(region.diagrams, k, region.label);
  };

  return (
    <div className="exam-diagrams">
      {!readOnly && (
        <div className="exam-diagram-regions" role="group" aria-label="Draw on a diagram">
          <span className="exam-diagrams-label">Diagrams</span>
          {REGIONS.map((r) => {
            const count = drawnIn(r, drawings).length;
            return (
              <button
                type="button"
                key={r.id}
                className={`records-button diagram-region${count ? " has-drawing" : ""}`}
                aria-haspopup="dialog"
                onClick={() => onOpen(r.diagrams, r.diagrams[0], r.label)}
              >
                <PenLine size={16} aria-hidden="true" />
                {r.label}
                {count > 0 && (
                  <span className="diagram-count">
                    {count}
                    <span className="sr-only"> drawn on</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {drawn.length > 0 && <DiagramThumbs items={drawn.map((k) => ({ diagram: k, strokes: drawings[k] }))} onOpen={openThumb} />}
    </div>
  );
}

// Small pictures of drawn diagrams; `items`: [{ diagram, version?, strokes }].
export function DiagramThumbs({ items, onOpen }) {
  return (
    <ul className="diagram-thumbs">
      {items.map((d) => (
        <li key={d.diagram}>
          <button type="button" className="diagram-thumb" aria-haspopup="dialog" onClick={() => onOpen(d.diagram)}>
            <DiagramImage diagram={d.diagram} version={d.version} strokes={d.strokes} aria-hidden="true" />
            <span>{DIAGRAMS[d.diagram]?.short ?? d.diagram}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
