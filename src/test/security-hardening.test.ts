// The Nov 17 2026 security audit's fixes (docs/SECURITY_AUDIT_2026-11.md).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isStaffLogin, loginForEmail, loginForPhone, lookupRecoveryTarget, phoneOfLogin, recoveryPhoneTrusted, type RecoveryDb } from "@/lib/account-recovery-lookup.server";
import { frameAncestorsFor, pageSecurityHeaders, withPageSecurityHeaders } from "@/lib/security-headers";
import { allRatesOk, rateOk } from "@/lib/public-rate-limit.server";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ── A stand-in Supabase client that records every read ─────────────────── */

type Filter = [op: string, col: string, val: unknown];
type Query = { table: string; filters: Filter[] };
type Tables = Record<string, Array<Record<string, any>>>;

/** SQL ILIKE pattern → RegExp (\\ escapes the next character; % any run; _ one character). */
function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function fakeDb(tables: Tables, opts: { rpc?: (fn: string, args: any) => { data: unknown; error: unknown }; users?: Record<string, string> } = {}) {
  const queries: Query[] = [];
  const matches = (row: Record<string, any>, [op, col, val]: Filter) => {
    const v = row[col];
    if (op === "eq") return v === val;
    if (op === "in") return (val as unknown[]).includes(v);
    if (op === "not_null") return v !== null && v !== undefined;
    if (op === "ilike") return likeToRegex(String(val)).test(String(v ?? ""));
    return true;
  };
  const db: RecoveryDb & { queries: Query[] } = {
    queries,
    rpc: (fn, args) => Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: "no rpc" } }),
    auth: { admin: { getUserById: (id) => Promise.resolve({ data: { user: opts.users?.[id] ? { email: opts.users[id] } : null }, error: null }) } },
    from: (table) => {
      const q: Query = { table, filters: [] };
      queries.push(q);
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
        in: (c: string, v: unknown[]) => (q.filters.push(["in", c, v]), b),
        ilike: (c: string, v: string) => (q.filters.push(["ilike", c, v]), b),
        not: (c: string) => (q.filters.push(["not_null", c, null]), b),
        order: () => b,
        limit: () => b,
        then: (res: any, rej: any) =>
          Promise.resolve({ data: (tables[table] ?? []).filter((r) => q.filters.every((f) => matches(r, f))), error: null }).then(res, rej),
      };
      return b;
    },
  };
  return db;
}

const VICTIM = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";

