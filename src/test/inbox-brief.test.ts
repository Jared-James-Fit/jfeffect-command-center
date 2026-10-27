import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  briefWaitingLines, formTitles, matchesSignal, mediaWaitingByClient, painWaitingByClient, reviewItemsByClient,
  signalTags, splitRequests, waitingCount, type ClientSignals, type InboxMsg,
} from "@/lib/inbox-brief";

const now = Date.parse("2026-10-27T18:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const msg = (id: string, client: string, role: string, h: number, extra: Partial<InboxMsg> = {}): InboxMsg =>
  ({ id, client_id: client, sender_role: role, created_at: ago(h), body: "", attachments: [], ...extra });
const read = (p: string) => readFileSync(p, "utf8");

describe("photos & videos waiting on the coach", () => {
  const video = { type: "video" }, photo = { type: "image" }, gif = { type: "image", kind: "gif" };
  it("counts the client's media nobody on staff reacted to or replied after", () => {
    const m = mediaWaitingByClient([
      msg("a1", "c1", "client", 5, { attachments: [video, video] }),
      msg("a2", "c1", "client", 3, { attachments: [photo] }),
    ], new Map(), new Map([["c1", "u1"]]), now);
    expect(m.get("c1")).toEqual([
      { messageId: "a2", at: ago(3), photos: 1, videos: 0, files: 0 },
      { messageId: "a1", at: ago(5), photos: 0, videos: 2, files: 0 },
    ]);
  });
  it("a staff reaction or a real reply after it clears it; the client's own reaction, an automated message or an internal note don't", () => {
    const msgs = [
      msg("a1", "c1", "client", 10, { attachments: [video] }),
      msg("a2", "c2", "client", 10, { attachments: [video] }),
      msg("r2", "c2", "admin", 8, { body: "nice" }),
      msg("a3", "c3", "client", 10, { attachments: [video] }),
      msg("x3", "c3", "admin", 8, { is_automated: true }),
      msg("n3", "c3", "admin", 7, { is_internal_note: true }),
    ];
    const reacted = new Map([["a1", ["coach-u"]], ["a3", ["u3"]]]);
    const m = mediaWaitingByClient(msgs, reacted, new Map([["c1", "u1"], ["c2", "u2"], ["c3", "u3"]]), now);
    expect(m.has("c1")).toBe(false); // the coach reacted
    expect(m.has("c2")).toBe(false); // the coach replied after
    expect(m.get("c3")?.length).toBe(1); // only their own reaction, a reminder and a private note
  });
  it("leaves out GIFs, the coach's own media and anything older than two weeks", () => {
    const m = mediaWaitingByClient([
      msg("g", "c1", "client", 2, { attachments: [gif] }),
      msg("mine", "c1", "admin", 2, { attachments: [video] }),
      msg("old", "c1", "client", 24 * 15, { attachments: [video] }),
    ], new Map(), new Map(), now);
    expect(m.size).toBe(0);
  });
});

describe("pain notes, forms to review, overdue forms", () => {
  it("pain flagged in a workout note waits until the coach replies after it", () => {
    const note = { kind: "workout_note", pain: { area: "Shoulder (L)", level: 4 } };
    const waiting = painWaitingByClient([msg("p1", "c1", "client", 6, { attachments: [note] })], now);
    expect(waiting.get("c1")?.[0].line).toContain("Left shoulder");
    const answered = painWaitingByClient([
      msg("p1", "c1", "client", 6, { attachments: [note] }),
      msg("r1", "c1", "admin", 2, { body: "how's it feel today?" }),
    ], now);
    expect(answered.size).toBe(0);
  });

  it("names what's to review (check-ins, and forms by the title they were sent with)", () => {
    const titles = formTitles([msg("f", "c1", "admin", 50, { attachments: [{ kind: "form_request", form_id: "nf1", request_title: "Nutrition Update Request" }] })]);
    const items = reviewItemsByClient([
      { client_id: "c1", kind: "checkin", type: "weekly_checkin", submitted_at: ago(20) },
      { client_id: "c1", kind: "form", type: "nf1", submitted_at: ago(5) },
      { client_id: "c1", kind: "form", type: "nf-unknown", submitted_at: ago(4) },
    ], titles);
    expect(items.get("c1")?.map((i) => i.title)).toEqual(["Form", "Nutrition Update Request", "Weekly check-in"]);
  });

  it("splits requests not filled into overdue (48h+) and still in time", () => {
    const { overdue, pending } = splitRequests({
      pending: [
        { key: "a", kind: "checkin", title: "Weekly check-in", since: ago(72) },
        { key: "b", kind: "form", title: "Nutrition Update Request", since: ago(5) },
      ],
      toReview: 0, missed: 2,
    }, now);
    expect(overdue.map((o) => o.title)).toEqual(["Weekly check-in"]);
    expect(pending.map((o) => o.title)).toEqual(["Nutrition Update Request"]);
  });
});

describe("one reading for filters, row tags and the Brief", () => {
  const s: ClientSignals = {
    needsReply: { since: ago(70), detail: "Pain flagged" },
    toReview: [{ kind: "checkin", title: "Weekly check-in", at: ago(28) }],
    overdue: [{ title: "Weekly check-in", since: ago(96) }],
    pending: [],
    missed: 1,
    media: [{ messageId: "m", at: ago(5), photos: 1, videos: 2, files: 0 }],
    pain: [{ messageId: "p", at: ago(70), line: "Left shoulder · Moderate (4/10)" }],
    sessionRequests: 1,
  };
  it("filters match their signal", () => {
    for (const f of ["To Review", "Overdue", "Media", "Pain", "Sessions"] as const) expect(matchesSignal(s, f), f).toBe(true);
    expect(matchesSignal(undefined, "Pain")).toBe(false);
  });
  it("row tags: most pressing first, short words, one line", () => {
    expect(signalTags(s, { followUp: false, priority: "Normal" }).map((t) => [t.key, t.label, t.tone])).toEqual([
      ["reply", "Reply", "urgent"],
      ["pain", "Pain", "urgent"],
      ["overdue", "Form overdue", "warn"],
      ["review", "Review", "info"],
      ["media", "2 videos · 1 photo", "info"],
      ["session", "Session request", "info"],
    ]);
    expect(waitingCount(s)).toBe(6);
  });
  it("what the AI reads is plain lines with dates (so its cache doesn't change by the minute)", () => {
    const lines = briefWaitingLines(s, { waitingOnClientSince: null });
    expect(lines[0]).toBe("Needs a reply (Pain flagged) since 2026-10-24");
    expect(lines.join("\n")).not.toMatch(/ago|hour|minute/);
    expect(lines).toContain("1 earlier request never filled in");
  });
});

describe("the coach inbox", () => {
  const route = read("src/route-pages/_authenticated/admin/messages.tsx");
  it("has the quick filters, hiding the empty optional ones", () => {
    expect(route).toContain('"Inbox", "Needs Response", "Pain", "Overdue", "To Review", "Media", "Sessions",');
    expect(route).toContain('FILTERS.filter((f) => !ONLY_WHEN_ANY.has(f) || (filterCounts[f] ?? 0) > 0 || filter === f)');
    expect(route).toContain("return status !== \"archived\" && matchesSignal(it.signals, filter as SignalFilter);");
  });
  it("rows show a few small tags instead of a wall of pills, and the photo opens the Brief", () => {
    expect(route).toContain("{tags.slice(0, 3).map((t) => <RowTag key={t.key} tag={t} />)}");
    for (const gone of ["<RequestStatusChip", "<WaitingPill", "Lift Reviews\"}"]) expect(route).not.toContain(gone);
    expect(route).toContain("onClick={(e) => { e.stopPropagation(); setBriefFor(client.id); }}");
    expect(route).toContain("onClick={() => setBriefFor(selected.id)}");
    expect(route).toContain("<ClientBriefSheet");
  });
  it("counts come from the same rows and the same rule the list shows", () => {
    expect(route).toContain("for (const it of allRows) {");
    expect(route).toContain("for (const f of COUNTED) if (inFilter(it, f)) counts[f] = (counts[f] ?? 0) + 1;");
    expect(route).toContain("return inFilter(it, filter);");
    expect(route).toContain("}, [allRows, search, filter]);");
  });
  it("only the filters that are work for me carry a count badge, in their row tag's colour", () => {
    expect(route).toContain('"Needs Response": "urgent", Pain: "urgent",');
    expect(route).toContain('Overdue: "warn", "Follow Up": "warn", Priority: "warn",');
    expect(route).toContain('"To Review": "info", Media: "info", Sessions: "info",');
    expect(route).toContain('Unread: "unread",');
    const badges = route.slice(route.indexOf("const FILTER_BADGE"), route.indexOf("const BADGE_STYLE"));
    for (const quiet of ["Inbox", "Waiting on Client", "Done", "Archived"]) expect(badges).not.toContain(quiet);
    expect(route).toContain('const badgeNumber = (n: number) => (n > 99 ? "99+" : String(n));');
    expect(route).toContain("aria-label={n ? `${label}, ${n}` : label}");
  });
});

describe("the Brief's AI read", () => {
  const fn = read("src/lib/client-brief.functions.ts");
  it("is staff only, reads as the coach (RLS), and is cached against exactly what it read", () => {
    expect(fn).toContain('sb.rpc("is_coach_or_admin", { _user_id: context.userId })');
    expect(fn).toContain('.from("clients")');
    expect(fn).toContain('const hash = await sha256(prompt.replace(/^Now: .*$/m, ""));');
    expect(fn).toContain('if (hit && hit.input_hash === hash)');
    // the gateway helper is loaded inside the handler, never at module scope
    expect(fn).not.toMatch(/^import .*ai-gateway\.server/m);
  });
  it("the cache table is closed to clients and staff (server only)", () => {
    const sql = read("supabase/migrations/20270101090000_inbox_client_briefs.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.inbox_client_briefs FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
});
