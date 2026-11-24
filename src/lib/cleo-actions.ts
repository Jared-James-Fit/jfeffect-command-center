/**
 * What Cleo can offer to do, who may do it, and how a card reads. Pure:
 * shared by the server (cleo-actions.server.ts) and the chat UI.
 *
 * Cleo never acts alone: Cleo proposes, the person taps Confirm, and it runs
 * with their own session. A coach's card for their own client becomes a
 * request the business owner approves; approving only authorizes it, and it
 * then runs as the coach (CLEO_ACTION_RULES, 20270507093000). Anything a
 * person's role could never do (money for a coach, anything for a role with no
 * coaching) is never offered to them at all.
 */
import { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { WEEKDAYS, rxSchema } from "@/lib/cleo-program";

/** Stored on a card (cleo_actions.permission); older cards say "admin" or a role permission. */
export type ActionPermission = ActionNeed | Permission | "admin";

/** Same list as createAppointment's (appointments.functions.ts). */
export const CLEO_APPOINTMENT_TYPES = [
  "Coaching Call", "Check-In Call", "Onboarding Call", "Strategy Call",
  "Consultation", "In-Person Session", "Assessment", "Nutrition Review",
  "Program Review", "Custom",
] as const;

/** Ways money comes in by hand (Stripe payments record themselves). */
export const CLEO_PAYMENT_METHODS = ["etransfer", "cash", "cheque", "debit", "credit_card", "bank_transfer", "other"] as const;

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const hm = z.string().regex(/^\d{2}:\d{2}$/, "HH:MM (24h)");

/** An exercise from the library (ids from exercise_library; never invented) with its prescription. */
const programExercise = rxSchema.extend({ exercise_id: uuid.describe("Library exercise id from exercise_library.") });

/** One change to a program day. Fields used depend on `op`. */
const dayChange = rxSchema.extend({
  op: z.enum(["update", "swap", "add", "remove"]).describe("update: change a row's prescription. swap: replace a row's exercise. add: new exercise. remove: delete a row."),
  row_id: uuid.optional().describe("The row to update, swap or remove (row ids from program_detail)."),
  exercise_id: uuid.optional().describe("For swap and add: the library exercise."),
  position: z.number().int().min(0).max(30).optional().describe("For add: where in the day (0 = first). Default last."),
}).superRefine((c, ctx) => {
  if (c.op !== "add" && !c.row_id) ctx.addIssue({ code: "custom", message: `${c.op} needs row_id` });
  if ((c.op === "add" || c.op === "swap") && !c.exercise_id) ctx.addIssue({ code: "custom", message: `${c.op} needs exercise_id` });
});

export const CLEO_ACTION_PARAMS = {
  create_task: z.object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).optional(),
    due_date: ymd.optional(),
  }),
  complete_task: z.object({ task_id: uuid }),
  send_message: z.object({ client_id: uuid, body: z.string().trim().min(1).max(4000) }),
  schedule_message: z.object({ client_id: uuid, body: z.string().trim().min(1).max(4000), date: ymd, time: hm }),
  add_client_note: z.object({
    client_id: uuid,
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  }),
  mark_check_ins_reviewed: z.object({ client_id: uuid }),
  record_payment: z.object({
    purchase_id: uuid,
    amount: z.number().positive().max(1_000_000).describe("Dollars received in this one payment, as the client sent them (tax included)."),
    method: z.enum(CLEO_PAYMENT_METHODS),
    date: ymd.optional().describe("The day it was received; today if left out."),
    includes_tax: z.boolean().default(true).describe("False only when this payment had no GST/HST in it."),
    reference: z.string().trim().max(200).optional().describe("E-transfer confirmation or cheque number."),
  }),
  send_payment_link: z.object({ purchase_id: uuid, via: z.enum(["email", "sms"]) }),
  book_appointment: z.object({
    client_id: uuid.optional(),
    title: z.string().trim().min(1).max(200),
    appointment_type: z.enum(CLEO_APPOINTMENT_TYPES),
    date: ymd,
    time: hm,
    duration_minutes: z.number().int().min(10).max(480).default(60),
    video_call: z.boolean().default(false),
    location: z.string().trim().max(300).optional(),
  }),
  assign_program_template: z.object({
    client_id: uuid,
    template_id: uuid.describe("From program_templates."),
    start_date: ymd,
    name: z.string().trim().min(1).max(80).optional(),
    publish: z.boolean().default(true).describe("Visible to the client right away."),
  }),
  build_program: z
    .object({
      client_id: uuid,
      name: z.string().trim().min(1).max(80),
      start_date: ymd,
      weeks: z.number().int().min(1).max(16),
      training_days: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional().describe("Weekdays the workouts fall on, one per day in `days`. Leave out to use the client's committed training days."),
      days: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(60),
            focus: z.string().trim().max(60).optional(),
            exercises: z
              .array(programExercise.extend({ weeks: z.array(rxSchema.extend({ week: z.number().int().min(1).max(16) })).max(16).optional().describe("Per-week changes for progression (e.g. week 2 RPE 8, week 4 deload). Anything not given repeats the base prescription.") }))
              .min(1)
              .max(14),
          }),
        )
        .min(1)
        .max(7),
      coach_notes: z.string().trim().max(1000).optional(),
      publish: z.boolean().default(false).describe("Visible to the client right away. Default: hidden until published."),
    })
    .superRefine((p, ctx) => {
      if (p.training_days && p.training_days.length !== p.days.length) ctx.addIssue({ code: "custom", message: "training_days needs one weekday per day" });
      if (p.training_days && new Set(p.training_days).size !== p.training_days.length) ctx.addIssue({ code: "custom", message: "training_days repeats a weekday" });
    }),
  edit_program_day: z.object({
    day_id: uuid.describe("From program_detail."),
    scope: z.enum(["this", "future"]).default("this").describe("this: only this day. future: also the same day in later weeks of the block (days the client already started or logged are never touched)."),
    changes: z.array(dayChange).min(1).max(20),
  }),
  add_workout: z.object({
    client_id: uuid,
    date: ymd,
    title: z.string().trim().min(1).max(60),
    focus: z.string().trim().max(60).optional(),
    exercises: z.array(programExercise).min(1).max(14),
    block_id: uuid.optional().describe("Which block it belongs to. Default: their current block."),
  }),
  remove_workout: z
    .object({
      workout_id: uuid.optional().describe("Scheduled workout id from program_detail (\"scheduled workout id\")."),
      day_id: uuid.optional().describe("Or the day id from program_detail."),
    })
    .refine((p) => p.workout_id || p.day_id, "Give workout_id or day_id"),
  publish_program: z.object({ block_id: uuid, visible: z.boolean().default(true).describe("true publishes it to the client; false hides it.") }),
  move_workout: z
    .object({
      workout_id: uuid.optional().describe("Scheduled workout id from training_program, when it has one."),
      day_id: uuid.optional().describe("Or the day id from training_program, for a workout dated on the program itself (no workout id)."),
      date: ymd,
    })
    .refine((p) => p.workout_id || p.day_id, "Give workout_id or day_id"),
  correct_logged_exercise: z.object({
    row_id: uuid.describe("The row the sets were logged against (row id from training_log or program_detail)."),
    exercise_id: uuid.describe("The library exercise they actually did, from exercise_library."),
  }),
  restore_program_version: z.object({
    version_id: uuid.describe("From program_history."),
  }),
  set_nutrition_targets: z.object({
    client_id: uuid,
    days: z
      .array(
        z.object({
          day_label: z.string().trim().min(1).max(50).describe('"Every Day", "Training Day", "Rest Day", "High Day"...'),
          calories: z.number().int().min(800).max(8000),
          protein: z.number().int().min(0).max(600),
          carbs: z.number().int().min(0).max(1200),
          fats: z.number().int().min(0).max(400),
          fibre: z.number().int().min(0).max(150).optional(),
        }),
      )
      .min(1)
      .max(7)
      .describe("Every day type they should have; this replaces the current list."),
    phase: z.enum(["Fat Loss", "Muscle Gain", "Maintenance", "Performance", "Lifestyle Reset", "Reverse Diet", "Recomp"]).optional(),
    coach_notes: z.string().trim().max(2000).optional().describe("Staff-only notes."),
    client_notes: z.string().trim().max(2000).optional().describe("Notes the client sees."),
    water: z.string().trim().max(100).optional(),
  }),
  link_openipf: z.object({
    client_id: uuid,
    url: z
      .string()
      .trim()
      .max(200)
      .regex(/(openipf|openpowerlifting)\.org\/u\/[a-z0-9]+/i, "An openipf.org/u/… or openpowerlifting.org/u/… profile link")
      .describe("Their profile link from the openipf lookup, e.g. https://www.openipf.org/u/marcasugui."),
  }),
} as const;

