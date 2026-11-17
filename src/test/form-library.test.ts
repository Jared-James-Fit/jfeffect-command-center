import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryOf, formSuggestions, libraryCategories, matchesSearch, ownerLabel, pickerList, startTab, type LibraryForm } from "@/lib/form-library";
import { parseFormDraft } from "@/lib/form-draft";
import { remapQuestionRefs } from "@/lib/form-logic";
import { reminderFor } from "@/lib/meet-checklist-reminders.server";
import { prefillAnswer } from "@/lib/form-prefill";
import { readiness } from "@/lib/form-checklist";
import { MEET_CHECKLIST_TEMPLATE as T } from "@/lib/meet-checklist-template";
import { updatingCardSubmission, requestCardSubmission } from "@/lib/form-request-state";

const f = (id: string, title: string, extra: Partial<LibraryForm> = {}): LibraryForm => ({ id, title, created_at: "2026-01-01", ...extra });
const forms = [
  f("meet", "Meet Day — Final Preparation Checklist", { category: "Powerlifting & Competitions", form_type: "meet_checklist", is_template: true }),
  f("plan", "Competition Calendar + Strategy", { category: "Powerlifting & Competitions", form_type: "competition_strategy", is_template: true }),
  f("onb", "New client intake", { category: "Client Onboarding", owner_id: "me" }),
  f("mine", "Sleep survey", { owner_id: "me", shared: true }),
  f("theirs", "Coach B's form", { owner_id: "other", shared: true, category: "Zebra things" }),
  f("old", "Old form", { archived: true }),
];

describe("the form library", () => {
  it("groups by category, the suggested ones first, then the coach's own A–Z; no category reads Custom Forms", () => {
    expect(libraryCategories(forms)).toEqual(["Client Onboarding", "Powerlifting & Competitions", "Custom Forms", "Zebra things"]);
    expect(categoryOf({ category: "  " })).toBe("Custom Forms");
  });

  it("finds a form by every word typed, accents and dashes aside", () => {
    expect(matchesSearch(forms[0], "meet check")).toBe(true);
    expect(matchesSearch(forms[0], "final prep")).toBe(true);
    expect(matchesSearch(forms[0], "nutrition")).toBe(false);
    expect(matchesSearch(forms[2], "onboarding")).toBe(true);
  });

  it("says where a form came from", () => {
    expect(ownerLabel(forms[0], "me")).toBe("Template");
    expect(ownerLabel(forms[2], "me")).toBeNull();
    expect(ownerLabel(forms[3], "me")).toBe("Yours · shared");
    expect(ownerLabel(forms[4], "me")).toBe("Shared");
  });

  it("lists by tab, never archived; a search looks through everything, favorites first", () => {
    const favorites = new Set(["onb"]);
    const recent = [
      { form_id: "plan", last_sent_at: "2026-11-01T00:00:00Z" },
      { form_id: "meet", last_sent_at: "2026-11-10T00:00:00Z" },
      { form_id: "plan", last_sent_at: "2026-10-01T00:00:00Z" },
    ];
    expect(pickerList(forms, { tab: "favorites", favorites, recent }).map((x) => x.id)).toEqual(["onb"]);
    expect(pickerList(forms, { tab: "recent", favorites, recent }).map((x) => x.id)).toEqual(["meet", "plan"]);
    expect(pickerList(forms, { tab: "all", favorites, recent }).map((x) => x.id)).not.toContain("old");
    expect(pickerList(forms, { tab: "cat:Powerlifting & Competitions", favorites, recent }).map((x) => x.id)).toEqual(["plan", "meet"]);
    expect(pickerList(forms, { tab: "favorites", query: "new", favorites, recent }).map((x) => x.id)).toEqual(["onb"]);
    expect(pickerList(forms, { tab: "suggested", favorites, recent, suggested: ["meet", "gone"] }).map((x) => x.id)).toEqual(["meet"]);
  });

  it("opens on suggestions, then favorites, then recent, then everything", () => {
    expect(startTab({ suggested: 1, favorites: 3, recent: 2 })).toBe("suggested");
    expect(startTab({ suggested: 0, favorites: 3, recent: 2 })).toBe("favorites");
    expect(startTab({ suggested: 0, favorites: 0, recent: 2 })).toBe("recent");
    expect(startTab({ suggested: 0, favorites: 0, recent: 0 })).toBe("all");
  });
});

