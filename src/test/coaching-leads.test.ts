import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LEAD_REPLY_PROMPT,
  dialable,
  draftNudge,
  igDmHref,
  keepOnlyBookingLink,
  leadNeeds,
  leadStage,
  leadUserPrompt,
  parseLeadReply,
  smsHref,
  type LeadApplication,
} from "@/lib/coaching-leads";
import { runQueuedLead } from "@/lib/coaching-leads.server";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-11-04T12:00:00Z");
const BOOK = "https://jfeffect.com/book/coaching-discovery";

const devin: LeadApplication = {
  id: "12e4179d-4940-4b0a-958c-b1213b2b2a2a",
  created_at: "2026-11-04T02:32:14Z",
  full_name: "Devin Buth",
  first_name: "Devin",
  email: "devin@example.com",
  phone: "+1-613-204-9868",
  instagram: "@doubledbuth",
  main_goal: "fat_loss",
  target_outcome: "Lose weight and keep my strength and size",
  timeline: "asap",
  lead_score: 88,
  lead_temperature: "hot",
  qualification_label: "Priority Lead",
  recommended_offer: "Fat Loss Coaching",
  status: "New",
  call_status: "not_booked",
  follow_up_at: null,
  client_id: "c1",
  is_test: false,
};

describe("what a lead needs from the coach", () => {
  it("a new application needs its first text, for two weeks", () => {
    expect(leadNeeds(devin, NOW)).toBe("reply");
    expect(leadNeeds({ ...devin, created_at: "2026-10-01T00:00:00Z" }, NOW)).toBeNull();
    expect(leadNeeds({ ...devin, is_test: true }, NOW)).toBeNull();
    expect(leadNeeds({ ...devin, call_status: "booked" }, NOW)).toBeNull();
    expect(leadNeeds({ ...devin, status: "Rejected" }, NOW)).toBeNull();
  });

  it("once texted, the follow-up is due a day later unless they booked", () => {
    const texted = { ...devin, status: "Contacted", follow_up_at: "2026-11-05T12:00:00Z" };
    expect(leadNeeds(texted, NOW)).toBeNull();
    expect(leadNeeds(texted, Date.parse("2026-11-05T13:00:00Z"))).toBe("follow_up");
    expect(leadNeeds({ ...texted, call_status: "booked" }, Date.parse("2026-11-05T13:00:00Z"))).toBeNull();
    expect(leadNeeds({ ...texted, follow_up_at: null }, Date.parse("2026-11-05T13:00:00Z"))).toBeNull();
    expect(leadStage(texted).label).toBe("Texted");
    expect(leadStage({ ...texted, call_status: "booked" }).label).toBe("Call booked");
  });
});

describe("the ways a text goes out", () => {
  it("dials and texts the number they gave, words filled in", () => {
    expect(dialable("+1-613-204-9868")).toBe("+16132049868");
    expect(dialable("(204) 555-0199")).toBe("+12045550199");
    expect(dialable("12")).toBeNull();
    expect(smsHref("+1-613-204-9868", "Hey Devin, today or tomorrow?")).toBe("sms:+16132049868?&body=Hey%20Devin%2C%20today%20or%20tomorrow%3F");
    expect(smsHref(null, "x")).toBeNull();
  });

  it("opens their Instagram DMs from a handle or a profile link", () => {
    expect(igDmHref("@doubledbuth")).toBe("https://ig.me/m/doubledbuth");
    expect(igDmHref("https://www.instagram.com/doubledbuth/?hl=en")).toBe("https://ig.me/m/doubledbuth");
    expect(igDmHref("not a handle!")).toBeNull();
  });

  it("someone who stopped halfway gets the same close, no AI needed", () => {
    expect(draftNudge({ full_name: "Devin Buth", main_goal: "fat_loss" }, BOOK)).toBe(
      `Hey Devin, Jared from JF Effect here. Saw you started your coaching application for fat loss. Easier to just hop on a quick 20 min call and map out your plan. Today or tomorrow better for you? Or grab a time here: ${BOOK}`,
    );
    expect(draftNudge({ full_name: null, main_goal: "other" }, null)).not.toContain("http");
  });
});