export type CleoActionKind = keyof typeof CLEO_ACTION_PARAMS;
export type CleoActionParams<K extends CleoActionKind> = z.infer<(typeof CLEO_ACTION_PARAMS)[K]>;

export const CLEO_ACTION_KINDS = Object.keys(CLEO_ACTION_PARAMS) as CleoActionKind[];

export function isCleoActionKind(v: unknown): v is CleoActionKind {
  return typeof v === "string" && (CLEO_ACTION_KINDS as string[]).includes(v);
}

/** Card heading and the tool description Cleo sees. */
export const CLEO_ACTION_INFO: Record<CleoActionKind, { title: string; tool: string }> = {
  create_task: { title: "Add a task", tool: "Add a task to the team board." },
  complete_task: { title: "Complete a task", tool: "Mark a task on the team board done (task ids are in OPEN TASKS)." },
  send_message: { title: "Send a message", tool: "Send a client a message in their coach thread now, from the coach account. Write it in the coach's voice, ready to send." },
  schedule_message: { title: "Schedule a message", tool: "Schedule a message to a client's coach thread for a date and time (business time zone)." },
  add_client_note: { title: "Add a coach note", tool: "Add a note to a client's file (staff only; the client never sees it)." },
  mark_check_ins_reviewed: { title: "Mark check-ins reviewed", tool: "Close everything waiting for review for one client (check-ins, forms, Review Due)." },
  record_payment: { title: "Record a payment", tool: "Record one payment a client made another way than Stripe (an e-transfer, cash, a cheque) on one of their purchases: the amount received, tax included, how and when. It's added to their Billing, the books and GST/HST like any payment; what's paid and owed follow from it (there is no setting a status or a total by hand). Purchase ids come from the purchases lookup. Never for a card payment through Stripe: those record themselves." },
  send_payment_link: { title: "Send a payment link", tool: "Send a client the payment link for an existing purchase by email or text." },
  book_appointment: { title: "Book an appointment", tool: "Book an appointment on the calendar (business time zone), optionally with a client and a video call." },
  assign_program_template: { title: "Assign a program", tool: "Put a client on a program template from the library, starting on a date. Its workouts land on their committed training days." },
  build_program: { title: "Build a program", tool: "Build a new training block for a client from scratch: weeks, days, and library exercises with prescriptions and weekly progression. Hidden from the client unless publish is true." },
  edit_program_day: { title: "Edit a workout", tool: "Change one program day: update prescriptions, swap or add library exercises, remove rows. Use this to add an exercise to a workout they already have (e.g. 'add calf raises at the end of today's workout': op add, scope this, on today's day id). Can carry the change into the same day in later weeks." },
  add_workout: { title: "Add a workout", tool: "Add a separate, extra session on a date (a second workout that day, or a day they had nothing). Never use it to add exercises to a workout they already have; that's edit_program_day." },
  remove_workout: { title: "Delete a workout", tool: "Delete a workout card from a client's calendar. An extra workout card (custom, e.g. one added with add_workout) is deleted completely with its exercises; a regular program day is only taken off the calendar (it stays in the block). Use this when they want a whole workout card gone, not edit_program_day (removing its exercises leaves an empty card). Never for a workout that was started or logged. It can be undone." },
  publish_program: { title: "Publish a program", tool: "Make a block visible to the client (publish) or hide it." },
  move_workout: { title: "Move a workout", tool: "Move a client's workout to another date: by its workout id when training_program lists one, else by its day id (a workout dated on the program itself). Never one that was started or logged." },
  correct_logged_exercise: { title: "Fix a logged exercise", tool: "Correct which exercise a client actually did on a day they already logged (e.g. they did barbell bench instead of the dumbbell incline). Only the exercise changes; every logged set (load, reps, RPE) stays exactly as entered." },
  restore_program_version: { title: "Undo a change", tool: "Undo one of the program or nutrition changes in a client's program history (version ids from program_history): puts days, exercises, dates, visibility or targets back the way they were. Days the client has since started or logged stay as trained." },
  set_nutrition_targets: { title: "Update nutrition", tool: "Set a client's nutrition targets: calories and macros for each day type, plus phase and notes. Replaces their current day list (or creates their first targets)." },
  link_openipf: { title: "Link OpenIPF", tool: "Link a coaching client's OpenIPF (or OpenPowerlifting) profile to their account: their meets come in, stay synced every day, and go in the Hall of Strength. Only a profile the openipf lookup found or the person gave you; never a guess. It can be removed and added back from their profile." },
};

