import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  APPLY_GOALS, APPLY_STEPS, APPLY_TIMELINES, EMPTY_ANSWERS, answeredCount, clip, emailOk, firstUnanswered, goalFromLink, hasContact,
  instagramHandle, phoneOk, stepError, type ApplyAnswers,
} from "@/lib/apply-form";
import { publicCoachingApplicationSchema } from "@/lib/coaching-applications.functions";

const read = (f: string) => readFileSync(f, "utf8");

const full: ApplyAnswers = {
  full_name: "Devin Buth",
  main_goal: "build_muscle",
  target_outcome: "Put on 10 lb of muscle",
  timeline: "asap",
  email: "devin@example.com",
  phone: "204.555.0123",
  instagram: "https://www.instagram.com/doubledbuth/?igsh=abc123",
};

describe("one question at a time", () => {
  it("asks the easy ones first and how to reach them last", () => {
    expect(APPLY_STEPS.map((s) => s.key)).toEqual(["full_name", "main_goal", "target_outcome", "timeline", "email", "phone", "instagram"]);
    for (const s of APPLY_STEPS.filter((s) => s.kind === "choice")) expect(s.options?.length).toBeGreaterThan(1);
  });

  it("every answer a person would really type is accepted", () => {
    for (const p of ["204.555.0123", "(204) 555-0123", "+1 204 555 0123", "2045550123"]) expect(phoneOk(p), p).toBe(true);
    expect(phoneOk("555")).toBe(false);
    for (const [raw, handle] of [
      ["@jamie.lifts", "@jamie.lifts"],
      ["jamie.lifts", "@jamie.lifts"],
      ["instagram.com/jamie.lifts", "@jamie.lifts"],
      ["https://www.instagram.com/doubledbuth/?igsh=abc123", "@doubledbuth"],
      ["  @@doubledbuth ", "@doubledbuth"],
    ]) expect(instagramHandle(raw!), raw).toBe(handle);
    for (const bad of ["", "not a handle", "https://instagram.com/", "a".repeat(31)]) expect(instagramHandle(bad), bad).toBeNull();
    expect(emailOk(" devin@example.com ")).toBe(true);
    expect(emailOk("devin@example")).toBe(false);
  });

  it("says exactly what to fix, never just a greyed-out button", () => {
    expect(stepError("phone", "555")).toBe("Add a number with the area code.");
    expect(stepError("email", "devin@")).toMatch(/doesn't look right/);
    expect(stepError("instagram", "not a handle")).toMatch(/@username/);
    expect(stepError("main_goal", "")).toBe("Pick the one that fits best.");
    for (const s of APPLY_STEPS) expect(stepError(s.key, full[s.key]), s.key).toBeNull();
  });

  it("knows where they are and when there's a way to reach them", () => {
    expect(firstUnanswered(full)).toBe(-1);
    expect(firstUnanswered({ ...full, timeline: "" })).toBe(3);
    expect(answeredCount(EMPTY_ANSWERS)).toBe(0);
    expect(answeredCount(full)).toBe(7);
    expect(hasContact({ email: "", phone: "" })).toBe(false);
    expect(hasContact({ email: "devin@example.com", phone: "" })).toBe(true);
    expect(hasContact({ email: "", phone: "(204) 555-0123" })).toBe(true);
  });
});

describe("the server accepts exactly what the page does", () => {
  it("every goal and start the page offers, phones in any format, pasted Instagram links", () => {
    for (const g of APPLY_GOALS) for (const t of APPLY_TIMELINES) {
      expect(() => publicCoachingApplicationSchema.parse({ ...full, main_goal: g.v, timeline: t.v })).not.toThrow();
    }
    const parsed = publicCoachingApplicationSchema.parse(full);
    expect(parsed.instagram).toBe("@doubledbuth");
    expect(parsed.phone).toBe("204.555.0123");
  });

  it("a long Instagram tracking link is trimmed, never a reason to refuse the application", () => {
    const long = `https://jfeffect.com/coaching/apply?fbclid=${"x".repeat(900)}`;
    const parsed = publicCoachingApplicationSchema.parse({ ...full, page_url: long, referrer: long, source_page: "y".repeat(200) });
    expect(parsed.page_url).toHaveLength(500);
    expect(parsed.referrer).toHaveLength(500);
    expect(parsed.source_page).toHaveLength(80);
    expect(clip("  abc  ", 2)).toBe("ab");
  });

  it("still refuses what isn't a lead", () => {
    expect(() => publicCoachingApplicationSchema.parse({ ...full, phone: "12" })).toThrow();
    expect(() => publicCoachingApplicationSchema.parse({ ...full, honeypot: "bot" })).toThrow();
    expect(() => publicCoachingApplicationSchema.parse({ ...full, main_goal: "nope" })).toThrow();
  });
});

describe("the page", () => {
  const page = read("src/routes/coaching.apply.tsx");
  it("is the question flow, with a progress bar and Question N of M", () => {
    expect(page).toContain("component: QuestionFlow,");
    expect(page).toContain('role="progressbar"');
    expect(page).toContain("Question {step + 1} of {total}");
    // Next always answers: no button disabled until the whole form is valid
    expect(page).not.toContain("disabled={!valid");
    expect(page).not.toContain("SimpleQuickApply");
  });

  it("keeps answers on the phone and saves an unfinished application once there's a way to reach them", () => {
    expect(page).toContain('const STORE_KEY = "jf_apply_v2";');
    expect(page).toContain("if (!ready.current || result || !hasContact(answers)) return;");
    expect(page).toContain("draft_id: draftId.current || undefined,");
    const server = read("src/lib/coaching-applications.functions.ts");
    expect(server).toContain("export const saveApplicationDraft = createServerFn");
    expect(server).toContain('if (data.honeypot || !hasContact(data)) return { saved: false };');
    expect(server).toContain("if (existing?.submitted_at) return { saved: false };");
    expect(server).toContain('.update({ submitted_at: new Date().toISOString(), submitted_application_id: inserted.id })');
  });

  it("the coach sees who started and didn't finish", () => {
    const inbox = read("src/route-pages/_authenticated/admin/sales.coaching-applications.tsx");
    expect(inbox).toContain("<UnfinishedApplications />");
    expect(inbox).toContain("Started, didn't finish");
    const sql = read("supabase/migrations/20270118090000_coaching_application_drafts.sql");
    expect(sql).toContain("REVOKE ALL ON public.coaching_application_drafts FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT ON public.coaching_application_drafts TO authenticated;");
    expect(sql).toContain("CHECK (email IS NOT NULL OR phone IS NOT NULL)");
  });

  it("the coaching page's goal picker starts the application with that goal answered", () => {
    for (const g of APPLY_GOALS) expect(goalFromLink(g.v)).toBe(g.v);
    expect(goalFromLink(" fat_loss ")).toBe("fat_loss");
    for (const bad of [null, undefined, "", "Fat Loss", "<script>", "fat_loss_x"]) expect(goalFromLink(bad)).toBeNull();
    const page = read("src/routes/coaching.index.tsx");
    expect(page).toContain("to={`${APPLY_TO}?goal=${g.v}` as typeof APPLY_TO}");
    const apply = read("src/routes/coaching.apply.tsx");
    expect(apply).toContain('goalFromLink(params.get("goal"))');
    // Next steps over the goal they already picked; Back can still reach it.
    expect(apply).toContain('APPLY_STEPS[after]?.key === "main_goal"');
  });
});
