/**
 * Facts, kept straight (pure, tested): the same thing read twice is one fact
 * (`dedupeKey`), a single-valued thing (a lift's attempt plan at a meet, its
 * rack height, its warm-up ladder, a meet's result, a day's bodyweight) has
 * one current answer (`slotKey`), and which answer is current is worked out
 * again from every live source whenever one is added, replaced, deleted or
 * corrected (`resolveFacts`), so nothing depends on the order things arrived.
 *
 * The current answer in a slot: a correction or an answer the coach gave
 * wins; otherwise the newer dated one when the dates are clearly apart and
 * it comes from someone who can say it; otherwise the more authoritative
 * provider (their own coach for attempts and warm-ups, the athlete next);
 * otherwise the one received later from a different upload. Two that can't be
 * told apart are a conflict, said once, never guessed.
 */
import { norm } from "./classify";
import type { Fact, FactKind, Provider, TrainingData, MeetData, AttemptPlanData, EquipmentData, RiskData } from "./types";

const r05 = (x: number | null | undefined) => (x == null ? "" : String(Math.round(x * 2) / 2));

/** The same thing, whichever file said it (a duplicate is merged, never stored twice). */
export function dedupeKey(f: Pick<Fact, "kind" | "lift" | "date" | "data" | "scope">, competitionId: string | null): string {
  const d: any = f.data;
  const meet = f.scope === "meet" ? competitionId ?? "" : "";
  switch (f.kind) {
    case "training": {
      const t = d as TrainingData;
      return ["t", f.date ?? `w${t.week ?? ""}d${t.day ?? ""}#${f.date ? "" : t.order ?? ""}`, norm(t.exercise), r05(t.loadKg ?? t.load), t.pct ?? "", t.sets, t.reps, t.rpe ?? "", t.rir ?? "", t.completion].join("|");
    }
    case "meet": {
      const m = d as MeetData;
      return ["m", f.date, r05(m.total)].join("|");
    }
    case "attempt_plan": {
      const a = d as AttemptPlanData;
      return ["a", meet, f.lift, r05(a.opener), r05(a.second), r05(a.third)].join("|");
    }
    case "warmup":
      return ["w", f.lift, (d.rows ?? []).map((x: any) => `${r05(x.kg)}${x.pct ?? ""}x${x.reps}`).join(",")].join("|");
    case "equipment": {
      const e = d as EquipmentData;
      return ["e", f.lift ?? "", e.rackHeight ?? "", e.safety ?? "", e.footBlocks ?? "", (e.gear ?? []).map(norm).sort().join(","), norm(e.text ?? "")].join("|");
    }
    case "bodyweight":
      return ["bw", f.date ?? "", r05(d.kg)].join("|");
    case "risk":
      return ["r", f.date ?? "", norm((d as RiskData).text).slice(0, 120), (d as RiskData).status].join("|");
    default:
      return [f.kind.slice(0, 3), meet, f.lift ?? "", norm(String(d.text ?? "")).slice(0, 160)].join("|");
  }
}

/** One current answer per slot (null: the kind isn't single-valued). */
export function slotKey(f: Pick<Fact, "kind" | "lift" | "date" | "data" | "competition_id">): string | null {
  switch (f.kind) {
    case "attempt_plan":
      return f.lift ? `a|${f.competition_id ?? ""}|${f.lift}` : null;
    case "warmup":
      return f.lift ? `w|${f.lift}` : null;
    case "equipment": {
      const e = f.data as EquipmentData;
      return f.lift && (e.rackHeight || e.safety || e.footBlocks) ? `e|${f.lift}` : null;
    }
    case "meet":
      return f.date ? `m|${f.date}` : null;
    case "bodyweight":
      return f.date ? `bw|${f.date}` : null;
    default:
      return null;
  }
}

/** Who can speak to a kind of fact: for attempts and warm-ups the athlete's own coach first. */
export function authority(kind: FactKind, p: Provider): number {
  if (kind === "attempt_plan" || kind === "warmup")
    return { primary_coach: 4, athlete: 3, handler: 3, other_coach: 2, other: 1, unknown: 1 }[p];
  if (kind === "meet") return { primary_coach: 3, athlete: 3, handler: 3, other_coach: 2, other: 2, unknown: 1 }[p];
  return { athlete: 3, primary_coach: 3, handler: 3, other_coach: 2, other: 1, unknown: 1 }[p];
}

