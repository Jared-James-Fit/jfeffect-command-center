import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  audienceAllows,
  CALL_LENGTHS,
  clientsOnly,
  durationChoices,
  durationLabel,
  isCallType,
  pickDuration,
  TYPE_TEMPLATES,
  withDuration,
} from "@/lib/booking-types";
import { bookingInviteAttachment, inviteOrder, inviteTypeGroups } from "@/components/messages/booking-invite";
import { inviteCoversBooking, selfBookedMessageBody } from "@/lib/session-booked";

const read = (p: string) => readFileSync(p, "utf8");

const general = {
  id: "g",
  slug: "general-call",
  name: "General Call",
  session_type: "Consultation",
  duration_minutes: 30,
  duration_options: [15, 30, 45, 60],
  audience: "clients",
  show_in_app: true,
  location_mode: "video",
  location: null,
} as any;
const discovery = {
  id: "d",
  slug: "coaching-discovery",
  name: "Coaching Discovery Call",
  session_type: "Consultation",
  duration_minutes: 20,
  duration_options: null,
  audience: "anyone",
  show_in_app: false,
  location_mode: "video",
  location: null,
} as any;
const training = {
  id: "t",
  slug: "train",
  name: "1:1 Training",
  session_type: "Personal Training Session",
  duration_minutes: 60,
  audience: "anyone",
  show_in_app: true,
  location_mode: "in_person",
  location: "800 Vaughan Ave",
} as any;

describe("a call's length", () => {
  it("offers its options and its default, shortest first", () => {
    expect(durationChoices(general)).toEqual([15, 30, 45, 60]);
    expect(durationChoices({ duration_minutes: 90, duration_options: [30, 60] })).toEqual([30, 60, 90]);
    expect(durationChoices(discovery)).toEqual([20]);
    expect(durationLabel(general)).toBe("15–60 min");
    expect(durationLabel(discovery)).toBe("20 min");
  });

  it("only ever books at a length the type offers", () => {
    expect(pickDuration(general, 45)).toBe(45);
    expect(pickDuration(general, "15")).toBe(15);
    expect(pickDuration(general, 50)).toBe(30); // not offered: its default
    expect(pickDuration(general, null)).toBe(30);
    expect(pickDuration(discovery, 60)).toBe(20); // a fixed-length type stays fixed
    expect(withDuration(general, 60).duration_minutes).toBe(60);
    expect(withDuration(general, 60)).not.toBe(general);
    expect(withDuration(general, 30)).toBe(general);
    expect(withDuration(discovery, 45).duration_minutes).toBe(20);
  });

  it("a call is anything that isn't training", () => {
    expect(isCallType(general)).toBe(true);
    expect(isCallType(training)).toBe(false);
    expect([...CALL_LENGTHS]).toEqual([15, 30, 45, 60]);
  });
});

describe("who can book a General Call", () => {
  it("a coaching client we know is them, never the public or a JF member", () => {
    expect(clientsOnly(general)).toBe(true);
    expect(audienceAllows(general, { serviceTier: "coaching" })).toBe(true);
    expect(audienceAllows(general, { serviceTier: null })).toBe(true);
    expect(audienceAllows(general, { serviceTier: "self_serve" })).toBe(false);
    expect(audienceAllows(general, null)).toBe(false);
  });

  it("the discovery call stays open to anyone", () => {
    expect(clientsOnly(discovery)).toBe(false);
    expect(audienceAllows(discovery, null)).toBe(true);
    expect(audienceAllows(discovery, { serviceTier: "self_serve" })).toBe(true);
  });

  it("the server checks it on every way in, and a member's app never lists it", () => {
    const fns = read("src/lib/booking.functions.ts");
    expect(fns).toContain("if (!audienceAllows(type, invitee ? { serviceTier: invitee.service_tier } : null)) {");
    expect(fns).toContain("if (!audienceAllows(type, { serviceTier: me.service_tier })) throw new Error(CLIENTS_ONLY_MESSAGE);");
    expect(fns).toContain("rows = rows.filter((t) => audienceAllows(t, { serviceTier: tier }));");
    // Slots and bookings follow the length they picked, only when the type offers it.
    expect(fns).toContain("const type = withDuration(loaded, data.duration);");
    const server = read("src/lib/booking.server.ts");
    expect(server).toContain("if (!audienceAllows(type, trustedClient ? { serviceTier: trustedClient.service_tier } : null)) {");
  });
});

