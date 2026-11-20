import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  INVITE_DAYS,
  inviteState,
  inviteStateMessage,
  inviteWaitingLine,
  invitePath,
  isInviteToken,
  pickBookingIdentity,
  tokenFromInviteUrl,
} from "@/lib/booking-invite";
import { hashInviteToken, newInviteToken, resolveBookingInvite } from "@/lib/booking-invite.server";
import { fixedLength, inviteBody, inviteShareText } from "@/components/messages/booking-invite";

const read = (p: string) => readFileSync(p, "utf8");
const MARC = "3d263734-5d46-4903-8520-e772aa8ca19d";
const JANE = "8072b23e-93e6-480b-afe6-6f0af204d6a3";
const now = new Date("2026-11-20T18:00:00Z");

describe("personal booking link tokens", () => {
  it("are 32 random URL-safe characters that name nobody", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newInviteToken();
      expect(isInviteToken(t)).toBe(true);
      expect(t).not.toContain(MARC);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("only a hash is kept", () => {
    const t = newInviteToken();
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toBe(hashInviteToken(newInviteToken()));
  });

  it("reads the token back out of a link, absolute or not, and nothing else", () => {
    const t = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(invitePath(t)).toBe(`/b/${t}`);
    expect(tokenFromInviteUrl(`/b/${t}`)).toBe(t);
    expect(tokenFromInviteUrl(`https://jfeffect.com/b/${t}?pv=1`)).toBe(t);
    expect(tokenFromInviteUrl("/book/general-call?d=30")).toBeNull();
    expect(tokenFromInviteUrl(`/b/${t}x`)).toBeNull();
    expect(tokenFromInviteUrl(null)).toBeNull();
    for (const junk of ["", "short", `${MARC}.123.abc`, "x".repeat(33), "a b".padEnd(32, "c")])
      expect(isInviteToken(junk)).toBe(false);
  });
});

describe("where a link stands", () => {
  const row = { expires_at: "2026-12-20T18:00:00Z", revoked_at: null, booked_session_id: null };
  it("works until it runs out or is cancelled", () => {
    expect(inviteState(row, { clientActive: true, bookedStatus: null, now })).toBe("ok");
    expect(
      inviteState(
        { ...row, expires_at: "2026-11-20T17:59:59Z" },
        { clientActive: true, bookedStatus: null, now },
      ),
    ).toBe("expired");
    expect(
      inviteState(
        { ...row, revoked_at: "2026-11-20T10:00:00Z" },
        { clientActive: true, bookedStatus: null, now },
      ),
    ).toBe("revoked");
    // an archived or deactivated client's links stop with the account
    expect(inviteState(row, { clientActive: false, bookedStatus: null, now })).toBe("revoked");
    expect(inviteState(null, { clientActive: true, bookedStatus: null, now })).toBe("invalid");
  });

  it("holds one booking at a time: freed again once that session is cancelled or moved away", () => {
    const booked = { ...row, booked_session_id: "s1" };
    for (const st of ["Scheduled", "Completed", "Missed"])
      expect(inviteState(booked, { clientActive: true, bookedStatus: st, now })).toBe("booked");
    for (const st of ["Cancelled", "Rescheduled"])
      expect(inviteState(booked, { clientActive: true, bookedStatus: st, now })).toBe("ok");
    // the session was deleted (booked_session_id kept, no status): free
    expect(inviteState(booked, { clientActive: true, bookedStatus: null, now })).toBe("ok");
  });

  it("says why it can't book, pointing at the coach", () => {
    expect(inviteStateMessage("expired", "Jared")?.title).toBe("This booking link has expired");
    expect(inviteStateMessage("revoked", "Jared")?.body).toContain("Ask Jared for a new one");
    expect(inviteStateMessage("invalid", "")?.body).toContain("ask your coach");
    expect(inviteStateMessage("ok", "Jared")).toBeNull();
    expect(INVITE_DAYS).toBe(30);
  });

  it("the coach's card reads cancelled, run out, opened or waiting", () => {
    expect(
      inviteWaitingLine({
        revokedAt: "x",
        expiresAt: "2026-12-20T00:00:00Z",
        firstOpenedAt: null,
        now,
      }),
    ).toBe("Link cancelled");
    expect(
      inviteWaitingLine({
        revokedAt: null,
        expiresAt: "2026-11-01T00:00:00Z",
        firstOpenedAt: null,
        now,
      }),
    ).toBe("Link expired");
    expect(
      inviteWaitingLine({
        revokedAt: null,
        expiresAt: "2026-12-20T00:00:00Z",
        firstOpenedAt: "2026-11-20T12:00:00Z",
        now,
      }),
    ).toBe("Opened, no time picked yet");
    expect(
      inviteWaitingLine({
        revokedAt: null,
        expiresAt: "2026-12-20T00:00:00Z",
        firstOpenedAt: null,
        now,
      }),
    ).toBe("Waiting for them to pick a time");
  });
});

describe("who a booking is for", () => {
  const ok = { state: "ok" as const, clientId: MARC };

  it("a working link books as its client with no sign-in", () => {
    expect(pickBookingIdentity({ invite: ok, signedIn: null })).toEqual({
      clientId: MARC,
      via: "booking_page",
      inviteApplies: true,
      blockedBy: null,
    });
  });

  it("the link's own client signed in books as themselves, through the link", () => {
    expect(pickBookingIdentity({ invite: ok, signedIn: { clientId: MARC, staff: false } })).toEqual(
      {
        clientId: MARC,
        via: "client_app",
        inviteApplies: true,
        blockedBy: null,
      },
    );
  });

  it("a forwarded link opened by another signed-in client books as them, never as the link's client", () => {
    const id = pickBookingIdentity({ invite: ok, signedIn: { clientId: JANE, staff: false } });
    expect(id).toEqual({
      clientId: JANE,
      via: "client_app",
      inviteApplies: false,
      blockedBy: null,
    });
  });

  it("staff (a coach testing, a dual account) never turn a client's link into their own booking", () => {
    expect(
      pickBookingIdentity({ invite: ok, signedIn: { clientId: JANE, staff: true } }).clientId,
    ).toBe(MARC);
    expect(
      pickBookingIdentity({
        invite: { state: "expired", clientId: MARC },
        signedIn: { clientId: JANE, staff: true },
      }),
    ).toEqual({
      clientId: null,
      via: "booking_page",
      inviteApplies: false,
      blockedBy: "expired",
    });
  });

  it("a link that can't book shows why, unless its client is signed in (then they just book)", () => {
    for (const state of ["expired", "revoked", "invalid"] as const) {
      expect(
        pickBookingIdentity({ invite: { state, clientId: MARC }, signedIn: null }).blockedBy,
      ).toBe(state);
      expect(
        pickBookingIdentity({
          invite: { state, clientId: MARC },
          signedIn: { clientId: MARC, staff: false },
        }),
      ).toEqual({
        clientId: MARC,
        via: "client_app",
        inviteApplies: false,
        blockedBy: null,
      });
    }
  });

  it("a link whose booking stands shows that booking", () => {
    const booked = { state: "booked" as const, clientId: MARC };
    expect(pickBookingIdentity({ invite: booked, signedIn: null }).blockedBy).toBe("booked");
    expect(
      pickBookingIdentity({ invite: booked, signedIn: { clientId: MARC, staff: false } }).blockedBy,
    ).toBe("booked");
    // someone else signed in: nothing about it
    expect(
      pickBookingIdentity({ invite: booked, signedIn: { clientId: JANE, staff: false } }).blockedBy,
    ).toBeNull();
  });

  it("no link: signed in books as them, everyone else is the public", () => {
    expect(
      pickBookingIdentity({ invite: null, signedIn: { clientId: MARC, staff: false } }).clientId,
    ).toBe(MARC);
    expect(pickBookingIdentity({ invite: null, signedIn: null })).toEqual({
      clientId: null,
      via: "booking_page",
      inviteApplies: false,
      blockedBy: null,
    });
  });
});

describe("resolving a token on the server", () => {
  // A small stand-in for the service-role client: booking_invites by token_hash, clients, pt_sessions.
  function fakeDb(tables: Record<string, any[]>) {
    return {
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const q: any = {
          select: () => q,
          eq: (col: string, v: unknown) => {
            filters.push([col, v]);
            return q;
          },
          maybeSingle: async () => ({
            data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          }),
        };
        return q;
      },
    } as any;
  }
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  const base = {
    id: "i1",
    token_hash: hashInviteToken(token),
    client_id: MARC,
    booking_card_id: "card-general",
    duration_minutes: 30,
    expires_at: "2026-12-20T18:00:00Z",
    revoked_at: null,
    booked_session_id: null,
  };

  it("finds the link by the token's hash and says what it's for", async () => {
    const db = fakeDb({ booking_invites: [base], clients: [{ id: MARC, archived: false }] });
    expect(await resolveBookingInvite(db, token, now)).toMatchObject({
      state: "ok",
      id: "i1",
      clientId: MARC,
      bookingCardId: "card-general",
      durationMin: 30,
    });
  });

  it("an unknown token is 'invalid'; anything that isn't a token is no link at all", async () => {
    const db = fakeDb({ booking_invites: [base], clients: [{ id: MARC, archived: false }] });
    expect((await resolveBookingInvite(db, "ZbCdEfGhIjKlMnOpQrStUvWxYz012345", now))?.state).toBe(
      "invalid",
    );
    expect(await resolveBookingInvite(db, "not a token", now)).toBeNull();
    expect(await resolveBookingInvite(db, "", now)).toBeNull();
  });

  it("follows the booking it made and the client's account", async () => {
    const booked = fakeDb({
      booking_invites: [{ ...base, booked_session_id: "s1" }],
      clients: [{ id: MARC, archived: false }],
      pt_sessions: [{ id: "s1", status: "Scheduled" }],
    });
    expect((await resolveBookingInvite(booked, token, now))?.state).toBe("booked");
    const archived = fakeDb({ booking_invites: [base], clients: [{ id: MARC, archived: true }] });
    expect((await resolveBookingInvite(archived, token, now))?.state).toBe("revoked");
  });
});