const dayGap = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

export type Resolution = {
  /** the status each fact should have */
  status: Map<string, "active" | "superseded">;
  /** why a fact isn't current */
  why: Map<string, string>;
  /** slots with two answers nothing can tell apart */
  conflicts: Array<{ slot: string; kind: FactKind; lift: Fact["lift"]; facts: Fact[] }>;
};

/** Which fact in each slot is current, and what's left unresolved. Dismissed facts are never passed in. */
export function resolveFacts(facts: Fact[]): Resolution {
  const status = new Map<string, "active" | "superseded">();
  const why = new Map<string, string>();
  const conflicts: Resolution["conflicts"] = [];
  const slots = new Map<string, Fact[]>();
  for (const f of facts) {
    status.set(f.id, "active");
    const k = slotKey(f);
    if (k) (slots.get(k) ?? slots.set(k, []).get(k)!).push(f);
  }
  for (const [slot, list] of slots) {
    // identical answers aren't a choice
    const distinct = new Map<string, Fact[]>();
    for (const f of list) {
      const k = dedupeKey(f, f.competition_id);
      (distinct.get(k) ?? distinct.set(k, []).get(k)!).push(f);
    }
    if (distinct.size <= 1) continue;
    const ranked = [...list].sort((a, b) => compare(b, a));
    const top = ranked[0];
    const runnerUp = ranked.find((f) => dedupeKey(f, f.competition_id) !== dedupeKey(top, top.competition_id))!;
    if (runnerUp && compare(top, runnerUp) === 0) {
      conflicts.push({ slot, kind: top.kind, lift: top.lift, facts: [top, runnerUp] });
      continue;
    }
    const topKey = dedupeKey(top, top.competition_id);
    for (const f of list) {
      if (dedupeKey(f, f.competition_id) === topKey) continue;
      status.set(f.id, "superseded");
      why.set(f.id, reasonOver(top, f));
    }
  }
  return { status, why, conflicts };
}

/** Positive when a is the current answer over b; 0 when nothing tells them apart. */
export function compare(a: Fact, b: Fact): number {
  const own = (f: Fact) => (f.basis === "coach" || f.basis === "answer" ? 1 : 0);
  if (own(a) !== own(b)) return own(a) - own(b);
  if (own(a) && own(b)) return Date.parse(a.received_at) - Date.parse(b.received_at);
  if (a.date && b.date && Math.abs(dayGap(a.date, b.date)) >= 3) {
    const newer = dayGap(a.date, b.date) > 0 ? a : b;
    if (authority(newer.kind, newer.provider) >= 2) return newer === a ? 1 : -1;
  }
  const au = authority(a.kind, a.provider) - authority(b.kind, b.provider);
  if (au) return au;
  if (a.source_id !== b.source_id) {
    const gap = Date.parse(a.received_at) - Date.parse(b.received_at);
    if (Math.abs(gap) >= 60 * 60_000) return gap;
  }
  return 0;
}

function reasonOver(top: Fact, f: Fact): string {
  if (top.basis === "coach") return "Corrected by the coach";
  if (top.basis === "answer") return "Settled by an answer";
  if (top.date && f.date && top.date > f.date) return `A newer one (${top.date}) replaced it`;
  if (authority(top.kind, top.provider) > authority(f.kind, f.provider)) return "Their coach's version is the one used";
  return "A later upload replaced it";
}

/** A fact a coach wrote or corrected (basis coach) from a source one: the new fact's fields. */
export function correctedFrom(f: Fact, data: Fact["data"], patch: Partial<Pick<Fact, "date" | "lift">> = {}): Omit<Fact, "id"> {
  return {
    ...f,
    ...patch,
    data,
    basis: "coach",
    status: "active",
    confidence: "high",
    dedupe_key: dedupeKey({ ...f, ...patch, data }, f.competition_id),
    received_at: new Date().toISOString(),
  };
}
