/**
 * Account headshots and the Crew picture reminder: the app's calls. Each one
 * checks who's asking with the caller's own login first (the client themselves;
 * staff through staffCanReachClient: the admin, or the client's own coach), then
 * does the work as the server (headshots.server.ts). A client never receives who
 * asked for a new headshot or why; a coach viewing as a client only reads.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const evidenceTile = z.object({ eyeTop: z.number().optional(), eyeBottom: z.number().optional() });
const deviceSchema = z
  .object({
    model: z.string().max(80).nullable(),
    delegate: z.enum(["GPU", "CPU"]).nullable().optional(),
    steps: z.array(z.object({ step: z.enum(["blink", "turn_left", "turn_right"]), ms: z.number(), peak: z.number() })).max(6),
    final: z
      .object({ faces: z.number(), faceShare: z.number(), yaw: z.number(), pitch: z.number(), roll: z.number(), brightness: z.number(), sharpness: z.number() })
      .nullable(),
    tiles: z.array(evidenceTile).max(6),
    durationMs: z.number(),
  })
  .nullable();

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function assertStaffFor(supabase: any, userId: string, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
}

/* ---- the client's own ------------------------------------------------ */

/** Where my account headshot stands (or, for a coach viewing as a client, theirs: read only). */
export const getMyHeadshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ viewAsClientId: z.string().uuid().optional(), viewAsUserId: z.string().uuid().optional() }).passthrough().parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    if (data.viewAsClientId) {
      await assertStaffFor(supabase, userId, data.viewAsClientId);
      return { ...(await s.myHeadshot(db, await s.clientById(db, data.viewAsClientId))), preview: true };
    }
    let client = await s.clientForUser(db, userId);
    if (await s.recoverPendingHeadshot(db, client)) client = await s.clientForUser(db, userId);
    return { ...(await s.myHeadshot(db, client)), preview: false };
  });

/** "Remind me later": the Home card and pushes wait for the next reminder moment. */
export const snoozeMyHeadshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    const c = await s.clientForUser(db, userId);
    if (!c || !s.headshotApplies(c)) return { until: null };
    return s.snoozeMyHeadshot(db, c);
  });

/** Open a single-use capture session (the client's own camera). */
export const startMyHeadshotCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ method: z.enum(["guided", "live"]), consent: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    const c = await s.clientForUser(db, userId);
    if (!c || !s.headshotApplies(c)) throw new Error("An account headshot is for coaching clients.");
    return s.startCapture(db, { client: c, actor: userId, method: data.method, consent: data.consent });
  });

/** Send what was captured (the files are already in the session's folder). */
export const submitHeadshotCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ headshotId: z.string().uuid(), device: deviceSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    const { data: h } = await db.from("account_headshots").select("client_id, method, user_id").eq("id", data.headshotId).maybeSingle();
    if (!h || h.user_id !== userId) return { ok: false as const, reason: "missing", message: "That capture isn't there any more. Please try again." };
    // a coach-assisted photo is the coach's own (taken in person) and accepted as they send it
    if (h.method === "coach_assisted") await assertStaffFor(supabase, userId, h.client_id);
    else {
      const c = await s.clientById(db, h.client_id);
      if (!c || c.user_id !== userId || !s.headshotApplies(c)) throw new Error("This capture is no longer linked to your account.");
    }
    return s.submitCapture(db, { headshotId: data.headshotId, actor: userId, device: data.device as any, staffAccepts: h.method === "coach_assisted" });
  });

/** "Ask my coach": a quiet push to their coach (once a day at most), who can take it with them in person. */
export const askCoachForHeadshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    const c = await s.clientForUser(db, userId);
    if (!c || !s.headshotApplies(c)) return { ok: false };
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await db.from("account_headshot_events").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("kind", "help_asked").gte("at", since);
    if ((count ?? 0) > 0) return { ok: true, already: true };
    await s.logHeadshotEvent(db, { clientId: c.id, actor: userId, kind: "help_asked" });
    try {
      const [{ staffUserIdsForClient }, { sendWebPushToUser }] = await Promise.all([import("@/lib/push/app-events.server"), import("@/lib/push/push.server")]);
      const name = c.preferred_name || c.first_name || "A client";
      for (const uid of await staffUserIdsForClient(db, c.id)) {
        await sendWebPushToUser(
          db,
          uid,
          { title: "Account headshot help", body: `${name} asked you to take their account headshot with them.`, url: `/admin/clients/${c.id}?tab=info`, tag: `headshot-help:${c.id}`, data: { kind: "headshot_help" } },
          { category: "check_ins", eventKey: `headshot-help:${c.id}:${since.slice(0, 10)}:${uid}`, priority: "normal" },
        );
      }
    } catch {
      /* the event is recorded; the coach sees it on the client's page */
    }
    return { ok: true, already: false };
  });

