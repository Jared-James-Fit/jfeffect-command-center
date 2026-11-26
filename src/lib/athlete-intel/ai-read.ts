/**
 * Reading what the model copied out of an upload (pure, tested). The model
 * only copies; this decides what stands. Every number in a fact must be
 * written in the source (or, for a PDF or a picture, in the text the model
 * read off it, which is then marked lower confidence); every note, cue or
 * instruction must be found in the source in the words it was written in;
 * a fact that isn't is dropped and counted. Completion is the model's
 * reading only when it quotes what says so; otherwise it's unknown.
 */
import { classifyExercise, norm, parseDate } from "./classify";
import type { Confidence, FactKind, Lift, Provider, Purpose, RawFact, TrainingData, Unit } from "./types";
import { PURPOSES, toKg } from "./types";
import { readMeetFileField } from "./meet-files";

export class UnreadableAnswer extends Error {}

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const KINDS: FactKind[] = ["training", "meet", "attempt_plan", "warmup", "cue", "technique", "instruction", "equipment", "preference", "bodyweight", "risk", "taper", "note"];

const numbersOf = (s: string) => new Set([...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", "."))));
const has = (nums: Set<number>, x: number | null | undefined) => x == null || nums.has(x) || nums.has(Math.round(x * 10) / 10);
const str = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};
const numOr = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const unitOr = (v: unknown): Unit | null => (v === "kg" || v === "lb" ? v : v === "lbs" ? "lb" : null);
const liftOr = (v: unknown): Lift | null => (LIFTS.includes(v as Lift) ? (v as Lift) : null);

/** Words a note must share with the source to count as copied (60% of its words, in order not needed). */
export function foundInSource(text: string, source: string): boolean {
  const src = ` ${norm(source)} `;
  const t = norm(text);
  if (!t) return false;
  if (src.includes(` ${t} `) || src.includes(t)) return true;
  const words = t.split(" ").filter((w) => w.length > 2);
  if (!words.length) return false;
  const hit = words.filter((w) => src.includes(` ${w} `) || src.includes(w)).length;
  return hit / words.length >= 0.75;
}

export type AiRead = {
  facts: RawFact[];
  purposes: Purpose[];
  providerHint: Provider | null;
  transcript: string | null;
  unsure: string[];
  dropped: number;
};

const json = (text: string): any => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

export function readAiAnswer(text: string, o: { source: string | null; fileKind: boolean; today: string; unitHint: Unit | null }): AiRead {
  const j = json(text);
  if (!j || !Array.isArray(j.facts)) throw new UnreadableAnswer("No facts in the answer");
  const transcript = o.fileKind ? str(j.transcript, 60_000) : null;
  const ground = o.fileKind ? transcript ?? "" : o.source ?? "";
  const nums = numbersOf(ground);
  const conf = (c: Confidence): Confidence => (o.fileKind && c === "high" ? "medium" : c);
  const facts: RawFact[] = [];
  let dropped = 0;
  const dateOf = (v: unknown) => {
    const s = str(v, 30);
    if (!s) return null;
    const d = parseDate(s, o.today);
    if (!d) return null;
    // a date has to be written somewhere: its day number at least
    return nums.has(Number(d.slice(8, 10))) || ground.includes(d) ? d : null;
  };
  for (const raw of j.facts.slice(0, 600)) {
    if (raw?.kind === "meet_logistics") {
      const d = readMeetFileField(raw, ground);
      if (!d) { dropped++; continue; }
      facts.push({ kind: "note", lift: null, date: null, data: { text: d.text, meetLogistics: { field: d.field, value: d.value } }, quote: str(raw.quote, 300), location: str(raw.location, 80), confidence: "medium", scope: "meet" });
      continue;
    }
    const kind = raw?.kind as FactKind;
    if (!KINDS.includes(kind)) {
      dropped++;
      continue;
    }
    const quote = str(raw.quote, 300);
    const location = str(raw.location, 80);
    const scope = raw.scope === "meet" ? "meet" : raw.scope === "athlete" ? "athlete" : undefined;
    const lift = liftOr(raw.lift);
    const date = dateOf(raw.date);
    const unit = unitOr(raw.unit) ?? o.unitHint;
    const k = (x: number | null) => (x == null ? null : unit ? toKg(x, unit) : x);
    if (kind === "training") {
      const exercise = str(raw.exercise, 80);
      const reps = numOr(raw.reps, 1, 30);
      const load = numOr(raw.load, 10, 700);
      const pct = numOr(raw.pct, 30, 110);
      const sets = numOr(raw.sets, 1, 12) ?? 1;
      const rpeRaw = numOr(raw.rpe, 5, 10);
      if (!exercise || reps == null || (load == null && pct == null && rpeRaw == null)) {
        dropped++;
        continue;
      }
      const repsOk = nums.has(reps) || (reps === 1 && /\b(single|1rm|max)\b/i.test(ground)) || (reps === 2 && /\bdouble\b/i.test(ground)) || (reps === 3 && /\btriple\b/i.test(ground));
      if (!repsOk || !has(nums, load) || !has(nums, pct) || (sets > 1 && !nums.has(sets))) {
        dropped++;
        continue;
      }
      const cls = classifyExercise(exercise);
      const standard = cls.lift ? (raw.standard === "variation" ? "variation" : cls.standard) : raw.standard === "competition" && lift ? "unclear" : cls.standard;
      // completion only from a quoted sign; otherwise unknown
      const evidence = str(raw.completion_evidence, 200);
      let completion: TrainingData["completion"] = raw.completion === "prescribed" ? "prescribed" : "unknown";
      if (raw.completion === "completed" && evidence && foundInSource(evidence, ground)) completion = "completed";
      facts.push({
        kind,
        lift: cls.lift ?? lift,
        date,
        data: {
          exercise,
          standard,
          sets,
          reps,
          load,
          unit: load != null ? unit : null,
          loadKg: load != null && unit ? toKg(load, unit) : null,
          pct,
          rpe: rpeRaw != null && nums.has(rpeRaw) ? rpeRaw : null,
          rir: numOr(raw.rir, 0, 5) != null && nums.has(numOr(raw.rir, 0, 5)!) ? numOr(raw.rir, 0, 5) : null,
          completion,
          week: numOr(raw.week, 1, 60),
          day: numOr(raw.day, 1, 14),
          order: facts.length,
        } satisfies TrainingData,
        quote,
        location,
        confidence: conf(unit ? "high" : "medium"),
        scope: "athlete",
      });
      continue;
    }
    if (kind === "meet") {
      const s = numOr(raw.squat, 20, 600);
      const b = numOr(raw.bench, 15, 400);
      const d = numOr(raw.deadlift, 20, 600);
      const total = numOr(raw.total, 50, 1500);
      if (!date || !s || !b || !d || ![s, b, d, total].every((x) => has(nums, x))) {
        dropped++;
        continue;
      }
      facts.push({
        kind,
        lift: null,
        date,
        data: {
          name: str(raw.name, 120),
          federation: str(raw.federation, 80),
          weightClass: str(raw.weight_class, 20),
          bodyweightKg: has(nums, numOr(raw.bodyweight, 30, 300)) ? k(numOr(raw.bodyweight, 30, 300)) : null,
          squat: k(s),
          bench: k(b),
          deadlift: k(d),
          total: k(total ?? s + b + d),
          place: str(raw.place, 10),
          attempts: null,
        },
        quote,
        location,
        confidence: conf("high"),
        scope: "athlete",
      });
      continue;
    }
    if (kind === "attempt_plan") {
      const op = numOr(raw.opener, 20, 600);
      const se = numOr(raw.second, 20, 600);
      const th = numOr(raw.third, 20, 600);
      if (!lift || op == null || ![op, se, th].every((x) => has(nums, x))) {
        dropped++;
        continue;
      }
      facts.push({ kind, lift, date, data: { opener: k(op), second: k(se), third: k(th) }, quote, location, confidence: conf(unit ? "high" : "medium"), scope: "meet", providerHint: providerOr(raw.by) });
      continue;
    }
    if (kind === "warmup") {
      const rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .map((r: any) => ({ kg: numOr(r?.load, 15, 600), pct: numOr(r?.pct, 20, 100), reps: numOr(r?.reps, 1, 20) }))
        .filter((r: any) => r.reps != null && (r.kg != null || r.pct != null) && has(nums, r.kg) && has(nums, r.pct) && nums.has(r.reps));
      if (!lift || rows.length < 2) {
        dropped++;
        continue;
      }
      facts.push({ kind, lift, date, data: { rows: rows.map((r: any) => ({ kg: k(r.kg), pct: r.pct, reps: r.reps })) }, quote, location, confidence: conf("high"), scope: "athlete", providerHint: providerOr(raw.by) });
      continue;
    }
    if (kind === "bodyweight") {
      const v = numOr(raw.value, 30, 300);
      if (v == null || !nums.has(v)) {
        dropped++;
        continue;
      }
      facts.push({ kind, lift: null, date, data: { kg: k(v)! }, quote, location, confidence: conf(unit ? "high" : "medium"), scope: "athlete" });
      continue;
    }
    if (kind === "equipment") {
      const height = str(raw.rack_height, 10);
      const safety = str(raw.safety, 10);
      const blocks = str(raw.foot_blocks, 10);
      const gear = (Array.isArray(raw.gear) ? raw.gear : []).map((g: unknown) => str(g, 60)).filter((g: string | null): g is string => !!g && foundInSource(g, ground)).slice(0, 12);
      const textv = str(raw.text, 200);
      const okNums = [height, safety, blocks].every((x) => x == null || nums.has(Number(x)));
      if (!okNums || (!height && !safety && !blocks && !gear.length && !(textv && foundInSource(textv, ground)))) {
        dropped++;
        continue;
      }
      facts.push({ kind, lift, date, data: { rackHeight: height, safety, footBlocks: blocks, gear, text: textv && foundInSource(textv, ground) ? textv : null }, quote, location, confidence: conf("high"), scope: "athlete" });
      continue;
    }
    // text facts: copied in the source's own words
    const textv = str(raw.text, 400);
    if (!textv || !foundInSource(textv, ground)) {
      dropped++;
      continue;
    }
    if (kind === "risk") {
      const status = raw.status === "resolved" ? "resolved" : raw.status === "current" ? "current" : "unknown";
      facts.push({ kind, lift, date, data: { text: textv, place: str(raw.place, 60), status }, quote, location, confidence: conf("medium"), scope: "athlete" });
      continue;
    }
    facts.push({ kind, lift, date, data: { text: textv }, quote, location, confidence: conf("high"), scope: scope ?? (kind === "taper" ? "meet" : "athlete"), providerHint: providerOr(raw.by) });
  }
  const purposes = (Array.isArray(j.purposes) ? j.purposes : []).filter((p: unknown): p is Purpose => PURPOSES.includes(p as Purpose));
  return {
    facts,
    purposes,
    providerHint: providerOr(j.written_by),
    transcript,
    unsure: (Array.isArray(j.unsure) ? j.unsure : []).map((u: unknown) => str(u, 200)).filter(Boolean).slice(0, 8) as string[],
    dropped,
  };
}

function providerOr(v: unknown): Provider | null {
  return v === "primary_coach" || v === "athlete" || v === "other_coach" ? v : null;
}
