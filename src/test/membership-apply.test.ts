import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMBER_ANSWERS,
  MEMBER_EXPERIENCE,
  MEMBER_GOALS,
  MEMBER_STEPS,
  applicationStage,
  approvedMessage,
  cleanMemberAnswers,
  contactNeeds,
  firstMemberProblem,
  firstMove,
  funnelRows,
  hiMessage,
  instagramProfileUrl,
  memberStepProblem,
  needsFirstReply,
  sortForReview,
  welcomeNote,
  type MemberAnswers,
  type MemberApplication,
} from "@/lib/membership-apply";
import { launchMode, LAUNCH_BOOT_SCRIPT } from "@/lib/landing-launch";
import { sourceFrom } from "@/lib/join-source";

const SQL = readFileSync("supabase/migrations/20270419090000_membership_applications.sql", "utf8");

const full: MemberAnswers = {
  goal: "build_muscle",
  experience: "new",
  coaching_interest: "",
  full_name: "  Devin   Buth ",
  contact_method: "instagram",
  email: " Devin@Example.ca ",
  instagram: "https://www.instagram.com/doubledbuth/?igsh=abc",
  phone: "",
};

describe("the application's questions", () => {
  it("asks the taps first, then the name, then how to reach them", () => {
    expect(MEMBER_STEPS).toEqual([
      "goal",
      "experience",
      "coaching_interest",
      "full_name",
      "contact_method",
      "contact",
    ]);
  });

  it("a complete application has nothing to fix", () => {
    expect(firstMemberProblem(full)).toBe(-1);
  });

  it("says what to fix on the screen it's on, and the first screen still to fix", () => {
    expect(memberStepProblem("goal", EMPTY_MEMBER_ANSWERS)?.field).toBe("goal");
    expect(firstMemberProblem({ ...full, experience: "" })).toBe(1);
    expect(memberStepProblem("full_name", { ...full, full_name: "D" })?.message).toMatch(/name/);
  });

  it("coaching interest is optional: skipping is an answer", () => {
    expect(memberStepProblem("coaching_interest", { ...full, coaching_interest: "" })).toBeNull();
    expect(
      memberStepProblem("coaching_interest", { ...full, coaching_interest: "always" }),
    ).not.toBeNull();
  });

  it("only asks for the contact details the chosen way needs", () => {
    expect(contactNeeds("instagram")).toEqual({ instagram: "required", phone: "hidden" });
    expect(contactNeeds("text")).toEqual({ instagram: "optional", phone: "required" });
    expect(contactNeeds("email")).toEqual({ instagram: "optional", phone: "hidden" });
    expect(memberStepProblem("contact", { ...full, instagram: "" })?.field).toBe("instagram");
    expect(
      memberStepProblem("contact", { ...full, contact_method: "email", instagram: "" }),
    ).toBeNull();
    expect(
      memberStepProblem("contact", { ...full, contact_method: "text", phone: "204" })?.field,
    ).toBe("phone");
    expect(
      memberStepProblem("contact", { ...full, contact_method: "text", phone: "(204) 555-0123" }),
    ).toBeNull();
    expect(memberStepProblem("contact", { ...full, email: "devin@" })?.field).toBe("email");
    // an Instagram they didn't have to give still has to read as a handle
    expect(
      memberStepProblem("contact", { ...full, contact_method: "email", instagram: "not a handle!" })
        ?.field,
    ).toBe("instagram");
  });

  it("stores the answers cleaned: email lower-case, the handle from a pasted link, no phone unless texting", () => {
    const c = cleanMemberAnswers({ ...full, phone: "204 555 0123" });
    expect(c.full_name).toBe("Devin Buth");
    expect(c.email).toBe("devin@example.ca");
    expect(c.instagram).toBe("@doubledbuth");
    expect(c.phone).toBeNull();
    expect(c.coaching_interest).toBeNull();
  });

  it("goals and experience carry straight into the member setup wizard", () => {
    const wizard = readFileSync("src/components/member/member-setup-wizard.tsx", "utf8");
    for (const g of MEMBER_GOALS) expect(wizard).toContain(`"${g.tag}"`);
    for (const e of MEMBER_EXPERIENCE) expect(wizard).toContain(`value: "${e.v}"`);
  });
});

