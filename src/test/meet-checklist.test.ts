import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carriedChecklist,
  checklistAnswered,
  checklistItems,
  checklistProgress,
  checklistStates,
  checklistText,
  readiness,
  readinessLine,
  setItemState,
  visibleItems,
  type ItemState,
} from "@/lib/form-checklist";
import { answerAsText } from "@/lib/form-fields";
import { conditionsPass } from "@/lib/form-logic";
import {
  bodyweightSuggestion,
  classLimitKg,
  currentStep,
  daysOutLabel,
  daysUntil,
  meetFacts,
  meetIssues,
  meetTimeline,
  otherUnit,
  pickMeet,
  weightCheck,
} from "@/lib/meet-checklist";
import { CONCERN, HANDLER, MEET_CHECKLIST_TEMPLATE as T, MEET_QUESTION_IDS as Q, SHOES } from "@/lib/meet-checklist-template";
import { meetChecklistSql, MEET_CHECKLIST_MIGRATION } from "@/lib/meet-checklist-sql";
import { formAnswerText } from "@/lib/form-answer-text";

type A = { value_text?: string | null; value_number?: number | null; value_json?: unknown };
const questions = T.questions.map((q, i) => ({ ...q, form_id: T.id, order_index: i }));
const byId = (id: string) => questions.find((q) => q.id === id)!;

/** Every checklist item on screen marked `state` (optional ones too unless skipped). */
function markAll(answers: Record<string, A>, state: ItemState, skipOptional = false) {
  for (const q of questions.filter((x) => x.question_type === "checklist")) {
    const items = visibleItems(checklistItems(q), answers);
    let v: unknown = [];
    for (const it of items) if (!(skipOptional && it.priority === "optional")) v = setItemState(v, items, it, state);
    answers[q.id] = { value_json: v };
  }
  return answers;
}

function complete(): Record<string, A> {
  const a: Record<string, A> = {
    [Q.name]: { value_text: "Jared McIntyre" },
    [Q.meetName]: { value_text: "MPA Provincials" },
    [Q.meetDate]: { value_text: "2026-12-05" },
    [Q.weightClass]: { value_text: "Men's 83 kg" },
    [Q.bodyweight]: { value_number: 181.2, value_json: { unit: "lb" } },
    [Q.weightConcern]: { value_text: CONCERN.none },
    [Q.handler]: { value_text: HANDLER.coach },
    [Q.shoes]: { value_text: SHOES.one },
  };
  return markAll(a, "ready");
}

const run = (answers: Record<string, A>, today = "2026-12-01") => {
  const facts = meetFacts(questions, answers);
  return readiness({ questions, answers, settings: T.settings, extra: meetIssues(facts, today) });
};

describe("the template", () => {
  it("is the migration, written from the template", () => {
    expect(readFileSync(MEET_CHECKLIST_MIGRATION, "utf8")).toBe(meetChecklistSql());
  });

  it("keeps every item from the original Google Form", () => {
    const labels = questions.flatMap((q) => (q.question_type === "checklist" ? checklistItems(q).map((i) => i.label.toLowerCase()) : []));
    const has = (s: string) => expect(labels.some((l) => l.includes(s)), s).toBe(true);
    for (const s of ["cpu membership", "cces", "photo id", "singlet", "competition shirt", "belt", "knee sleeves", "wrist wraps", "underwear", "squat socks", "bench socks", "deadlift socks", "squat shoes", "bench shoes", "deadlift shoes", "hair ties", "headphones", "food and drinks", "food scale", "bodyweight scale", "baby powder", "chalk", "opening attempts"]) has(s);
    expect(byId(Q.handler).options).toEqual(expect.arrayContaining(Object.values(HANDLER)));
    expect(byId(Q.weightConcern).options).toEqual(Object.values(CONCERN));
  });

  it("is wired up correctly: unique ids and keys, rules on earlier questions, flags among the options, areas named", () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const areas = new Set(((T.settings as any).readiness.areas as any[]).map((a) => a.key));
    for (const [i, q] of questions.entries()) {
      const rules = [...((q.conditional_logic as any).show_if ?? []), ...((q.conditional_logic as any).hide_if ?? [])];
      for (const r of rules) expect(ids.indexOf(r.question_id), `${q.label} rule`).toBeLessThan(i);
      const v = q.validation as any;
      if (v.area) expect(areas.has(v.area), `${q.label} area`).toBe(true);
      for (const f of v.flag_options ?? []) expect(q.options, `${q.label} flag`).toContain(f);
      if (q.question_type === "checklist") {
        const items = checklistItems(q);
        expect(new Set(items.map((x) => x.key)).size).toBe(items.length);
        for (const it of items) for (const r of it.show_if ?? []) expect(ids.indexOf(r.question_id), `${it.label} rule`).toBeLessThan(i);
      }
    }
  });
});