describe("what the coach sends", () => {
  const general = {
    id: "g",
    slug: "general-call",
    name: "General Call",
    duration_minutes: 30,
    duration_options: [15, 30, 45, 60],
  } as any;
  const discovery = {
    id: "d",
    slug: "coaching-discovery",
    name: "Coaching Discovery Call",
    duration_minutes: 20,
  } as any;
  it("a length only for a type that offers several", () => {
    expect(fixedLength(general, 45)).toBe(45);
    expect(fixedLength(general, 50)).toBeNull();
    expect(fixedLength(discovery, 45)).toBeNull();
  });
  it("words for the chat and for a text", () => {
    expect(inviteBody(general, 45, "")).toBe(
      "Book a 45-min General Call: pick a time that works for you.",
    );
    expect(inviteBody(general, 45, " Quick one about your meet ")).toBe(
      "Quick one about your meet",
    );
    const url = "https://jfeffect.com/b/AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(inviteShareText("Marc", general, 30, "", url)).toBe(
      `Hi Marc, here's a link to book your 30-min General Call. Pick a time that works for you: ${url}`,
    );
    expect(inviteShareText("Marc", general, 30, "Let's talk Sunday", url)).toBe(
      `Let's talk Sunday\n${url}`,
    );
  });
});

describe("wiring", () => {
  it("the server books a link once: held before the booking, kept on it after, let go on failure", () => {
    const fns = read("src/lib/booking.functions.ts");
    const book = fns.slice(
      fns.indexOf("export const bookOnline"),
      fns.indexOf("async function assertStaffFor"),
    );
    expect(book.indexOf("claimInvite(db, inviteId)")).toBeGreaterThan(0);
    expect(book.indexOf("claimInvite(db, inviteId)")).toBeLessThan(
      book.indexOf("createOnlineBooking(db,"),
    );
    expect(book).toContain(
      'await finishInvite(db, inviteId, result.kind === "session" ? result.id : null);',
    );
    expect(book).toContain("if (inviteId) await finishInvite(db, inviteId, null).catch(() => {});");
    // who it's for and the length are the server's, never the page's
    expect(book).toContain(
      "const { type: loaded, invite, identity, client } = await bookingContext(db, data);",
    );
    expect(book).toContain(
      "identity.inviteApplies && invite?.durationMin ? invite.durationMin : data.duration",
    );
  });

  it("a coaching application's call stays the public kind, whoever is signed in", () => {
    const fns = read("src/lib/booking.functions.ts");
    expect(fns).toContain("const publicOnly = !!input.applicationId && !input.invite;");
    expect(fns).toContain("publicOnly ? Promise.resolve(null) : viewerUserId(),");
    const page = read("src/components/booking/booking-page.tsx");
    expect(page).toContain("applicationId: prefill.applicationId || null } })");
  });

  it("only staff mint or cancel a link, for a client their own login can see", () => {
    const fns = read("src/lib/booking.functions.ts");
    for (const name of ["createBookingInvite", "revokeBookingInvite"]) {
      const at = fns.indexOf(`export const ${name}`);
      expect(fns.slice(at, at + 400)).toContain(".middleware([requireSupabaseAuth])");
    }
    expect(fns).toContain(
      'if (!staff) throw new Error("Only coaches can send personal booking links.");',
    );
    expect(fns).not.toContain("getClientBookingLink");
  });

  it("the table is the server's: hashes only, no client or public access, the claim only for the service role", () => {
    const sql = read("supabase/migrations/20270422090000_booking_invites.sql");
    expect(sql).toContain("token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("ALTER TABLE public.booking_invites ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.booking_invites FROM anon, authenticated;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.booking_invite_claim(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("the link's page sends no referrer (the token never leaks to a site it links to)", () => {
    const route = read("src/routes/b.$token.tsx");
    expect(route).toContain('{ name: "referrer", content: "no-referrer" }');
  });

  it("the chat's + menu has one Schedule (a link they pick from, or book it yourself)", () => {
    const menu = read("src/components/composer-plus-menu.tsx");
    expect(menu).toContain('label: "Schedule"');
    expect(menu).toContain("<ScheduleSheet");
    expect(menu).toContain("initialCard={bookCard}");
    const profile = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    expect(profile).toContain("<ClientScheduleSheet");
  });

  it("a booking from a personal link shows in their coach chat (a text or email reaches no chat)", () => {
    const server = read("src/lib/booking.server.ts");
    expect(server).toContain(
      '(!isTrainingSessionType(type.session_type) || opts.via === "booking_page")',
    );
  });
});
