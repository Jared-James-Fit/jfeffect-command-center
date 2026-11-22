/**
 * JF Effect for coaches, early access: the application's questions, answers
 * and rules, shared by the page and the server (pure, tested in
 * coach-platform-apply.test.ts; the CHECKs in
 * 20270508090000_coach_platform_early_access.sql hold the same values).
 *
 * This is a waitlist, said plainly everywhere it shows: independent coach
 * workspaces aren't open (organization isolation, seat billing and the coach
 * agreement must pass first, docs/COACHING_PLATFORM.md). Applying creates no
 * account and no business, and costs nothing. It asks only what decides who's
 * invited first and how their workspace is set up.
 */
import { emailOk, instagramHandle } from "@/lib/apply-form";

export const SPECIALTIES = [
  { v: "powerlifting", l: "Powerlifting" },
  { v: "bodybuilding", l: "Bodybuilding and physique" },
  { v: "strength", l: "Strength and muscle" },
  { v: "general", l: "General fitness" },
  { v: "nutrition", l: "Nutrition and fat loss" },
  { v: "running", l: "Running and endurance" },
  { v: "sport", l: "Sports performance" },
  { v: "other", l: "Something else" },
] as const;

export const CLIENT_BANDS = [
  { v: "0", l: "None yet", hint: "Starting out" },
  { v: "1-5", l: "1 to 5" },
  { v: "6-15", l: "6 to 15" },
  { v: "16-40", l: "16 to 40" },
  { v: "41+", l: "More than 40" },
] as const;

export const WORKS_AS = [
  { v: "solo", l: "On my own" },
  { v: "team", l: "With a team", hint: "Other coaches work with me" },
] as const;

export const CURRENT_PLATFORMS = [
  { v: "trainerize", l: "Trainerize" },
  { v: "truecoach", l: "TrueCoach" },
  { v: "everfit", l: "Everfit" },
  { v: "sheets", l: "Spreadsheets and messages" },
  { v: "other", l: "Another app" },
  { v: "none", l: "Nothing yet" },
] as const;

export const COUNTRIES = [
  { v: "CA", l: "Canada" },
  { v: "US", l: "United States" },
  { v: "OTHER", l: "Somewhere else" },
] as const;

/** Canadian provinces and territories: where GST/HST (and Manitoba's RST) on the coach's bill depends on. */
export const PROVINCES = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"],
] as const;

export type Specialty = (typeof SPECIALTIES)[number]["v"];

export type CoachAnswers = {
  specialties: string[];
  client_band: string;
  works_as: string;
  current_platform: string;
  full_name: string;
  business_name: string;
  link: string;
  country: string;
  region: string;
  email: string;
  privacy_ack: boolean;
  marketing_ok: boolean;
};

export const EMPTY_COACH_ANSWERS: CoachAnswers = {
  specialties: [],
  client_band: "",
  works_as: "",
  current_platform: "",
  full_name: "",
  business_name: "",
  link: "",
  country: "",
  region: "",
  email: "",
  privacy_ack: false,
  marketing_ok: false,
};

/** One question per screen: taps first, then who they are, where, and how to reach them. */
export const COACH_STEPS = [
  "specialties",
  "client_band",
  "works_as",
  "current_platform",
  "full_name",
  "brand",
  "place",
  "contact",
] as const;
export type CoachStep = (typeof COACH_STEPS)[number];

/** Taps that are the answer and move on by themselves. */
export const TAP_STEPS: readonly CoachStep[] = ["client_band", "works_as", "current_platform"];

export const NAME_MAX = 120;
export const BUSINESS_MAX = 120;
export const LINK_MAX = 200;
export const REGION_MAX = 80;

export const COACH_NOTICE_VERSION = "coach-early-access-2026-11-22b";

/** What they agree to by sending it (stored word for word with the application). */
export const PRIVACY_NOTICE =
  "I use what you send here to review your application, set up your workspace if you're invited, and email you about early access. It isn't shared or sold. Ask me to delete it any time at support@jfeffect.com.";

/** The separate, optional box (CASL: express consent, never ticked for them). */
export const MARKETING_CONSENT =
  "Also send me JF Effect news for coaches by email (from JF Effect, support@jfeffect.com). I can unsubscribe any time.";

export type Problem = { field: keyof CoachAnswers | null; message: string };

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export const firstNameFrom = (full: string) => clip(full, NAME_MAX).split(" ")[0] ?? "";

