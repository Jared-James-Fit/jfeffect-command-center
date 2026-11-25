/**
 * Cleo Autopilot's autonomy (Nov 25 2026): what a decision may become, by the
 * coach's settings. Global, per client and per domain (training, nutrition,
 * cardio): Draft Only (the default for everyone), Smart Autopilot (small
 * routine changes inside the permitted ranges may publish by themselves) or
 * Advanced (wider ranges). Locks keep a domain the coach's alone, pause (global
 * or per client, optionally until a date) stops anything new, and shadow mode
 * (on for everyone until the coach turns it off for a client) records what
 * would have published as a draft instead. A protected decision always goes
 * to the coach. Training never publishes by itself in this version: Edit with
 * AI's apply runs with the coach's own session and checks access there. Pure
 * and tested (autopilot.test.ts).
 */
import { MAX_STEP_KCAL } from "@/lib/weight-management/decision";
import type { AutopilotAssessment, Bucket, Domain, DomainDecision, Mode, Protection, Routing } from "@/lib/autopilot/types";

export type SettingsRow = {
  scope: "global" | "client";
  client_id: string | null;
  mode_training: Mode | null;
  mode_nutrition: Mode | null;
  mode_cardio: Mode | null;
  locked_domains: string[] | null;
  ranges: { nutrition_kcal?: number | null; cardio_minutes?: number | null } | null;
  paused: boolean | null;
  paused_until: string | null;
  shadow: boolean | null;
};

export type Settings = {
  modes: Record<Domain, Mode>;
  locked: Domain[];
  /** The coach's permitted ranges (null: the mode's own default, SMART_RANGES / ADVANCED_RANGES). */
  ranges: { nutritionKcal: number | null; cardioMinutes: number | null };
  paused: boolean;
  pausedBy: "global" | "client" | null;
  shadow: boolean;
};

/** What Smart may change by itself unless the coach narrows it. */
export const SMART_RANGES = { nutritionKcal: 100, cardioMinutes: 15 } as const;
/** Advanced's ceiling: never past the engine's own step. */
export const ADVANCED_RANGES = { nutritionKcal: MAX_STEP_KCAL, cardioMinutes: 30 } as const;

export const DEFAULT_SETTINGS: Settings = {
  modes: { training: "draft", nutrition: "draft", cardio: "draft" },
  locked: [],
  ranges: { nutritionKcal: null, cardioMinutes: null },
  paused: false,
  pausedBy: null,
  shadow: true,
};

const isMode = (v: unknown): v is Mode => v === "draft" || v === "smart" || v === "advanced";
const isDomain = (v: unknown): v is Domain => v === "training" || v === "nutrition" || v === "cardio";
const pausedNow = (r: SettingsRow | null, today: string) => !!r && (!!r.paused || (!!r.paused_until && r.paused_until >= today));
const posNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** The settings in force for one client: theirs over the global row over the safe defaults. */
export function resolveSettings(global: SettingsRow | null, client: SettingsRow | null, today: string): Settings {
  const mode = (d: Domain): Mode => {
    const k = `mode_${d}` as const;
    const c = client?.[k];
    if (isMode(c)) return c;
    const g = global?.[k];
    return isMode(g) ? g : "draft";
  };
  const locked = Array.from(new Set([...(global?.locked_domains ?? []), ...(client?.locked_domains ?? [])].filter(isDomain)));
  const nutritionKcal = posNum(client?.ranges?.nutrition_kcal) ?? posNum(global?.ranges?.nutrition_kcal);
  const cardioMinutes = posNum(client?.ranges?.cardio_minutes) ?? posNum(global?.ranges?.cardio_minutes);
  const gPaused = pausedNow(global, today);
  const cPaused = pausedNow(client, today);
  const shadow = typeof client?.shadow === "boolean" ? client.shadow : typeof global?.shadow === "boolean" ? global.shadow : true;
  return {
    modes: { training: mode("training"), nutrition: mode("nutrition"), cardio: mode("cardio") },
    locked,
    ranges: { nutritionKcal, cardioMinutes },
    paused: gPaused || cPaused,
    pausedBy: gPaused ? "global" : cPaused ? "client" : null,
    shadow,
  };
}

