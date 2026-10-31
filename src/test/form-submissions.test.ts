import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FORM_UNUSED_DAYS,
  TO_REVIEW_DAYS,
  countByKind,
  dayLabel,
  filterSubmissions,
  groupByDay,
  isToReview,
  nativeKind,
  type FormSubmission,
} from "@/lib/form-submissions";
import { DEFAULT_TAB, LEGACY_SUB, LEGACY_TAB_ALIAS, TABS, isMoreTab } from "@/route-pages/_authenticated/admin/forms-tabs";

// Sat Oct 31 2026, 3pm in Winnipeg (CDT, UTC-5).
const now = Date.parse("2026-10-31T20:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

const row = (over: Partial<FormSubmission>): FormSubmission => ({
  key: `checkin:${Math.random()}`,
  source: "checkin",
  kind: "weekly_checkin",
  id: "x",
  title: "Weekly Check-In",
  clientId: "c1",
  clientName: "Marc Asugui",
  photo: null,
  submittedAt: hoursAgo(2),
  reviewed: false,
  detail: null,
  formId: null,
  ...over,
});

describe("Forms → Submissions", () => {
  it("waiting on the coach = not reviewed and recent; progress (reviewed elsewhere) never counts", () => {
    expect(isToReview(row({}), now)).toBe(true);
    expect(isToReview(row({ reviewed: true }), now)).toBe(false);
    expect(isToReview(row({ submittedAt: hoursAgo(24 * (TO_REVIEW_DAYS + 1)) }), now)).toBe(false);
    expect(isToReview(row({ source: "progress", kind: "progress", reviewed: null }), now)).toBe(false);
  });

  it("filters by kind, waiting and a search over client and form, newest first", () => {
    const rows = [
      row({ key: "a", submittedAt: hoursAgo(30) }),
      row({ key: "b", kind: "nutrition_update", source: "native", title: "Nutrition Update Request", clientName: "Nicole Yusi", submittedAt: hoursAgo(5), reviewed: true }),
      row({ key: "c", kind: "progress", source: "progress", title: "Progress photos", reviewed: null, submittedAt: hoursAgo(1) }),
    ];
    expect(filterSubmissions(rows, { kind: "all", status: "all", search: "" }, now).map((r) => r.key)).toEqual(["c", "b", "a"]);
    expect(filterSubmissions(rows, { kind: "all", status: "to_review", search: "" }, now).map((r) => r.key)).toEqual(["a"]);
    expect(filterSubmissions(rows, { kind: "nutrition_update", status: "all", search: "" }, now).map((r) => r.key)).toEqual(["b"]);
    expect(filterSubmissions(rows, { kind: "all", status: "all", search: "nicole" }, now).map((r) => r.key)).toEqual(["b"]);
    expect(filterSubmissions(rows, { kind: "all", status: "all", search: "progress" }, now).map((r) => r.key)).toEqual(["c"]);
  });

  it("counts each chip's total and what's waiting", () => {
    const c = countByKind([row({}), row({ reviewed: true }), row({ kind: "progress", source: "progress", reviewed: null })], now);
    expect(c.all).toEqual({ total: 3, toReview: 1 });
    expect(c.weekly_checkin).toEqual({ total: 2, toReview: 1 });
    expect(c.progress).toEqual({ total: 1, toReview: 0 });
    expect(c.application).toEqual({ total: 0, toReview: 0 });
  });

  it("groups by the coach's day: Today, Yesterday, the weekday, then dates", () => {
    expect(dayLabel(hoursAgo(1), now)).toBe("Today");
    expect(dayLabel(hoursAgo(20), now)).toBe("Yesterday");
    expect(dayLabel(hoursAgo(24 * 3), now)).toBe("Wednesday");
    expect(dayLabel("2026-10-12T18:00:00Z", now)).toBe("Oct 12");
    expect(dayLabel("2025-12-30T18:00:00Z", now)).toBe("Dec 30, 2025");
    // 11pm Winnipeg on Oct 30 is Oct 31 in UTC: still "Yesterday" for the coach.
    expect(dayLabel("2026-10-31T04:00:00Z", now)).toBe("Yesterday");
    const groups = groupByDay([row({ submittedAt: hoursAgo(1) }), row({ submittedAt: hoursAgo(2) }), row({ submittedAt: hoursAgo(20) })], now);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
  });

  it("a Nutrition Update Request is its own kind; any other native form is 'Other forms'", () => {
    expect(nativeKind("nutrition-id", "nutrition-id")).toBe("nutrition_update");
    expect(nativeKind("intake", "nutrition-id")).toBe("form");
  });
});

describe("the Forms page", () => {
  it("opens on Submissions, with five tabs and the rest under More", () => {
    expect(DEFAULT_TAB).toBe("submissions");
    const main = TABS.filter((t) => !("hidden" in t) && !("more" in t)).map((t) => t.label);
    expect(main).toEqual(["Submissions", "Requests", "Forms", "Applications", "Agreements"]);
    expect(isMoreTab("reviews")).toBe(true);
    expect(isMoreTab("submissions")).toBe(false);
  });

  it("old links still land somewhere sensible", () => {
    expect(LEGACY_TAB_ALIAS["website-forms"]).toBe("builder");
    expect(LEGACY_SUB["website-forms"]).toBe("website");
    expect(LEGACY_TAB_ALIAS["fillout-submissions"]).toBe("fillout");
    const route = readFileSync("src/routes/_authenticated/admin/forms.tsx", "utf8");
    expect(route).toContain('if (t === "submissions" && sub === "fillout") return { tab: "fillout" };');
    expect(readFileSync("src/route-pages/_authenticated/admin/check-in-reviews.tsx", "utf8")).toContain('search: { tab: "submissions" }');
  });

  it("forms unused for 2 months archive themselves, never the Nutrition Update Request", () => {
    expect(FORM_UNUSED_DAYS).toBe(60);
    const sql = readFileSync("supabase/migrations/20270110091000_forms_archive_unused.sql", "utf8");
    expect(sql).toContain("create or replace function public.archive_unused_forms(_days int default 60)");
    expect(sql).toContain("f.id <> 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'::uuid");
    expect(sql).toContain("archived_reason = 'unused'");
    expect(sql).toContain("cron.schedule('forms-archive-unused'");
    expect(sql).toContain("grant execute on function public.archive_unused_forms(int) to service_role;");
  });
});
