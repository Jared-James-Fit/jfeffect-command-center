import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { barPlace, barScale, weekSummary } from "@/lib/availability-ui";
import { bookingInviteAttachment } from "@/components/messages/booking-invite";

describe("smart availability wiring", () => {
  it("a smart type is planned by the engine, re-checked on the hard rules only, and held with his gap", () => {
    const server = readFileSync("src/lib/booking.server.ts", "utf8");
    expect(server).toContain("if (type.smart) return (await smartPlan(admin, type, from, to, now)).slots;");
    expect(server).toContain("isHardOpen(await smartPlan(admin, type, day, day, now), opts.startISO, type.duration_minutes)");
    expect(server).toContain("Math.max(type.buffer_minutes ?? 0, gapMin)");
    // Nothing changes until he confirms his boundaries.
    expect(server).toContain("const smart = !!settings?.confirmedAt;");
    // Extra calendars only ever add busy time to the two that always block.
    expect(server).toContain("...(await scheduleCalendarIds(hostCoachId)), ...extraCalendars");
  });

  it("the week's bars cover his day and place a block by its share of it", () => {
    const scale = barScale({ dayStart: "09:00", dayEnd: "17:00" }, [{ start: 7 * 60 + 30, end: 8 * 60 }]);
    expect(scale).toEqual({ from: 7 * 60, to: 18 * 60 });
    expect(barPlace({ start: 12 * 60, end: 13 * 60 + 6 }, scale)).toEqual({ left: (5 * 60 / 660) * 100, width: (66 / 660) * 100 });
    expect(barPlace({ start: 5 * 60, end: 6 * 60 }, scale)).toBeNull();
    expect(weekSummary([{ slotCount: 4, closed: false }, { slotCount: 0, closed: true }], "auto")).toBe("Automatic · 4 call times open on 1 day this week");
    expect(weekSummary([], "manual")).toBe("Manual · nothing open this week");
  });
});

describe("chat: Send Form and Booking Link", () => {
  it("the coach's + menu has both, and a booking invite renders as its own card", () => {
    const menu = readFileSync("src/components/composer-plus-menu.tsx", "utf8");
    expect(menu).toContain('label: "Send Form"');
    expect(menu).toContain('label: "Booking Link"');
    expect(menu).toContain("externalOpen={{ form: formOpen, sig: sigOpen, recipe: recipeOpen }}");
    const shared = readFileSync("src/components/chat-shared.tsx", "utf8");
    expect(shared).toContain('if (att.kind === "booking_invite") {');
  });

  it("an invite carries what the card needs to find the booking it led to", () => {
    const att = bookingInviteAttachment(
      { id: "t1", slug: "coaching-discovery", name: "Coaching Discovery Call", duration_minutes: 20, location_mode: "video", location: null } as any,
      "c1",
      "  ",
    );
    expect(att).toMatchObject({ kind: "booking_invite", url: "/book/coaching-discovery", booking_card_id: "t1", client_id: "c1", duration_min: 20, where: "Google Meet video call" });
    expect(att.request_note).toBeUndefined();
    expect(Date.parse(att.sent_at)).not.toBeNaN();
  });
});

describe("forms keep what's on screen", () => {
  it("the saved-answers reset runs only when the saved answers change", () => {
    const r = readFileSync("src/components/forms/client-form-renderer.tsx", "utf8");
    expect(r).toContain("if (appliedAnswers.current === answersRaw) return;");
  });
});
