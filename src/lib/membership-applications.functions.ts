/**
 * Free membership by application (membership-apply.ts), its server calls.
 *
 * Public (no sign-in): send an application, report a funnel step, and the
 * activation page (what a link opens, email me a code, check the code, set
 * the password). Admin: list, notes / contact status / flag, approve (sends
 * the activation email), decline, reopen, resend, the link to DM or text,
 * and the funnel.
 *
 * Every write to an application is the server's (service role, after the
 * admin check); the table has no client policies. Becoming a member is the
 * database's own gate (`_member_free_join`), so nothing here can be skipped.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminView } from "@/lib/permissions.server";
import { clip } from "@/lib/apply-form";
import {
  CONSENT_VERSION,
  FUNNEL_EVENTS,
  MEMBER_STEPS,
  approvedMessage,
  cleanMemberAnswers,
  consentText,
  firstMemberProblem,
  firstNameFrom,
  memberStepProblem,
  type FunnelCounts,
  type MemberAnswers,
  type MemberApplication,
} from "@/lib/membership-apply";

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

function clientIp(): string | null {
  const xff = getRequestHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-real-ip") ?? null;
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse/i;
const looksLikeBot = () => BOT_UA.test(getRequestHeader("user-agent") ?? "");

const TEST_EMAIL = (email: string) =>
  /@(example\.(com|org|net))$/i.test(email) || /\.(test|example|invalid|localhost)$/i.test(email);

/** The coach's calendar day (Manitoba keeps UTC-5 from Nov 1 2026; the server's own zone rules know it). */
function coachDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const optText = (max: number) => z.string().optional().nullable().transform((v) => clip(v ?? "", max) || null);

/* ------------------------------------------------------------------ */
/* Public: the funnel                                                  */
/* ------------------------------------------------------------------ */

const TrackInput = z.object({
  visitorId: z.string().uuid(),
  event: z.enum(FUNNEL_EVENTS),
  step: z.string().max(40).optional().nullable(),
  source: optText(80),
  referrer: z.string().max(500).optional().nullable(),
  utm_source: optText(120),
  utm_medium: optText(120),
  utm_campaign: optText(120),
});

