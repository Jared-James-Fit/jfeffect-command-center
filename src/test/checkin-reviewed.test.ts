import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("check-in reviewed state", () => {
  const sql = read("supabase/migrations/20261007100000_checkin_reviewed_state.sql");

  it("a staff reply closes open check-ins and native forms, but automation and notes do not", () => {
    expect(sql).toContain("create trigger staff_reply_closes_reviews");
    expect(sql).toContain("after insert on public.messages");
    for (const guard of [
      "new.sender_role = 'client'",
      "coalesce(new.is_internal_note, false)",
      "coalesce(new.is_automated, false)",
      "new.deleted_at is not null",
      "new.scheduled_at is not null",
      "%form_request%",
    ]) expect(sql).toContain(guard);
    expect(sql).toContain("reviewed_via = 'reply'");
  });

  it("one-tap RPCs are limited to admins and the client's assigned coach", () => {
    for (const fn of ["mark_checkin_reviewed", "reopen_checkin_review", "mark_client_reviews_reviewed"]) {
      expect(sql).toContain(`function public.${fn}(`);
      expect(sql).toContain(`revoke all on function public.${fn}(`);
    }
    expect(sql.match(/is_assigned_coach\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("Review Due counts only unreviewed check-ins/forms and recent external forms", () => {
    expect(sql).toContain("mc.reviewed_at is null");
    expect(sql).toContain("interval '30 days'");
  });

  it("card: Mark reviewed button, Use reply marks reviewed, shows who/when with Undo", () => {
    const card = read("src/components/messages/messenger-checkin-card.tsx");
    expect(card).toContain("Mark reviewed");
    expect(card).toContain('markReviewed("use_reply")');
    expect(card).toContain("reopen");
    expect(card).toContain("reviewedViaLabel");
  });

  it("Clients badge offers Mark reviewed and the Messages inbox ignores reviewed check-ins", () => {
    expect(read("src/components/clients/clients-status.ts")).toContain('actions: ["reviews", "mark_reviewed"]');
    expect(read("src/components/clients/client-row.tsx")).toContain("markClientReviewsReviewed");
    expect(read("src/components/clients/quick-actions.tsx")).toContain("Mark check-in reviewed");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain('.is("reviewed_at", null)');
  });
});
