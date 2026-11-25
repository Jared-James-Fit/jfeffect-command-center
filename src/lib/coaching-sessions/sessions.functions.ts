import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coaching sessions (docs/COACHING_SESSIONS.md). Every read goes through the
 * coach's own login (RLS: their own clients, an admin all), and every write is
 * the server's after the same check (assertReach). Nothing here sends anything
 * to the client except sendSessionSummaryFn, which only the coach's tap calls.
 */

const uuid = z.string().uuid();
const callerOf = (context: unknown) => {
  const { supabase, userId } = context as { supabase: any; userId: string };
  return { supabase, userId };
};


/** The Sessions tab: upcoming events, what Cleo recommends now, sessions, open commitments. */
export const getSessionsHomeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.getSessionsHome(callerOf(context), data);
  });

const prepareInput = z.object({
  clientId: uuid,
  eventKey: z.string().max(120).nullable().optional(),
  customTitle: z.string().trim().max(160).nullable().optional(),
  format: z.enum(["call", "touch_base", "retrospective"]).default("call"),
  minutes: z.number().int().min(5).max(120).nullable().optional(),
  coachNotes: z.string().max(4000).nullable().optional(),
  priorities: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  ptSessionId: uuid.nullable().optional(),
  scheduledAt: z.string().max(40).nullable().optional(),
  /** a key from the app, so a double tap prepares one session */
  key: z.string().max(80).nullable().optional(),
});

/** Prepare a session: the event, the coach's notes, the prep and the agenda, in one tap. */
export const prepareSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => prepareInput.parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.prepareSession(callerOf(context), data);
  });

/** One session: what it's about, the prep (read again while it's ahead), the agenda, commitments. */
export const getSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.getSession(callerOf(context), data);
  });

/** The coach's edits: notes, priorities, length, what's noted in the call, its status. Autosaved. */
export const updateSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: uuid,
        coachNotes: z.string().max(4000).nullable().optional(),
        priorities: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
        minutes: z.number().int().min(5).max(120).optional(),
        live: z
          .object({
            notes: z.string().max(8000).optional(),
            decisions: z.array(z.string().trim().min(1).max(400)).max(30).optional(),
            section: z.string().max(40).optional(),
          })
          .optional(),
        status: z.enum(["ready", "live", "done", "cancelled"]).optional(),
        gamePlan: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.updateSession(callerOf(context), data);
  });

/** Commitments: add one, mark it done or dropped, or edit it. */
export const commitmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: uuid,
        id: uuid.nullable().optional(),
        owner: z.enum(["coach", "athlete"]).optional(),
        text: z.string().trim().min(2).max(400).optional(),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        status: z.enum(["open", "done", "dropped"]).optional(),
        /** keep one Cleo read from the conversation (it's then carried to the next call) */
        confirmed: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.commitment(callerOf(context), data);
  });

/** Send the shared game plan to the athlete, only on the coach's tap, once. */
export const sendSessionSummaryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, text: z.string().trim().min(10).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.sendSessionSummary(callerOf(context), data);
  });

/**
 * The shared screen's data: only what the athlete may see (presentation.ts
 * athleteView), never the coach's notes, priorities, Cleo's reads or earlier
 * follow-ups, so nothing private is even in the shared window's page.
 */
export const getPresentationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.getPresentation(callerOf(context), data);
  });

/* ------------------------------------------------------------------ */
/* Before the call                                                     */

/**
 * Send the pre-call questions in their coach chat, on the coach's tap: the
 * "Before our call" form (native forms engine), asking only what this
 * session is missing (the assignment's ask_keys). Once per ten minutes.
 */
export const sendSessionQuestionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, note: z.string().trim().max(600).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.sendSessionQuestions(callerOf(context), data);
  });

/** Cleo's pre-call brief, written again (in the background). Whoever has Cleo only. */
export const queueBriefFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.queueBrief(callerOf(context), data);
  });

/* ------------------------------------------------------------------ */
/* After the call                                                      */


/**
 * The meeting's notes or transcript (an Otter export, pasted or read on the
 * phone): kept in the private bucket under the client, for as long as the
 * coach chose, and read by Cleo in the background. A recording's transcript
 * needs the coach to confirm the athlete agreed to it being used.
 */
export const importTranscriptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: uuid,
        text: z.string().min(40).max(200_000),
        source: z.enum(["otter", "notes", "other"]),
        consent: z.boolean(),
        retainDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(0)]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.importTranscript(callerOf(context), data);
  });

/** Read the meeting from the coach's own notes (no transcript). */
export const analyseNotesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.analyseNotes(callerOf(context), data);
  });

/**
 * Delete the raw transcript now. With `derived`, also everything Cleo took
 * from it that the coach hasn't kept: the read, undecided recommendations,
 * proposed commitments and intelligence. What the coach confirmed stays
 * unless they remove it too (`all`).
 */
export const deleteTranscriptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, derived: z.enum(["none", "unkept", "all"]).default("none") }).parse(d))
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.deleteTranscript(callerOf(context), data);
  });


/**
 * The coach's decision on a recommendation: approve (or approve as edited),
 * keep what's in place, reject, defer or ask for clarification. An approved
 * training, nutrition or cardio change goes to that plan's own editor as words
 * for Cleo to draft (the coach still reviews and applies it there); nothing
 * here changes a plan.
 */
export const decideRecommendationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid,
        status: z.enum(["approved", "edited", "kept", "rejected", "deferred", "clarify", "proposed"]),
        note: z.string().trim().max(1000).nullable().optional(),
        proposed: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.decideRecommendation(callerOf(context), data);
  });

/**
 * Lasting coaching intelligence: confirm, edit, archive or remove what Cleo
 * proposed from a conversation, or add one by hand. Only confirmed, unexpired
 * lines reach Cleo's other work (client-intel/brief.server.ts).
 */
export const intelligenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: uuid,
        id: uuid.nullable().optional(),
        action: z.enum(["confirm", "edit", "archive", "restore", "remove", "add"]),
        text: z.string().trim().min(3).max(600).optional(),
        kind: z.enum(["goal", "preference", "training_response", "approach", "decision", "technique", "constraint", "achievement", "relationship", "concern", "other"]).optional(),
        permanence: z.enum(["lasting", "temporary"]).optional(),
        expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        visibility: z.enum(["coach", "shareable"]).optional(),
        sessionId: uuid.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ops = await import("./sessions.ops.server");
    return ops.intelligence(callerOf(context), data);
  });
