// Shared membership/account-type metadata used by admin UI and portal.

export const ACCOUNT_TYPES = {
  app_member:   { label: "App Member",     tone: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
  program_only: { label: "Program-Only",   tone: "bg-violet-500/10 text-violet-300 border-violet-500/30" },
  jf_member:    { label: "JF Membership",  tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
} as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;

// Access-level keys we know about (string-typed so DB additions don't break compile).
export const COACHING_FEATURES = [
  { key: "coaching_chat",           label: "1:1 Coaching Chat" },
  { key: "custom_programming",      label: "Custom workout programming" },
  { key: "custom_nutrition",        label: "Custom nutrition targets" },
  { key: "weekly_review",           label: "Weekly check-in review" },
  { key: "lift_review",             label: "Lift review feedback" },
  { key: "coach_review_queue",      label: "Coach review queue" },
  { key: "private_coach_notes",     label: "Private coach notes" },
  { key: "personal_sms_followups",  label: "Personal SMS follow-ups" },
] as const;

// Friendly labels for JF default access levels (used in the setup checklist).
export const DEFAULT_ACCESS_LABELS: Record<string, string> = {
  jf_membership:    "JF Membership badge",
  app_membership:   "App member portal access",
  program_library:  "Plan / Program Library",
  resource_library: "Resource Library",
  nutrition_tools:  "Nutrition tools & education",
  community:        "Community, group chats & announcements",
};

export const INACTIVE_STATUSES = ["Past Due", "Cancelled", "Expired", "Deactivated"];
export function isSubscriptionActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return !INACTIVE_STATUSES.includes(status);
}