/** May this change publish by itself under this mode and these ranges? */
export function withinRange(d: DomainDecision, mode: Mode, ranges: Settings["ranges"]): boolean {
  if (mode === "draft") return false;
  if (d.domain === "training") return false;
  if (d.size !== "small") return false;
  const base = mode === "advanced" ? ADVANCED_RANGES : SMART_RANGES;
  if (d.domain === "nutrition") {
    if (d.kcalPerDay == null) return false;
    // the coach's range, never past Advanced's ceiling (the engine's own step)
    const limit = Math.min(ranges.nutritionKcal ?? base.nutritionKcal, ADVANCED_RANGES.nutritionKcal);
    return Math.abs(d.kcalPerDay) <= limit;
  }
  // cardio: only the engine's deterministic step (a model-written cardio plan always goes to the coach)
  if (!d.cardioStep || d.cardioMinutesDelta == null) return false;
  const limit = Math.min(ranges.cardioMinutes ?? base.cardioMinutes, ADVANCED_RANGES.cardioMinutes);
  return Math.abs(d.cardioMinutesDelta) <= limit;
}

/** One domain: none, a draft for the coach, or (Smart / Advanced, shadow off) published. */
export function routeDomain(d: DomainDecision, protections: Protection[], s: Settings, missing: string[]): Routing {
  if (d.change === "hold") return { action: "none", bucket: "on_track", shadowWouldPublish: false, why: d.summary };
  if (d.change === "review") {
    const missingInfo = missing.length > 0 && !protections.some((p) => p.domain === d.domain || p.domain === "overall");
    return { action: "none", bucket: missingInfo ? "missing_info" : "requires_attention", shadowWouldPublish: false, why: d.summary };
  }
  if (s.paused) return { action: "none", bucket: "awaiting_approval", shadowWouldPublish: false, why: s.pausedBy === "global" ? "Autopilot is paused for everyone" : "Autopilot is paused for this client" };
  if (s.locked.includes(d.domain)) return { action: "none", bucket: "requires_attention", shadowWouldPublish: false, why: `${d.domain} is locked: change it by hand` };
  const guarded = protections.filter((p) => p.domain === d.domain || p.domain === "overall");
  if (guarded.length) return { action: "draft", bucket: "requires_attention", shadowWouldPublish: false, why: guarded[0].text };
  const mode = s.modes[d.domain];
  if (!withinRange(d, mode, s.ranges)) {
    return { action: "draft", bucket: "awaiting_approval", shadowWouldPublish: false, why: mode === "draft" ? "Draft Only" : d.domain === "training" ? "Training changes always wait for you" : "Outside the permitted range" };
  }
  if (s.shadow) return { action: "draft", bucket: "awaiting_approval", shadowWouldPublish: true, why: "Shadow mode: would have published" };
  return { action: "publish", bucket: "auto_updated", shadowWouldPublish: false, why: `${mode === "advanced" ? "Advanced" : "Smart Autopilot"}: inside the permitted range` };
}

const BUCKET_ORDER: Bucket[] = ["requires_attention", "missing_info", "awaiting_approval", "auto_updated", "on_track"];

/** The decision's place on the dashboard: the most urgent of its domains. */
export function overallBucket(routes: Routing[], a: Pick<AutopilotAssessment, "missing" | "protections">): Bucket {
  if (a.protections.some((p) => p.reason === "injury" || p.reason === "medical" || p.reason === "unsafe_weight")) return "requires_attention";
  let best: Bucket = a.missing.length ? "missing_info" : "on_track";
  for (const r of routes) if (BUCKET_ORDER.indexOf(r.bucket) < BUCKET_ORDER.indexOf(best)) best = r.bucket;
  return best;
}

/** Every domain routed, and the dashboard bucket. */
export function routeAssessment(a: AutopilotAssessment, s: Settings): { routes: Record<Domain, Routing>; bucket: Bucket } {
  const routes = {
    training: routeDomain(a.domains.training, a.protections, s, a.missing),
    nutrition: routeDomain(a.domains.nutrition, a.protections, s, a.missing),
    cardio: routeDomain(a.domains.cardio, a.protections, s, a.missing),
  };
  return { routes, bucket: overallBucket(Object.values(routes), a) };
}
