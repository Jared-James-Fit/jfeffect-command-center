/**
 * What Cleo may do for a person, in three levels (pure, tested; the database
 * decides: `cleo_has_feature` / `cleo_feature`, 20270509100000_cleo_capabilities_recovery_automation.sql).
 *
 *   assist      every coach and admin, for their own clients: recovery
 *               analysis, drafts on request, program suggestions. The coach
 *               does every action.
 *   automation  a future paid tier (cleo_entitlement_grants: a plan, one
 *               account, a trial or a promo): drafts queued for approval,
 *               routine messages sent automatically, follow-ups. Not sold yet.
 *   owner       the business owner only, never grantable: automated messages
 *               in the owner's private voice and examples, follow-ups timed to
 *               the athlete's training, automation oversight.
 *
 * A grant can never hold an owner capability, so no purchase reaches the
 * owner level. Screens read `cleo_my_capabilities()`; every server path and
 * the background job ask the database again.
 */

export type CapabilityLevel = "assist" | "automation" | "owner";

export type CapabilityFeature = { key: string; level: CapabilityLevel; label: string; description: string };

/** Mirrors the migration's seed (capability catalog test keeps them equal). */
export const CAPABILITY_FEATURES: readonly CapabilityFeature[] = [
  { key: "assist.recovery_analysis", level: "assist", label: "Recovery reports", description: "Structured pain reports, their history, trends, warning signs and what to consider." },
  { key: "assist.message_drafts", level: "assist", label: "Message drafts", description: "A reply drafted on request for the coach to edit and send." },
  { key: "assist.program_suggestions", level: "assist", label: "Program suggestions", description: "Proposed changes to a program, reviewed and applied by the coach." },
  { key: "automation.approval_queue", level: "automation", label: "Approval queue", description: "Replies drafted as reports come in, waiting for the coach's approval." },
  { key: "automation.auto_send", level: "automation", label: "Automatic routine messages", description: "Routine, low-risk replies sent automatically under the coach's rules." },
  { key: "automation.follow_ups", level: "automation", label: "Follow-ups", description: "A short follow-up a few days after a report." },
  { key: "owner.voice", level: "owner", label: "Private voice", description: "Automated messages written in the owner's own voice and approved examples." },
  { key: "owner.training_aware", level: "owner", label: "Training-aware follow-ups", description: "Follow-ups timed before the athlete's next session that loads the area, with their program read in." },
  { key: "owner.controls", level: "owner", label: "Automation oversight", description: "Capability management, audit history, pause and rollback controls." },
];

export type FeatureKey = (typeof CAPABILITY_FEATURES)[number]["key"];

export const LEVEL_ORDER: readonly CapabilityLevel[] = ["assist", "automation", "owner"];

export const LEVEL_COPY: Record<CapabilityLevel, { name: string; who: string; line: string }> = {
  assist: {
    name: "Assist",
    who: "Every coach",
    line: "Reports, trends, drafts and suggestions. The coach sends every message and makes every change.",
  },
  automation: {
    name: "Automation",
    who: "Not offered yet",
    line: "Replies drafted as reports come in, routine ones sent under the coach's rules, follow-ups. Planned as a paid add-on; nobody has it.",
  },
  owner: {
    name: "Owner",
    who: "You only",
    line: "Everything above, plus your own voice and examples, follow-ups timed to each athlete's training, and oversight of every automation. Never sold.",
  },
};

export function levelOfFeature(key: string): CapabilityLevel | null {
  const level = key.split(".")[0];
  return (LEVEL_ORDER as readonly string[]).includes(level) ? (level as CapabilityLevel) : null;
}

/** Can a plan, an account, a trial or a promo hold it? Never an owner capability. */
export function grantable(key: string): boolean {
  const level = levelOfFeature(key);
  return level === "assist" || level === "automation";
}

/** A person's level from the capabilities they have (the highest one held). */
export function capabilityLevel(features: readonly string[]): CapabilityLevel | "none" {
  const levels = new Set(features.map(levelOfFeature).filter(Boolean));
  if (levels.has("owner")) return "owner";
  if (levels.has("automation")) return "automation";
  if (levels.has("assist")) return "assist";
  return "none";
}

export type MyCapabilities = { level: CapabilityLevel | "none"; features: string[] };

export function readCapabilities(raw: unknown): MyCapabilities {
  const r = (raw ?? {}) as { level?: unknown; features?: unknown };
  const features = Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string") : [];
  return { level: capabilityLevel(features), features };
}

export function hasFeature(caps: MyCapabilities | null | undefined, key: FeatureKey): boolean {
  return !!caps?.features.includes(key);
}
