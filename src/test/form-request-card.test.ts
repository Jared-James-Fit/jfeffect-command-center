import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { requestCardSubmission } from "@/lib/form-request-state";

const sub = (status: string, created_at: string, submitted_at: string | null = null) => ({ status, created_at, submitted_at });

// Nov 8 2026: Jared opened his Nutrition Update on Oct 4, the monthly request
// came Oct 26, he sent it Nov 8. The card only counted drafts STARTED after
// Oct 26, so it said "Start" to him and "Waiting for client" to the coach.
describe("a request card shows the answer sent after it, whenever the draft began", () => {
  const asked = "2026-10-26T14:07:00Z";

  it("a draft from before the request, sent after it, is the answer", () => {
    const jared = sub("pending_review", "2026-10-04T23:24:32Z", "2026-11-08T18:12:40Z");
    expect(requestCardSubmission([jared], asked)).toBe(jared);
  });

  it("an answer sent before the request isn't this request's", () => {
    const old = sub("reviewed", "2026-10-10T00:00:00Z", "2026-10-19T00:10:42Z");
    expect(requestCardSubmission([old], "2026-10-28T01:07:00Z")).toBeNull();
  });

  it("a draft being filled in shows as started; the newest sent answer wins", () => {
    const draft = sub("in_progress", "2026-10-27T00:00:00Z");
    expect(requestCardSubmission([draft], asked)).toBe(draft);
    const a = sub("pending_review", "2026-10-26T15:00:00Z", "2026-10-27T00:00:00Z");
    const b = sub("reviewed", "2026-10-28T00:00:00Z", "2026-11-02T00:00:00Z");
    expect(requestCardSubmission([draft, a, b], asked)).toBe(b);
  });

  it("allows a minute between the two clocks", () => {
    const quick = sub("pending_review", "2026-10-26T14:06:30Z", "2026-10-26T14:06:30Z");
    expect(requestCardSubmission([quick], asked)).toBe(quick);
  });

  it("the card uses it, and no longer filters by when the draft was created", () => {
    const card = readFileSync("src/components/messages/messenger-checkin-card.tsx", "utf8");
    expect(card).toContain("return requestCardSubmission(");
    expect(card).not.toContain('q.gte("created_at"');
  });
});

describe("a monthly request moves the 'asked' time like a coach's send", () => {
  const sql = readFileSync("supabase/migrations/20270215090000_nutrition_request_asked_at.sql", "utf8");
  it("updates the assignment instead of leaving it", () => {
    expect(sql).toContain("on conflict (form_id, client_id) do update set updated_at = now();");
    expect(sql).not.toContain("do nothing;");
  });
  it("never asks again within 14 days of an update they sent, and only coaching clients", () => {
    expect(sql).toContain("and s.submitted_at > now() - interval '14 days'");
    expect(sql).toContain("and c.service_tier = 'coaching'");
  });
  it("reads the client's clock through instant_to_local", () => {
    expect(sql).toContain("local_now := public.instant_to_local(now(), tz);");
    expect(sql).not.toMatch(/local_now := now\(\) at time zone tz/);
  });
  it("backfills the requests already out without the trigger stamping now()", () => {
    expect(sql).toContain("alter table public.nf_assignments disable trigger nf_assignments_set_updated_at;");
    expect(sql).toContain("alter table public.nf_assignments enable trigger nf_assignments_set_updated_at;");
  });
});
