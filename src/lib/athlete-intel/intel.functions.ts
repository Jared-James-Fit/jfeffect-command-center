/**
 * Athlete Intelligence's server functions (Nov 26 2026). Staff ones check that
 * the signed-in staff member reaches the athlete (the admin, the athlete's own
 * coach, or their handler during the handling's access window) before the
 * service role reads or writes anything. The share-link ones are public: the
 * link (only its hash is stored) names one athlete and one role, lets that
 * person add information and answer what's asked of them, and shows nothing
 * else. Nothing here contacts anyone by itself or changes an approved
 * gameplan, a program or an official attempt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_VIDEO_BYTES, RIGHTS_TEXT } from "./uploads";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function reach(context: any, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(context.supabase, context.userId, clientId);
}
async function sourceClient(sb: any, sourceId: string) {
  const { data } = await sb.from("athlete_intel_sources").select("id, client_id, competition_id, status, file_path, kind, status_before_delete").eq("id", sourceId).maybeSingle();
  if (!data) throw new Error("That file isn't there any more");
  return data;
}

const uuid = z.string().uuid();
const PROVIDERS = ["primary_coach", "athlete", "handler", "other_coach", "other", "unknown"] as const;
const PURPOSES = ["program", "logs", "competition_history", "event_logistics", "coach_recommendations", "warmups", "attempts", "technical", "other"] as const;
const fileMeta = z.object({
  name: z.string().trim().min(1).max(200),
  size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  type: z.string().max(120).optional().default(""),
  hash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
});
const extracted = z
  .object({
    text: z.string().max(200_000),
    sheets: z
      .array(z.object({ name: z.string().max(120), rows: z.array(z.array(z.string().max(500)).max(60)).max(2000) }))
      .max(40)
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

/* ------------------------------------------------------------------ */
/* The read                                                           */

export const getIntelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid, competitionId: uuid.nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await reach(context, data.clientId);
    const sb = await admin();
    const s = await import("./intel.server");
    // a source that waited for AI permission is read once it's given
    const { data: waiting } = await sb.from("athlete_intel_sources").select("id").eq("client_id", data.clientId).eq("status", "waiting_consent").limit(20);
    if (waiting?.length) {
      const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
      if ((await clientAllowsAi(data.clientId)).ok)
        await sb.from("athlete_intel_sources").update({ status: "queued", error: null }).in("id", waiting.map((w: any) => w.id));
    }
    return s.loadIntel(sb, data.clientId, data.competitionId ?? null, { staffView: true });
  });

/* ------------------------------------------------------------------ */
/* Adding information                                                 */

const addBase = z.object({
  clientId: uuid,
  competitionId: uuid.nullable().optional(),
  provider: z.enum(PROVIDERS).default("unknown"),
  providerName: z.string().trim().max(120).nullable().optional(),
  purposes: z.array(z.enum(PURPOSES)).max(9).default([]),
  context: z.string().trim().max(1000).nullable().optional(),
});

/** Files: a source row each and a one-time upload link (the bucket takes nothing else); a file already on file is said, not read twice. */
export const startUploadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    addBase.extend({ files: z.array(fileMeta).min(1).max(12), rightsConfirmed: z.literal(true), replacesId: uuid.nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await reach(context, data.clientId);
    const sb = await admin();
    if (data.competitionId) {
      const { data: c } = await sb.from("competitions").select("client_id").eq("id", data.competitionId).maybeSingle();
      if (c?.client_id !== data.clientId) throw new Error("That competition isn't this athlete's");
    }
    const s = await import("./intel.server");
    return s.startUploads(sb, {
      clientId: data.clientId,
      competitionId: data.competitionId ?? null,
      provider: data.provider,
      providerName: data.providerName ?? null,
      purposes: data.purposes,
      context: data.context ?? null,
      files: data.files,
      uploadedBy: context.userId,
      viaLinkId: null,
      replacesId: data.replacesId ?? null,
    });
  });


/** The file is up: what the phone read from it (spreadsheets, Word, text) goes with it, and it's queued. */
export const finishUploadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sourceId: uuid, extracted, failed: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const src = await sourceClient(sb, data.sourceId);
    await reach(context, src.client_id);
    const s = await import("./intel.server");
    return s.finishUpload(sb, src, data);
  });