describe("the database agrees with the page", () => {
  it("checks the same goals, experience and contact ways", () => {
    for (const g of MEMBER_GOALS) {
      expect(SQL).toContain(`'${g.v}'`);
      expect(SQL).toContain(`WHEN '${g.v}' THEN '${g.tag}'`);
    }
    for (const e of MEMBER_EXPERIENCE) expect(SQL).toContain(`'${e.v}'`);
    expect(SQL).toContain("contact_method IN ('instagram', 'text', 'email')");
  });

  it("nobody becomes a member until approved, and logins from before keep the old rule", () => {
    const join = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public._member_free_join"));
    const gate = join.indexOf("v_gate := public._membership_join_allowed(_uid);");
    expect(gate).toBeGreaterThan(0);
    // the gate runs before anything is linked or made
    expect(gate).toBeLessThan(join.indexOf("UPDATE public.clients"));
    expect(gate).toBeLessThan(join.indexOf("INSERT INTO public.app_members"));
    // after the athlete / coach-record checks, which never make anything
    expect(gate).toBeGreaterThan(
      join.indexOf("RETURN jsonb_build_object('status', 'coach_account');"),
    );
    expect(SQL).toContain("IF v_since IS NULL OR u.created_at < v_since THEN RETURN 'ok'; END IF;");
    expect(SQL).toContain("('membership_applications_since', now()::text)");
    expect(SQL).toContain("ON CONFLICT (key) DO NOTHING;");
  });

  it("keeps the live join's server-side write and its Lead link", () => {
    const join = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public._member_free_join"));
    expect(join).toContain("AND NOT (c.status = 'Lead' AND c.assigned_coach_id IS NULL)) THEN");
    expect(join).toContain("PERFORM set_config('request.jwt.claims', '', true);");
    expect(join.indexOf("SET user_id = _uid")).toBeLessThan(
      join.indexOf("INSERT INTO public.app_members"),
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public._member_free_join(uuid) FROM PUBLIC, anon, authenticated;",
    );
  });

  it("applications and funnel events are the server's alone", () => {
    expect(SQL).toContain("REVOKE ALL ON public.membership_applications FROM anon, authenticated;");
    expect(SQL).toContain(
      "REVOKE ALL ON public.membership_funnel_events FROM anon, authenticated;",
    );
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*membership_applications/);
    expect(SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.membership_activate_login(uuid) TO service_role;",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.membership_activate_login(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.membership_funnel(timestamptz) FROM PUBLIC, anon, authenticated;",
    );
  });

  it("one pending application per email, and a visitor counts once a day per step", () => {
    expect(SQL).toContain(
      "ON public.membership_applications (lower(email)) WHERE status = 'pending';",
    );
    expect(SQL).toContain("ON public.membership_funnel_events (visitor_id, event, step, day);");
  });
});

const app = (over: Partial<MemberApplication>): MemberApplication => ({
  id: "a",
  created_at: "2026-11-19T10:00:00Z",
  full_name: "Devin Buth",
  email: "devin@example.ca",
  instagram: "@doubledbuth",
  phone: null,
  goal: "build_muscle",
  experience: "new",
  coaching_interest: null,
  contact_method: "instagram",
  status: "pending",
  flagged: false,
  contact_status: "not_contacted",
  contacted_at: null,
  admin_notes: null,
  decided_at: null,
  invite_sent_at: null,
  invite_count: 0,
  activated_at: null,
  client_id: null,
  existing_account: false,
  source_page: null,
  referrer: null,
  utm_source: null,
  utm_campaign: null,
  ...over,
});

