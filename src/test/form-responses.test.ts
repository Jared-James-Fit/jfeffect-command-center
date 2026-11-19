import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countsLine, effectiveAsk, formPeople, personState, responseCounts, sortPeople, type AssignmentRow, type SubmissionRow } from "@/lib/form-response-status";
import { summarizeForm, summarizeQuestion, type SummaryResponse } from "@/lib/form-response-summary";
import { formAnswerText } from "@/lib/form-answer-text";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-11-19T15:00:00Z");

describe("one state per person, about the latest request", () => {
  it("answered at or after it was last asked for (a minute's grace), or never asked", () => {
    expect(personState({ askedAt: "2026-10-26T14:07:00Z", answeredAt: "2026-10-30T20:00:00Z", draftAt: null })).toBe("answered");
    expect(personState({ askedAt: "2026-11-19T01:50:47Z", answeredAt: "2026-11-19T01:50:10Z", draftAt: null })).toBe("answered");
    expect(personState({ askedAt: null, answeredAt: "2026-11-01T00:00:00Z", draftAt: null })).toBe("answered");
  });

  it("answered before it was asked again is waiting; a draft since the ask is in progress", () => {
    expect(personState({ askedAt: "2026-10-28T01:07:00Z", answeredAt: "2026-10-19T00:10:42Z", draftAt: null })).toBe("waiting");
    expect(personState({ askedAt: "2026-11-17T19:35:41Z", answeredAt: null, draftAt: "2026-11-17T19:45:55Z" })).toBe("in_progress");
    // a draft from before the ask doesn't count as started
    expect(personState({ askedAt: "2026-11-17T19:35:41Z", answeredAt: null, draftAt: "2026-11-01T00:00:00Z" })).toBe("waiting");
    expect(personState({ askedAt: null, answeredAt: null, draftAt: null })).toBeNull();
  });
});

// The Nutrition Update Request as it stood on Nov 19 2026 (ids shortened), where the
// old library read "Sent to 14 · 8 answered · 7 waiting".
const asked = "2026-10-26T14:07:00Z";
const A = (id: string, at = asked, archived = false): AssignmentRow => ({ client_id: id, updated_at: at, created_at: at, client: { full_name: id, archived } });
const S = (id: string, client: string, at: string, status = "pending_review", archived = false): SubmissionRow => ({
  id,
  client_id: client,
  status,
  submitted_at: at,
  created_at: at,
  client: { full_name: client, archived },
});
const assignments = [
  A("f8e4", "2026-10-26T13:07:00Z"), A("3a54"), A("b970"), A("ebed"), A("51df"), A("3f83"), A("4fa8"), A("89ae"), A("98ca"),
  A("363f", asked, true), A("aebf", "2026-10-28T01:07:00Z"), A("2926", "2026-11-08T18:37:42Z"), A("48d8", "2026-11-12T04:12:17Z"), A("f30b", "2026-11-19T01:50:47Z"),
];
const submissions = [
  S("s1", "3a54", "2026-11-08T18:12:40Z", "reviewed"),
  S("s2", "51df", "2026-10-26T17:41:47Z", "reviewed"),
  S("s3", "89ae", "2026-10-30T20:00:47Z", "reviewed"),
  S("s4", "363f", "2026-10-26T21:04:58Z", "reviewed", true),
  S("s5", "aebf", "2026-10-19T00:10:42Z", "reviewed"),
  S("s6", "2926", "2026-11-09T12:18:00Z", "reviewed"),
  S("s7", "48d8", "2026-11-12T04:15:29Z", "reviewed"),
  S("s8", "f30b", "2026-11-19T01:55:05Z"),
];