function referrerHost(raw: string | null | undefined): string | null {
  try {
    const host = new URL(String(raw ?? "")).hostname.replace(/^www\./, "");
    return host ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** One anonymous step (a random id per browser). Best effort, never throws to the page. */
export const trackJoinFunnel = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TrackInput.parse(i))
  .handler(async ({ data }) => {
    if (looksLikeBot()) return { ok: false };
    if (data.step && !(MEMBER_STEPS as readonly string[]).includes(data.step)) return { ok: false };
    try {
      const { admin } = await import("@/lib/membership-applications.server");
      const sb = await admin();
      await sb.from("membership_funnel_events").upsert(
        {
          visitor_id: data.visitorId,
          event: data.event,
          step: data.event === "apply_step" ? data.step ?? "" : "",
          day: coachDay(),
          source: data.source,
          referrer_host: referrerHost(data.referrer),
          utm_source: data.utm_source,
          utm_medium: data.utm_medium,
          utm_campaign: data.utm_campaign,
        },
        { onConflict: "visitor_id,event,step,day", ignoreDuplicates: true },
      ).then(() => null, () => null);
    } catch {
      /* counting is never worth an error */
    }
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Public: the application                                             */
/* ------------------------------------------------------------------ */

const ApplyInput = z.object({
  goal: z.string().max(40),
  experience: z.string().max(40),
  coaching_interest: z.string().max(10).optional().default(""),
  full_name: z.string().max(200),
  contact_method: z.string().max(20),
  email: z.string().max(254),
  instagram: z.string().max(120).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  // bot traps and attribution: never shown, never a reason to refuse a person
  honeypot: z.string().max(200).optional().default(""),
  elapsed_ms: z.number().int().min(0).max(86_400_000).optional().default(0),
  visitor_id: z.string().uuid().optional().nullable(),
  source_page: optText(80),
  referrer: optText(500),
  utm_source: optText(120),
  utm_medium: optText(120),
  utm_campaign: optText(120),
});

/** Faster than a person could read the questions: a script. */
const MIN_HUMAN_MS = 2500;
const MAX_PER_HOUR = 5;

export type ApplyResult =
  | { ok: true; status: "received" | "updated"; firstName: string; contactMethod: string; coachingInterest: string | null; bookingUrl: string | null }
  | { ok: true; status: "already_approved"; firstName: string }
  | { ok: true; status: "has_account"; firstName: string };

export const submitMembershipApplication = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ApplyInput.parse(i))
  .handler(async ({ data }): Promise<ApplyResult> => {
    const answers: MemberAnswers = {
      goal: data.goal,
      experience: data.experience,
      coaching_interest: data.coaching_interest ?? "",
      full_name: data.full_name,
      contact_method: data.contact_method,
      email: data.email,
      instagram: data.instagram ?? "",
      phone: data.phone ?? "",
    };
    const bad = firstMemberProblem(answers);
    if (bad >= 0) throw new Error(memberStepProblem(MEMBER_STEPS[bad]!, answers)!.message);
    const clean = cleanMemberAnswers(answers);
    const firstName = firstNameFrom(clean.full_name);

    // A bot gets the same answer a person does, and nothing is saved.
    if (data.honeypot || data.elapsed_ms < MIN_HUMAN_MS) {
      return { ok: true, status: "received", firstName, contactMethod: clean.contact_method, coachingInterest: clean.coaching_interest, bookingUrl: null };
    }

    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const { ipHash } = await import("@/lib/membership-activation.server");
    const ip = ipHash(clientIp());

    if (ip) {
      const { count } = await sb
        .from("membership_applications")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ip)
        .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
      if ((count ?? 0) >= MAX_PER_HOUR) throw new Error("A few applications just came from this connection. Try again in an hour.");
    }

    // Already a member or a coaching client: they sign in, nothing to apply for.
    const account = await m.accountFor(sb, clean.email);
    if (account.kind === "athlete" || account.kind === "staff") {
      return { ok: true, status: "has_account", firstName };
    }

    // Already approved (the invite is in their inbox): send it again if the last one is an hour old.
    const { data: approved } = await sb
      .from("membership_applications")
      .select("id, email, full_name, invite_sent_at, invite_count, activated_at")
      .eq("email", clean.email)
      .eq("status", "approved")
      .is("activated_at", null)
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (approved) {
      const last = approved.invite_sent_at ? Date.parse(approved.invite_sent_at) : 0;
      if (Date.now() - last > 3_600_000 && account.kind !== "coach_record") {
        const round = (approved.invite_count ?? 0) + 1;
        const sent = await m.sendApprovalEmail(sb, approved, { round });
        if (sent.sent) {
          await sb.from("membership_applications").update({ invite_sent_at: new Date().toISOString(), invite_count: round }).eq("id", approved.id);
        }
      }
      return { ok: true, status: "already_approved", firstName };
    }

    const now = new Date().toISOString();
    const row = {
      full_name: clean.full_name,
      email: clean.email,
      instagram: clean.instagram,
      phone: clean.phone,
      goal: clean.goal,
      experience: clean.experience,
      coaching_interest: clean.coaching_interest,
      contact_method: clean.contact_method,
      contact_consent_at: now,
      consent_text: `${CONSENT_VERSION}: ${consentText(clean.contact_method)}`,
      source_page: data.source_page,
      referrer: data.referrer,
      utm_source: data.utm_source,
      utm_medium: data.utm_medium,
      utm_campaign: data.utm_campaign,
      visitor_id: data.visitor_id ?? null,
      ip_hash: ip,
      is_test: TEST_EMAIL(clean.email),
    };

    // Applying again while it's pending updates the one they have.
    const { data: pending } = await sb
      .from("membership_applications")
      .select("id")
      .eq("email", clean.email)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    let id: string;
    let status: "received" | "updated" = "received";
    if (pending) {
      const { error } = await sb.from("membership_applications").update(row).eq("id", pending.id);
      if (error) throw new Error("That didn't send. Your answers are saved: tap Send again.");
      id = pending.id;
      status = "updated";
    } else {
      const { data: ins, error } = await sb.from("membership_applications").insert(row).select("id").single();
      if (error) {
        // two taps at once: the other one landed
        if (error.code === "23505") return { ok: true, status: "updated", firstName, contactMethod: clean.contact_method, coachingInterest: clean.coaching_interest, bookingUrl: null };
        console.warn("[member-apply] insert failed", error.message);
        throw new Error("That didn't send. Your answers are saved: tap Send again.");
      }
      id = ins.id;
    }

    if (data.visitor_id) {
      await sb
        .from("membership_funnel_events")
        .upsert({ visitor_id: data.visitor_id, event: "apply_submit", step: "", day: coachDay() }, { onConflict: "visitor_id,event,step,day", ignoreDuplicates: true })
        .then(() => null, () => null);
    }

    let bookingUrl: string | null = null;
    if (clean.coaching_interest === "yes" || clean.coaching_interest === "maybe") {
      const { leadBookingUrl } = await import("@/lib/coaching-leads.server");
      bookingUrl = await leadBookingUrl(sb, null).catch(() => null);
    }
    if (status === "received" && !row.is_test) {
      await m.pushNewApplication(sb, { id, full_name: clean.full_name, goal: clean.goal });
    }
    await m.sendReceivedEmail(sb, { id, email: clean.email, full_name: clean.full_name, contact_method: clean.contact_method, coaching_interest: clean.coaching_interest }, bookingUrl);

    return { ok: true, status, firstName, contactMethod: clean.contact_method, coachingInterest: clean.coaching_interest, bookingUrl };
  });

/* ------------------------------------------------------------------ */
/* Public: activation (/activate)                                      */
/* ------------------------------------------------------------------ */

export type ActivationView =
  | { state: "invalid" }
  | { state: "pending" }
  | { state: "joined" }
  | { state: "has_account" }
  | { state: "coach_record" }
  | { state: "ok"; firstName: string; emailHint: string | null; email: string | null; proven: boolean; goal: string; experience: string; coachingInterest: string | null };

const TokenInput = z.object({ token: z.string().min(10).max(120), proof: z.string().max(64).optional().nullable() });

async function appForToken(token: string): Promise<any | null> {
  const { verifyActivation } = await import("@/lib/membership-activation.server");
  const id = verifyActivation(token);
  if (!id) return null;
  const { admin } = await import("@/lib/membership-applications.server");
  const sb = await admin();
  const { data } = await sb
    .from("membership_applications")
    .select("id, email, full_name, goal, experience, coaching_interest, status, activated_at, existing_account, code_hash, code_expires_at, code_attempts, code_sent_at")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function viewFor(app: any, proof: string | null | undefined): Promise<ActivationView> {
  if (!app || app.status === "declined") return { state: "invalid" };
  if (app.status === "pending") return { state: "pending" };
  if (app.activated_at) return { state: "joined" };
  if (app.existing_account) return { state: "has_account" };
  const m = await import("@/lib/membership-applications.server");
  const account = await m.accountFor(await m.admin(), app.email);
  if (account.kind === "athlete" || account.kind === "staff") return { state: "has_account" };
  if (account.kind === "coach_record") return { state: "coach_record" };
  const { proofOk } = await import("@/lib/membership-activation.server");
  const proven = proofOk(app.id, app.email, proof);
  return {
    state: "ok",
    firstName: firstNameFrom(app.full_name),
    // the full email only once it's proven theirs (the password manager saves it); a forwarded link sees it masked
    email: proven ? app.email : null,
    emailHint: m.maskEmail(app.email),
    proven,
    goal: app.goal,
    experience: app.experience,
    coachingInterest: app.coaching_interest ?? null,
  };
}

/** What an activation link opens on. */
export const peekActivation = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.parse(i))
  .handler(async ({ data }): Promise<ActivationView> => viewFor(await appForToken(data.token), data.proof));

/** Email a 6-digit code to the application's email (a DM'd or texted link). */
export const sendActivationCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.parse(i))
  .handler(async ({ data }) => {
    const app = await appForToken(data.token);
    const view = await viewFor(app, null);
    if (view.state !== "ok") throw new Error("This link doesn't work anymore. Ask Jared for a new one.");
    const { CODE_MINUTES, CODE_RESEND_SECONDS, codeHash, newCode } = await import("@/lib/membership-activation.server");
    if (app.code_sent_at && Date.now() - Date.parse(app.code_sent_at) < CODE_RESEND_SECONDS * 1000) {
      return { sentTo: view.emailHint, waitSeconds: CODE_RESEND_SECONDS };
    }
    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const code = newCode();
    const { error } = await sb
      .from("membership_applications")
      .update({ code_hash: codeHash(app.id, code), code_expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), code_attempts: 0, code_sent_at: new Date().toISOString() })
      .eq("id", app.id);
    if (error) throw new Error("Couldn't send the code. Try again.");
    const sent = await m.sendCodeEmail(sb, app, code);
    if (!sent.sent) throw new Error("Couldn't email the code. Try again in a minute.");
    return { sentTo: view.emailHint, waitSeconds: CODE_RESEND_SECONDS };
  });

