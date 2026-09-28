// Rules for the list of proposed updates waiting in the review panel.
// Pure functions, no React, so they can be tested (pendingUpdates.test.js).
//
// ROADMAP P0-4: dictating the same field twice before reviewing used to leave
// two pending items, the second computed against a stale base (without the
// first), so "add ..." could lose the earlier addition and accepting both kept
// only one. Now:
//   1. Extraction is sent the form *as it would be* with pending items
//      applied (`withPendingApplied`), so a follow-up builds on the proposal.
//   2. At most one pending item per field: a newer one supersedes the older
//      (`mergePending`) and is flagged so the panel can say so.

/** Form state with every pending proposal applied on top — the base the
 *  next dictation should be interpreted against. */
export function withPendingApplied(state, pending) {
  const next = { ...state };
  for (const u of pending) next[u.field] = u.new_value;
  return next;
}

/**
 * Merge freshly extracted updates into the pending list.
 *
 * @param prev       current pending items (each with a stable `id`)
 * @param incoming   updates from the API (field, old_value, new_value, evidence)
 * @param realState  the actual form values right now; `old_value` is reset to
 *                   these, because the API computed it against the
 *                   pending-applied base, and "old" in the review panel must
 *                   mean what is really in the form.
 * @param makeId     () => new unique id
 */
export function mergePending(prev, incoming, realState, makeId) {
  // Within one batch, the last update for a field wins.
  const byField = new Map();
  for (const u of incoming) byField.set(u.field, u);

  const kept = prev.filter((p) => !byField.has(p.field));
  const added = [...byField.values()].map((u) => ({
    ...u,
    id: makeId(),
    old_value: realState[u.field] ?? "",
    supersedes: prev.some((p) => p.field === u.field),
  }));
  return [...kept, ...added];
}
