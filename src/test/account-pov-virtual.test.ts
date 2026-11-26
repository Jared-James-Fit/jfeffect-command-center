import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyDbRequest, povPath, startStatusWords, timeLeft, POV_OWN_FNS } from "@/lib/pov/pov-rules";
import { STARTER_PERSONAS } from "@/lib/virtual-accounts/personas";

const SQL = readFileSync("supabase/migrations/20270601090000_accounts_directory_badges_pov_virtual.sql", "utf8");
// account views as they are now (one tap, no reason, admin-only record): the later migration
const ACCESS = readFileSync("supabase/migrations/20270602110000_account_access_hardening.sql", "utf8");
const accessBody = (name: string) => {
  const start = ACCESS.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return ACCESS.slice(start, ACCESS.indexOf("$$;", start));
};
const fnBody = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", start);
  return SQL.slice(start, end);
};

describe("account view (View as): what counts as a change", () => {
  const db = "https://x.supabase.co";
  it("table reads are reads, anything else on a table is a write", () => {
    expect(classifyDbRequest(`${db}/rest/v1/pl_row_results?select=*`, "GET")).toEqual({ kind: "read", target: "pl_row_results" });
    expect(classifyDbRequest(`${db}/rest/v1/pl_row_results`, "POST")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/rest/v1/pl_row_results?id=eq.1`, "PATCH")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/rest/v1/pl_row_results?id=eq.1`, "DELETE")?.kind).toBe("write");
  });
  it("RPCs: a POST writes only when its name says so", () => {
    expect(classifyDbRequest(`${db}/rest/v1/rpc/community_feed_ranked`, "POST")?.kind).toBe("read");
    expect(classifyDbRequest(`${db}/rest/v1/rpc/community_react`, "POST")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/rest/v1/rpc/workout_view_set`, "POST")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/rest/v1/rpc/save_progress_bodyweight`, "POST")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/rest/v1/rpc/anything`, "GET")?.kind).toBe("read");
  });
  it("storage: signing and listing read, uploads write; sign-in is never counted", () => {
    expect(classifyDbRequest(`${db}/storage/v1/object/sign/documents/a.pdf`, "POST")?.kind).toBe("read");
    expect(classifyDbRequest(`${db}/storage/v1/object/list/documents`, "POST")?.kind).toBe("read");
    expect(classifyDbRequest(`${db}/storage/v1/object/documents/a.pdf`, "POST")?.kind).toBe("write");
    expect(classifyDbRequest(`${db}/auth/v1/token?grant_type=refresh_token`, "POST")).toBeNull();
    expect(classifyDbRequest("not a url", "POST")).toBeNull();
  });
  it("the view's own calls are never refused", () => {
    for (const f of ["startPovSessionFn", "touchPovFn", "endPovFn", "setPovModeFn", "povLogFn", "accessLogFn", "accessSessionFn"]) {
      expect(POV_OWN_FNS.has(f)).toBe(true);
    }
  });
  it("the access record keeps paths with ids and dates taken out", () => {
    expect(povPath("/portal/workouts/2026-11-26/2b3c4d5e-1111-2222-3333-444455556666")).toBe("/portal/workouts/:date/:id");
  });
  it("time left in words", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(timeLeft("2026-11-26T12:28:30Z", now)).toBe("28 min");
    expect(timeLeft("2026-11-26T12:00:20Z", now)).toBe("Under a minute");
    expect(timeLeft("2026-11-26T14:05:00Z", now)).toBe("2h 5m");
    expect(timeLeft("2026-11-26T11:00:00Z", now)).toBe("Ended");
    expect(startStatusWords("ok")).toBeNull();
    expect(startStatusWords("forbidden")).toMatch(/access/);
  });
});

describe("account view: the server decides who and until when, and asks nothing", () => {
  it("no reason; an admin any account, a coach only their own; a refusal is recorded; other views end; it expires", () => {
    const start = accessBody("admin_pov_start");
    expect(start).not.toContain("reason_required");
    expect(start).toContain("_reason text DEFAULT NULL");
    expect(start).toContain("public._staff_can_reach(v_uid, _client_id)");
    expect(start).toContain("_log_access_denial(v_uid, _client_id, 'view_as'");
    expect(start).toContain("'status', 'forbidden'");
    expect(start).toMatch(/interval '30 minutes'/);
    expect(start).toMatch(/interval '4 hours'/);
    expect(start).toContain("end_reason = 'replaced'");
    const reach = accessBody("_staff_can_reach");
    expect(reach).toContain("public.has_role(_staff, 'admin')");
    expect(reach).toContain("co.status = 'Active'");
  });
  it("editing a non-coaching account asks for two-step again; view-only never does", () => {
    const step = fnBody("_pov_needs_step_up");
    expect(step).toContain("service_tier = 'coaching'");
    const mode = accessBody("admin_pov_set_mode");
    expect(mode).toContain("_pov_step_up_state");
    expect(mode).toContain("interval '15 minutes'");
    expect(mode).not.toContain("reason_required");
  });
  it("every view, edit, change and block is recorded, and only the admin reads the record", () => {
    expect(ACCESS).toContain("kind IN ('start', 'view', 'edit_on', 'edit_off', 'write', 'blocked', 'change', 'end', 'expired', 'interrupted', 'revoked')");
    expect(ACCESS).toContain(
      'CREATE POLICY "Admins read account views" ON public.admin_pov_sessions FOR SELECT TO authenticated\n  USING ((SELECT public.has_role((SELECT auth.uid()), \'admin\'::app_role)));',
    );
    expect(ACCESS).not.toMatch(/staff_user_id = \(SELECT auth\.uid\(\)\)\);/);
    for (const fn of ["admin_access_log", "admin_access_session", "admin_pov_log"]) {
      expect(accessBody(fn)).toContain("IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed'");
    }
  });
  it("the server middleware refuses non-read calls while a view is view-only", () => {
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain("povGuard");
    expect(start).toContain('req.method === "GET" || (name && POV_OWN_FNS.has(name)) || isPreviewSafeFn(name)');
  });
});

describe("virtual Crew accounts", () => {
  it("12 fictional people, words only, within the Crew's limits", () => {
    expect(STARTER_PERSONAS.length).toBeGreaterThanOrEqual(10);
    expect(STARTER_PERSONAS.length).toBeLessThanOrEqual(15);
    const slugs = new Set<string>();
    for (const p of STARTER_PERSONAS) {
      expect(p.slug).toMatch(/^[a-z][a-z0-9._]{2,29}$/);
      expect(slugs.has(p.slug)).toBe(false);
      slugs.add(p.slug);
      expect(p.bio.length).toBeLessThanOrEqual(150);
      expect(p.background).toMatch(/^Fictional\./);
      expect(p.disciplines.length).toBeLessThanOrEqual(3);
      for (const d of p.disciplines) expect(["powerlifting", "bodybuilding", "strength", "glutes", "fitness"]).toContain(d);
      // no media of any kind
      expect(Object.keys(p).sort()).toEqual(["background", "bio", "disciplines", "first", "last", "slug"]);
    }
  });
  it("can never carry a photo: created and updated with no avatar, never a media record", () => {
    const create = fnBody("admin_virtual_account_create");
    expect(create).not.toMatch(/storage\.objects/);
    expect(create).toContain("banned_until");
    expect(create).toContain("@virtual.jfeffect.invalid");
    expect(fnBody("admin_virtual_account_update")).toContain("avatar_path = NULL");
  });
  it("only likes, within every limit, and the global switch starts off", () => {
    const tick = fnBody("virtual_accounts_tick");
    expect(tick).toContain("automation_enabled");
    expect(tick).toContain("instant_to_local");
    expect(tick).toContain("daily_like_limit");
    expect(tick).toContain("per_post_max");
    expect(tick).toContain("story_only");
    expect(tick).toContain("auto_shared");
    expect(tick).toContain("chat_has_blocked(p.author_user_id, v.user_id)");
    expect(tick).not.toMatch(/INSERT INTO public\.community_(posts|comments|follows)/);
    expect(SQL).toContain('{"automation_enabled":false,');
  });
  it("are labelled wherever they show, send no notifications and count in no statistics", () => {
    expect(SQL).toContain("'virtual', EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE va.user_id = me.uid)");
    expect(fnBody("community_notify_on_reaction")).toContain("SELECT 1 FROM public.virtual_accounts va");
    expect(SQL).toMatch(/bi_people[\s\S]+virtual_accounts/);
    expect(readFileSync("src/components/name-marks.tsx", "utf8")).toContain("Virtual");
  });
  it("is_test_login never sweeps a virtual account into the test bucket", () => {
    expect(fnBody("is_test_login")).toContain("virtual_accounts");
  });
});
