import { describe, expect, it } from "vitest";
import {
  CHECKIN_ASK_GAP_DAYS,
  CHECKIN_DISMISS_DAYS,
  EMPTY_LIFESTYLE,
  applicableFields,
  checkinProfileAsk,
  defaultTicks,
  extractionPrompt,
  historyLine,
  keyForLabel,
  lifestyleText,
  liveFacts,
  nextMissingItem,
  normalizeLifestyle,
  normalizeRelationship,
  occupationMatches,
  parseExtraction,
  profileCompletion,
  relationshipToneLine,
  relationshipWords,
  type ContextFact,
  type Lifestyle,
} from "@/lib/client-context/lifestyle";
import { planCheckin, type PlanInput } from "@/lib/checkin-coordination/plan";
import { addPlanSteps, PROFILE_ASK_KEY } from "@/lib/checkin-coordination/steps";

const NOW = "2026-11-25T12:00:00.000Z";
const L = (o: Partial<Lifestyle> = {}): Lifestyle => ({ ...EMPTY_LIFESTYLE, ...o });
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

describe("which questions apply (conditional)", () => {
  it("nothing about work for someone retired, not working or who'd rather not say", () => {
    for (const s of ["retired", "not_working", "prefer_not"] as const) {
      expect(applicableFields(L({ employment_status: s }))).toEqual({ essential: ["employment_status"], optional: [] });
    }
  });
  it("physical demand only when the workday doesn't already say it", () => {
    expect(applicableFields(L({ employment_status: "full_time", workday_activity: "mostly_sitting" })).essential).not.toContain("physical_demand");
    expect(applicableFields(L({ employment_status: "full_time", workday_activity: "mixed" })).essential).toContain("physical_demand");
    expect(applicableFields(L({ employment_status: "full_time" })).essential).not.toContain("physical_demand");
  });
  it("a student is asked about their day, never a job title or employer", () => {
    expect(applicableFields(L({ employment_status: "student" })).optional).toEqual([]);
  });
});

describe("Complete your profile", () => {
  it("an empty profile starts at 0 and asks employment first", () => {
    expect(profileCompletion(L()).percent).toBe(0);
    expect(nextMissingItem(L(), NOW)?.field).toBe("employment_status");
  });
  it("declining never lowers the percentage; it counts as done", () => {
    const answered = profileCompletion(L({ employment_status: "full_time", workday_activity: "mostly_sitting", work_schedule: "daytime", occupation: "Nurse", employer: "X" }));
    const declined = profileCompletion(L({ employment_status: "full_time", workday_activity: "mostly_sitting", work_schedule: "daytime", declined: ["occupation", "employer"] }));
    expect(answered.percent).toBe(100);
    expect(declined.percent).toBe(100);
    expect(declined.complete).toBe(true);
  });
  it("Prefer not to say on employment is complete (nothing else applies)", () => {
    const c = profileCompletion(L({ employment_status: "prefer_not" }));
    expect(c).toMatchObject({ percent: 100, complete: true });
    expect(nextMissingItem(L({ employment_status: "prefer_not" }), NOW)).toBeNull();
  });
  it("essentials before optional personalization; optional never blocks complete", () => {
    const l = L({ employment_status: "full_time", workday_activity: "mostly_standing", work_schedule: "rotating" });
    const c = profileCompletion(l);
    expect(c.complete).toBe(true);
    expect(c.percent).toBe(80);
    expect(nextMissingItem(l, NOW)).toMatchObject({ field: "occupation", essential: false, options: null });
  });
  it("a snoozed question waits two weeks, then comes back", () => {
    expect(nextMissingItem(L({ prompt_state: { employment_status: { dismissed_at: daysAgo(3) } } }), NOW)?.field).not.toBe("employment_status");
    expect(nextMissingItem(L({ prompt_state: { employment_status: { dismissed_at: daysAgo(15) } } }), NOW)?.field).toBe("employment_status");
  });
});