/** The code from the email: proves the inbox is theirs. Returns the same proof the emailed link carries. */
export const verifyActivationCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.extend({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email.") }).parse(i))
  .handler(async ({ data }) => {
    const app = await appForToken(data.token);
    const view = await viewFor(app, null);
    if (view.state !== "ok") throw new Error("This link doesn't work anymore. Ask Jared for a new one.");
    const { CODE_MAX_ATTEMPTS, codeHash, emailProof } = await import("@/lib/membership-activation.server");
    if (!app.code_hash || !app.code_expires_at || Date.parse(app.code_expires_at) < Date.now()) {
      throw new Error("That code has expired. Tap Send a new code.");
    }
    if ((app.code_attempts ?? 0) >= CODE_MAX_ATTEMPTS) throw new Error("Too many tries. Tap Send a new code.");
    const { admin } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    if (codeHash(app.id, data.code) !== app.code_hash) {
      await sb.from("membership_applications").update({ code_attempts: (app.code_attempts ?? 0) + 1 }).eq("id", app.id);
      throw new Error("That code didn't work. Check it, or tap Send a new code.");
    }
    await sb.from("membership_applications").update({ code_hash: null, code_expires_at: null, code_attempts: 0 }).eq("id", app.id);
    return { proof: emailProof(app.id, app.email), email: app.email as string };
  });

/**
 * Set the password and make them a member. The email must be proven (the
 * emailed link, or the code), so a forwarded link can't take an inbox it
 * doesn't own. The page then signs in with the password.
 */
export const activateMembership = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    TokenInput.extend({ password: z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer.") }).parse(i),
  )
  .handler(async ({ data }) => {
    const app = await appForToken(data.token);
    const view = await viewFor(app, data.proof);
    if (view.state === "joined" || view.state === "has_account") throw new Error("You already have an account. Sign in with your email and password.");
    if (view.state === "coach_record") throw new Error("Your coach already set up an account for this email. Ask Jared to send your setup link.");
    if (view.state !== "ok") throw new Error("This link doesn't work anymore. Ask Jared for a new one.");
    if (!view.proven) throw new Error("Confirm your email first.");

    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const account = await m.accountFor(sb, app.email);
    let loginId: string;
    if (account.kind === "orphan_login") {
      // an old sign-up with this email: the inbox is proven, so it becomes theirs with this password
      loginId = account.loginId;
      const { error } = await sb.auth.admin.updateUserById(loginId, { password: data.password, email_confirm: true });
      if (error) throw new Error("Couldn't finish setting up your account. Try again.");
    } else if (account.kind === "none") {
      // Made unconfirmed first, then confirmed: confirmed at creation, the new-login trigger would
      // hand them any record with this email; confirming runs the member join, which only links
      // a coaching application nobody took on.
      const { data: made, error } = await sb.auth.admin.createUser({
        email: app.email,
        password: data.password,
        email_confirm: false,
        user_metadata: { full_name: app.full_name, first_name: firstNameFrom(app.full_name), jf_signup: "free", membership_application_id: app.id },
      });
      if (error || !made?.user) {
        console.warn("[member-activate] create failed", error?.message);
        throw new Error("Couldn't set up your account. Try again, or ask Jared for help.");
      }
      loginId = made.user.id;
      const { error: cErr } = await sb.auth.admin.updateUserById(loginId, { email_confirm: true });
      if (cErr) throw new Error("Couldn't finish setting up your account. Try again.");
    } else {
      throw new Error("You already have an account. Sign in with your email and password.");
    }

    const { data: joined, error: jErr } = await sb.rpc("membership_activate_login", { _uid: loginId });
    const status = (joined as any)?.status as string | undefined;
    if (jErr || !(status === "member" || status === "athlete")) {
      console.warn("[member-activate] join answered", status, jErr?.message);
      throw new Error("Your account is made, but it didn't finish joining. Sign in and it'll finish, or ask Jared.");
    }
    return { ok: true, email: app.email as string, goal: app.goal as string, experience: app.experience as string, firstName: firstNameFrom(app.full_name) };
  });

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type MemberApplicationsList = { applications: MemberApplication[] };

export const listMemberApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MemberApplicationsList> => {
    await assertAdminView(context as any);
    const { admin, APPLICATION_COLUMNS } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    const { data, error } = await sb
      .from("membership_applications")
      .select(APPLICATION_COLUMNS)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return { applications: (data ?? []) as MemberApplication[] };
  });

export const updateMemberApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        admin_notes: z.string().max(4000).nullable().optional(),
        contact_status: z.enum(["not_contacted", "messaged", "talking"]).optional(),
        flagged: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { admin } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    const { id, ...rest } = data;
    const patch: Record<string, unknown> = { ...rest };
    if (rest.contact_status && rest.contact_status !== "not_contacted") patch.contacted_at = new Date().toISOString();
    if (rest.contact_status === "not_contacted") patch.contacted_at = null;
    const { error } = await sb.from("membership_applications").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ApproveResult =
  | { kind: "invited"; link: string; message: string; emailed: boolean; emailProblem: string | null }
  | { kind: "has_account" }
  | { kind: "coach_record"; clientId: string };

/** Approve: send the activation email, and hand back the link to DM or text. Re-approving re-sends. */
export const approveMemberApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), note: z.string().max(600).optional().nullable() }).parse(i))
  .handler(async ({ data, context }): Promise<ApproveResult> => {
    await assertAdmin(context);
    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const { data: app, error } = await sb
      .from("membership_applications")
      .select("id, email, full_name, status, invite_count, activated_at, decided_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !app) throw new Error("That application is gone.");
    if (app.activated_at) return { kind: "has_account" };

    const account = await m.accountFor(sb, app.email);
    if (account.kind === "staff") throw new Error("That email is a team login. Ask them to apply with a different email.");
    const decided = { status: "approved", flagged: false, decided_at: app.status === "approved" ? app.decided_at ?? new Date().toISOString() : new Date().toISOString(), decided_by: (context as any).userId };
    if (account.kind === "athlete") {
      await sb.from("membership_applications").update({ ...decided, existing_account: true, client_id: account.clientId, user_id: account.loginId }).eq("id", app.id);
      return { kind: "has_account" };
    }
    if (account.kind === "coach_record") {
      await sb.from("membership_applications").update({ ...decided, client_id: account.clientId }).eq("id", app.id);
      return { kind: "coach_record", clientId: account.clientId };
    }
    await sb.from("membership_applications").update(decided).eq("id", app.id);

    const round = (app.invite_count ?? 0) + 1;
    const sent = await m.sendApprovalEmail(sb, app, { round, note: data.note });
    if (sent.sent) {
      await sb.from("membership_applications").update({ invite_sent_at: new Date().toISOString(), invite_count: round }).eq("id", app.id);
    }
    const link = await m.activationLink(app.id);
    return {
      kind: "invited",
      link,
      message: approvedMessage(app, link),
      emailed: sent.sent,
      emailProblem: sent.sent ? null : sent.reason === "suppressed" ? "Their email is on the do-not-email list" : "The email didn't go",
    };
  });

export const declineMemberApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { admin } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    const { error } = await sb
      .from("membership_applications")
      .update({ status: "declined", decided_at: new Date().toISOString(), decided_by: (context as any).userId, code_hash: null })
      .eq("id", data.id)
      .is("activated_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Back to pending (a decline undone, or an approval taken back before they joined). */
export const reopenMemberApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { admin } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    const { data: app } = await sb.from("membership_applications").select("email, activated_at").eq("id", data.id).maybeSingle();
    if (!app) throw new Error("That application is gone.");
    if (app.activated_at) throw new Error("They've already joined.");
    const { data: other } = await sb
      .from("membership_applications")
      .select("id")
      .eq("email", String(app.email).toLowerCase())
      .eq("status", "pending")
      .neq("id", data.id)
      .limit(1)
      .maybeSingle();
    if (other) throw new Error("They have a newer application waiting. Open that one.");
    const { error } = await sb
      .from("membership_applications")
      .update({ status: "pending", decided_at: null, decided_by: null, existing_account: false, code_hash: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The link and a message to paste in a DM or a text (no email proof: they confirm with a code). */
export const getMemberActivationLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const { data: app } = await sb.from("membership_applications").select("id, full_name, status").eq("id", data.id).maybeSingle();
    if (!app || app.status !== "approved") throw new Error("Approve them first.");
    const link = await m.activationLink(app.id);
    return { link, message: approvedMessage(app, link) };
  });

export const resendMemberInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await import("@/lib/membership-applications.server");
    const sb = await m.admin();
    const { data: app } = await sb
      .from("membership_applications")
      .select("id, email, full_name, status, invite_count, activated_at, existing_account")
      .eq("id", data.id)
      .maybeSingle();
    if (!app || app.status !== "approved") throw new Error("Approve them first.");
    if (app.activated_at || app.existing_account) throw new Error("They're already in.");
    const round = (app.invite_count ?? 0) + 1;
    const sent = await m.sendApprovalEmail(sb, app, { round });
    if (!sent.sent) throw new Error(sent.reason === "suppressed" ? "Their email is on the do-not-email list. Send the link by DM or text." : "The email didn't go. Send the link by DM or text.");
    await sb.from("membership_applications").update({ invite_sent_at: new Date().toISOString(), invite_count: round }).eq("id", app.id);
    return { ok: true };
  });