describe("the coach's list", () => {
  it("puts the ones nobody has written to first, oldest first, then the rest still waiting, then everything else newest first", () => {
    const list = sortForReview([
      app({
        id: "done-old",
        status: "approved",
        activated_at: "2026-11-01T00:00:00Z",
        created_at: "2026-10-01T00:00:00Z",
      }),
      app({ id: "messaged", contact_status: "messaged", created_at: "2026-11-10T00:00:00Z" }),
      app({ id: "new-late", created_at: "2026-11-19T00:00:00Z" }),
      app({ id: "new-early", created_at: "2026-11-18T00:00:00Z" }),
      app({ id: "flagged", flagged: true, created_at: "2026-11-17T00:00:00Z" }),
      app({ id: "declined", status: "declined", created_at: "2026-11-12T00:00:00Z" }),
    ]);
    expect(list.map((a) => a.id)).toEqual([
      "new-early",
      "new-late",
      "messaged",
      "flagged",
      "declined",
      "done-old",
    ]);
    expect(needsFirstReply(app({}))).toBe(true);
    expect(needsFirstReply(app({ flagged: true }))).toBe(false);
  });

  it("says where each one stands", () => {
    expect(applicationStage(app({})).label).toBe("New");
    expect(applicationStage(app({ contact_status: "messaged" })).label).toBe("Messaged");
    expect(applicationStage(app({ flagged: true })).label).toBe("Flagged");
    expect(applicationStage(app({ status: "approved" })).label).toBe("Approved");
    expect(applicationStage(app({ status: "approved", invite_sent_at: "x" })).label).toBe(
      "Invite sent",
    );
    expect(applicationStage(app({ status: "approved", activated_at: "x" })).label).toBe("Joined");
    expect(applicationStage(app({ status: "approved", existing_account: true })).label).toBe(
      "Has an account",
    );
    expect(applicationStage(app({ status: "declined" })).label).toBe("Declined");
  });

  it("opens their Instagram profile from the handle", () => {
    expect(instagramProfileUrl("@doubledbuth")).toBe("https://instagram.com/doubledbuth");
    expect(instagramProfileUrl(null)).toBeNull();
  });

  it("writes his messages with their name and goal, never a dash", () => {
    const hi = hiMessage(app({ coaching_interest: "yes" }));
    expect(hi).toContain("Hey Devin!");
    expect(hi).toContain("building muscle");
    expect(hi).toContain("coaching");
    const ok = approvedMessage(app({}), "https://jfeffect.com/activate?a=x");
    expect(ok).toContain("Devin, you're in");
    expect(ok).toContain("https://jfeffect.com/activate?a=x");
    for (const t of [hi, ok, ...welcomeNote("Devin", "lose_fat")]) expect(t).not.toMatch(/[—–]/);
  });

  it("points them at a program for their goal and level first", () => {
    expect(firstMove("powerlifting", "advanced").title).toMatch(/powerlifting/i);
    expect(firstMove("build_muscle", "new").title).toMatch(/beginner/i);
    expect(firstMove("lose_fat", "intermediate").to).toBe("/portal/programs?tab=jf");
  });
});

describe("the funnel", () => {
  it("each stage is a share of the one before, never a divide by zero", () => {
    const rows = funnelRows({
      visitors: 200,
      starts: 40,
      submitted: 20,
      pending: 4,
      approved: 10,
      activated: 8,
      engaged: 6,
    });
    expect(rows.map((r) => r.rate)).toEqual([null, 20, 50, 50, 80, 75]);
    expect(
      funnelRows({
        visitors: 0,
        starts: 0,
        submitted: 0,
        pending: 0,
        approved: 0,
        activated: 0,
        engaged: 0,
      }).every((r) => r.rate === null),
    ).toBe(true);
  });

  it("reads where someone came from, and ignores our own site as a referrer", () => {
    const s = sourceFrom(
      "https://jfeffect.com/?utm_source=instagram&utm_campaign=bio&from=story",
      "https://l.instagram.com/",
    );
    expect(s).toMatchObject({
      source: "story",
      utm_source: "instagram",
      utm_campaign: "bio",
      referrer: "https://l.instagram.com/",
    });
    expect(sourceFrom("https://jfeffect.com/join", "https://jfeffect.com/").referrer).toBeNull();
    expect(sourceFrom("not a url", null).source).toBeNull();
  });
});

describe("the front door", () => {
  it("is the landing page for a visitor, the app for anyone signed in or in the installed app", () => {
    const base = { hasSession: false, standalone: false, native: false, forceLanding: false };
    expect(launchMode(base)).toBe("landing");
    expect(launchMode({ ...base, hasSession: true })).toBe("app");
    expect(launchMode({ ...base, standalone: true })).toBe("app");
    expect(launchMode({ ...base, native: true })).toBe("app");
    expect(launchMode({ ...base, hasSession: true, forceLanding: true })).toBe("landing");
  });

  it("decides before the first paint, in the head, only on /", () => {
    expect(LAUNCH_BOOT_SCRIPT).toContain('location.pathname!=="/"');
    expect(LAUNCH_BOOT_SCRIPT).toContain('"-auth-token"');
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain("__html: LAUNCH_BOOT_SCRIPT");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain('html[data-launch="app"] [data-landing] { display: none !important; }');
    expect(css).toContain(
      'html:not([data-launch="app"]) [data-launch-splash] { display: none !important; }',
    );
    // the boot script runs as plain JavaScript
    expect(() => new Function(LAUNCH_BOOT_SCRIPT)).not.toThrow();
  });
});