/** What's wrong with one screen's answer, if anything. */
export function stepProblem(step: CoachStep, a: CoachAnswers): Problem | null {
  switch (step) {
    case "specialties":
      return a.specialties.some((s) => SPECIALTIES.some((o) => o.v === s)) ? null : { field: "specialties", message: "Pick at least one." };
    case "client_band":
      return CLIENT_BANDS.some((o) => o.v === a.client_band) ? null : { field: "client_band", message: "Pick one." };
    case "works_as":
      return WORKS_AS.some((o) => o.v === a.works_as) ? null : { field: "works_as", message: "Pick one." };
    case "current_platform":
      return !a.current_platform || CURRENT_PLATFORMS.some((o) => o.v === a.current_platform) ? null : { field: "current_platform", message: "Pick one, or skip it." };
    case "full_name": {
      const n = clip(a.full_name, NAME_MAX);
      if (n.length < 2) return { field: "full_name", message: "Your name, so I know who I'm talking to." };
      return null;
    }
    case "brand":
      if (a.link.trim() && !linkOk(a.link)) return { field: "link", message: "That doesn't look like an Instagram handle or a website." };
      return null;
    case "place":
      if (!COUNTRIES.some((o) => o.v === a.country)) return { field: "country", message: "Pick where your business is based." };
      if (a.country === "CA" && !PROVINCES.some(([c]) => c === a.region)) return { field: "region", message: "Pick your province or territory." };
      if (a.country === "US" && clip(a.region, REGION_MAX).length < 2) return { field: "region", message: "Which state?" };
      return null;
    case "contact":
      if (!emailOk(a.email.trim())) return { field: "email", message: "That email doesn't look right." };
      if (!a.privacy_ack) return { field: "privacy_ack", message: "Tick the box to send it." };
      return null;
  }
}

/** The first screen with something to fix, or -1 when it's ready to send. */
export function firstProblem(a: CoachAnswers): number {
  return COACH_STEPS.findIndex((s) => stepProblem(s, a) !== null);
}

/**
 * An @handle or an Instagram link is Instagram; something that starts like a
 * site (http, www.) or ends in a site's ending (.com, .ca…) is a website; any
 * other bare word is read as a handle ("jamie.lifts").
 */
export function readLink(raw: string): { instagram: string | null; website: string | null } | null {
  const s = raw.trim();
  if (!s) return { instagram: null, website: null };
  const isIg = /^@/.test(s) || /(instagram\.com|instagr\.am)\//i.test(s);
  const looksSite = /^(https?:\/\/|www\.)/i.test(s) || /\.(com|ca|co|net|org|io|fit|coach|app|uk|au|us|info|biz)(\/\S*)?$/i.test(s);
  if (isIg || !looksSite) {
    const handle = instagramHandle(s);
    return handle ? { instagram: handle, website: null } : null;
  }
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(s) ? { instagram: null, website: s.slice(0, LINK_MAX) } : null;
}

export function linkOk(raw: string): boolean {
  return readLink(raw) !== null;
}

/** What's stored: trimmed, bounded, only known values. */
export function cleanAnswers(a: CoachAnswers) {
  const specialties = Array.from(new Set(a.specialties.filter((s) => SPECIALTIES.some((o) => o.v === s))));
  const link = readLink(a.link) ?? { instagram: null, website: null };
  return {
    specialties,
    client_band: a.client_band,
    works_as: a.works_as,
    current_platform: a.current_platform || null,
    full_name: clip(a.full_name, NAME_MAX),
    business_name: clip(a.business_name, BUSINESS_MAX) || null,
    instagram: link.instagram,
    website: link.website,
    country: a.country,
    region: a.country === "OTHER" ? clip(a.region, REGION_MAX) || null : a.country === "CA" ? a.region : clip(a.region, REGION_MAX),
    email: a.email.trim().toLowerCase(),
    marketing_ok: !!a.marketing_ok,
  };
}

export const APPLICATION_STATUSES = ["new", "contacted", "waitlisted", "invited", "declined"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_WORDS: Record<ApplicationStatus, string> = {
  new: "New",
  contacted: "Contacted",
  waitlisted: "Waitlist",
  invited: "Invited to the pilot",
  declined: "Not a fit",
};

export const labelOf = (list: ReadonlyArray<{ v: string; l: string }>, v: string | null | undefined) =>
  list.find((o) => o.v === v)?.l ?? (v || "");

/** How big a business is, for sorting the list: bigger books first, they're the pilot's best test. */
export function bandRank(band: string): number {
  return Math.max(0, CLIENT_BANDS.findIndex((b) => b.v === band));
}