/** Typed or pasted information (no file): read like a note. */
export const addNoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addBase.extend({ text: z.string().trim().min(2).max(50_000) }).parse(d))
  .handler(async ({ data, context }) => {
    await reach(context, data.clientId);
    const sb = await admin();
    const s = await import("./intel.server");
    const { data: row, error } = await sb
      .from("athlete_intel_sources")
      .insert({
        client_id: data.clientId,
        competition_id: data.competitionId ?? null,
        kind: "manual",
        file_name: null,
        provider: data.provider,
        provider_name: data.providerName ?? null,
        purposes: data.purposes,
        context: data.context ?? null,
        source_text: data.text,
        status: "queued",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await s.logIntel(sb, { clientId: data.clientId, competitionId: data.competitionId ?? null, sourceId: row.id, actorId: context.userId, actor: "coach", action: "note_added" });
    return { sourceId: row.id };
  });

/* ------------------------------------------------------------------ */
/* Managing sources                                                   */

export const sourceActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sourceId: uuid,
        action: z.enum(["retry", "delete", "restore", "restore_version", "update"]),
        provider: z.enum(PROVIDERS).optional(),
        providerName: z.string().trim().max(120).nullable().optional(),
        purposes: z.array(z.enum(PURPOSES)).max(8).optional(),
        context: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const src = await sourceClient(sb, data.sourceId);
    await reach(context, src.client_id);
    const s = await import("./intel.server");
    const now = new Date().toISOString();
    if (data.action === "retry") {
      await sb.from("athlete_intel_sources").update({ status: "queued", attempts: 0, error: null, retry_at: null, progress: null }).eq("id", src.id).in("status", ["failed", "waiting_ai", "waiting_consent", "ready", "stored"]);
    } else if (data.action === "delete") {
      if (src.status === "deleted") return { ok: true };
      await sb.from("athlete_intel_sources").update({ status: "deleted", status_before_delete: src.status, deleted_at: now, deleted_by: context.userId }).eq("id", src.id);
      await s.afterChange(sb, src.client_id);
    } else if (data.action === "restore") {
      if (src.status !== "deleted") return { ok: true };
      await sb.from("athlete_intel_sources").update({ status: src.status_before_delete ?? "ready", deleted_at: null, deleted_by: null }).eq("id", src.id);
      await s.afterChange(sb, src.client_id);
    } else if (data.action === "restore_version") {
      // an older version back: the one that replaced it steps aside (kept as history)
      if (src.status !== "replaced") return { ok: true };
      const { data: cur } = await sb.from("athlete_intel_sources").select("id").eq("replaces_id", src.id).not("status", "in", "(deleted,replaced)").limit(5);
      for (const c of (cur ?? []) as any[]) await sb.from("athlete_intel_sources").update({ status: "replaced", replaced_by: src.id }).eq("id", c.id);
      await sb.from("athlete_intel_sources").update({ status: "ready", replaced_by: null }).eq("id", src.id);
      await s.afterChange(sb, src.client_id);
    } else if (data.action === "update") {
      const patch: Record<string, unknown> = {};
      if (data.provider) patch.provider = data.provider;
      if (data.providerName !== undefined) patch.provider_name = data.providerName;
      if (data.purposes) patch.purposes = data.purposes;
      if (data.context !== undefined) patch.context = data.context;
      // who it's from and what it's for change how it's read: read again
      const { error } = await sb.from("athlete_intel_sources").update({ ...patch, ...(["ready", "waiting_consent", "failed"].includes(src.status) ? { status: "queued", attempts: 0, error: null, retry_at: null, progress: null } : {}) }).eq("id", src.id);
      if (error) throw new Error(error.message);
    }
    await s.logIntel(sb, { clientId: src.client_id, competitionId: src.competition_id, sourceId: src.id, actorId: context.userId, actor: "coach", action: `source_${data.action}` });
    return { ok: true };
  });

/** A file's original, to open (a short-lived link, only for staff who reach the athlete). */
export const sourceFileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sourceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const src = await sourceClient(sb, data.sourceId);
    await reach(context, src.client_id);
    if (!src.file_path) return { url: null };
    const s = await import("./intel.server");
    const { data: signed } = await sb.storage.from(s.INTEL_BUCKET).createSignedUrl(src.file_path, 300);
    return { url: signed?.signedUrl ?? null };
  });