describe("sending a call from a chat", () => {
  it("lists calls for clients first and the discovery call under new people", () => {
    const g = inviteTypeGroups([discovery, training, general]);
    expect(g.forClients.map((t) => t.id)).toEqual(["g", "t"]);
    expect(g.forNew.map((t) => t.id)).toEqual(["d"]);
    expect(inviteOrder([discovery, training, general]).map((t) => t.id)).toEqual(["g", "t", "d"]);
  });

  it("carries the length the coach picked, and a fixed-length type's link is unchanged", () => {
    const att = bookingInviteAttachment(general, "c1", "", 45);
    expect(att).toMatchObject({ url: "/book/general-call?d=45", duration_min: 45, duration_fixed: 45, booking_card_id: "g" });
    const def = bookingInviteAttachment(general, "c1", "", null);
    expect(def).toMatchObject({ url: "/book/general-call", duration_min: 30 });
    expect(def.duration_fixed).toBeUndefined();
    const fixed = bookingInviteAttachment(discovery, "c1", "", 45);
    expect(fixed).toMatchObject({ url: "/book/coaching-discovery", duration_min: 20 });
  });

  it("the booking page takes the coach's length from ?d=", () => {
    const route = read("src/routes/book.$slug.tsx");
    expect(route).toContain("duration: s.d ?? null,");
    const page = read("src/components/booking/booking-page.tsx");
    expect(page).toContain("const coachLength = prefill.duration && options.includes(prefill.duration) ? prefill.duration : null;");
    expect(page).toContain('queryKey: ["booking-slots", slug, month, duration],');
  });
});

describe("a call a client booked shows in their coach chat", () => {
  it("in their words, with the call as a card", () => {
    expect(
      selfBookedMessageBody({
        title: "General Call",
        session_type: "Consultation",
        session_date: "2026-11-26",
        start_time: "15:00:00",
        end_time: "15:30:00",
        location: "Video call (Google Meet)",
        wants_meet: true,
      }),
    ).toBe("Booked a General Call: Thu, Nov 26 · 3:00–3:30 PM · Video call.");
  });

  it("not when the coach's invite card already shows it", () => {
    const since = [
      { id: "a", created_at: "2026-11-20T10:00:00Z" },
      { id: "b", created_at: "2026-11-21T10:00:00Z" },
    ];
    expect(inviteCoversBooking("a", since)).toBe(true);
    expect(inviteCoversBooking("b", since)).toBe(false);
    expect(inviteCoversBooking("a", [])).toBe(false);
  });

  it("is posted after a client's own call booking, and the card says who booked it", () => {
    const server = read("src/lib/booking.server.ts");
    expect(server).toContain("await postSelfBookedCall(admin, { client: trustedClient, type, sessionId: result.id, now })");
    expect(server).toContain('attachments: [{ ...bookedCard([row as any]), booked_by: "client" }],');
    const thread = read("src/components/message-thread.tsx");
    expect(thread).toContain('bookedByClient={att.booked_by === "client"}');
  });
});

describe("Home keeps Request a session and adds Book a call", () => {
  it("a call never takes the training action's place", () => {
    const card = read("src/components/home/upcoming-schedule-card.tsx");
    expect(card).toContain("const sessionTypes = useMemo(() => bookable.filter((t) => !t.isCall), [bookable]);");
    expect(card).toContain("const singleBook = sessionTypes.length === 1 && !pov.viewAsClientId ? sessionTypes[0] : null;");
    expect(card).toContain("<Video className=\"h-4 w-4\" /> Book a call");
  });
});

describe("the migration", () => {
  const sql = read("supabase/migrations/20270421090000_general_calls.sql");
  it("turns the 1:1 Meeting into General Call only while it's untouched, and keeps the discovery call", () => {
    expect(sql).toContain("and name = '1:1 Meeting'");
    expect(sql).toContain("and slug is null");
    expect(sql).toContain("duration_options = '{15,30,45,60}'");
    expect(sql).toContain("audience = 'clients'");
    expect(sql).not.toMatch(/update public\.booking_cards[^;]*coaching-discovery[^;]*set/i);
  });
  it("the new-type templates offer a general call and a discovery call", () => {
    const ids = TYPE_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("general");
    expect(ids).toContain("intro");
    expect(TYPE_TEMPLATES.find((t) => t.id === "general")!.values.audience).toBe("clients");
  });
});
