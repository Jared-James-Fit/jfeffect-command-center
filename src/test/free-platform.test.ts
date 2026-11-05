import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFreeSignup, freeJoinMessage, freeSignupRedirect } from "@/lib/free-signup";
import { isMemberAccessActive } from "@/lib/memberAccess";
import { scannerSafeAuthLink } from "@/lib/scanner-safe-auth-link";
import {
  draftDaysPayload,
  draftProblem,
  programMeta,
  type ProgramDraft,
} from "@/lib/athlete-programs";
import { moveItem, newDay } from "@/lib/athlete-program-draft";
import { prescription } from "@/components/athlete-programs/program-detail";

const read = (p: string) => readFileSync(p, "utf8");
const SQL = read("supabase/migrations/20270128090000_free_platform.sql");
const EX = "11111111-1111-4111-8111-111111111111";

describe("free accounts", () => {
  it("the sign-up form asks for one thing at a time, in order", () => {
    expect(checkFreeSignup({ firstName: " ", email: "a@b.co", password: "12345678" })?.field).toBe(
      "firstName",
    );
    expect(checkFreeSignup({ firstName: "Marc", email: "nope", password: "12345678" })?.field).toBe(
      "email",
    );
    expect(
      checkFreeSignup({ firstName: "Marc", email: "marc@x.com", password: "short" })?.field,
    ).toBe("password");
    expect(
      checkFreeSignup({ firstName: "Marc", email: " marc@x.com ", password: "12345678" }),
    ).toBeNull();
  });

  it("confirmation lands on /welcome, scanner-safe (the token is spent only on Continue)", () => {
    expect(freeSignupRedirect("https://jfeffect.com/")).toBe("https://jfeffect.com/welcome");
    const verify =
      "https://x.supabase.co/auth/v1/verify?token=abc123&type=signup&redirect_to=https://jfeffect.com/welcome";
    const out = scannerSafeAuthLink({ url: verify, siteUrl: "https://jfeffect.com" })!;
    expect(out).toBe("https://jfeffect.com/welcome?token_hash=abc123&type=signup");
  });

  it("a person a coach already set up is sent to their invite, never made a second record", () => {
    expect(freeJoinMessage("coach_account")?.title).toMatch(/coach already set you up/i);
    expect(freeJoinMessage("member")).toBeNull();
    expect(freeJoinMessage("athlete")).toBeNull();
  });

  it("'Free' is access in the app and in both SQL checks (they change together)", () => {
    expect(isMemberAccessActive({ subscription_status: "Free", status: "Active" })).toBe(true);
    expect(isMemberAccessActive({ subscription_status: "free" })).toBe(true);
    // the kill switch still wins (how the team locks someone out)
    expect(
      isMemberAccessActive({ subscription_status: "Free", manual_access_disabled: true }),
    ).toBe(false);
    expect(isMemberAccessActive({ subscription_status: "Free", status: "Cancelled" })).toBe(false);
    expect(SQL).toContain("IN ('active', 'trialing', 'admin_granted', 'complimentary', 'free')");
    expect(SQL).toContain("subscription_status IN ('Trialing', 'Active', 'Complimentary', 'Free')");
  });

  it("a public sign-up is never linked to a coach's client record by email; only invited / staff-made logins are", () => {
    expect(SQL).toContain(
      "IF NEW.invited_at IS NOT NULL OR NEW.email_confirmed_at IS NOT NULL THEN",
    );
    expect(SQL).toContain("RETURN jsonb_build_object('status', 'coach_account');");
    expect(SQL).toContain("IF u.email_confirmed_at IS NULL THEN");
    // the confirmation trigger never fails a confirmation
    expect(SQL).toMatch(/EXCEPTION WHEN others THEN\s+RAISE WARNING 'member_free_join/);
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public._member_free_join(uuid) FROM PUBLIC, anon, authenticated;",
    );
  });
});