/* ------------------------------------------------------------------ */
/* Facts                                                              */

export const factActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        factId: uuid,
        action: z.enum(["dismiss", "restore", "correct"]),
        data: z.record(z.string(), z.unknown()).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: f } = await sb.from("athlete_intel_facts").select("id, client_id, kind, data").eq("id", data.factId).maybeSingle();
    if (!f) throw new Error("That isn't there any more");
    await reach(context, f.client_id);
    const s = await import("./intel.server");
    if (data.action === "correct") {
      const { cleanCorrection } = await import("./uploads");
      const next = cleanCorrection(f.kind, f.data, data.data ?? {});
      if (!next) throw new Error("That correction doesn't read: check the numbers");
      return s.correctFact(sb, f.id, next, { ...(data.date !== undefined ? { date: data.date } : {}) }, context.userId);
    }
    await s.setFactDismissed(sb, f.id, data.action === "dismiss", context.userId);
    return { id: f.id };
  });

/* ------------------------------------------------------------------ */
/* Questions                                                          */

const answer = z.object({
  value: z.string().min(1).max(60),
  number: z.number().min(1).max(600).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export const answerQuestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => answer.extend({ questionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: q } = await sb.from("athlete_intel_questions").select("*").eq("id", data.questionId).maybeSingle();
    if (!q) throw new Error("That question isn't there any more");
    await reach(context, q.client_id);
    if (q.status !== "open") return { ok: true, already: true };
    const s = await import("./intel.server");
    await s.answerQuestion(sb, q, data, { userId: context.userId, role: "handler" });
    return { ok: true };
  });

/** A short request for one answer, ready for the handler to send: to the athlete in their chat (on the handler's tap), or to their coach with a share link to answer on. */
export const requestAnswerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ questionId: uuid, to: z.enum(["athlete", "primary_coach"]), send: z.boolean().default(false), text: z.string().trim().max(800).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: q } = await sb.from("athlete_intel_questions").select("*").eq("id", data.questionId).maybeSingle();
    if (!q) throw new Error("That question isn't there any more");
    await reach(context, q.client_id);
    const s = await import("./intel.server");
    const [{ data: client }, { data: h }, { data: me }] = await Promise.all([
      sb.from("clients").select("id, user_id, first_name, preferred_name, full_name").eq("id", q.client_id).maybeSingle(),
      sb.from("competition_handling").select("share_with_coach, existing_coach, status").eq("competition_id", q.competition_id).maybeSingle(),
      sb.from("coaches").select("first_name").eq("user_id", context.userId).maybeSingle(),
    ]);
    const first = String(client?.preferred_name || client?.first_name || String(client?.full_name ?? "").split(" ")[0] || "there");
    if (data.to === "primary_coach") {
      if (h?.share_with_coach !== "yes") throw new Error(`${first} hasn't said their coach may be contacted. Ask ${first} instead.`);
      const link = await s.createLink(sb, { clientId: q.client_id, competitionId: q.competition_id, role: "primary_coach", name: h?.existing_coach?.name ?? null, userId: context.userId });
      const text = s.draftRequest(q, { athleteFirst: first, coachName: h?.existing_coach?.name ?? null, to: "primary_coach", handlerFirst: me?.first_name ?? null, link: link.url });
      await sb.from("athlete_intel_questions").update({ asked_via: "coach_link", asked_at: new Date().toISOString() }).eq("id", q.id);
      return { text, link: link.url, sent: false, contact: h?.existing_coach?.contact ?? null };
    }
    const text = data.text?.trim() || s.draftRequest(q, { athleteFirst: first, to: "athlete", handlerFirst: me?.first_name ?? null });
    if (!data.send) return { text, link: null, sent: false, contact: null };
    if (!client?.user_id) throw new Error(`${first} has no login yet: send it to them another way`);
    const now = new Date().toISOString();
    const { error } = await sb.from("messages").insert({
      client_id: q.client_id,
      sender_id: context.userId,
      sender_role: "admin",
      body: text,
      message_type: "Competition",
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: now,
      read_by_admin_at: now,
    });
    if (error) throw new Error(error.message);
    await sb.from("athlete_intel_questions").update({ asked_via: "athlete_chat", asked_at: now }).eq("id", q.id);
    await s.logIntel(sb, { clientId: q.client_id, competitionId: q.competition_id, questionId: q.id, actorId: context.userId, actor: "coach", action: "question_asked", detail: { to: "athlete" } });
    return { text, link: null, sent: true, contact: null };
  });