describe("the library, the viewer and the database count the same", () => {
  it("answered + in progress + waiting = people, always", () => {
    const people = formPeople(assignments, submissions);
    const c = responseCounts(people, NOW);
    expect(c).toMatchObject({ people: 14, answered: 7, inProgress: 0, waiting: 7, responses: 8, toReview: 1 });
    expect(c.answered + c.inProgress + c.waiting).toBe(c.people);
    expect(countsLine(c)).toBe("7 answered · 7 waiting");
    // answered in October, asked again on the 28th: waiting, said as asked again
    expect(people.find((p) => p.clientId === "aebf")).toMatchObject({ state: "waiting", askedAgain: true });
  });

  it("an archived client isn't waiting on anything, but their answers stay", () => {
    const people = formPeople([...assignments, A("gone", "2026-11-01T00:00:00Z", true)], [...submissions, S("s9", "gone", "2026-10-01T00:00:00Z", "reviewed", true)]);
    const c = responseCounts(people, NOW);
    expect(c.people).toBe(14);
    expect(c.responses).toBe(9);
    expect(people.find((p) => p.clientId === "gone")).toMatchObject({ counted: false, state: "waiting" });
    // the deactivated one who answered still counts as answered
    expect(people.find((p) => p.clientId === "363f")).toMatchObject({ counted: true, state: "answered" });
  });

  it("someone who opened it themselves (a form shared with everyone) is a person too", () => {
    const people = formPeople([], [S("x", "solo", "2026-11-10T00:00:00Z"), { id: "d", client_id: "draft", status: "in_progress", created_at: "2026-11-11T00:00:00Z" }]);
    expect(responseCounts(people, NOW)).toMatchObject({ people: 2, answered: 1, inProgress: 1, waiting: 0 });
  });

  it("a form they keep updating is one copy: a nudge never asks again, a fresh copy does", () => {
    const sentOnce = [S("m1", "kat", "2026-11-10T00:00:00Z", "reviewed")];
    const nudged: AssignmentRow = { client_id: "kat", updated_at: "2026-11-15T00:00:00Z", created_at: "2026-11-01T00:00:00Z" };
    // a checklist is one copy they keep changing: sending it again is a reminder
    expect(formPeople([nudged], sentOnce, { keepsUpdating: true })[0]).toMatchObject({ state: "answered", askedAgain: false });
    // a one-off form sent again is a new request
    expect(formPeople([nudged], sentOnce)[0]).toMatchObject({ state: "waiting", askedAgain: true });
    // sent for another meet: a fresh copy, asked again
    const fresh = { ...nudged, settings: { new_copy_since: "2026-11-15T00:00:00Z" } };
    expect(formPeople([fresh], sentOnce, { keepsUpdating: true })[0]).toMatchObject({ state: "waiting", askedAgain: true });
    expect(effectiveAsk(fresh, { keepsUpdating: true, hasSent: true })).toBe("2026-11-15T00:00:00Z");
    expect(effectiveAsk(nudged, { keepsUpdating: true, hasSent: false })).toBe("2026-11-15T00:00:00Z");
    const sql = read("supabase/migrations/20270416090000_form_status_keeps_updating.sql");
    expect(sql).toContain("case when asg.keeps_updating and sub.answered_at is not null then asg.fresh_at else asg.asked_at end as asked_at");
    expect(sql).toContain("create or replace function public.nf_form_library_stats()");
  });

  it("the client's Forms card reads the same rule", () => {
    const card = read("src/components/forms/client-forms-overview.tsx");
    expect(card).toContain("formPeople(f.asg ? [f.asg] : [], f.subs, { keepsUpdating: f.allowUpdates })[0]");
    expect(card).toContain('return i.state !== "answered";');
    expect(read("src/components/forms/form-responses.tsx")).toContain("formPeople(assignments, submissions, { keepsUpdating: !!form?.allow_updates })");
  });

  it("a draft started before the request counts as in progress once they type into it", () => {
    const asked: AssignmentRow = { client_id: "jm", updated_at: "2026-10-26T14:07:00Z", created_at: "2026-10-04T00:00:00Z" };
    const oldDraft: SubmissionRow = { id: "d", client_id: "jm", status: "in_progress", created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" };
    expect(formPeople([asked], [oldDraft])[0].state).toBe("waiting");
    // saving an answer moves nf_answers.updated_at, never the submission's row
    expect(formPeople([asked], [{ ...oldDraft, answers_touched_at: "2026-11-05T12:00:00Z" }])[0]).toMatchObject({ state: "in_progress", draft: { id: "d" } });
    const sql = read("supabase/migrations/20270416090000_form_status_keeps_updating.sql");
    expect(sql).toContain("coalesce(ans.at, s.created_at))) filter (where s.status = 'in_progress') as draft_at");
    expect(read("src/components/forms/form-responses.tsx")).toContain("s.answers_touched_at = touched.get(s.id)!");
  });

  it("archived clients shown for their past answers are counted apart, so every list adds up", () => {
    const people = formPeople(
      [...assignments, A("gone", "2026-11-01T00:00:00Z", true)],
      [...submissions, S("s9", "gone", "2026-10-01T00:00:00Z", "reviewed", true)],
    ).filter((p) => p.counted || p.responses.length > 0);
    const c = responseCounts(people, NOW);
    expect(c.people + c.archived).toBe(people.length);
    expect(c).toMatchObject({ people: 14, archived: 1 });
  });

  it("puts what's waiting on the coach first", () => {
    const order = sortPeople(formPeople(assignments, submissions)).map((p) => p.clientId);
    expect(order[0]).toBe("f30b");
    expect(order.slice(-1)[0]).not.toBe("f30b");
  });

  it("the database's stats use the same rule and add up the same way", () => {
    const sql = read("supabase/migrations/20270415090000_form_responses_status.sql");
    expect(sql).toContain("foreign key (client_id) references public.clients(id) on delete cascade not valid;");
    expect(sql).toContain("alter table public.nf_assignments validate constraint nf_assignments_client_id_fkey;");
    expect(sql).toContain("when p.answered_at is not null and (p.asked_at is null or p.answered_at >= p.asked_at - interval '1 minute') then 'answered'");
    expect(sql).toContain("when p.draft_at is not null and (p.asked_at is null or p.draft_at >= p.asked_at - interval '1 minute') then 'in_progress'");
    expect(sql).toContain("select * from st where state = 'answered' or (state is not null and not inactive)");
    expect(sql).toContain("and coalesce(s.submitted_at, s.created_at) > now() - interval '30 days'");
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });
});

describe("Summary reads like Google Forms", () => {
  const R = (name: string, answers: SummaryResponse["answers"], at = "2026-11-10T00:00:00Z"): SummaryResponse => ({ submissionId: name, clientId: name, name, at, answers });
  it("counts choices in the form's own order, anything else after", () => {
    const q = { id: "q", label: "Phase", question_type: "single_choice", options: ["Cut", "Maintain", "Gain"] };
    const s = summarizeQuestion(q, [R("a", [{ question_id: "q", value_text: "Cut" }]), R("b", [{ question_id: "q", value_text: "Cut" }]), R("c", [{ question_id: "q", value_text: "Recomp" }]), R("d", [])]);
    expect(s).toMatchObject({ kind: "choices", answered: 3 });
    expect((s as any).counts.map((c: any) => [c.label, c.count])).toEqual([["Cut", 2], ["Maintain", 0], ["Gain", 0], ["Recomp", 1]]);
  });

  it("checkboxes count each pick once a person", () => {
    const q = { id: "m", label: "Days", question_type: "multi_choice", options: ["Mon", "Wed"] };
    const s = summarizeQuestion(q, [R("a", [{ question_id: "m", value_json: ["Mon", "Wed", "Mon"] }]), R("b", [{ question_id: "m", value_json: ["Wed"] }])]) as any;
    expect(s.counts.map((c: any) => [c.label, c.count, Math.round(c.share * 100)])).toEqual([["Mon", 1, 50], ["Wed", 2, 100]]);
  });

  it("a rating gets its average and spread, a number keeps its unit", () => {
    const rating = summarizeQuestion({ id: "r", label: "Energy", question_type: "rating" }, [R("a", [{ question_id: "r", value_number: 7 }]), R("b", [{ question_id: "r", value_number: 8 }])]) as any;
    expect(rating).toMatchObject({ kind: "numbers", average: 7.5, min: 7, max: 8 });
    expect(rating.scale.filter((x: any) => x.count).map((x: any) => x.label)).toEqual(["7", "8"]);
    const weight = summarizeQuestion({ id: "w", label: "Bodyweight", question_type: "number" }, [R("a", [{ question_id: "w", value_number: 181.2, value_json: { unit: "lb" } }])]) as any;
    expect(weight).toMatchObject({ average: 181.2, unit: "lb" });
  });

  it("a checklist leads with what's still needed; written answers list who wrote them, newest first", () => {
    const cl = summarizeQuestion({ id: "c", label: "Gear", question_type: "checklist" }, [
      R("a", [{ question_id: "c", value_json: [{ key: "id", label: "Photo ID", state: "need" }, { key: "s", label: "Singlet", state: "ready" }] }]),
      R("b", [{ question_id: "c", value_json: [{ key: "id", label: "Photo ID", state: "ready" }] }]),
    ]) as any;
    expect(cl.items[0]).toEqual({ label: "Photo ID", ready: 1, need: 1, na: 0 });
    const text = summarizeQuestion({ id: "t", label: "Notes", question_type: "long_text" }, [R("old", [{ question_id: "t", value_text: "first" }], "2026-11-01T00:00:00Z"), R("new", [{ question_id: "t", value_text: "second" }])]) as any;
    expect(text.entries.map((e: any) => e.name)).toEqual(["new", "old"]);
  });

  it("a cleared number box is no answer, never a 0 or '{\"unit\":\"lb\"}'", () => {
    expect(formAnswerText({ question_id: "w", value_number: null, value_json: { unit: "lb" } })).toBe("");
    const w = summarizeQuestion({ id: "w", label: "Bodyweight", question_type: "number" }, [
      R("a", [{ question_id: "w", value_number: 180, value_json: { unit: "lb" } }]),
      R("b", [{ question_id: "w", value_number: null, value_json: { unit: "lb" } }]),
    ]) as any;
    expect(w).toMatchObject({ answered: 1, average: 180, min: 180 });
  });

  it("leaves headings, files and videos out, in the form's order", () => {
    const out = summarizeForm(
      [
        { id: "b", label: "B", question_type: "short_text", order_index: 2 },
        { id: "i", label: "Intro", question_type: "info", order_index: 0 },
        { id: "a", label: "A", question_type: "short_text", order_index: 1 },
        { id: "f", label: "Photo", question_type: "file", order_index: 3 },
      ],
      [],
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("wiring", () => {
  it("one viewer everywhere: the library, the editor, the chat card and Submissions", () => {
    const viewer = read("src/components/forms/form-responses.tsx");
    expect(viewer).toContain('client:client_id(full_name, archived)');
    expect(viewer).toContain(".filter((p) => p.counted || p.responses.length > 0)");
    for (const v of ['"summary"', '"individual"', '"table"']) expect(viewer).toContain(v);
    expect(read("src/route-pages/_authenticated/admin/native-forms.tsx")).toContain("<FormResponsesSheet formId={responsesFor.id}");
    expect(read("src/components/forms/submissions-inbox.tsx")).toContain("<FormResponsesSheet");
    const card = read("src/components/messages/messenger-checkin-card.tsx");
    expect(card).toContain("View full response");
    expect(card).toContain("<FormResponsesSheetLazy");
    expect(card).toContain('<CompetitionPlanSummary submissionId={submissionId} formId={formId} compact />');
    // the nutrition plan still gets written when the coach opens the chat
    expect(card).toContain("if (!isNutrition || !data || kicked.current || !planMissing(plan)) return;");
  });

  it("a form card's bubble never repeats the card's title, and the coach's note shows once", () => {
    const thread = read("src/components/message-thread.tsx");
    expect(thread).toContain("return !!title && (b === title || b === `shared a form: ${title}`);");
    expect(thread).toContain('a?.kind === "workout_note" || formCardSaysIt(m.body, a))');
    expect(read("src/components/messages/messenger-checkin-card.tsx")).not.toContain("{note && !done && <div");
  });

  it("the library reads the new counts", () => {
    const lib = read("src/route-pages/_authenticated/admin/native-forms.tsx");
    expect(lib).toContain("countsLine({ people: sent, answered: stats?.done ?? 0, inProgress: stats?.in_progress ?? 0, waiting: stats?.waiting ?? 0 })");
    expect(lib).toContain("data-form-select-bar");
  });

  it("the dashboard lists meets coming up, checklist or not", () => {
    const card = read("src/components/forms/meet-readiness-card.tsx");
    expect(card).toContain("export const UPCOMING_MEET_DAYS = 56;");
    expect(card).toContain('.in("status", ["Active", "Planned"])');
    expect(card).toContain("Upcoming meets");
  });
});
