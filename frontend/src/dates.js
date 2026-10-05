// Calendar dates as YYYY-MM-DD strings, in the APP's timezone (IST) — not the
// device's, which may be set to anything, and not UTC (toISOString() is UTC:
// in India that is yesterday until 5:30 am).

// Must match APP_TIMEZONE in backend/.env (default Asia/Kolkata).
export const APP_TIME_ZONE = "Asia/Kolkata";

const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const zoned = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// { year, month (1-12), day, hour (0-23), minute } of an instant, in IST.
export function appTimeParts(now = new Date()) {
  const parts = Object.fromEntries(zoned.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function localToday(now = new Date()) {
  const { year, month, day } = appTimeParts(now);
  return `${year}-${pad(month)}-${pad(day)}`;
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
