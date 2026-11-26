/**
 * When Cleo asks (pure, tested): almost never. Most uploads need no question
 * at all. Missing information alone is never a reason; a question is raised
 * only when its answer could change a consequential decision (attempt
 * selection, safety, a competition logistic) AND nothing on file settles it
 * AND the two possible answers would lead somewhere different AND the
 * decision is close enough that it matters now. Everything else is handled:
 * the confirmed fact is used, a reasonable inference is made and said, a
 * conservative recommendation is generated, or it's left out.
 *
 * Each question has a stable key: once answered or skipped it isn't asked
 * again unless what prompted it changed (its fingerprint), and an answer is
 * applied as facts, so the condition that raised it is gone.
 */
import { setE1rm, strengthSet } from "./engine-input";
import type { Fact, Lift, Provider, SourceRow, TrainingData } from "./types";
import { PROVIDER_LABEL } from "./types";
import type { Resolution } from "./facts";

export type AskWho = "handler" | "athlete" | "primary_coach";
export type AnswerKind = "confirm" | "number" | "text" | "choice" | "date" | "unit";

export type Question = {
  key: string;
  fingerprint: string;
  area: "attempts" | "safety" | "logistics" | "conflict" | "performance";
  text: string;
  /** the decision it affects, in a line */
  why: string;
  answer: { kind: AnswerKind; options?: Array<{ value: string; label: string }>; unit?: "kg" };
  askWho: AskWho[];
  priority: number;
  /** shown from this day (deferred before it) */
  visibleFrom: string;
  factIds: string[];
  sourceId: string | null;
  lift: Lift | null;
};