describe("password recovery: only a phone on the login's own records", () => {
  // The attack: a coaching application with the victim's email and the
  // attacker's phone made an unlinked Lead row, and recovery texted that phone.
  const tables: Tables = {
    clients: [
      { user_id: null, phone: "+12045550000", email: "victim@x.com", normalized_email: "victim@x.com", normalized_phone: "12045550000" },
      { user_id: VICTIM, phone: "+12045551111", normalized_phone: "12045551111" },
      { user_id: null, phone: "+12045550000", email: "admin@x.com", normalized_email: "admin@x.com" },
    ],
    app_members: [],
    coaches: [{ user_id: ADMIN, phone: "+12045552222" }],
    profiles: [],
    user_roles: [{ user_id: ADMIN, role: "admin" }, { user_id: VICTIM, role: "client" }],
  };
  const rpc = (fn: string, args: any) =>
    fn === "auth_user_id_for_email"
      ? { data: ({ "victim@x.com": VICTIM, "admin@x.com": ADMIN } as Record<string, string>)[String(args._email).toLowerCase()] ?? null, error: null }
      : { data: null, error: null };

  it("texts the victim's own phone, never the lead row's", async () => {
    const db = fakeDb(tables, { rpc });
    const t = await lookupRecoveryTarget(db, "Victim@X.com", true);
    expect(t).toEqual({ userId: VICTIM, email: "victim@x.com", phoneE164: "+12045551111" });
    // every clients read was by the login, never by email
    for (const q of db.queries.filter((q) => q.table === "clients")) {
      expect(q.filters.some(([op, col]) => op === "eq" && col === "user_id")).toBe(true);
      expect(q.filters.some(([, col]) => col === "normalized_email" || col === "email")).toBe(false);
    }
  });

  it("never texts a staff login (the admin's reset goes by email only)", async () => {
    const t = await lookupRecoveryTarget(fakeDb(tables, { rpc }), "admin@x.com", true);
    expect(t.userId).toBe(ADMIN);
    expect(t.phoneE164).toBeNull();
    expect(t.email).toBe("admin@x.com");
  });

  it("an email with no login matches nobody (a wildcard is never a match)", async () => {
    expect(await lookupRecoveryTarget(fakeDb(tables, { rpc }), "vict_m@x.com", true)).toEqual({ userId: null, email: null, phoneE164: null });
  });

  it("a phone only on an unlinked lead row matches nobody", async () => {
    expect((await lookupRecoveryTarget(fakeDb(tables, { rpc }), "204-555-0000", false)).userId).toBeNull();
  });

  it("a phone on the login's own record finds it, with the login's own email", async () => {
    const t = await lookupRecoveryTarget(fakeDb(tables, { rpc, users: { [VICTIM]: "Victim@X.com" } }), "(204) 555-1111", false);
    expect(t).toEqual({ userId: VICTIM, email: "victim@x.com", phoneE164: "+12045551111" });
  });

  it("a phone two logins carry is never guessed between them", async () => {
    const t: Tables = { ...tables, app_members: [{ user_id: "33333333-3333-3333-3333-333333333333", phone: "+12045551111" }] };
    expect(await loginForPhone(fakeDb(t, { rpc }), "+12045551111")).toBeNull();
  });

  it("a phone that only contains the digits isn't that phone", async () => {
    const t: Tables = { clients: [], app_members: [{ user_id: VICTIM, phone: "+4412045551111" }], coaches: [], profiles: [] };
    expect(await loginForPhone(fakeDb(t), "+12045551111")).toBe(VICTIM);
    const u: Tables = { clients: [], app_members: [{ user_id: VICTIM, phone: "+120455511119" }], coaches: [], profiles: [] };
    expect(await loginForPhone(fakeDb(u), "+12045551111")).toBeNull();
  });

  it("before the migration, the exact profiles email stands in (escaped, exact)", async () => {
    const db = fakeDb({ profiles: [{ id: VICTIM, email: "victim@x.com" }, { id: ADMIN, email: "vxctim@x.com" }] });
    expect(await loginForEmail(db, "victim@x.com")).toBe(VICTIM);
    expect(await loginForEmail(db, "v_ctim@x.com")).toBeNull();
  });

  it("phoneOfLogin reads member, client, coach, then profile rows of that login only", async () => {
    const db = fakeDb({ app_members: [], clients: [], coaches: [], profiles: [{ id: VICTIM, phone: "2045553333" }] });
    expect(await phoneOfLogin(db, VICTIM)).toBe("+12045553333");
  });

  // The variant: the attacker applies first, with the victim's email and their
  // own phone; when the victim later joins, that application record is linked
  // to the victim's login (member_free_join / handle_new_user / a setup claim).
  const ATTACKER_PHONE = "+12045559999";
  const planted = (extra: Record<string, unknown> = {}): Tables => ({
    clients: [
      { user_id: VICTIM, phone: ATTACKER_PHONE, normalized_phone: "12045559999", applied_at: "2026-11-01T00:00:00Z", assigned_coach_id: null, ...extra },
    ],
    app_members: [{ user_id: VICTIM, phone: null }],
    coaches: [],
    profiles: [],
    user_roles: [{ user_id: VICTIM, role: "client" }],
  });

  it("never texts a phone from a public application nobody coaches, once linked to a login", async () => {
    const db = fakeDb(planted(), { rpc });
    expect(await phoneOfLogin(db, VICTIM)).toBeNull();
    const t = await lookupRecoveryTarget(fakeDb(planted(), { rpc }), "victim@x.com", true);
    expect(t).toEqual({ userId: VICTIM, email: "victim@x.com", phoneE164: null });
  });

  it("typing the planted phone finds nobody", async () => {
    expect(await loginForPhone(fakeDb(planted()), ATTACKER_PHONE)).toBeNull();
    expect((await lookupRecoveryTarget(fakeDb(planted(), { rpc }), ATTACKER_PHONE, false)).userId).toBeNull();
  });

  it("an applicant's phone counts once a coach has taken them on", async () => {
    const t = planted({ assigned_coach_id: "c0ac0000-0000-0000-0000-000000000001" });
    expect(await phoneOfLogin(fakeDb(t), VICTIM)).toBe(ATTACKER_PHONE);
    expect(await loginForPhone(fakeDb(t), ATTACKER_PHONE)).toBe(VICTIM);
  });

  it("a later trusted record's phone is used past an untrusted one, and a coach-made record needs no coach", async () => {
    const t = planted();
    t.clients.push({ user_id: VICTIM, phone: "+12045551111", normalized_phone: "12045551111", applied_at: null, assigned_coach_id: null });
    expect(await phoneOfLogin(fakeDb(t), VICTIM)).toBe("+12045551111");
    expect(recoveryPhoneTrusted({ applied_at: null, assigned_coach_id: null })).toBe(true);
    expect(recoveryPhoneTrusted({ applied_at: "2026-11-01", assigned_coach_id: null })).toBe(false);
    expect(recoveryPhoneTrusted({ applied_at: "2026-11-01", assigned_coach_id: "x" })).toBe(true);
  });

  it("a texted sign-in or reset link is for the record's own login, by its own email, never a team login", () => {
    const src = read("src/lib/sms-links.functions.ts");
    const handler = src.slice(src.indexOf("export const sendAuthLinkBySms"));
    expect(handler).toContain("if (!client.user_id) throw new Error(");
    expect(handler).toContain("isStaffLogin(supabaseAdmin as any, client.user_id)");
    expect(handler).toContain("auth.admin.getUserById(client.user_id)");
    expect(handler).toContain("clientEmail: loginEmail,");
    expect(handler).not.toContain("clientEmail: client.email");
  });

  it("a role lookup that fails counts as staff (email only)", async () => {
    const db: RecoveryDb = { ...fakeDb({}), from: () => { throw new Error("down"); } };
    expect(await isStaffLogin(db, VICTIM)).toBe(true);
  });

  it("the recovery function uses the lookup and Cloudflare's own client IP", () => {
    const src = read("src/lib/account-recovery.functions.ts");
    expect(src).toContain('import("./account-recovery-lookup.server")');
    expect(src).not.toMatch(/\.from\("clients"\)[\s\S]{0,80}normalized_email/);
    expect(src).toContain('getRequestHeader("cf-connecting-ip")');
  });

  it("a public application never writes contact details onto an existing record", () => {
    const src = read("src/lib/crm.functions.ts");
    expect(src).not.toMatch(/patch\.phone\s*=/);
    expect(src).not.toMatch(/patch\.instagram\s*=/);
  });

  it("setup and reset links refuse every team role, found exactly by email", () => {
    const src = read("src/lib/clients.functions.ts");
    const guard = src.slice(src.indexOf("async function assertNotPrivilegedTarget"), src.indexOf("async function claimUnlinkedLogin"));
    expect(guard).toContain("loginForEmail");
    expect(guard).toContain("STAFF_ROLES");
    expect(guard).not.toContain("listUsers");
  });
});

