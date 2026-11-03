import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("a client's change request is answered from the chat", () => {
  const sheet = readFileSync("src/components/schedule/client-session-sheet.tsx", "utf8");
  const thread = readFileSync("src/components/message-thread.tsx", "utf8");
  const card = readFileSync("src/components/schedule/session-change-card.tsx", "utf8");
  const fns = readFileSync("src/lib/schedule.functions.ts", "utf8");

  it("the client's message carries the request as a card, and the chat shows the card instead of the words", () => {
    expect(sheet).toContain('attachments: [{ type: "file", url: "", kind: "session_change", change_request_id: res.requestId }]');
    expect(thread).toMatch(/att\.kind === "session_change" && att\.change_request_id/);
    expect(thread).toContain('a?.kind === "session_change"');
  });

  it("Approve moves the session to the asked-for time in one tap; Decline keeps it booked; Other time opens the move form", () => {
    expect(card).toMatch(/answer\(\{ data: action === "approve" \? \{ action, requestId \}/);
    expect(card).toContain('onClick={() => setSheet("move")}');
    expect(fns).toMatch(/\.update\(\{ session_date: r\.proposed_date, start_time: start, end_time: end \}\)\s*\.eq\("id", s\.id\)\s*\.eq\("status", "Scheduled"\)/);
    expect(fns).toMatch(/\.update\(\{ status: "declined", resolution: reason \|\| "declined"/);
    // only the client's coach or an admin
    const answer = fns.slice(fns.indexOf("export const answerSessionChange"));
    expect(answer).toMatch(/await requireStaff\(supabase, userId\);\s*\/\/ RLS: the caller must see this request/);
    // never into the past, never past midnight, and the client is told
    expect(answer).toContain("That time has already passed.");
    expect(answer).toContain("That would run past midnight.");
    expect(answer).toMatch(/message_type: "Scheduling",\s*is_automated: true/);
  });
});