/**
 * What a card needs from the person who asks for it. Never from whoever
 * approves it: the owner's OK only authorizes a request; it never lends the
 * owner's identity or rights to it (20270507093000_cleo_actions_run_as_requester.sql).
 *
 * - "tasks": the team task board (the admin, an active coach, a role with tasks.manage).
 * - "client": coaching work on one client: the admin, or that client's own coach.
 * - "payments.record" / "payments.request": money. The admin, or a role holding the
 *   permission (the finance login). Never a coach, with or without approval.
 * - "owner": the admin only, run as themselves.
 */
export type ActionNeed = "tasks" | "client" | "payments.record" | "payments.request" | "owner";

export type ActionRule = {
  need: ActionNeed;
  /**
   * A coach's card for their own client can be approved by the owner and then
   * runs as the coach: written with the service role after the coach's role and
   * the client's assignment are checked again, every row naming the coach.
   * False when running it goes through the app's request-bound server
   * functions, which would act as whoever tapped Approve: those stay the
   * owner's to do himself.
   */
  approvable: boolean;
};

export const CLEO_ACTION_RULES: Record<CleoActionKind, ActionRule> = {
  create_task: { need: "tasks", approvable: false },
  complete_task: { need: "tasks", approvable: false },
  send_message: { need: "client", approvable: true },
  schedule_message: { need: "client", approvable: true },
  add_client_note: { need: "client", approvable: true },
  mark_check_ins_reviewed: { need: "client", approvable: true },
  build_program: { need: "client", approvable: true },
  edit_program_day: { need: "client", approvable: true },
  publish_program: { need: "client", approvable: true },
  correct_logged_exercise: { need: "client", approvable: true },
  set_nutrition_targets: { need: "client", approvable: true },
  // the database's link function checks the person who taps it: the owner's to do himself
  link_openipf: { need: "owner", approvable: false },
  // These run through server functions bound to the tapper's request (templates,
  // the calendar's scheduled instances, appointments with Google): the owner's.
  assign_program_template: { need: "owner", approvable: false },
  add_workout: { need: "owner", approvable: false },
  remove_workout: { need: "owner", approvable: false },
  move_workout: { need: "owner", approvable: false },
  book_appointment: { need: "owner", approvable: false },
  restore_program_version: { need: "owner", approvable: false },
  // payments.record covers money that came in; a refund, cancellation or comp is the owner's call.
  record_payment: { need: "payments.record", approvable: false },
  send_payment_link: { need: "payments.request", approvable: false },
};