describe("checklist answers", () => {
  const q = byId(Q.equipment);
  const items = checklistItems(q);
  it("marks, clears and keeps form order", () => {
    const belt = items.find((i) => i.key === "belt")!;
    const singlet = items.find((i) => i.key === "singlet")!;
    let v = setItemState([], items, belt, "need");
    v = setItemState(v, items, singlet, "ready");
    expect(v.map((e) => e.key)).toEqual(["singlet", "belt"]);
    expect(checklistStates(v).get("belt")).toBe("need");
    v = setItemState(v, items, belt, null);
    expect(v.map((e) => e.key)).toEqual(["singlet"]);
  });

  it("keeps an item the coach has since removed, as it was", () => {
    const v = setItemState([{ key: "old", label: "Old thing", state: "na" }], items, items[0], "ready");
    expect(v).toContainEqual({ key: "old", label: "Old thing", state: "na" });
  });

  it("carries only N/A to a new copy (packed last meet isn't packed this meet)", () => {
    expect(carriedChecklist([{ key: "a", label: "A", state: "ready" }, { key: "b", label: "B", state: "na" }, { key: "c", label: "C", state: "need" }])).toEqual([{ key: "b", label: "B", state: "na" }]);
  });

  it("shows one pair of shoes or three, from the shoes question", () => {
    const one = visibleItems(items, { [Q.shoes]: { value_text: SHOES.one } }).map((i) => i.key);
    const split = visibleItems(items, { [Q.shoes]: { value_text: SHOES.split } }).map((i) => i.key);
    expect(one).toContain("shoes");
    expect(one).not.toContain("squat-shoes");
    expect(split).toEqual(expect.arrayContaining(["squat-shoes", "bench-shoes", "deadlift-shoes"]));
    expect(split).not.toContain("shoes");
  });

  it("required means critical and important marked; optional never blocks", () => {
    const shown = visibleItems(items, { [Q.shoes]: { value_text: SHOES.one } });
    let v: unknown = [];
    for (const it of shown.filter((i) => i.priority !== "optional")) v = setItemState(v, shown, it, "na");
    expect(checklistAnswered(shown, v, true)).toBe(true);
    expect(checklistAnswered(shown, [], true)).toBe(false);
    expect(checklistAnswered(shown, [], false)).toBe(false);
    const p = checklistProgress(shown, v);
    expect(p.unconfirmed).toBe(0);
    expect(p.na).toBe(p.marked);
  });

  it("reads as words for the coach, the AI and follow-up rules", () => {
    const v = [{ key: "singlet", label: "Singlet", state: "ready" }, { key: "belt", label: "Belt", state: "need" }];
    expect(checklistText(v, "Packed")).toBe("Singlet: Packed · Belt: Still need");
    expect(answerAsText({ value_json: v })).toBe("Singlet: Ready, Belt: Still need");
    expect(formAnswerText({ question_id: "x", value_json: v })).toContain("Belt: Still need");
    expect(conditionsPass({ show_if: [{ question_id: "x", op: "contains", value: "Belt: Still need" }] }, { x: { value_json: v } })).toBe(true);
  });

  it("a number keeps its unit, and compares as a number", () => {
    const a = { value_number: 185.4, value_json: { unit: "lb" } };
    expect(answerAsText(a)).toBe("185.4 lb");
    expect(formAnswerText({ question_id: "x", ...a })).toBe("185.4 lb");
    expect(conditionsPass({ show_if: [{ question_id: "x", op: "gt", value: 180 }] }, { x: a })).toBe(true);
  });
});

