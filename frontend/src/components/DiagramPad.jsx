import { useEffect, useRef, useState } from "react";
import { Check, Eraser, Undo2 } from "lucide-react";
import DiagramImage from "./DiagramImage.jsx";
import { useDialog } from "../useDialog.js";
import { DIAGRAMS, DIAGRAM_WIDTH, MAX_POINTS, PENS, PEN_WIDTH, addPoint, pointCount, strokeAt } from "../diagrams.js";

export const DIAGRAM_FULL_MESSAGE = "This diagram is full. Erase some lines to draw more.";
export const DISCARD_DRAWING_MESSAGE = "Discard what you drew on these diagrams?";

const ERASER_RADIUS = 14; // diagram units around the finger / pen tip

// Once a stylus has touched the screen, finger touches stop drawing, so the
// hand resting on the screen leaves no marks. Without a stylus, fingers draw.
let stylusSeen = false;
export const forgetStylus = () => {
  stylusSeen = false;
};

const heightOf = (key) => DIAGRAMS[key]?.height ?? DIAGRAM_WIDTH;

// Full-screen drawing on a region's diagrams (tabs when there are several).
// `drawings`: { diagram: strokes }. Done hands back the strokes of every
// diagram in `keys` (empty = nothing drawn there); Cancel changes nothing.
// `readOnly`: a saved visit's drawings, to look at only. `versions`: the
// artwork each was drawn on (history); otherwise the current artwork.
export default function DiagramPad({ title, keys, start, drawings, versions = {}, readOnly = false, onDone, onClose }) {
  const [work, setWork] = useState(() => Object.fromEntries(keys.map((k) => [k, drawings[k] ?? []])));
  const [current, setCurrent] = useState(keys.includes(start) ? start : keys[0]);
  const [tool, setTool] = useState("black");
  const [undo, setUndo] = useState({}); // diagram -> earlier strokes, newest last
  const [live, setLive] = useState(null); // the stroke being drawn
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const workRef = useRef(work);
  const liveRef = useRef(null);
  const gesture = useRef(null); // { id, erased }
  const svgRef = useRef(null);

  const cancel = () => {
    if (dirty && !readOnly && !window.confirm(DISCARD_DRAWING_MESSAGE)) return;
    onClose();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const ref = useDialog(undefined);
  // Esc is handled here, before any dialog underneath (patient history)
  // sees it: it closes this screen only.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const height = heightOf(current);

  const setStrokes = (key, strokes, { keepUndo = false } = {}) => {
    // Read now: the updater below runs later, after workRef has changed.
    const before = workRef.current[key];
    if (!keepUndo) setUndo((u) => ({ ...u, [key]: [...(u[key] ?? []), before] }));
    workRef.current = { ...workRef.current, [key]: strokes };
    setWork(workRef.current);
    setDirty(true);
  };

  // Pointer position in diagram units (the picture may be letterboxed).
  const toDiagram = (e) => {
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM?.();
    if (ctm && typeof DOMPoint !== "undefined") {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return [p.x, p.y];
    }
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * DIAGRAM_WIDTH, ((e.clientY - r.top) / r.height) * height];
  };

  const eraseAt = (x, y) => {
    const strokes = workRef.current[current];
    const i = strokeAt(strokes, x, y, ERASER_RADIUS);
    if (i < 0) return;
    // One undo step per eraser gesture, however many lines it removes.
    setStrokes(current, strokes.filter((_, j) => j !== i), { keepUndo: gesture.current.erased });
    gesture.current.erased = true;
    setNote("");
  };

  const down = (e) => {
    if (readOnly || gesture.current) return; // one pointer at a time
    if (e.pointerType === "pen") stylusSeen = true;
    if (e.pointerType === "touch" && stylusSeen) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = { id: e.pointerId, erased: false };
    const [x, y] = toDiagram(e);
    if (tool === "eraser") return eraseAt(x, y);
    if (pointCount(workRef.current[current]) >= MAX_POINTS) {
      gesture.current = null;
      setNote(DIAGRAM_FULL_MESSAGE);
      return;
    }
    liveRef.current = { color: tool, width: PEN_WIDTH[e.pointerType] ?? PEN_WIDTH.pen, points: addPoint([], x, y, height) };
    setLive(liveRef.current);
  };

  const move = (e) => {
    if (gesture.current?.id !== e.pointerId) return;
    // Fast strokes: the browser may group several positions into one event.
    const events = e.nativeEvent?.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = toDiagram(ev);
      if (tool === "eraser") {
        eraseAt(x, y);
        continue;
      }
      const s = liveRef.current;
      if (!s) return;
      if (pointCount(workRef.current[current]) + s.points.length / 2 >= MAX_POINTS) {
        setNote(DIAGRAM_FULL_MESSAGE);
        return;
      }
      const points = addPoint(s.points, x, y, height);
      if (points !== s.points) liveRef.current = { ...s, points };
    }
    if (liveRef.current) setLive(liveRef.current);
  };

  const up = (e) => {
    if (gesture.current?.id !== e.pointerId) return;
    gesture.current = null;
    const s = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (s) setStrokes(current, [...workRef.current[current], s]);
  };

  const undoLast = () => {
    const steps = undo[current] ?? [];
    if (!steps.length) return;
    workRef.current = { ...workRef.current, [current]: steps[steps.length - 1] };
    setWork(workRef.current);
    setUndo((u) => ({ ...u, [current]: steps.slice(0, -1) }));
    setNote("");
  };

  const choose = (key) => {
    setCurrent(key);
    setNote("");
  };

  const strokes = live ? [...work[current], live] : work[current];

  return (
    <div className="diagram-pad-backdrop">
      <div className="diagram-pad" role="dialog" aria-modal="true" aria-labelledby="diagram-pad-title" tabIndex={-1} ref={ref}>
        <header className="diagram-pad-header">
          <h2 id="diagram-pad-title">{title}</h2>
          {keys.length > 1 && (
            <div className="diagram-tabs" role="group" aria-label="Diagrams">
              {keys.map((k) => (
                <button
                  type="button"
                  key={k}
                  className="diagram-tab"
                  aria-pressed={k === current}
                  onClick={() => choose(k)}
                >
                  {DIAGRAMS[k]?.short ?? k}
                  {work[k].length > 0 && (
                    <span className="diagram-tab-dot">
                      <span className="sr-only"> (drawn on)</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="diagram-stage">
          <DiagramImage
            key={current}
            diagram={current}
            version={versions[current]}
            strokes={strokes}
            svgRef={svgRef}
            className={readOnly ? "" : `is-drawing tool-${tool}`}
            title={DIAGRAMS[current]?.label}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>

        {note && (
          <p className="diagram-note" role="status">
            {note}
          </p>
        )}

        <footer className="diagram-toolbar">
          {!readOnly && (
            <div className="diagram-tools" role="group" aria-label="Drawing tools">
              {PENS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`pen-button pen-${p.id}`}
                  aria-pressed={tool === p.id}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => setTool(p.id)}
                >
                  <span className="pen-swatch" aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                className="pen-button"
                aria-pressed={tool === "eraser"}
                aria-label="Eraser"
                title="Eraser: touch a line to remove it"
                onClick={() => setTool("eraser")}
              >
                <Eraser size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pen-button"
                aria-label="Undo"
                title="Undo"
                onClick={undoLast}
                disabled={!undo[current]?.length}
              >
                <Undo2 size={20} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="diagram-actions">
            {readOnly ? (
              <button type="button" className="records-button primary" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className="records-button" onClick={cancel}>
                  Cancel
                </button>
                <button type="button" className="records-button primary" onClick={() => onDone(workRef.current)}>
                  <Check size={17} aria-hidden="true" />
                  Done
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