describe("the check-in's one optional profile question", () => {
  it("asks the first missing essential, one tap", () => {
    const a = checkinProfileAsk(L(), NOW);
    expect(a).toMatchObject({ field: "employment_status", essential: true });
    expect(a?.options).toContain("Prefer not to say / Not applicable");
  });
  it("never the free-text job title, never for a complete profile", () => {
    expect(checkinProfileAsk(L({ employment_status: "full_time", workday_activity: "mostly_sitting", work_schedule: "daytime" }), NOW)).toBeNull();
  });
  it("at most once every three weeks", () => {
    const st = { work_schedule: { asked_at: daysAgo(CHECKIN_ASK_GAP_DAYS - 1) } };
    expect(checkinProfileAsk(L({ prompt_state: st }), NOW)).toBeNull();
    expect(checkinProfileAsk(L({ prompt_state: { work_schedule: { asked_at: daysAgo(CHECKIN_ASK_GAP_DAYS + 1) } } }), NOW)).not.toBeNull();
  });
  it("a skip rests the question six weeks, and two skips stop it for good", () => {
    const rested = L({ prompt_state: { employment_status: { asked_at: daysAgo(30), dismissed_at: daysAgo(30), dismissals: 1 } } });
    expect(checkinProfileAsk(rested, NOW)?.field).not.toBe("employment_status");
    const later = L({ prompt_state: { employment_status: { asked_at: daysAgo(CHECKIN_DISMISS_DAYS + 1), dismissed_at: daysAgo(CHECKIN_DISMISS_DAYS + 1), dismissals: 1 } } });
    expect(checkinProfileAsk(later, NOW)?.field).toBe("employment_status");
    const stopped = L({ prompt_state: { employment_status: { asked_at: daysAgo(100), dismissed_at: daysAgo(100), dismissals: 2 } } });
    expect(checkinProfileAsk(stopped, NOW)?.field).not.toBe("employment_status");
  });
  it("no row readable: nothing asked", () => {
    expect(checkinProfileAsk(null, NOW)).toBeNull();
  });
  it("rides on the weekly plan as one optional single-choice step before the win", () => {
    const base: PlanInput = { due: "2026-11-29", lastWeighIn: "2026-11-28", weighInsLast7: 5, meet: null, goal: null, lastPhotos: null, lastMeasurements: null, schedules: [], nutritionPendingSince: null };
    const ask = checkinProfileAsk(L(), NOW)!;
    const plan = planCheckin({ ...base, profileAsk: { field: ask.field, prompt: ask.prompt, options: ask.options! } });
    expect(plan.extras.map((e) => e.key)).toEqual(["profile"]);
    const steps = addPlanSteps([{ key: "sleep" }, { key: "win" }], plan);
    expect(steps.map((s) => s.key)).toEqual(["sleep", PROFILE_ASK_KEY, "win"]);
    expect(steps[1]).toMatchObject({ type: "single", optional: true });
    expect(keyForLabel("employment_status", "Full-time")).toBe("full_time");
    expect(planCheckin(base).extras).toEqual([]);
  });
});

describe("relationship labels (coach-only, tone only)", () => {
  it("unknown labels dropped; Custom needs its words", () => {
    expect(normalizeRelationship({ labels: ["friend", "boss", "custom"], custom_label: "" })).toEqual({ labels: ["friend"], custom: null, note: null });
    expect(normalizeRelationship({ labels: ["family", "custom"], custom_label: "Cousin" }).labels).toEqual(["family", "custom"]);
  });
  it("a plain client gets no tone line; others get tone only, never objectivity", () => {
    expect(relationshipToneLine({ labels: ["client"], custom: null, note: null })).toBeNull();
    const line = relationshipToneLine({ labels: ["close_friend"], custom: null, note: "private description" })!;
    expect(line).toMatch(/tone only/);
    expect(line).toMatch(/never soften standards/);
    expect(line).not.toContain("private description");
  });
  it("words for the coach-facing brief", () => {
    expect(relationshipWords({ labels: ["family", "custom"], custom: "Cousin", note: null })).toBe("Family member, Cousin");
  });
});

describe("context as prompt text", () => {
  const facts: ContextFact[] = [
    { category: "work", fact: "Works nights this month", source: "coach_provided", status: "active", valid_until: "2026-11-30" },
    { category: "work", fact: "Old job", source: "coach_provided", status: "historical", valid_until: null },
    { category: "schedule", fact: "Away last week", source: "coach_provided", status: "active", valid_until: "2026-11-20" },
  ];
  it("only active facts still in force", () => {
    expect(liveFacts(facts, "2026-11-25").map((f) => f.fact)).toEqual(["Works nights this month"]);
  });
  it("client-facing text has no private facts or relationship", () => {
    const t = lifestyleText(L({ employment_status: "full_time", workday_activity: "physically_demanding" }))!;
    expect(t).toContain("Physical demand of work: High (from their workday)");
    expect(t).not.toContain("PRIVATE");
    expect(t).not.toContain("RELATIONSHIP");
  });
  it("coach text labels private facts never to be quoted, and the relationship tone-only", () => {
    const t = lifestyleText(null, { facts, today: "2026-11-25", relationship: { labels: ["friend"], custom: null, note: null } })!;
    expect(t).toMatch(/never quote/);
    expect(t).toContain("Works nights this month");
    expect(t).not.toContain("Old job");
    expect(t).toMatch(/never changes a coaching decision/);
  });
  it("Prefer not to say isn't written as their work", () => {
    expect(lifestyleText(L({ employment_status: "prefer_not" }))).toBeNull();
  });
});