describe("readiness", () => {
  it("not started until something's answered", () => {
    const r = run({});
    expect(r.verdict).toBe("not_started");
    expect(readinessLine(r)).toBe("Not started");
  });

  it("everything confirmed is ready, and N/A is never an issue", () => {
    const a = complete();
    const r = run(a);
    expect(r.verdict).toBe("ready");
    expect(r.issues.filter((i) => i.kind !== "unconfirmed")).toEqual([]);
    expect(r.areas.map((x) => [x.key, x.word])).toEqual([
      ["documents", "Complete"],
      ["equipment", "Complete"],
      ["handler", "Confirmed"],
      ["weight", "No concern reported"],
      ["logistics", "Complete"],
      ["final", "Complete"],
    ]);
    const na = markAll({ ...a }, "na");
    expect(run(na).verdict).toBe("ready");
  });

  it("a missing photo ID is critical and outranks any number of packed accessories", () => {
    const a = complete();
    const docs = byId(Q.documents);
    const items = checklistItems(docs);
    a[Q.documents] = { value_json: setItemState(a[Q.documents].value_json, items, items.find((i) => i.key === "photo-id")!, "need") };
    const r = run(a);
    expect(r.verdict).toBe("attention");
    expect(r.critical).toBe(1);
    expect(r.issues[0]).toMatchObject({ severity: "critical", kind: "need", label: "Valid photo ID", area: "documents" });
    expect(r.areas.find((x) => x.key === "documents")!.word).toBe("Needs attention");
    expect(readinessLine(r)).toBe("Needs attention · 1 critical");
  });

  it("an optional item still needed is shown but never decides", () => {
    const a = complete();
    const q = byId(Q.supplies);
    const items = checklistItems(q);
    a[Q.supplies] = { value_json: setItemState(a[Q.supplies].value_json, items, items.find((i) => i.key === "headphones")!, "need") };
    const r = run(a);
    expect(r.verdict).toBe("ready");
    expect(r.optional).toBe(1);
  });

  it("the handler and weight answers the coach should see", () => {
    const a = complete();
    a[Q.handler] = { value_text: HANDLER.needHelp };
    a[Q.weightConcern] = { value_text: CONCERN.slight };
    const r = run(a);
    expect(r.verdict).toBe("attention");
    expect(r.areas.find((x) => x.key === "handler")!.word).toBe("Unresolved");
    expect(r.areas.find((x) => x.key === "weight")!.word).toBe("Coach review needed");
    expect(r.issues.find((i) => i.area === "handler")!.detail).toBe(HANDLER.needHelp);
  });

  it("only what's not confirmed yet is in progress, not attention", () => {
    const a: Record<string, A> = { [Q.name]: { value_text: "J" } };
    const r = run(a);
    expect(r.verdict).toBe("in_progress");
    expect(r.critical).toBe(0);
    expect(r.areas.find((x) => x.key === "documents")!.status).toBe("open");
    expect(readinessLine(r)).toMatch(/^In progress · 0 of \d+ checked$/);
  });

  it("the handler's plan item shows only with a handler of their own", () => {
    const items = checklistItems(byId(Q.final));
    expect(visibleItems(items, { [Q.handler]: { value_text: HANDLER.coach } }).map((i) => i.key)).not.toContain("handler-plan");
    expect(visibleItems(items, { [Q.handler]: { value_text: HANDLER.confirmed } }).map((i) => i.key)).toContain("handler-plan");
  });
});

