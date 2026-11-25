/**
 * Cleo Autopilot's publishing rules and its one system card (Nov 25 2026).
 * Only for a client the coach put on Smart Autopilot or Advanced with shadow
 * mode off: never during an active workout, preferably while the client isn't
 * in the app, and right after the change is revalidated against the latest
 * data and the coach's edits (run.server.ts). Then ONE deterministic card in
 * the client's coach chat for everything that went live together ("Your
 * nutrition targets have been updated." + before / after + from when + Open
 * my plan), once per decision, never for a change that failed or didn't
 * publish. Pure and tested (autopilot.test.ts).
 */
import type { Domain } from "@/lib/autopilot/types";

export const AUTOPILOT_MESSAGE_KIND = "autopilot_update";

/** A workout touched this recently and not finished is in progress. */
export const ACTIVE_WORKOUT_MS = 3 * 60 * 60_000;
/** Seen in the app this recently: wait for a quieter moment… */
export const ONLINE_MS = 10 * 60_000;
/** …but never longer than this after the change was ready. */
export const MAX_WAIT_MS = 6 * 60 * 60_000;

export type WorkoutActivity = { startedAt: string | null; lastActivityAt: string | null; completedAt: string | null };

/** Is a workout in progress right now (started or touched in the last 3 hours, not finished)? */
export function workoutInProgress(rows: WorkoutActivity[], now: number): boolean {
  return rows.some((r) => {
    if (r.completedAt) return false;
    const at = Math.max(Date.parse(r.lastActivityAt ?? "") || 0, Date.parse(r.startedAt ?? "") || 0);
    return at > 0 && now - at < ACTIVE_WORKOUT_MS;
  });
}

export type PublishWindow = { ok: true } | { ok: false; reason: "active_workout" | "online"; retryAfterMs: number };

/** May it publish now? Never mid-workout; while they're in the app, wait a little (at most MAX_WAIT_MS). */
export function publishWindow(x: { now: number; readySince: number; workouts: WorkoutActivity[]; lastSeenAt: string | null }): PublishWindow {
  if (workoutInProgress(x.workouts, x.now)) return { ok: false, reason: "active_workout", retryAfterMs: 30 * 60_000 };
  const seen = Date.parse(x.lastSeenAt ?? "") || 0;
  if (seen && x.now - seen < ONLINE_MS && x.now - x.readySince < MAX_WAIT_MS) return { ok: false, reason: "online", retryAfterMs: ONLINE_MS };
  return { ok: true };
}

export type PublishedChange = { domain: Domain; before: string | null; after: string | null };

const NOUN: Record<Domain, string> = { nutrition: "nutrition targets", cardio: "cardio plan", training: "training program" };
const OPEN: Record<Domain, { label: string; url: string }> = {
  nutrition: { label: "Open my nutrition plan", url: "/portal/nutrition-targets" },
  cardio: { label: "Open my cardio plan", url: "/portal/cardio" },
  training: { label: "Open my program", url: "/portal/workouts" },
};

/** The card's headline: one sentence, 5–20 words, never in the coach's first person. */
export function systemCardBody(domains: Domain[]): string {
  const ds = Array.from(new Set(domains)).sort((a, b) => ["nutrition", "cardio", "training"].indexOf(a) - ["nutrition", "cardio", "training"].indexOf(b));
  if (!ds.length) return "";
  if (ds.length === 1) return `Your ${NOUN[ds[0]]} ${ds[0] === "nutrition" ? "have" : "has"} been updated.`;
  const words = ds.map((d) => d);
  const list = words.length === 2 ? `${words[0]} and ${words[1]}` : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Your ${list} plans have been updated.`;
}

export type AutopilotCardAttachment = {
  type: "file";
  url: "";
  kind: typeof AUTOPILOT_MESSAGE_KIND;
  decision_id: string;
  title: string;
  effective: string;
  changes: Array<{ domain: Domain; label: string; before: string | null; after: string | null }>;
  open: { label: string; url: string };
};

/** The one card for everything published together, or null when nothing went live. */
export function systemCard(decisionId: string, changes: PublishedChange[], effective: string): { body: string; attachment: AutopilotCardAttachment } | null {
  const live = changes.filter((c) => c.after != null && c.after !== c.before);
  if (!live.length) return null;
  // one line per domain (the latest wins), in a fixed order
  const byDomain = new Map<Domain, PublishedChange>();
  for (const c of live) byDomain.set(c.domain, c);
  const ordered = (["nutrition", "cardio", "training"] as Domain[]).filter((d) => byDomain.has(d)).map((d) => byDomain.get(d)!);
  const body = systemCardBody(ordered.map((c) => c.domain));
  return {
    body,
    attachment: {
      type: "file",
      url: "",
      kind: AUTOPILOT_MESSAGE_KIND,
      decision_id: decisionId,
      title: body,
      effective,
      changes: ordered.map((c) => ({ domain: c.domain, label: c.domain === "nutrition" ? "Nutrition" : c.domain === "cardio" ? "Cardio" : "Training", before: c.before, after: c.after })),
      open: OPEN[ordered[0].domain],
    },
  };
}

/** Words in a string (for the length limits). */
export function wordCount(s: string): number {
  return (String(s ?? "").trim().match(/\S+/g) ?? []).length;
}
