/**
 * What Cleo and the app's automation may do, by who's asking (pure, tested in
 * coach-platform-seat-pricing.test.ts). The rule for independent coaches,
 * written down before they exist so the org work builds to it:
 *
 *   - Insight, analysis and drafts: any coach with Cleo, on their own clients.
 *   - Anything that reaches a client or changes their training, nutrition or
 *     money without a person approving it first: the platform owner only.
 *     Today nothing in the app does that for anyone (every Cleo action is a
 *     card the owner approves; every AI draft is reviewed), and an independent
 *     coach never gets it, whatever their own organization's settings say.
 *   - Platform administration: the platform owner only, never a coach, never
 *     an organization's own owner.
 *
 * Enforcement lives in the database and the server (cleo_allowed(),
 * assertCleo, the org checks in docs/COACHING_PLATFORM.md); this list is what
 * those checks implement, and what the owner's Coach platform page shows.
 */

export type Principal = "platform_owner" | "jf_coach" | "independent_coach";

export type Capability = {
  key: string;
  label: string;
  /** Who may have it. */
  allowed: readonly Principal[];
  /** Acts without a person approving each time. */
  autonomous: boolean;
};

export const CAPABILITIES: readonly Capability[] = [
  { key: "insights", label: "Progress summaries and insights", allowed: ["platform_owner", "jf_coach", "independent_coach"], autonomous: false },
  { key: "film", label: "Film review and bar speed", allowed: ["platform_owner", "jf_coach", "independent_coach"], autonomous: false },
  { key: "checkin_reads", label: "Check-in and form reads", allowed: ["platform_owner", "jf_coach", "independent_coach"], autonomous: false },
  { key: "drafts", label: "Program, nutrition and message drafts the coach reviews", allowed: ["platform_owner", "jf_coach", "independent_coach"], autonomous: false },
  { key: "suggestions", label: "Workout and nutrition suggestions the coach approves", allowed: ["platform_owner", "jf_coach", "independent_coach"], autonomous: false },
  { key: "auto_replies", label: "Chat replies sent without approval", allowed: ["platform_owner"], autonomous: true },
  { key: "auto_programming", label: "Program changes applied without approval", allowed: ["platform_owner"], autonomous: true },
  { key: "auto_nutrition", label: "Nutrition changes applied without approval", allowed: ["platform_owner"], autonomous: true },
  { key: "business_automation", label: "Business automation and workflow orchestration", allowed: ["platform_owner"], autonomous: true },
  { key: "platform_admin", label: "Platform settings, every organization, revenue", allowed: ["platform_owner"], autonomous: false },
];

export function can(principal: Principal, key: string): boolean {
  const c = CAPABILITIES.find((x) => x.key === key);
  return !!c && c.allowed.includes(principal);
}

/** What an independent coach gets, for the owner's page and the agreement. */
export function capabilitiesFor(principal: Principal): Capability[] {
  return CAPABILITIES.filter((c) => c.allowed.includes(principal));
}
