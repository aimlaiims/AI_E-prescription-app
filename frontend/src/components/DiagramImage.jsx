import { DIAGRAMS, DIAGRAM_WIDTH, artFor, strokePath } from "../diagrams.js";

// One examination diagram with what was drawn on it: the line art, then the
// strokes on top. Used for thumbnails, history and the drawing screen.
// `version`: the artwork it was drawn on (stored drawings); default current.
export default function DiagramImage({ diagram, version, strokes = [], svgRef, className = "", title, ...rest }) {
  const spec = DIAGRAMS[diagram];
  const height = spec?.height ?? DIAGRAM_WIDTH;
  const art = artFor(diagram, version);
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${DIAGRAM_WIDTH} ${height}`}
      className={`diagram-image ${className}`}
      style={{ aspectRatio: `${DIAGRAM_WIDTH} / ${height}`, "--diagram-ratio": DIAGRAM_WIDTH / height }}
      role="img"
      aria-label={title ?? spec?.label ?? "Diagram"}
      {...rest}
    >
      <rect className="diagram-paper" width={DIAGRAM_WIDTH} height={height} />
      {art ? (
        // Our own static artwork (diagramArt.js), never user text.
        <g className="diagram-art" dangerouslySetInnerHTML={{ __html: art }} />
      ) : (
        <text className="diagram-missing" x={DIAGRAM_WIDTH / 2} y={height / 2} textAnchor="middle">
          Diagram not available
        </text>
      )}
      <g className="diagram-ink">
        {strokes.map((s, i) => (
          <path key={`h${i}`} d={strokePath(s.points)} className="ink-halo" strokeWidth={s.width + 4} />
        ))}
        {strokes.map((s, i) => (
          <path key={i} d={strokePath(s.points)} className={`ink ink-${s.color}`} strokeWidth={s.width} />
        ))}
      </g>
    </svg>
  );
}
