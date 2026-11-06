// Badges an athlete has earned, read from their real history (never stored,
// so they can't drift from the results).
import { formatScore } from "./format";
import type { ProfileHistoryItem } from "./types";

export interface Achievement {
  id: string;
  label: string;
  detail: string;
}

/** Results that count: verified, with a rank. */
function ranked(h: ProfileHistoryItem[]) {
  return h.filter((x) => x.rank != null && x.score != null && x.status !== "cancelled");
}

/** Same event type: same activity, metric, load and scoring. */
export function eventKind(x: Pick<ProfileHistoryItem, "activity" | "metric" | "unit" | "scoring" | "load_value" | "load_unit">): string {
  return [x.activity.toLowerCase(), x.metric, x.unit, x.scoring, x.load_value ?? "", x.load_unit ?? ""].join("|");
}

/** Best score per kind of event, the person's personal bests. */
export function personalBests(history: ProfileHistoryItem[]): { kind: string; item: ProfileHistoryItem }[] {
  const best = new Map<string, ProfileHistoryItem>();
  for (const x of ranked(history)) {
    const k = eventKind(x);
    const cur = best.get(k);
    const better = !cur || (x.direction === "lower" ? x.score! < cur.score! : x.score! > cur.score!);
    if (better) best.set(k, x);
  }
  return [...best.entries()].map(([kind, item]) => ({ kind, item }));
}

export function achievements(history: ProfileHistoryItem[]): Achievement[] {
  const r = ranked(history);
  const finals = r.filter((x) => x.final);
  const out: Achievement[] = [];
  if (r.length >= 1) out.push({ id: "first", label: "First challenge", detail: `Competed at ${r[r.length - 1].title}` });
  const wins = finals.filter((x) => x.rank === 1);
  if (wins.length) out.push({ id: "champion", label: wins.length > 1 ? `${wins.length}× champion` : "Champion", detail: wins.map((w) => w.title).join(", ") });
  const podiums = finals.filter((x) => x.rank! <= 3);
  if (podiums.length && podiums.length > wins.length) out.push({ id: "podium", label: podiums.length > 1 ? `${podiums.length} podiums` : "Podium finish", detail: podiums.map((p) => p.title).join(", ") });
  const top10 = finals.filter((x) => x.rank! <= 10 && x.field >= 20);
  if (top10.length && !podiums.length) out.push({ id: "top10", label: "Top 10", detail: top10[0].title });
  if (r.length >= 3) out.push({ id: "regular", label: "Regular", detail: `${r.length} challenges entered` });
  // a personal best that beat an earlier result in the same kind of event
  const byKind = new Map<string, ProfileHistoryItem[]>();
  for (const x of [...r].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const k = eventKind(x);
    byKind.set(k, [...(byKind.get(k) ?? []), x]);
  }
  for (const list of byKind.values()) {
    if (list.length < 2) continue;
    const last = list[list.length - 1];
    const before = list.slice(0, -1);
    const prevBest = last.direction === "lower" ? Math.min(...before.map((x) => x.score!)) : Math.max(...before.map((x) => x.score!));
    const improved = last.direction === "lower" ? last.score! < prevBest : last.score! > prevBest;
    if (improved) {
      out.push({ id: `pb-${last.slug}`, label: "Personal best", detail: `${formatScore(last.score, last)} at ${last.title}` });
      break;
    }
  }
  return out;
}
