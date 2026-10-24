import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clockLabel, isRequestableDate, mentionedWeekdays, oneTapApprovable, replaceCandidates, requestMessageBody,
  requestStatusLabel, requestTypeLabel, requestUsesCredit, requestWhen, suggestReplaced,
} from "@/lib/session-requests";
import { creditOutlook } from "@/lib/session-credit";
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

  it("nothing is booked until the coach approves; Approve books in one tap, the dialog is More options", () => {
    const fns = readFileSync("src/lib/session-requests.functions.ts", "utf8");
    const card = readFileSync("src/components/schedule/session-request-card.tsx", "utf8");
    const ask = fns.slice(fns.indexOf("export const requestSession"), fns.indexOf("export const withdrawSessionRequest"));
    expect(ask).not.toMatch(/from\("pt_sessions"\)\s*\.(insert|update)/);
    expect(card).toContain("<PtSessionDialog");
    expect(card).toContain("More options");
    expect(card).toMatch(/action: "approve", requestId, replaceSessionId: replacing\?\.id \?\? null/);
    // answers are automated scheduling notes (no "unread message" SMS for them)
    expect(fns).toMatch(/message_type: "Scheduling",\s*is_automated: true/);
  });

  it("approving a swap moves the booked session, and the database moves its credit (callers never touch credits)", () => {
    const fns = readFileSync("src/lib/session-requests.functions.ts", "utf8");
    expect(fns).toMatch(/\.update\(\{ session_date: req\.preferred_date, start_time: start, end_time: end \}\)\s*\.eq\("id", s\.id\)\.eq\("status", "Scheduled"\)/);
    expect(fns).not.toMatch(/session_ledger_events|reserve_session_for_pt|consume_session|release_session/);
    // an extra one is never booked twice for the same time
    expect(fns).toMatch(/Already booked then/);
    // the past can't be approved into
    expect(fns).toMatch(/assertUpcoming\(req\.preferred_date, start, tz\)/);
  });

  it("knows which booked session a request is instead of", () => {
    const today = "2026-10-24";
    const booked = [
      { id: "mon26", session_date: "2026-10-26", start_time: "11:00:00", status: "Scheduled" },
      { id: "tue27", session_date: "2026-10-27", start_time: "11:00:00", status: "Scheduled" },
      { id: "wed28", session_date: "2026-10-28", start_time: "17:30:00", status: "Scheduled" },
      { id: "fri30", session_date: "2026-10-30", start_time: "17:30:00", status: "Scheduled" },
      { id: "tue03", session_date: "2026-11-03", start_time: "11:00:00", status: "Scheduled" },
      { id: "done", session_date: "2026-10-22", start_time: "17:30:00", status: "Completed" },
    ];
    // Marc: "Changing Tuesday session for this day." for Thu Oct 29, 5:30 PM → this week's Tuesday.
    const marc = { preferred_date: "2026-10-29", preferred_time: "17:30:00", note: "Changing Tuesday session for this day." };
    expect(suggestReplaced(marc, booked, today)).toBe("tue27");
    expect(suggestReplaced({ ...marc, note: "Can we do thursday instead of tues?" }, booked, today)).toBe("tue27");
    // nothing said about moving: an extra session
    expect(suggestReplaced({ ...marc, note: null }, booked, today)).toBeNull();
    expect(suggestReplaced({ ...marc, note: "Want an extra one this week" }, booked, today)).toBeNull();
    // "moving" with one session that week is that one; with several, the coach picks
    const one = [booked[3], booked[4]];
    expect(suggestReplaced({ ...marc, note: "Need to move my session" }, one, today)).toBe("fri30");
    expect(suggestReplaced({ ...marc, note: "Need to move my session" }, booked, today)).toBeNull();
    // the client's own pick wins, if it's still booked nearby
    expect(suggestReplaced({ ...marc, note: null, replaces_session_id: "wed28" }, booked, today)).toBe("wed28");
    expect(suggestReplaced({ ...marc, note: null, replaces_session_id: "done" }, booked, today)).toBeNull();
    // candidates: booked, upcoming, within a week, never the asked-for slot itself
    const ids = replaceCandidates({ preferred_date: "2026-10-28", preferred_time: "17:30" }, booked, today).map((s) => s.id);
    expect(ids).toEqual(["mon26", "tue27", "fri30", "tue03"]);
    expect(mentionedWeekdays("Thurs or Sat works, not mon")).toEqual([1, 4, 6]);
  });

  it("only kinds the app can book on its own go in one tap", () => {
    expect(oneTapApprovable("training")).toBe(true);
    expect(oneTapApprovable("call")).toBe(true);
    expect(oneTapApprovable("other")).toBe(false);
    expect(requestUsesCredit("training")).toBe(true);
    expect(requestUsesCredit("call")).toBe(false);
  });

  it("says where a new session's credit comes from, and only blocks with no package at all", () => {
    expect(creditOutlook({ remaining: 2, packageSize: 16, first: "Marc" })).toEqual({ tone: "low", text: "Uses 1 of 2 sessions left", needsConfirm: false });
    expect(creditOutlook({ remaining: 8, packageSize: 16, first: "Marc" }).tone).toBe("ok");
    expect(creditOutlook({ remaining: 0, packageSize: 16, first: "Marc" })).toEqual({
      tone: "renewal", text: "No sessions left · it goes on Marc's next 16", needsConfirm: false,
    });
    expect(creditOutlook({ remaining: 1, count: 3, packageSize: 16, first: "Marc" }).text).toBe("Uses their last 1; 2 go on Marc's next 16");
    expect(creditOutlook({ remaining: 0, packageSize: null, first: "Marc" }).needsConfirm).toBe(true);
    expect(creditOutlook({ remaining: 0, packageSize: 16, first: "" }).text).toBe("No sessions left · it goes on their next 16");
    const dialog = readFileSync("src/components/pt-session-dialog.tsx", "utf8");
    expect(dialog).toContain("const mustConfirmOverbook = overbook && (outlook?.needsConfirm ?? true);");
    expect(dialog).not.toContain("tracked as a negative balance");
  });

  it("the client says what it's instead of, and the server checks it's theirs", () => {
    const sheet = readFileSync("src/components/schedule/request-session-sheet.tsx", "utf8");
    const fns = readFileSync("src/lib/session-requests.functions.ts", "utf8");
    const sql = readFileSync("supabase/migrations/20261231100000_session_request_replaces.sql", "utf8");
    expect(sheet).toContain("Is this instead of a booked session?");
    expect(sheet).toContain("replacesSessionId: instead?.id ?? null");
    expect(fns).toMatch(/s\.client_id !== client\.id \|\| s\.status !== "Scheduled" \|\| !near/);
    expect(sql).toMatch(/replaces_session_id uuid references public\.pt_sessions\(id\) on delete set null/);
  });

  it("the new table follows the linked-login rule", () => {
    const sql = readFileSync("supabase/migrations/20261105090000_session_requests.sql", "utf8");
    expect(sql).toContain("Linked login reads own session_requests");
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
  });
});