describe("Cleo reading the coach's note", () => {
  const current = L({ employment_status: "full_time", occupation: "Nurse" });
  it("keeps known fields, marks a value that would replace one on file, drops duplicates", () => {
    const x = parseExtraction(
      '```json\n{"profile":{"employment_status":"part_time","occupation":"nurse","work_schedule":"Rotating shifts","workday_activity":"juggling"},"facts":[],"relationship":null}\n```',
      current,
    );
    expect(x.profile.map((p) => [p.field, p.value, p.replaces])).toEqual([
      ["employment_status", "part_time", true],
      ["work_schedule", "rotating", false],
    ]);
    expect(x.dropped.join(" ")).toMatch(/Typical workday/);
  });
  it("never records anything medical, caps facts at 8, skips ones already on file", () => {
    const facts = [{ category: "family", text: "Has two kids" }, { category: "other", text: "Diagnosed with something" }, { category: "interests", text: "Already known" }, ...Array.from({ length: 10 }, (_, i) => ({ category: "interests", text: `Hobby ${i}` }))];
    const x = parseExtraction({ profile: {}, facts, relationship: null }, null, ["already known"]);
    expect(x.facts.some((f) => /Diagnosed/.test(f.text))).toBe(false);
    expect(x.facts.some((f) => f.text === "Already known")).toBe(false);
    expect(x.facts).toHaveLength(8);
    expect(x.dropped.join(" ")).toMatch(/health/i);
  });
  it("a past end date is dropped, a future one kept", () => {
    const x = parseExtraction({ facts: [{ category: "schedule", text: "On nights", valid_until: "2026-12-31" }, { category: "schedule", text: "Away", valid_until: "2026-01-01" }] }, null, [], "2026-11-25");
    expect(x.facts.map((f) => f.validUntil)).toEqual(["2026-12-31", null]);
  });
  it("relationship with custom words; unreadable answers say so", () => {
    expect(parseExtraction({ relationship: { labels: ["family"], custom: "Cousin" } }, null).relationship).toMatchObject({ labels: ["family", "custom"], custom: "Cousin", words: "Family member, Cousin" });
    expect(parseExtraction("no json here", null).dropped).toEqual(["Cleo's answer wasn't readable"]);
  });
  it("the confirm card never pre-ticks a replacement or a relationship already on file", () => {
    const x = parseExtraction({ profile: { employment_status: "part_time", work_schedule: "evenings" }, facts: [{ category: "family", text: "Two kids" }], relationship: { labels: ["friend"] } }, current);
    expect(defaultTicks(x, true)).toEqual({ "p:employment_status": false, "p:work_schedule": true, "f:0": true, r: false });
    expect(defaultTicks(x, false).r).toBe(true);
  });
  it("the prompt carries what's on file and the note, and asks for no health details", () => {
    const { system, prompt } = extractionPrompt({ name: "Sam", text: "Works nights at the hospital", today: "2026-11-25", current });
    expect(system).toMatch(/Never record health/);
    expect(prompt).toContain("employment_status=full_time");
    expect(prompt).toContain("Works nights at the hospital");
  });
});

describe("history in words and occupation search", () => {
  it("lifestyle, relationship and fact rows read in words with their source", () => {
    expect(historyLine({ field: "work_schedule", old_value: "daytime", new_value: "rotating", source: "client_reported" })).toEqual({ what: "Work schedule", change: "Regular daytime hours → Rotating shifts", source: "Client" });
    expect(historyLine({ field: "occupation", old_value: null, new_value: "(declined)", source: "client_reported" }).change).toBe("Rather not say");
    expect(historyLine({ field: "relationship", old_value: null, new_value: "close_friend · since school", source: "coach_provided" })).toMatchObject({ what: "Relationship", change: "Close friend · since school" });
    expect(historyLine({ field: "fact:family", old_value: null, new_value: "Two kids", source: "ai_confirmed" })).toEqual({ what: "Private note · Family", change: "Two kids", source: "Cleo, confirmed by coach" });
  });
  it("occupation search: starts-with first, then contains", () => {
    expect(occupationMatches("nur")).toEqual(["Nurse"]);
    expect(occupationMatches("engineer")[0]).toBe("Engineer");
    expect(occupationMatches("")).toEqual([]);
  });
  it("normalizeLifestyle drops unknown values", () => {
    expect(normalizeLifestyle({ employment_status: "astronaut", declined: ["employer", "nope"] })).toMatchObject({ employment_status: null, declined: ["employer"] });
  });
});
