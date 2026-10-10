import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clockLabel, isRequestableDate, requestMessageBody, requestStatusLabel, requestTypeLabel, requestWhen,
} from "@/lib/session-requests";
import { APP_EVENTS } from "@/lib/push/app-events.server";

describe("session requests", () => {
  it("labels types, times and status plainly", () => {
    expect(requestTypeLabel("call")).toBe("Coaching call");
    expect(clockLabel("14:30:00")).toBe("2:30 PM");
    expect(clockLabel("00:15")).toBe("12:15 AM");
    expect(requestWhen({ preferred_date: "2026-10-14", preferred_time: null })).toMatch(/any time$/);
    expect(requestMessageBody({ request_type: "training", preferred_date: "2026-10-14", preferred_time: "18:00" }))
      .toMatch(/^📅 Session request: 1:1 Training · .* · 6:00 PM$/);
    expect(requestStatusLabel("pending", "Jared")).toBe("Waiting for Jared to approve");
  });

  it("only accepts today onward, up to ~6 months", () => {
    expect(isRequestableDate("2026-10-10", "2026-10-10")).toBe(true);
    expect(isRequestableDate("2026-10-09", "2026-10-10")).toBe(false);
    expect(isRequestableDate("2027-06-01", "2026-10-10")).toBe(false);
    expect(isRequestableDate("10/12/2026", "2026-10-10")).toBe(false);
  });

  it("pushes the coach when asked and the client when answered", () => {
    expect(APP_EVENTS.session_requested.to).toBe("staff");
    expect(APP_EVENTS.session_requested.url("c1")).toBe("/admin/messages?client=c1");
    expect(APP_EVENTS.session_request_answered.to).toBe("client");
  });

  it("nothing is booked until the coach approves; approval books through the normal dialog", () => {
    const fns = readFileSync("src/lib/session-requests.functions.ts", "utf8");
    const card = readFileSync("src/components/schedule/session-request-card.tsx", "utf8");
    expect(fns).not.toMatch(/from\("pt_sessions"\)\s*\.insert/);
    expect(card).toContain("<PtSessionDialog");
    expect(card).toContain('action: "approve"');
    // answers are automated scheduling notes (no "unread message" SMS for them)
    expect(fns).toMatch(/message_type: "Scheduling",\s*is_automated: true/);
  });

  it("the new table follows the linked-login rule", () => {
    const sql = readFileSync("supabase/migrations/20261105090000_session_requests.sql", "utf8");
    expect(sql).toContain("Linked login reads own session_requests");
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
  });
});