/* ------------------------------------------------------------------ */
/* Recommendations                                                    */

export const applyRecommendationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid, keys: z.array(z.string().max(80)).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: c } = await sb.from("competitions").select("client_id").eq("id", data.competitionId).maybeSingle();
    if (!c) throw new Error("Competition not found");
    await reach(context, c.client_id);
    const s = await import("./intel.server");
    const v = await s.applyRecommendations(sb, data.competitionId, data.keys, context.userId);
    return { version: v?.version ?? null };
  });

/* ------------------------------------------------------------------ */
/* Share links                                                        */

export const createLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: uuid,
        competitionId: uuid.nullable().optional(),
        role: z.enum(["primary_coach", "athlete", "other_coach"]),
        name: z.string().trim().max(120).nullable().optional(),
        athleteAgreed: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await reach(context, data.clientId);
    const sb = await admin();
    if (data.role !== "athlete") {
      // their own coach is contacted only when the athlete said so
      const { data: h } = data.competitionId
        ? await sb.from("competition_handling").select("share_with_coach, status").eq("competition_id", data.competitionId).maybeSingle()
        : { data: null };
      const ok = h && h.status !== "cancelled" ? h.share_with_coach === "yes" : !!data.athleteAgreed;
      if (!ok) throw new Error("The athlete hasn't agreed to their coach being contacted yet");
    }
    const s = await import("./intel.server");
    return s.createLink(sb, { clientId: data.clientId, competitionId: data.competitionId ?? null, role: data.role, name: data.name ?? null, userId: context.userId });
  });

export const revokeLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ linkId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: l } = await sb.from("athlete_intel_links").select("id, client_id, competition_id").eq("id", data.linkId).maybeSingle();
    if (!l) return { ok: true };
    await reach(context, l.client_id);
    await sb.from("athlete_intel_links").update({ revoked_at: new Date().toISOString() }).eq("id", l.id);
    const s = await import("./intel.server");
    await s.logIntel(sb, { clientId: l.client_id, competitionId: l.competition_id, actorId: context.userId, actor: "coach", action: "link_revoked" });
    return { ok: true };
  });

/* Public: the share page ----------------------------------------- */


export const getShareFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const s = await import("./intel.server");
    const { sb, state, row } = await s.openLink(data.token, false);
    if (state !== "ok" || !row) return { state: state === "ok" ? "invalid" : state };
    const [{ data: c }, { data: comp }] = await Promise.all([
      sb.from("clients").select("first_name, preferred_name, full_name").eq("id", row.client_id).maybeSingle(),
      row.competition_id ? sb.from("competitions").select("name, meet_date").eq("id", row.competition_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!row.opened_at) await sb.from("athlete_intel_links").update({ opened_at: new Date().toISOString() }).eq("id", row.id);
    return {
      state: "ok" as const,
      first: String(c?.preferred_name || c?.first_name || String(c?.full_name ?? "").split(" ")[0] || "the athlete"),
      meet: comp ? { name: comp.name, date: String(comp.meet_date).slice(0, 10) } : null,
      role: row.role as "primary_coach" | "athlete" | "other_coach",
      name: row.name ?? null,
      questions: await s.questionsForRole(sb, row.client_id, row.competition_id, row.role),
      rightsText: RIGHTS_TEXT,
    };
  });

export const startShareUploadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().max(200), files: z.array(fileMeta).min(1).max(8), rightsConfirmed: z.literal(true), name: z.string().trim().max(120).nullable().optional(), context: z.string().trim().max(1000).nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sb, state, row } = await (await import("./intel.server")).openLink(data.token, true);
    if (state !== "ok" || !row) throw new Error("This link doesn't work any more");
    const { rateOk } = await import("@/lib/public-rate-limit.server");
    if (!(await rateOk(sb, `intel_share_link:${row.id}`, 40, "1 day"))) throw new Error("That's the most this link takes in a day");
    const s = await import("./intel.server");
    const r = await s.startUploads(sb, {
      clientId: row.client_id,
      competitionId: row.competition_id,
      provider: row.role,
      providerName: data.name?.trim() || row.name || null,
      purposes: [],
      context: data.context ?? null,
      files: data.files,
      uploadedBy: null,
      viaLinkId: row.id,
      replacesId: null,
    });
    await sb.from("athlete_intel_links").update({ last_used_at: new Date().toISOString(), uploads: (row.uploads ?? 0) + r.files.filter((f) => f.sourceId).length }).eq("id", row.id);
    return r;
  });

