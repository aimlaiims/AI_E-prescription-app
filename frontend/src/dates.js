// Calendar dates as YYYY-MM-DD strings in the LOCAL timezone.
// (toISOString() is UTC — in India that is yesterday until 5:30 am.)

const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function localToday(now = new Date()) {
  return toIso(now);
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return toIso(new Date(y, m - 1, d + days));
}

// Date bounds for a filter chip combined with the From/To inputs: both apply,
// so the tighter bound wins (ISO strings compare correctly as text).
export function dateBounds(filter, from, to, today = localToday()) {
  const chipFrom = filter === "today" ? today : filter === "week" ? addDays(today, -6) : "";
  const chipTo = filter === "all" ? "" : today;
  const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  return { date_from: later(chipFrom, from), date_to: earlier(chipTo, to) };
}
