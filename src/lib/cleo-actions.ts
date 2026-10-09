/**
 * What Cleo can offer to do, who may do it, and how a card reads. Pure:
 * shared by the server (cleo-actions.server.ts) and the chat UI.
 *
 * Cleo never acts on her own. She proposes; the person taps Confirm; it runs
 * with their own session. When it's outside their role it becomes a request
 * the business owner approves (see 20261029090000_cleo_actions.sql).
 */
import { z } from "zod";
import { RECORDABLE_PAYMENT_STATUSES, type Permission } from "@/lib/permissions";
import { PAYMENT_STATUS_DETAILED } from "@/lib/offers";

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
