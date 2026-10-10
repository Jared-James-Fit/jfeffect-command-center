/**
 * What Cleo can offer to do, who may do it, and how a card reads. Pure:
 * shared by the server (cleo-actions.server.ts) and the chat UI.
 *
 * Cleo never acts on her own. She proposes; the person taps Confirm; it runs
 * with their own session. When it's outside their role it becomes a request
 * the business owner approves (see 20261101090000_cleo_actions.sql).
 */
import { z } from "zod";
import { RECORDABLE_PAYMENT_STATUSES, type Permission } from "@/lib/permissions";
import { PAYMENT_STATUS_DETAILED } from "@/lib/offers";
import { WEEKDAYS, rxSchema } from "@/lib/cleo-program";

export type ActionPermission = Permission | "admin";

/** Same list as createAppointment's (appointments.functions.ts). */
export const CLEO_APPOINTMENT_TYPES = [
  "Coaching Call", "Check-In Call", "Onboarding Call", "Strategy Call",
  "Consultation", "In-Person Session", "Assessment", "Nutrition Review",
  "Program Review", "Custom",
] as const;

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
  update_payment_status: z.object({
    purchase_id: uuid,
    payment_status: z.enum(PAYMENT_STATUS_DETAILED),
    amount_paid: z.number().nonnegative().max(1_000_000).optional().describe("Total paid so far in dollars, if it changed."),
    note: z.string().trim().max(500).optional(),
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
  publish_program: z.object({ block_id: uuid, visible: z.boolean().default(true).describe("true publishes it to the client; false hides it.") }),
  move_workout: z.object({ workout_id: uuid.describe("Scheduled workout id from training_program."), date: ymd }),
  correct_logged_exercise: z.object({
    row_id: uuid.describe("The row the sets were logged against (row id from training_log or program_detail)."),
    exercise_id: uuid.describe("The library exercise they actually did, from exercise_library."),
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
  update_payment_status: { title: "Update a payment", tool: "Change a purchase's payment status (e.g. mark it Paid or Partially Paid). Purchase ids come from the purchases lookup." },
  send_payment_link: { title: "Send a payment link", tool: "Send a client the payment link for an existing purchase by email or text." },
  book_appointment: { title: "Book an appointment", tool: "Book an appointment on the calendar (business time zone), optionally with a client and a video call." },
  assign_program_template: { title: "Assign a program", tool: "Put a client on a program template from the library, starting on a date. Its workouts land on their committed training days." },
  build_program: { title: "Build a program", tool: "Build a new training block for a client from scratch: weeks, days, and library exercises with prescriptions and weekly progression. Hidden from the client unless publish is true." },
  edit_program_day: { title: "Edit a workout", tool: "Change one program day: update prescriptions, swap or add library exercises, remove rows. Can carry the change into the same day in later weeks." },
  add_workout: { title: "Add a workout", tool: "Add a one-off workout with library exercises to a client's program and schedule it on a date." },
  publish_program: { title: "Publish a program", tool: "Make a block visible to the client (publish) or hide it." },
  move_workout: { title: "Move a workout", tool: "Move a scheduled workout to another date." },
  correct_logged_exercise: { title: "Fix a logged exercise", tool: "Correct which exercise a client actually did on a day they already logged (e.g. they did barbell bench instead of the dumbbell incline). Only the exercise changes; every logged set (load, reps, RPE) stays exactly as entered." },
  set_nutrition_targets: { title: "Update nutrition", tool: "Set a client's nutrition targets: calories and macros for each day type, plus phase and notes. Replaces their current day list (or creates their first targets)." },
};

/** What doing it takes. Admins can do all of these; the finance login holds some role permissions. */
export function actionPermission(kind: CleoActionKind, params: any): ActionPermission {
  switch (kind) {
    case "create_task":
    case "complete_task":
      return "tasks.manage";
    case "send_payment_link":
      return "payments.request";
    case "update_payment_status":
      // payments.record covers money in or still owed; a refund, cancellation or comp is the owner's call.
      return (RECORDABLE_PAYMENT_STATUSES as readonly string[]).includes(params?.payment_status) ? "payments.record" : "admin";
    default:
      return "admin";
  }
}

export type Caller = { isAdmin: boolean; permissions: readonly string[] };

/** "run": they can do it themselves. "ask_owner": it needs the business owner's OK. */
export function routeFor(permission: ActionPermission, caller: Caller): "run" | "ask_owner" {
  if (caller.isAdmin) return "run";
  return permission !== "admin" && caller.permissions.includes(permission) ? "run" : "ask_owner";
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
  route: "run" | "ask_owner";
  result: string | null;
  error: string | null;
  requestedBy: string;
  requesterName: string | null;
  createdAt: string;
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