/** What doing it takes (stored on the card as `permission`; the server always re-reads the rule by kind). */
export function actionPermission(kind: CleoActionKind, _params?: unknown): ActionPermission {
  return CLEO_ACTION_RULES[kind].need;
}

/**
 * Who's asking. `permissions` are the role permissions of the person's roles
 * other than coach: a coach role never carries money through Cleo.
 */
export type Caller = { isAdmin: boolean; isCoach?: boolean; permissions: readonly string[] };

/** "run": they do it themselves now. "ask_owner": the owner approves, then it runs as them. "not_allowed": never theirs. */
export type ActionRoute = "run" | "ask_owner" | "not_allowed";

export function routeFor(kind: CleoActionKind, caller: Caller): ActionRoute {
  if (caller.isAdmin) return "run";
  const rule = CLEO_ACTION_RULES[kind];
  switch (rule.need) {
    case "tasks":
      return caller.isCoach || caller.permissions.includes("tasks.manage") ? "run" : "not_allowed";
    case "payments.record":
    case "payments.request":
      return caller.permissions.includes(rule.need) ? "run" : "not_allowed";
    case "client":
      return caller.isCoach && rule.approvable ? "ask_owner" : "not_allowed";
    case "owner":
      return "not_allowed";
  }
}

/** The kinds Cleo offers this person at all. */
export function availableKinds(caller: Caller): CleoActionKind[] {
  return CLEO_ACTION_KINDS.filter((k) => routeFor(k, caller) !== "not_allowed");
}