describe("suggestions", () => {
  const base = { today: "2026-11-17", forms };
  it("the meet checklist inside four weeks of a meet it wasn't sent for", () => {
    expect(formSuggestions({ ...base, nextMeetDate: "2026-12-05" })).toEqual([{ formId: "meet", reason: "Meet in 18 days" }]);
    expect(formSuggestions({ ...base, nextMeetDate: "2027-01-30" })).toEqual([]);
    expect(formSuggestions({ ...base, nextMeetDate: "2026-12-05", meetChecklistSentAt: "2026-11-10T12:00:00Z" })).toEqual([]);
    // sent for an old meet: still suggested for this one
    expect(formSuggestions({ ...base, nextMeetDate: "2026-12-05", meetChecklistSentAt: "2026-06-01T12:00:00Z" })).toHaveLength(1);
  });
  it("the competition plan for someone who competes and has none; onboarding for a lead; never sent by itself", () => {
    expect(formSuggestions({ ...base, competes: true }).map((s) => s.formId)).toEqual(["plan"]);
    expect(formSuggestions({ ...base, competes: true, hasCompetitionPlan: true })).toEqual([]);
    expect(formSuggestions({ ...base, isLead: true }).map((s) => s.formId)).toEqual(["onb"]);
  });
});

describe("AI drafts are read by code, never trusted", () => {
  it("keeps only the builder's types, caps every list, makes item keys unique", () => {
    const text = `Here you go: ${JSON.stringify({
      title: "Meet prep",
      description: "Get ready.",
      category: "Powerlifting & Competitions",
      questions: [
        { type: "info", label: "About you" },
        { type: "short_text", label: "Name", required: true },
        { type: "password", label: "Your password" },
        { type: "single_choice", label: "Handler", options: ["Yes", "Yes", "No"] },
        { type: "single_choice", label: "Only one option", options: ["A"] },
        { type: "number", label: "Bodyweight", unit: "lb" },
        { type: "checklist", label: "Bag", items: [{ label: "Belt", priority: "critical" }, { label: "Belt" }, { label: "Chalk", priority: "weird" }] },
      ],
    })}`;
    const d = parseFormDraft(text)!;
    expect(d.title).toBe("Meet prep");
    expect(d.questions.map((q) => q.question_type)).toEqual(["info", "short_text", "single_choice", "number", "checklist"]);
    expect(d.questions[2].options).toEqual(["Yes", "No"]);
    expect(d.questions[3].validation).toEqual({ unit: "lb" });
    expect((d.questions[4].validation.items as any[]).map((i) => [i.key, i.priority])).toEqual([["belt", "critical"], ["belt-2", "important"], ["chalk", "important"]]);
  });
  it("refuses an answer that isn't a form", () => {
    expect(parseFormDraft("sorry, I can't")).toBeNull();
    expect(parseFormDraft(JSON.stringify({ title: "x", questions: [{ type: "info", label: "Heading only" }] }))).toBeNull();
  });
});

describe("a copied form follows its own questions", () => {
  it("swaps every reference: rules, item rules, options_from", () => {
    const ids = new Map([["a", "A"], ["b", "B"]]);
    const q = remapQuestionRefs(
      {
        conditional_logic: { match: "all", show_if: [{ question_id: "a", op: "equals", value: "x" }], hide_if: [{ question_id: "z", op: "is_empty", value: "" }] },
        validation: { options_from: "b", items: [{ key: "k", label: "K", show_if: [{ question_id: "a", op: "equals", value: "y" }] }, { key: "j", label: "J" }] },
      },
      ids,
    );
    expect((q.conditional_logic as any).show_if[0].question_id).toBe("A");
    expect((q.conditional_logic as any).hide_if[0].question_id).toBe("z");
    expect((q.validation as any).options_from).toBe("B");
    expect((q.validation as any).items[0].show_if[0].question_id).toBe("A");
    expect((q.validation as any).items[1]).toEqual({ key: "j", label: "J" });
  });
});

