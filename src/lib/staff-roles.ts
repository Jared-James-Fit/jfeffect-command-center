/**
 * The staff roles, in one place: what each one is for, what it can and can't
 * see, and how someone gets it. The Team page, the invite server functions
 * and the setup page all read from here.
 */

export type StaffRoleKey = "admin" | "coach" | "finance" | "media_manager";

/** Roles an admin can send a staff invite link for. */
export const INVITABLE_ROLES = ["finance"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string | null | undefined): role is InvitableRole {
  return !!role && (INVITABLE_ROLES as readonly string[]).includes(role);
}

export type StaffRoleInfo = {
  key: StaffRoleKey;
  label: string;
  /** One line under the name. */
  summary: string;
  can: string[];
  cannot: string[];
  /** How someone gets this role. */
  setup: "invite" | "people" | "owner_only" | "retired";
  /** Shown on the setup page and in the invite message. */
  welcome?: string;
  requiresAuthenticator?: boolean;
};

export const STAFF_ROLE_INFO: Record<StaffRoleKey, StaffRoleInfo> = {
  finance: {
    key: "finance",
    label: "Finance",
    summary: "Bookkeeper. The books and nothing else.",
    can: [
      "See revenue and payments",
      "Taxes & Books: expenses, receipts, GST/HST, tax payments",
      "Add and edit expenses, snap receipts, record tax payments",
      "Download reports for the accountant",
    ],
    cannot: [
      "See clients' training, nutrition, check-ins or messages",
      "Refund, comp or cancel anything",
      "Delete records",
    ],
    setup: "invite",
    welcome: "You'll have the books: revenue, expenses, receipts and taxes.",
    requiresAuthenticator: true,
  },
  coach: {
    key: "coach",
    label: "Coach",
    summary: "Coaches the clients you assign them.",
    can: [
      "Training, check-ins, nutrition and messages for their assigned clients",
      "Programs and the exercise library",
    ],
    cannot: [
      "See other coaches' clients",
      "See the books or payments",
    ],
    setup: "people",
  },
  admin: {
    key: "admin",
    label: "Admin",
    summary: "Everything. Only you.",
    can: ["Everything in the app"],
    cannot: [],
    setup: "owner_only",
  },
  media_manager: {
    key: "media_manager",
    label: "Media Manager",
    summary: "Retired. The Media workspace was removed.",
    can: [],
    cannot: ["This role no longer has a workspace to sign in to"],
    setup: "retired",
  },
};

/** Order on the Team page. */
export const STAFF_ROLE_ORDER: StaffRoleKey[] = ["finance", "coach", "admin", "media_manager"];

export function staffRoleLabel(role: string | null | undefined): string {
  return (role && STAFF_ROLE_INFO[role as StaffRoleKey]?.label) || "Staff";
}

/** "Expires in 3 days" / "Expires today" / "Expired". */
export function inviteExpiryLabel(expiresAt: string | null | undefined, now = Date.now()): string {
  if (!expiresAt) return "No expiry";
  const ms = Date.parse(expiresAt) - now;
  if (Number.isNaN(ms)) return "No expiry";
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export type InviteDelivery = "messenger" | "sms" | "link";

export const INVITE_TTL_DAYS = 7;

/** The Messenger text that goes with the setup card. Plain, short, no jargon. */
export function staffInviteMessage(opts: { firstName: string; role: InvitableRole; email: string }): string {
  const info = STAFF_ROLE_INFO[opts.role];
  const name = opts.firstName.trim() || "there";
  return [
    `Hey ${name}! I set you up with a JF Effect team account (${info.label}). ${info.welcome ?? ""}`.trim(),
    `It's a separate login from this one. You'll sign in with ${opts.email}.`,
    `Tap the card below to create your password. The link works for ${INVITE_TTL_DAYS} days.`,
  ].join("\n\n");
}