export type QuestionInput = {
  today: string;
  /** the competition it's for; no meet, no consequential decision, no question */
  meet: { id: string; date: string; incrementKg: number } | null;
  facts: Fact[];
  conflicts: Resolution["conflicts"];
  sources: Array<Pick<SourceRow, "id" | "file_name" | "kind" | "provider" | "provider_name" | "created_at" | "status"> & { unitUnknown?: boolean; startDate?: string | null }>;
  /** the app's own strength read per lift (kg): today's line and hard sessions in 6 weeks */
  app: Partial<Record<Lift, { nowKg: number | null; hardSessions6w: number }>>;
  /** meets in the last 12 months, best per lift (kg) */
  meetBestKg: Partial<Record<Lift, number>>;
  /** attempts someone with the authority already set (the athlete's own onboarding answer or their coach's) */
  attemptsSetBy: Partial<Record<Lift, { opener: number | null; by: "athlete" | "my_coach" | "handler" }>>;
  /** may the athlete's own coach be contacted about them */
  coachContactOk: boolean;
  athleteReachable: boolean;
  /** keys already answered or skipped, with what prompted them then */
  settled: Array<{ key: string; fingerprint: string; status: "answered" | "dismissed" }>;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
const who = (p: Provider, name: string | null) => name || PROVIDER_LABEL[p].toLowerCase();
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The strongest evidence on file for a lift (kg e1RM): the app's line, completed uploaded sets, a recent meet. */
export function evidenceBest(lift: Lift, input: Pick<QuestionInput, "today" | "facts" | "app" | "meetBestKg">, exceptSource?: string | null): number | null {
  const six = addDays(input.today, -42);
  const vals: number[] = [];
  const app = input.app[lift]?.nowKg;
  if (app) vals.push(app);
  for (const f of input.facts) {
    if (f.lift !== lift || !strengthSet(f) || f.date! < six || (exceptSource && f.source_id === exceptSource)) continue;
    const e = setE1rm(f.data as TrainingData);
    if (e) vals.push(e);
  }
  const m = input.meetBestKg[lift];
  if (m) vals.push(m * 0.98);
  return vals.length ? Math.max(...vals) : null;
}

/** Would counting this evidence move the lift's best by at least an attempt increment? */
const material = (candidate: number | null, best: number | null, inc: number) =>
  candidate != null && (best == null || candidate > best + Math.max(inc, best * 0.01));

/** The questions worth asking now, most important first (callers show the first, the rest wait). */
export function decideQuestions(input: QuestionInput): Question[] {
  const out: Question[] = [];
  const meet = input.meet;
  if (!meet) return out;
  const daysOut = daysBetween(input.today, meet.date);
  if (daysOut < 0) return out;
  const inc = meet.incrementKg || 2.5;
  const attemptsDecided = (l: Lift) => input.attemptsSetBy[l]?.opener != null;
  const settled = new Map(input.settled.map((s) => [s.key, s]));
  const push = (q: Omit<Question, "fingerprint"> & { basis: string }) => {
    const fingerprint = hash(q.basis);
    const prior = settled.get(q.key);
    // asked before: an answer is final; a skip holds until what prompted it changes
    if (prior && (prior.status === "answered" || prior.fingerprint === fingerprint)) return;
    const { basis: _b, ...rest } = q;
    out.push({ ...rest, fingerprint });
  };
  const target = (first: AskWho[]): AskWho[] =>
    first.filter((w) => (w === "primary_coach" ? input.coachContactOk : w === "athlete" ? input.athleteReachable : true));

  // 1. Two current attempt plans for a lift nothing can tell apart
  for (const c of input.conflicts) {
    if (c.kind !== "attempt_plan" || !c.lift) continue;
    const [a, b] = c.facts;
    const line = (f: Fact) => {
      const d = f.data as any;
      return `${who(f.provider, f.provider_name)}${f.date ? ` (${fmtDay(f.date)})` : ""}: ${[d.opener, d.second, d.third].map((x: number | null) => x ?? "–").join(" / ")} kg`;
    };
    push({
      key: `conflict:attempts:${meet.id}:${c.lift}`,
      basis: `${a.id}|${b.id}`,
      area: "conflict",
      text: `Two ${c.lift} attempt plans don't match. Which one is current?`,
      why: "The opener and attempt plan come from it",
      answer: { kind: "choice", options: [{ value: a.id, label: line(a) }, { value: b.id, label: line(b) }, { value: "unknown", label: "Not sure yet" }] },
      askWho: target(["handler", "primary_coach", "athlete"]),
      priority: 90 - Math.min(40, daysOut),
      visibleFrom: addDays(meet.date, -42),
      factIds: [a.id, b.id],
      sourceId: null,
      lift: c.lift,
    });
  }
  // rack heights that disagree, close to the meet
  for (const c of input.conflicts) {
    if (c.kind !== "equipment" || !c.lift) continue;
    const [a, b] = c.facts;
    const line = (f: Fact) => {
      const d = f.data as any;
      return `${who(f.provider, f.provider_name)}: ${[d.rackHeight ? `rack ${d.rackHeight}` : null, d.safety ? `safeties ${d.safety}` : null, d.footBlocks ? `blocks ${d.footBlocks}` : null].filter(Boolean).join(", ")}`;
    };
    push({
      key: `conflict:rack:${c.lift}`,
      basis: `${a.id}|${b.id}`,
      area: "logistics",
      text: `${cap(c.lift)} rack settings don't match. Which is right?`,
      why: "It goes on the gameplan and the attempt cards",
      answer: { kind: "choice", options: [{ value: a.id, label: line(a) }, { value: b.id, label: line(b) }, { value: "unknown", label: "Not sure yet" }] },
      askWho: target(["athlete", "handler"]),
      priority: 40,
      visibleFrom: addDays(meet.date, -14),
      factIds: [a.id, b.id],
      sourceId: null,
      lift: c.lift,
    });
  }
  // the athlete's own onboarding attempts against their coach's uploaded plan
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    const set = input.attemptsSetBy[lift];
    const coach = input.facts.find((f) => f.kind === "attempt_plan" && f.lift === lift && f.provider === "primary_coach" && (f.competition_id === meet.id || f.competition_id == null));
    const op = (coach?.data as any)?.opener as number | null | undefined;
    if (!set?.opener || !coach || op == null || Math.abs(op - set.opener) < inc) continue;
    if (coach.basis !== "source") continue;
    push({
      key: `conflict:onboarding:${meet.id}:${lift}`,
      basis: `${coach.id}|${set.opener}`,
      area: "conflict",
      text: `The ${lift} opener ${set.by === "my_coach" ? "the athlete said their coach set" : "the athlete gave"} (${set.opener} kg) isn't their coach's uploaded one (${op} kg). Which is current?`,
      why: "The opener comes from it",
      answer: { kind: "choice", options: [{ value: "coach", label: `${who(coach.provider, coach.provider_name)}: ${op} kg` }, { value: "athlete", label: `Their answer: ${set.opener} kg` }, { value: "unknown", label: "Not sure yet" }] },
      askWho: target(["athlete", "primary_coach", "handler"]),
      priority: 85 - Math.min(40, daysOut),
      visibleFrom: addDays(meet.date, -42),
      factIds: [coach.id],
      sourceId: coach.source_id,
      lift,
    });
  }

  // 2. Current pain on a competition lift, close to the meet
  const twentyOne = addDays(input.today, -21);
  const risks = input.facts.filter((f) => f.kind === "risk" && (f.data as any).status !== "resolved");
  for (const f of risks) {
    const when = f.date ?? f.received_at.slice(0, 10);
    if (when < twentyOne) continue;
    const lift = f.lift;
    if (!lift) continue;
    const later = input.facts.some(
      (g) => g.kind === "risk" && g.id !== f.id && (g.data as any).status === "resolved" && (g.date ?? g.received_at.slice(0, 10)) >= when && (g.lift === lift || (g.data as any).place === (f.data as any).place),
    );
    if (later) continue;
    const place = (f.data as any).place as string | null;
    push({
      key: `risk:${f.dedupe_key}`,
      basis: f.dedupe_key,
      area: "safety",
      text: `${who(f.provider, f.provider_name)}'s notes${f.date ? ` from ${fmtDay(f.date)}` : ""} mention ${place ? `${place} pain` : "pain"} on ${lift === "bench" ? "bench" : `${lift}s`}. Is it still affecting ${lift === "bench" ? "the bench" : `the ${lift}`}?`,
      why: "It changes how conservative the attempts and warm-ups are",
      answer: {
        kind: "choice",
        options: [
          { value: "resolved", label: "No longer an issue" },
          { value: "manageable", label: "Still there, manageable" },
          { value: "limiting", label: "Still limiting" },
          { value: "unknown", label: "Not sure" },
        ],
      },
      askWho: target(["athlete", "handler"]),
      priority: 80 - Math.min(30, daysOut),
      visibleFrom: addDays(meet.date, -28),
      factIds: [f.id],
      sourceId: f.source_id,
      lift,
    });
  }

  // 3. Sets in a file whose completion or unit isn't known, when they'd be the best evidence for a lift
  for (const s of input.sources) {
    if (s.status !== "ready" && s.status !== "waiting_consent") continue;
    const facts = input.facts.filter((f) => f.source_id === s.id && f.kind === "training" && f.lift && f.date && (f.data as TrainingData).standard === "competition");
    const recent = facts.filter((f) => f.date! >= addDays(input.today, -42));
    const unknown = recent.filter((f) => (f.data as TrainingData).completion === "unknown");
    const lifts = new Set<Lift>();
    for (const f of unknown) {
      const lift = f.lift!;
      if (attemptsDecided(lift)) continue;
      const e = setE1rm(f.data as TrainingData);
      if (material(e, evidenceBest(lift, input, s.id), inc)) lifts.add(lift);
    }
    if (lifts.size) {
      const name = s.file_name ?? "the uploaded notes";
      push({
        key: `completion:${s.id}`,
        basis: unknown.map((f) => f.id).sort().join(","),
        area: "attempts",
        text: `${name} has ${unknown.length} dated set${unknown.length === 1 ? "" : "s"} with nothing saying whether they were done. Are they what was completed, or the plan?`,
        why: `They'd be the strongest ${[...lifts].join(" and ")} evidence on file, so they move the openers`,
        answer: {
          kind: "choice",
          options: [
            { value: "completed", label: "Completed as written" },
            { value: "prescribed", label: "The plan, not results" },
            { value: "unknown", label: "Mixed / not sure" },
          ],
        },
        askWho: target(["handler", "athlete", "primary_coach"]),
        priority: 70 - Math.min(30, daysOut),
        visibleFrom: addDays(meet.date, -70),
        factIds: unknown.map((f) => f.id).slice(0, 40),
        sourceId: s.id,
        lift: lifts.size === 1 ? [...lifts][0] : null,
      });
    }
    if (s.unitUnknown) {
      const raw = facts.filter((f) => (f.data as TrainingData).load != null && !(f.data as TrainingData).unit);
      const lifted = new Set<Lift>();
      for (const f of raw) {
        const t = f.data as TrainingData;
        const asKg = setE1rm({ ...t, loadKg: t.load });
        if (!attemptsDecided(f.lift!) && material(asKg, evidenceBest(f.lift!, input, s.id), inc)) lifted.add(f.lift!);
      }
      if (lifted.size)
        push({
          key: `unit:${s.id}`,
          basis: raw.map((f) => f.id).sort().join(","),
          area: "attempts",
          text: `Are the weights in ${s.file_name ?? "the uploaded file"} in kg or lb?`,
          why: `They'd set the ${[...lifted].join(" and ")} estimate, and nothing in the file or their records says`,
          answer: { kind: "unit", options: [{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }] },
          askWho: target(["handler", "athlete"]),
          priority: 75 - Math.min(30, daysOut),
          visibleFrom: addDays(meet.date, -70),
          factIds: raw.map((f) => f.id).slice(0, 40),
          sourceId: s.id,
          lift: null,
        });
    }
    // undated completed work that's the only strength evidence for a lift
    const undated = input.facts.filter((f) => f.source_id === s.id && f.kind === "training" && f.lift && !f.date && (f.data as TrainingData).completion === "completed" && (f.data as TrainingData).standard === "competition" && (f.data as TrainingData).week != null);
    if (undated.length && !s.startDate) {
      const only = [...new Set(undated.map((f) => f.lift!))].filter((l) => !attemptsDecided(l) && evidenceBest(l, input) == null);
      if (only.length)
        push({
          key: `start_date:${s.id}`,
          basis: undated.map((f) => f.id).sort().join(","),
          area: "performance",
          text: `When did week 1 of ${s.file_name ?? "the uploaded program"} start?`,
          why: `Its completed ${only.join(" and ")} work has week numbers but no dates, and it's the only evidence for ${only.length === 1 ? "that lift" : "those lifts"}`,
          answer: { kind: "date" },
          askWho: target(["handler", "athlete", "primary_coach"]),
          priority: 60 - Math.min(30, daysOut),
          visibleFrom: addDays(meet.date, -56),
          factIds: undated.map((f) => f.id).slice(0, 40),
          sourceId: s.id,
          lift: null,
        });
    }
  }

  // 4. A heavy single that was prescribed recently with nothing saying whether it happened
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    if (attemptsDecided(lift)) continue;
    const singles = input.facts
      .filter(
        (f) =>
          f.kind === "training" &&
          f.lift === lift &&
          f.date &&
          f.date >= twentyOne &&
          f.date <= input.today &&
          (f.data as TrainingData).completion === "prescribed" &&
          (f.data as TrainingData).standard === "competition" &&
          (f.data as TrainingData).reps <= 2 &&
          (f.data as TrainingData).loadKg != null,
      )
      .sort((a, b) => ((b.data as TrainingData).loadKg ?? 0) - ((a.data as TrainingData).loadKg ?? 0));
    const top = singles[0];
    if (!top) continue;
    const t = top.data as TrainingData;
    const done = input.facts.some(
      (f) => f.kind === "training" && f.lift === lift && f.date === top.date && (f.data as TrainingData).completion === "completed" && ((f.data as TrainingData).loadKg ?? 0) >= t.loadKg! * 0.95,
    );
    if (done) continue;
    const e = setE1rm({ ...t, rpe: t.rpe ?? 9 });
    if (!material(e, evidenceBest(lift, input), inc)) continue;
    push({
      key: `single:${top.dedupe_key}`,
      basis: top.dedupe_key,
      area: "attempts",
      text: `The program prescribed a ${t.loadKg} kg ${lift} single on ${fmtDay(top.date!)}, but there's no recorded result. Was it completed?`,
      why: `It would be their heaviest recent ${lift}, so it moves the opener`,
      answer: {
        kind: "choice",
        options: [
          { value: "yes", label: "Yes, as written" },
          { value: "other", label: "Yes, at a different weight" },
          { value: "no", label: "No" },
          { value: "unknown", label: "Not sure" },
        ],
      },
      askWho: target(["athlete", "handler", "primary_coach"]),
      priority: 65 - Math.min(30, daysOut),
      visibleFrom: addDays(meet.date, -42),
      factIds: [top.id],
      sourceId: top.source_id,
      lift,
    });
  }

  return out.filter((q) => q.askWho.length).sort((a, b) => b.priority - a.priority);
}

/** The questions to show now: only those whose window is open, one at a time (the rest wait). */
export function questionsToShow(all: Question[], today: string): { now: Question[]; later: number; deferred: number } {
  const open = all.filter((q) => q.visibleFrom <= today);
  return { now: open.slice(0, 1), later: Math.max(0, open.length - 1), deferred: all.length - open.length };
}

/** A short message asking one person for one thing (the handler sends it, never Cleo by itself). */
export function requestMessage(q: Question, o: { athleteFirst: string; coachName?: string | null; to: AskWho; handlerFirst?: string | null }): string {
  const hi = o.to === "athlete" ? `Hi ${o.athleteFirst},` : `Hi${o.coachName ? ` ${o.coachName.split(" ")[0]}` : ""},`;
  const about = o.to === "primary_coach" ? ` for ${o.athleteFirst}'s meet` : "";
  const body = q.text.replace(/^The program/, o.to === "athlete" ? "Your program" : "The program");
  return `${hi} quick one${about}: ${body}${o.handlerFirst ? ` Thanks, ${o.handlerFirst}` : ""}`.slice(0, 600);
}