describe("weight against the class", () => {
  it("reads class limits", () => {
    expect(classLimitKg("Men's 83 kg")).toBe(83);
    expect(classLimitKg("Women's 84 kg+")).toBeNull();
    expect(classLimitKg("Men's 53 kg (sub-junior & junior only)")).toBe(53);
    expect(classLimitKg("198 lb")).toBeCloseTo(89.8, 1);
    expect(classLimitKg("whatever")).toBeNull();
  });

  it("flags over the limit near the meet, critical over 2% inside a week, never a plan", () => {
    const f = (kg: number, cls = "Men's 83 kg") => ({ bodyweightKg: kg, weightClass: cls, bodyweight: { value: kg, unit: "kg" as const } });
    expect(weightCheck(f(85.2), 5)).toMatchObject({ severity: "critical" });
    expect(weightCheck(f(85.2), 5)!.line).toBe("2.2 kg (2.7%) over the 83 kg limit, 5 days out");
    expect(weightCheck(f(83.6), 5)).toMatchObject({ severity: "important" });
    expect(weightCheck(f(85.2), 12)).toMatchObject({ severity: "important" });
    expect(weightCheck(f(90), 30)).toBeNull();
    expect(weightCheck(f(82.9), 2)).toBeNull();
    expect(weightCheck(f(130, "Men's 120 kg+"), 2)).toBeNull();
  });

  it("reads the bodyweight in its unit and adds the flag to readiness", () => {
    const a = complete();
    a[Q.bodyweight] = { value_number: 188, value_json: { unit: "lb" } }; // 85.3 kg
    const facts = meetFacts(questions, a);
    expect(facts.bodyweightKg).toBeCloseTo(85.28, 1);
    const r = run(a, "2026-12-01");
    expect(r.verdict).toBe("attention");
    const w = r.issues.find((i) => i.area === "weight")!;
    expect(w.detail).toBe("5.0 lb (2.7%) over the 83 kg limit, 4 days out");
    expect(r.areas.find((x) => x.key === "weight")!.word).toBe("Coach review needed");
  });
});

describe("meet dates and where the meet comes from", () => {
  it("counts days and labels them", () => {
    expect(daysUntil("2026-12-05", "2026-12-01")).toBe(4);
    expect(daysUntil("2026-11-30", "2026-12-01")).toBe(-1);
    expect(daysOutLabel(0)).toBe("Today");
    expect(daysOutLabel(1)).toBe("Tomorrow");
    expect(daysOutLabel(9)).toBe("9 days out");
  });

  it("times the checklist back from the meet", () => {
    const steps = meetTimeline("2026-12-05");
    expect(steps.map((s) => [s.key, s.date])).toEqual([
      ["review", "2026-11-21"],
      ["pack", "2026-12-03"],
      ["final", "2026-12-04"],
    ]);
    expect(meetTimeline("2026-12-05", { travelling: true })[1].date).toBe("2026-12-02");
    expect(currentStep(steps, "2026-11-20")).toBeNull();
    expect(currentStep(steps, "2026-12-03")!.key).toBe("pack");
  });

  it("the meet the coach picked first, then their next visible prep, then their plan; never a past one", () => {
    const today = "2026-12-01";
    const preps = [
      { event_name: "Old meet", event_date: "2026-10-01" },
      { event_name: "MPA Provincials", event_date: "2027-03-06", weight_class: "Men's 83 kg" },
      { title: "Winter Classic prep", event_date: "2026-12-12" },
    ];
    const plan = { primary: { name: "Nationals", level: "National Championships", date: "2027-05-20" }, meets: [], weightClass: "Men's 93 kg" };
    expect(pickMeet({ sent: { name: "Sent meet", date: "2026-12-20" }, preps, plan }, today)).toMatchObject({ name: "Sent meet", source: "sent" });
    expect(pickMeet({ preps, plan }, today)).toMatchObject({ name: "Winter Classic prep", date: "2026-12-12", source: "prep", weightClass: "Men's 93 kg" });
    expect(pickMeet({ plan }, today)).toMatchObject({ name: "Nationals", source: "plan" });
    expect(pickMeet({ plan: { primary: { name: "Past", date: "2026-01-01" }, meets: [] } }, today)).toBeNull();
  });

  it("suggests the last weigh-in, filling it in only when it's this morning's or yesterday's", () => {
    expect(bodyweightSuggestion({ date: "2026-12-01", kg: 82.1 }, "lb", "2026-12-01")).toMatchObject({ value: 181, fresh: true, ageDays: 0 });
    expect(bodyweightSuggestion({ date: "2026-11-25", kg: 82.1 }, "kg", "2026-12-01")).toMatchObject({ value: 82.1, fresh: false, ageDays: 6 });
    expect(bodyweightSuggestion(null, "kg", "2026-12-01")).toBeNull();
    expect(otherUnit(181, "lb")).toBe("≈ 82.1 kg");
    expect(otherUnit(82.1, "kg")).toBe("≈ 181.0 lb");
  });
});