describe("meet reminders", () => {
  const qs = T.questions.map((q, i) => ({ ...q, order_index: i }));
  const ready = readiness({ questions: qs, answers: {}, settings: T.settings });
  it("two weeks out only if not sent; packing only while something's open; the night before only for must-haves", () => {
    expect(reminderFor({ days: 14, sent: false, readiness: null })?.stage).toBe("review");
    expect(reminderFor({ days: 10, sent: true, readiness: ready })).toBeNull();
    expect(reminderFor({ days: 15, sent: false, readiness: null })).toBeNull();
    expect(reminderFor({ days: 2, sent: true, readiness: { ...ready, verdict: "ready" } })).toBeNull();
    expect(reminderFor({ days: 2, sent: true, readiness: { ...ready, verdict: "attention", critical: 1, important: 1 } })?.body).toMatch(/^2 things/);
    expect(reminderFor({ days: 1, sent: false, readiness: null })?.stage).toBe("final");
    expect(reminderFor({ days: 1, sent: true, readiness: { ...ready, issues: [] } })).toBeNull();
    expect(reminderFor({ days: 0, sent: false, readiness: null })).toBeNull();
  });
  it("is a push from a daily job, never a text", () => {
    const src = readFileSync("src/lib/meet-checklist-reminders.server.ts", "utf8");
    expect(src).toContain("sendWebPushToUser");
    expect(src).not.toMatch(/sendSms|twilio/i);
    expect(readFileSync("supabase/migrations/20270401091000_meet_day_checklist.sql", "utf8")).toContain("'meet-checklist-reminders'");
  });
});

describe("prefill from the account", () => {
  const wc = { options: T.questions.find((q) => q.validation.meet_key === "weight_class")!.options, validation: { prefill: "meet_weight_class" } };
  it("the meet's class as the form's own option, by sex", () => {
    expect(prefillAnswer(wc, { sex: "male", meet: { name: "x", date: null, weightClass: "83", source: "prep" } })).toBe("Men's 83 kg");
    expect(prefillAnswer(wc, { sex: "female", meet: { name: "x", date: null, weightClass: "-84kg", source: "prep" } })).toBe("Women's 84 kg");
    expect(prefillAnswer(wc, { sex: "male", meet: { name: "x", date: null, weightClass: "120+", source: "prep" } })).toBe("Men's 120 kg+");
    expect(prefillAnswer(wc, { sex: "male", meet: { name: "x", date: null, weightClass: "Men's 93 kg", source: "plan" } })).toBe("Men's 93 kg");
    expect(prefillAnswer(wc, { sex: null, meet: { name: "x", date: null, weightClass: "63", source: "prep" } })).toBe("Women's 63 kg");
  });
  it("this morning's weigh-in goes in by itself, an older one never", () => {
    const bw = { validation: { prefill: "bodyweight" } };
    expect(prefillAnswer(bw, { bodyweight: { value: 181.2, unit: "lb", date: "2026-11-17", fresh: true } })).toEqual({ value: "181.2", unit: "lb" });
    expect(prefillAnswer(bw, { bodyweight: { value: 181.2, unit: "lb", date: "2026-11-01", fresh: false } })).toBeNull();
  });
});

describe("one checklist copy across nudges", () => {
  const subs = [
    { id: "a", status: "pending_review", submitted_at: "2026-11-10T00:00:00Z", created_at: "2026-11-09T00:00:00Z" },
    { id: "b", status: "in_progress", submitted_at: null, created_at: "2026-11-01T00:00:00Z" },
  ];
  it("a re-sent checklist card shows the copy they're updating, where a one-off form would wait for a new answer", () => {
    expect(updatingCardSubmission(subs)?.id).toBe("a");
    expect(requestCardSubmission(subs, "2026-11-15T00:00:00Z")?.id).toBe("b");
  });
});