export type JoinFunnel = FunnelCounts & {
  days: number;
  declined: number;
  trained: number;
  started_program: number;
  posted: number;
  coaching_interest: number;
  steps: Record<string, number>;
  sources: Array<{ source: string; count: number }>;
};

export const getJoinFunnel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ days: z.number().int().min(1).max(365) }).parse(i))
  .handler(async ({ data, context }): Promise<JoinFunnel> => {
    await assertAdminView(context as any);
    const { admin } = await import("@/lib/membership-applications.server");
    const sb = await admin();
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: f, error } = await sb.rpc("membership_funnel", { _since: since });
    if (error) throw new Error(error.message);
    const r = (f ?? {}) as any;
    const n = (k: string) => Number(r[k] ?? 0) || 0;
    return {
      days: data.days,
      visitors: n("visitors"),
      starts: n("starts"),
      submitted: n("submitted"),
      pending: n("pending"),
      approved: n("approved"),
      activated: n("activated"),
      engaged: n("engaged"),
      declined: n("declined"),
      trained: n("trained"),
      started_program: n("started_program"),
      posted: n("posted"),
      coaching_interest: n("coaching_interest"),
      steps: (r.steps ?? {}) as Record<string, number>,
      sources: Array.isArray(r.sources) ? r.sources : [],
    };
  });
