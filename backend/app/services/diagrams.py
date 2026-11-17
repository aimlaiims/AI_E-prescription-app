"""
Examination diagrams the doctor draws on (frontend: src/diagrams.js, the
artwork in src/diagramArt.js). Saved with the visit, never printed; shown in
the patient's history.

The diagram names and artwork versions exist twice — here and in
frontend/src/diagrams.js — change both or neither. A redrawn diagram gets a
new version and the old artwork stays, so earlier drawings keep showing on
the picture they were drawn on.
"""
import json

# diagram -> artwork versions that exist
ARTWORK = {
    "tm-right": (1,),
    "tm-left": (1,),
    "nose": (1,),
    "oral-cavity": (1,),
    "floor-of-mouth": (1,),
    "oropharynx": (1,),
    "larynx": (1,),
    "neck-right": (1,),
    "neck-left": (1,),
}

COLORS = ("black", "red", "blue")
# Generous: a busy drawing is a few thousand points. Stops a runaway request,
# never a real drawing.
MAX_STROKES = 600
MAX_POINTS = 20000  # x, y pairs per diagram
COORD_MIN, COORD_MAX = -100, 2100  # every picture is 1000 wide, under 2000 high


def problem(drawings) -> str | None:
    """Why these drawings can't be saved (plain words), or None."""
    seen = set()
    for d in drawings:
        if d.version not in ARTWORK.get(d.diagram, ()):
            return "One of the diagrams isn't known to this version of the app. Reload the page and draw it again."
        if d.diagram in seen:
            return "A diagram was sent twice. Reload the page and draw it again."
        seen.add(d.diagram)
        if len(d.strokes) > MAX_STROKES or sum(len(s.points) for s in d.strokes) > 2 * MAX_POINTS:
            return "A diagram has too much drawing on it. Clear part of it and save again."
        for s in d.strokes:
            if len(s.points) % 2 or any(not COORD_MIN <= v <= COORD_MAX for v in s.points):
                return "A diagram couldn't be read. Reload the page and draw it again."
    return None


def to_json(drawing) -> str:
    return json.dumps(
        [{"color": s.color, "width": s.width, "points": s.points} for s in drawing.strokes],
        separators=(",", ":"),
    )


def stored(row) -> dict:
    return {"diagram": row.diagram, "version": row.version, "strokes": json.loads(row.strokes)}
