/**
 * Duration parsing and formatting for time-based exercises.
 * Single source of truth is integer seconds.
 */

export function parseDurationInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // mm:ss
  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    const m = parseInt(colon[1], 10);
    const sec = parseInt(colon[2], 10);
    if (sec >= 60) return null;
    const total = m * 60 + sec;
    return total > 0 ? total : null;
  }

  // "1m 30s", "2 min", "45 sec", "1 min 30 sec", "1h 5m"
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let matched = false;
  let rest = s;
  while ((match = re.exec(s)) !== null) {
    matched = true;
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = match[2];
    if (unit.startsWith("h")) total += n * 3600;
    else if (unit.startsWith("m")) total += n * 60;
    else total += n;
    rest = rest.replace(match[0], "");
  }
  if (matched) {
    if (rest.replace(/[\s,]/g, "") !== "") return null;
    const rounded = Math.round(total);
    return rounded > 0 ? rounded : null;
  }

  // bare number → seconds
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(parseFloat(s));
    return n > 0 ? n : null;
  }

  return null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total} sec`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}

export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}