describe("the AI's read and texts", () => {
  it("is told only their own answers and the real booking link, never their score", () => {
    const p = leadUserPrompt(devin, { bookingUrl: BOOK, now: NOW });
    expect(p).toContain("First name: Devin");
    expect(p).toContain("Wants help with: Fat Loss");
    expect(p).toContain("The result they want, in their words: Lose weight and keep my strength and size");
    expect(p).toContain("When they want to start: ASAP");
    expect(p).toContain(`Discovery call booking link: ${BOOK}`);
    expect(p).toContain("Applied: 9h ago");
    expect(p).toMatch(/Written: Wednesday \d{1,2}:00 (AM|PM) \(Manitoba time\)/);
    expect(p).not.toMatch(/88|Priority|hot/);
    expect(leadUserPrompt(devin, { now: NOW + 3 * 86_400_000 })).toContain("applied a while ago");
    expect(leadUserPrompt(devin, { now: NOW, instructions: "Shorter" })).toContain("COACH'S NOTE FOR THIS VERSION (follow it): Shorter");
  });

  it("closes like Cardone: certainty, one next step, an either/or, never a yes/no", () => {
    expect(LEAD_REPLY_PROMPT).toContain("Grant Cardone");
    expect(LEAD_REPLY_PROMPT).toContain("either/or");
    expect(LEAD_REPLY_PROMPT).toContain("Never a yes/no question");
    expect(LEAD_REPLY_PROMPT).toContain('the text starts with their first name');
    expect(LEAD_REPLY_PROMPT).toContain('evening or night → "tomorrow morning or afternoon?"');
    expect(LEAD_REPLY_PROMPT).toContain("When they applied is never a signal.");
    expect(LEAD_REPLY_PROMPT).toContain("Never make up a link");
    expect(LEAD_REPLY_PROMPT).toContain("Never invent facts about them");
  });

  it("reads the model's JSON (fences and all) and refuses an answer with no text", () => {
    const raw = '```json\n{"read":"Wants to cut without losing strength.","signals":["ASAP","gave phone","specific result","extra"],"watch":["budget"],"angle":"A cut built around keeping strength.","next_step":"Text now.","text":"Hey Devin, today or tomorrow?","follow_up":"Afternoon or evening?"}\n```';
    const r = parseLeadReply(raw)!;
    expect(r.text).toBe("Hey Devin, today or tomorrow?");
    expect(r.followUp).toBe("Afternoon or evening?");
    expect(r.brief.signals).toHaveLength(3);
    expect(r.brief.watch).toEqual(["budget"]);
    expect(parseLeadReply('{"read":"x"}')).toBeNull();
    expect(parseLeadReply("Sorry, I can't")).toBeNull();
  });

  it("never sends a link the model made up", () => {
    expect(keepOnlyBookingLink(`Today or tomorrow? Or grab a time here: ${BOOK}`, BOOK)).toBe(`Today or tomorrow? Or grab a time here: ${BOOK}`);
    expect(keepOnlyBookingLink("Book here: https://calendly.com/fake. Today or tomorrow?", BOOK)).toBe("Book here: Today or tomorrow?");
    expect(keepOnlyBookingLink("See https://jfeffect.com/pricing today", null)).toBe("See today");
  });
});

/** Just enough of the Supabase query builder for runQueuedLead. */
function fakeDb(rows: any[]) {
  return {
    rows,
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      let patch: any = null;
      const pick = () => (table === "coaching_lead_replies" ? rows : []).filter((r) => filters.every((f) => f(r)));
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
        gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), api),
        order: () => api,
        limit: () => api,
        update: (p: any) => ((patch = p), api),
        maybeSingle: () => {
          const hit = pick()[0] ?? null;
          if (patch && hit) Object.assign(hit, patch);
          return Promise.resolve({ data: hit, error: null });
        },
        then: (res: any, rej: any) => Promise.resolve({ data: pick(), error: null }).then(res, rej),
      };
      return api;
    },
  };
}

describe("the background run", () => {
  it("claims one waiting lead once, records a failure, and retries it only after a pause", async () => {
    const row = { application_id: devin.id, status: "pending", updated_at: "2026-11-04T11:59:00.000Z", attempts: 0, instructions: null, generated_at: null };
    const db = fakeDb([row]);
    // No application in this fake database: the run fails and says so on the row.
    const first = await runQueuedLead(db, null, NOW);
    expect(first.status).toBe("error");
    expect(row).toMatchObject({ status: "error", attempts: 1 });
    expect((row as any).error).toBeTruthy();
    expect((await runQueuedLead(db, null, Date.parse(row.updated_at) + 60_000)).status).toBe("idle");
    expect((await runQueuedLead(db, devin.id, Date.parse(row.updated_at) + 11 * 60_000)).status).toBe("error");
    expect(row.attempts).toBe(2);
    // Being written right now: left alone.
    Object.assign(row, { status: "generating", updated_at: new Date(NOW).toISOString() });
    expect((await runQueuedLead(db, devin.id, NOW + 60_000)).status).toBe("idle");
  });
});

describe("wiring", () => {
  it("every new application is queued by the database and written by the hook, with a cron catch-up", () => {
    const sql = read("supabase/migrations/20270121090000_coaching_lead_replies.sql");
    expect(sql).toContain("create trigger coaching_lead_replies_queue\n  after insert on public.coaching_applications");
    expect(sql).toContain("/api/public/hooks/lead-replies-tick");
    expect(sql).toContain("'lead-replies-tick',\n    '*/5 * * * *'");
    expect(sql).toContain("(select public.has_role((select auth.uid()), 'admin'))");
    expect(sql).toContain("revoke insert, update, delete on public.coaching_lead_replies from authenticated;");
    expect(read("src/routes/api/public/hooks/lead-replies-tick.ts")).toContain("runQueuedLead(supabaseAdmin as any, applicationId)");
  });

  it("the alert, the push, Home and Messages all open the lead", async () => {
    expect(read("src/lib/coaching-applications.functions.ts")).toContain("const adminLink = `https://jfeffect.com/admin/leads?id=${inserted.id}`;");
    const { APP_EVENTS } = await import("@/lib/push/app-events.server");
    expect(APP_EVENTS.lead_ready.url("c1", devin.id)).toBe(`/admin/leads?id=${devin.id}`);
    expect(APP_EVENTS.lead_ready.category).toBe("coaching_apps");
    expect(read("src/routes/_authenticated/admin/index.tsx")).toContain("<NewLeadsCard />");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain('{role === "admin" && !search && filter === "Inbox" && <LeadsInboxRow />}');
  });
});