export const finishShareUploadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().max(200), sourceId: uuid, extracted, failed: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { sb, state, row } = await (await import("./intel.server")).openLink(data.token, true);
    if (state !== "ok" || !row) throw new Error("This link doesn't work any more");
    const src = await sourceClient(sb, data.sourceId);
    const { data: mine } = await sb.from("athlete_intel_sources").select("via_link_id").eq("id", src.id).maybeSingle();
    if (mine?.via_link_id !== row.id) throw new Error("That file isn't from this link");
    const s = await import("./intel.server");
    return s.finishUpload(sb, src, data);
  });

export const shareNoteFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().max(200), text: z.string().trim().min(2).max(20_000), name: z.string().trim().max(120).nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    const s = await import("./intel.server");
    const { sb, state, row } = await s.openLink(data.token, true);
    if (state !== "ok" || !row) throw new Error("This link doesn't work any more");
    const { data: src, error } = await sb
      .from("athlete_intel_sources")
      .insert({
        client_id: row.client_id,
        competition_id: row.competition_id,
        kind: "manual",
        provider: row.role,
        provider_name: data.name?.trim() || row.name || null,
        source_text: data.text,
        status: "queued",
        via_link_id: row.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await s.logIntel(sb, { clientId: row.client_id, competitionId: row.competition_id, sourceId: src.id, actor: "contributor", action: "note_added", detail: { role: row.role } });
    return { ok: true };
  });

export const answerShareFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => answer.extend({ token: z.string().max(200), questionId: uuid }).parse(d))
  .handler(async ({ data }) => {
    const s = await import("./intel.server");
    const { sb, state, row } = await s.openLink(data.token, true);
    if (state !== "ok" || !row) throw new Error("This link doesn't work any more");
    const { data: q } = await sb.from("athlete_intel_questions").select("*").eq("id", data.questionId).eq("client_id", row.client_id).maybeSingle();
    if (!q || q.status !== "open" || !(q.ask_who ?? []).includes(row.role)) throw new Error("That question has already been settled");
    await s.answerQuestion(sb, q, data, { userId: null, role: row.role });
    return { ok: true };
  });

/** Apply only a selected, still-current field from a private meet source. */
export const applyMeetFileFactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitionId: uuid, factId: uuid, before: z.string().max(200).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: c } = await sb.from("competitions").select("client_id").eq("id", data.competitionId).maybeSingle();
    if (!c) throw new Error("Competition not found");
    await reach(context, c.client_id);
    const { error } = await sb.rpc("apply_competition_file_fact", { _actor: context.userId, _competition: data.competitionId, _fact: data.factId, _before: data.before });
    if (error) throw new Error(error.message);
    const { applySchedule } = await import("@/lib/competition/worker.server");
    await applySchedule(sb, data.competitionId);
    return { ok: true };
  });


/** Coach-reviewed batch: one transaction, one schedule refresh, no AI write. */
export const applyMeetFileFactsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    competitionId: uuid,
    updates: z.array(z.object({
      factId: uuid,
      before: z.string().max(200).nullable(),
      extracted: z.string().min(1).max(200),
      value: z.string().trim().min(1).max(160),
    })).min(1).max(30),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: c } = await sb.from("competitions").select("client_id").eq("id", data.competitionId).maybeSingle();
    if (!c) throw new Error("Competition not found");
    await reach(context, c.client_id);
    const { data: count, error } = await sb.rpc("apply_competition_file_facts", { _actor: context.userId, _competition: data.competitionId, _updates: data.updates });
    if (error) throw new Error(error.message);
    let scheduleWarning = false;
    try {
      const { applySchedule } = await import("@/lib/competition/worker.server");
      await applySchedule(sb, data.competitionId);
    } catch {
      scheduleWarning = true;
    }
    return { ok: true, count: Number(count ?? 0), scheduleWarning };
  });