/** Why a card isn't theirs, in words Cleo can pass on. */
export function notAllowedReason(kind: CleoActionKind, ownerName: string): string {
  switch (CLEO_ACTION_RULES[kind].need) {
    case "payments.record":
    case "payments.request":
      return `Payments are ${ownerName}'s and the finance login's, never a coach's.`;
    case "tasks":
      return "Your role doesn't work the team task board.";
    case "client":
      return "That's coaching work on a client, which only the admin or that client's own coach does.";
    case "owner":
      return `Only ${ownerName} can do this one. Do it in the app, or ask ${ownerName}.`;
  }
}

export type CleoActionStatus = "proposed" | "cancelled" | "awaiting_approval" | "declined" | "running" | "done" | "failed";

/** A card as the chat shows it. */
export type CleoActionView = {
  id: string;
  messageId: string | null;
  kind: CleoActionKind;
  title: string;
  summary: string;
  status: CleoActionStatus;
  /** For a proposal: what Confirm does for this person. */
  route: ActionRoute;
  result: string | null;
  error: string | null;
  requestedBy: string;
  requesterName: string | null;
  createdAt: string;
  /** Where to see it once it's done (an in-app /admin path). */
  link: { href: string; label: string } | null;
  /** Done program/nutrition changes: the restore point in program history. */
  undo: { versionId: string; undone: boolean } | null;
};

/** Proposals go stale: the books, the calendar and the thread move on. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;

export function isStale(createdAt: string, now = Date.now()): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t > PROPOSAL_TTL_MS;
}

export function statusLabel(status: CleoActionStatus, ownerName: string): string {
  switch (status) {
    case "proposed": return "Waiting for you";
    case "cancelled": return "Cancelled";
    case "awaiting_approval": return `Waiting on ${ownerName}`;
    case "declined": return `${ownerName} said no`;
    case "running": return "Working on it…";
    case "done": return "Done";
    case "failed": return "Didn't work";
  }
}