describe("the retired paid checkout stays off", () => {
  it("both server functions refuse before doing anything", () => {
    const src = read("src/lib/jf-billing.functions.ts");
    expect(src).toContain("const PAID_SIGNUP_ENABLED = false;");
    for (const fn of ["createJfSignupCheckout", "completeJfSignup"]) {
      const body = src.slice(src.indexOf(`export const ${fn}`));
      const handler = body.slice(body.indexOf(".handler("), body.indexOf(".handler(") + 400);
      expect(handler).toContain("if (!PAID_SIGNUP_ENABLED) throw new Error(PAID_SIGNUP_RETIRED);");
    }
  });
});

describe("page security headers", () => {
  it("the published site frames only itself; previews also allow the Lovable editor", () => {
    expect(frameAncestorsFor("jfeffect.com")).toBe("'self'");
    expect(frameAncestorsFor("www.jfeffect.com")).toBe("'self'");
    expect(frameAncestorsFor("id-preview--abc.lovable.app")).toContain("https://*.lovable.app");
    expect(frameAncestorsFor("id-preview--abc.lovable.app")).toContain("https://lovable.dev");
    expect(frameAncestorsFor("evil-jfeffect.com")).toContain("https://lovable.dev");
  });

  it("only HTML pages get them, and headers already set win", async () => {
    const page = withPageSecurityHeaders(new Response("<p>hi</p>", { headers: { "content-type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } }), "https://jfeffect.com/portal");
    expect(page.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(await page.text()).toBe("<p>hi</p>");
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(withPageSecurityHeaders(json, "https://jfeffect.com/_server")).toBe(json);
  });

  it("never blocks the camera or microphone (set videos, voice memos, Fillout photos)", () => {
    const pp = pageSecurityHeaders("https://jfeffect.com/")["Permissions-Policy"];
    expect(pp).not.toMatch(/camera|microphone/);
  });

  it("the server entry adds them", () => {
    expect(read("src/server.ts")).toContain("withPageSecurityHeaders(");
  });
});

describe("public rate limits", () => {
  const db = (answer: { data: unknown; error: unknown }) => ({ rpc: () => Promise.resolve(answer) });
  it("blocks once the limiter says no", async () => {
    expect(await rateOk(db({ data: false, error: null }), "k", 1, "1 hour")).toBe(false);
    expect(await rateOk(db({ data: true, error: null }), "k", 1, "1 hour")).toBe(true);
  });
  it("never blocks a real person when the limiter can't be reached", async () => {
    expect(await rateOk(db({ data: null, error: { message: "down" } }), "k", 1, "1 hour")).toBe(true);
    expect(await rateOk({ rpc: () => Promise.reject(new Error("net")) }, "k", 1, "1 hour")).toBe(true);
  });
  it("every limit must pass, and a missing key (no IP) is skipped", async () => {
    const calls: string[] = [];
    const ok = await allRatesOk({ rpc: (_fn, a: any) => (calls.push(a.p_key), Promise.resolve({ data: a.p_key !== "b", error: null })) }, [
      { key: "a", max: 1, window: "1 hour" },
      { key: null, max: 1, window: "1 hour" },
      { key: "b", max: 1, window: "1 day" },
    ]);
    expect(ok).toBe(false);
    expect(calls).toEqual(["a", "b"]);
  });
  it("the application, its drafts and public booking are limited per connection", () => {
    expect(read("src/lib/coaching-applications.functions.ts")).toMatch(/apply:ip:/);
    expect(read("src/lib/coaching-applications.functions.ts")).toMatch(/apply:email:/);
    expect(read("src/lib/coaching-applications.functions.ts")).toMatch(/apply-draft:ip:/);
    expect(read("src/lib/booking.functions.ts")).toMatch(/book:ip:/);
  });
  it("the public application no longer tells a stranger who is a client", () => {
    const src = read("src/lib/coaching-applications.functions.ts");
    const submit = src.slice(src.indexOf("export const submitCoachingApplication"), src.indexOf("/* ─────────── Admin endpoints"));
    const reply = submit.slice(submit.indexOf("const canBook"));
    expect(reply).toContain("return {");
    expect(reply).not.toMatch(/client_id/);
    expect(reply).not.toMatch(/conflict/);
  });
});

describe("the nutrition AI's prompts never ship to a phone", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  }
  it("only server modules (and tests) import the prompts", () => {
    // A static import puts a module in the browser bundle; a dynamic import
    // inside a server function's handler doesn't (the build strips handlers).
    const offenders = files(join(process.cwd(), "src"))
      .filter((p) => !/[\\/]test[\\/]/.test(p) && !p.endsWith(".server.ts"))
      .filter((p) => /from\s+["'][^"']*nutrition-ai-prompts/.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => p.replace(process.cwd(), ""))).toEqual([]);
  });
  it("the browser-safe module carries no prompt text", () => {
    const src = read("src/lib/nutrition-request.ts");
    expect(src).not.toMatch(/elite|you are a nutrition coach|MEAL_PLAN_PROMPT|TARGETS_PROMPT/i);
  });
  it("the coach's copy-a-prompt tools ask the server, staff only", () => {
    const fns = read("src/lib/nutrition-ai-plans.functions.ts");
    const fn = fns.slice(fns.indexOf("export const getManualNutritionPromptFn"));
    expect(fn).toContain("isStaff(supabase, userId)");
    expect(fn).toContain('import("@/lib/nutrition-ai-prompts.server")');
    expect(read("src/components/nutrition/NutritionRequestPanel.tsx")).toContain("getManualNutritionPromptFn");
    expect(read("src/components/nutrition/MealPlanBulkPaste.tsx")).toContain("getManualNutritionPromptFn");
  });
});

describe("authorization fixes", () => {
  it("every Drive upload step checks the caller can add media for that client", () => {
    const src = read("src/lib/drive.functions.ts");
    for (const fn of ["provisionClientFolder", "initMediaUpload", "finalizeMediaUpload", "createSubmission"]) {
      const body = src.slice(src.indexOf(`export const ${fn}`));
      const handler = body.slice(body.indexOf(".handler("), body.indexOf(".handler(") + 200);
      expect(handler).toContain("await assertCanUploadForClient(context, data.clientId);");
    }
  });
  it("an appointment's side effects run only after the caller's own update changed it", () => {
    const src = read("src/lib/appointments.functions.ts");
    expect(src).toMatch(/if \(!changed\?\.length\) throw new Error\("You can't cancel this appointment\."\);[\s\S]*reverseAppointmentCredit/);
    expect(src).toMatch(/if \(!changed\?\.length\) throw new Error\("You can't change this appointment\."\);/);
    expect(src).toMatch(/You can't sync this appointment/);
  });
  it("check-in thread writes read the thread as the caller first", () => {
    const src = read("src/lib/weekly-checkin-threads.functions.ts");
    expect((src.match(/Thread not found\./g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("voice transcription: the chat's own folder, once per message, coaching chats only", () => {
    const src = read("src/lib/voice-transcribe.functions.ts");
    expect(src).toContain("data.storagePath.startsWith(clientFolder)");
    expect(src).toMatch(/status === "ready" \|\| status === "empty"/);
    expect(src).toContain('!== "coaching"');
  });
  it("a phone can start at most one automatic Nutrition Update plan a day", () => {
    const src = read("src/lib/push/app-events.functions.ts");
    expect(src).toContain("AUTO_PLAN_GAP_MS = 24 * 60 * 60 * 1000");
    expect(src).toContain("return startNutritionPlan(sb, data.id);");
  });
  it("acceptance records are written by the server (the database stamps them)", () => {
    expect(read("src/lib/legal.functions.ts")).toMatch(/supabaseAdmin as any\)\s*\.from\("legal_acceptances"\)\s*\.insert/);
    expect(read("src/lib/membership-agreement.functions.ts")).toMatch(/supabaseAdmin as any\)\.from\("legal_acceptances"\)\.insert/);
    expect(read("src/lib/legal.functions.ts")).toMatch(/\.eq\("status", "draft"\)/);
  });
  it("the admin's retry runs the worker functions as the server, after its own check", () => {
    const src = read("src/lib/scheduled-messages.functions.ts");
    const fn = src.slice(src.indexOf("export const retryFailedMessage"));
    expect(fn.indexOf("Not authorized to retry this message")).toBeLessThan(fn.indexOf('"claim_message_for_retry"'));
    expect(fn).toMatch(/\(supabaseAdmin as any\)\.rpc\(\s*"claim_message_for_retry"/);
    expect(fn).toMatch(/\(supabaseAdmin as any\)\.rpc\("finalize_message_send"/);
  });
});

describe("the migration", () => {
  const sql = read("supabase/migrations/20270403093000_security_hardening.sql");
  it("takes the worker and job functions away from signed-in users and visitors", () => {
    for (const fn of ["claim_scheduled_messages(text, integer, integer)", "finalize_message_send(uuid, text, text)", "consume_session_for_pt(uuid)", "crm_last_contacted_map(uuid[])", "xp_client_for_user(uuid)", "grant_sessions_due_today()"]) {
      expect(sql).toContain(`'public.${fn}'`);
    }
    expect(sql).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated");
  });
  it("narrows the powerlifting records, the avatars bucket and the legal records", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Authenticated read powerlifting athletes"');
    expect(sql).toContain('DROP POLICY IF EXISTS "Auth view avatars" ON storage.objects;');
    expect(sql).toContain('DROP POLICY IF EXISTS "Users insert their own acceptances"');
    expect(sql).toContain("CREATE TRIGGER trg_legal_acceptance_stamp");
    expect(sql).toContain("CREATE TRIGGER trg_legal_acceptance_keep");
    expect(sql).toContain("OLD.published_at IS NOT NULL");
  });
  it("adds the exact login lookup for the server only, and turns the paid checkout off", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("SET public_checkout_enabled = false");
  });
  it("only a coaching client writes into the coach chat", () => {
    const policy = sql.slice(sql.indexOf('CREATE POLICY "Client send own messages"'));
    expect(policy).toContain("c.service_tier = 'coaching'");
    expect(policy).toContain("sender_id = (SELECT auth.uid())");
  });
  it("keeps the replaced version trigger SECURITY DEFINER, as it was", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.tg_legal_version_immutable()"));
    expect(fn.slice(0, 200)).toContain("SECURITY DEFINER");
  });
});