/* ---- the Crew picture reminder --------------------------------------- */

export const getCrewPhotoReminder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    return s.crewReminderFor(db, userId);
  });

export const dismissCrewPhotoReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const db = await admin();
    const s = await import("./headshots.server");
    await s.dismissCrewReminder(db, userId);
    return { ok: true };
  });

/* ---- staff ------------------------------------------------------------ */

/** A client's headshot for their coach or an admin: status, the photo waiting, the request, the record. */
export const getClientHeadshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaffFor(supabase, userId, data.clientId);
    const db = await admin();
    const s = await import("./headshots.server");
    await s.recoverPendingHeadshot(db, await s.clientById(db, data.clientId));
    const view = await s.staffView(db, data.clientId, userId);
    const c = await s.clientById(db, data.clientId);
    return { ...view, applies: s.headshotApplies(c), hasLogin: !!c?.user_id, isAdmin: await isAdmin(supabase, userId) };
  });

/** Accept the photo waiting, or ask for another (the note stays private). */
export const decideClientHeadshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ headshotId: z.string().uuid(), decision: z.enum(["accept", "decline"]), note: z.string().max(500).nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const db = await admin();
    const { data: h } = await db.from("account_headshots").select("client_id").eq("id", data.headshotId).maybeSingle();
    if (!h) throw new Error("That headshot isn't there any more.");
    await assertStaffFor(supabase, userId, h.client_id);
    const s = await import("./headshots.server");
    return s.decide(db, { headshotId: data.headshotId, actor: userId, decision: data.decision, note: data.note ?? null });
  });

/** Ask a client for a new headshot. The client sees the standard request; the reason is private. */
export const requestClientHeadshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaffFor(supabase, userId, data.clientId);
    const db = await admin();
    const s = await import("./headshots.server");
    const c = await s.clientById(db, data.clientId);
    if (!c || !s.headshotApplies(c)) throw new Error("A headshot can be asked of a coaching client with a login.");
    await s.openRequest(db, { client: c, kind: "manual", actor: userId, reason: data.reason ?? null });
    return { ok: true };
  });

export const cancelClientHeadshotRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaffFor(supabase, userId, data.clientId);
    const db = await admin();
    const s = await import("./headshots.server");
    await s.cancelRequest(db, data.clientId, userId);
    return { ok: true };
  });

/** A coach taking the photo with the client in person (their own camera, live), accepted as they send it. */
export const startCoachHeadshotCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaffFor(supabase, userId, data.clientId);
    const db = await admin();
    const s = await import("./headshots.server");
    const c = await s.clientById(db, data.clientId);
    if (!c || !s.headshotApplies(c)) throw new Error("A headshot can be taken for a coaching client with a login.");
    return s.startCapture(db, { client: c, actor: userId, method: "coach_assisted", consent: true });
  });

/** What waits on staff: headshots to review, then open requests (the caller's own clients). */
export const listHeadshotQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: a }, { data: co }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
    ]);
    if (!a && !co) return [];
    const db = await admin();
    const s = await import("./headshots.server");
    const { staffUnreachableClients } = await import("@/lib/staff-client-access.server");
    return s.headshotQueue(db, async (ids) => {
      const out = new Set(await staffUnreachableClients(supabase, userId, ids));
      return new Set(ids.filter((i) => !out.has(i)));
    });
  });

/* ---- settings (admin) ------------------------------------------------- */

export const getPhotoReminderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only an admin can change photo reminders.");
    const s = await import("./headshots.server");
    return s.loadPhotoSettings(await admin());
  });

export const savePhotoReminderSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        headshot: z.object({ enabled: z.boolean(), followUpDays: z.array(z.number()).max(6), repeatDays: z.number(), requiredSince: z.string().nullable() }),
        crew: z.object({ enabled: z.boolean(), firstDays: z.number(), secondDays: z.number(), repeatDays: z.number() }),
        evidenceRetentionDays: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only an admin can change photo reminders.");
    const s = await import("./headshots.server");
    return s.savePhotoSettings(await admin(), data);
  });