describe("athlete programs", () => {
  const ok: ProgramDraft = {
    title: "Upper / Lower",
    description: "",
    goal: "muscle",
    level: null,
    weeks: 4,
    days: [
      {
        title: "Upper",
        exercises: [{ exercise_id: EX, name: "Bench", sets: 3, reps: "8-10", rpe: "8" }],
      },
    ],
  };

  it("the builder checks what the database checks", () => {
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, title: "x" })).toMatch(/name/);
    expect(draftProblem({ ...ok, days: [] })).toMatch(/day/);
    expect(draftProblem({ ...ok, days: [{ title: "Upper", exercises: [] }] })).toMatch(
      /exercise to Upper/,
    );
    expect(
      draftProblem({
        ...ok,
        days: [{ title: "A", exercises: [{ exercise_id: EX, sets: 0, reps: "5" }] }],
      }),
    ).toMatch(/Sets/);
    expect(
      draftProblem({
        ...ok,
        days: [{ title: "A", exercises: [{ exercise_id: EX, sets: 3, reps: " " }] }],
      }),
    ).toMatch(/reps/);
    expect(
      draftProblem({
        ...ok,
        days: [{ title: "A", exercises: [{ exercise_id: EX, sets: 3, reps: "5", rpe: "12" }] }],
      }),
    ).toMatch(/RPE/);
    expect(
      draftProblem({
        ...ok,
        days: [{ title: "A", exercises: [{ exercise_id: EX, sets: 3, reps: "5", rpe: "7.5-8" }] }],
      }),
    ).toBeNull();
    expect(
      draftProblem({
        ...ok,
        days: Array.from({ length: 8 }, (_, i) => ({
          ...newDay(i),
          exercises: ok.days[0].exercises,
        })),
      }),
    ).toMatch(/7/);
  });

  it("only ids and the prescription are saved (names come from the library)", () => {
    const [day] = draftDaysPayload(ok.days);
    expect(day.exercises[0]).toEqual({
      exercise_id: EX,
      sets: 3,
      reps: "8-10",
      rpe: "8",
      rest_seconds: null,
      notes: null,
    });
    expect(day.exercises[0]).not.toHaveProperty("name");
  });

  it("reorders one step and holds at the ends", () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("reads like a coach writes it", () => {
    expect(prescription({ sets: 3, reps: "8-10", rpe: "8", rest_seconds: 120 })).toBe(
      "3 × 8-10 · RPE 8 · 2:00 rest",
    );
    expect(prescription({ sets: 5, reps: "5", rest_seconds: 45 })).toBe("5 × 5 · 45s rest");
    expect(programMeta({ weeks: 1, days_per_week: 3, exercise_count: 0 })).toBe(
      "1 week · 3 days a week",
    );
  });

  it("kept out of the coach's template library, library exercises only, and only the owner starts one", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.athlete_programs");
    expect(SQL).not.toMatch(/INSERT INTO public\.pl_templates/);
    expect(SQL).toContain("RAISE EXCEPTION 'Pick each exercise from the library'");
    expect(SQL).toContain(
      "SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;",
    );
    expect(SQL).toContain("AND c.service_tier = 'self_serve'");
    // started programs are owned by the member, like a library plan they started
    expect(SQL).toContain(
      "VALUES (v_client, p.title, p.weeks, p.goal, 'Active', true, v_start, v_start + (p.weeks * 7 - 1), 0, v_uid)",
    );
    // privacy and blocks decide who sees a shared program
    expect(SQL).toContain("NOT IN (SELECT public.community_blocked_authors())");
    expect(SQL).toContain(
      "NOT public.community_is_private(_owner) OR public.community_follows_user(auth.uid(), _owner)",
    );
    // the table shows only your own (others' come through the RPCs)
    expect(SQL).toContain(
      "USING (owner_id = (SELECT auth.uid()) OR (SELECT public.is_community_staff()));",
    );
  });

  it("the start server fn archives (never deletes) the program started before", () => {
    const fn = read("src/lib/athlete-programs.functions.ts");
    expect(fn).toContain('rpc("athlete_program_start"');
    expect(fn).toMatch(/status: "Archived",\s+archived: true/);
    expect(fn).not.toMatch(/\.delete\(/);
    expect(fn).toContain("includePinned: false");
  });
});

describe("Crew reports", () => {
  it("reports are staff-only, never your own, and three people take a program down until staff look", () => {
    expect(SQL).toContain('CREATE POLICY "Staff read community reports"');
    expect(SQL).toContain("RAISE EXCEPTION 'That''s yours'");
    expect(SQL).toMatch(
      />= 3 THEN\s+UPDATE public\.athlete_programs SET hidden_at = now\(\), hidden_reason = 'Reported by several people'/,
    );
    // removing a post archives it (the author keeps it), never deletes it
    expect(SQL).toContain(
      "SET archived_from = visibility, visibility = 'private', archived_at = now()",
    );
  });

  it("every post you don't own has Report", () => {
    const menu = read("src/components/community/post-actions.tsx");
    expect(menu).toContain("const canReport = !mine && !viewerIsStaff;");
    expect(menu).toContain('<ReportSheet kind="post"');
  });
});
