/**
 * Free membership by application (/join): the questions, their answers and
 * the rules the page, the server and the database share (pure, tested in
 * membership-apply.test.ts; the CHECKs in 20270419090000_membership_applications.sql
 * use the same values).
 *
 * Applying is free and needs no account. A real person reads every
 * application; approving one sends an activation link, and only then does a
 * login exist that can become a free member (`_member_free_join` refuses
 * anyone else, the database's own gate).
 */
import { emailOk, instagramHandle, phoneOk } from "@/lib/apply-form";

/** What they want, in their words. `tag` is the setup wizard's goal, so setup never asks twice. */
export const MEMBER_GOALS = [
  { v: "build_muscle", l: "Build muscle", tag: "Build muscle" },
  { v: "lose_fat", l: "Lose fat", tag: "Lose fat" },
  { v: "get_stronger", l: "Get stronger", tag: "Get stronger" },
  { v: "powerlifting", l: "Compete in powerlifting", tag: "Powerlifting meet" },
  { v: "back_in_shape", l: "Get back in shape", tag: "Get back in shape" },
  { v: "general_fitness", l: "Feel fit and healthy", tag: "General fitness" },
] as const;

/** The setup wizard's experience values, so the answer carries straight over. */
export const MEMBER_EXPERIENCE = [
  { v: "new", l: "New to lifting", hint: "Under 6 months" },
  { v: "beginner", l: "Beginner", hint: "6 months to 2 years" },
  { v: "intermediate", l: "Intermediate", hint: "2 to 5 years" },
  { v: "advanced", l: "Advanced", hint: "5+ years" },
] as const;

export const COACHING_INTEREST = [
  { v: "yes", l: "Yes, tell me about it" },
  { v: "maybe", l: "Maybe later" },
  { v: "no", l: "No, just the app" },
] as const;

export const CONTACT_METHODS = [
  { v: "instagram", l: "Instagram DM", hint: "Fastest" },
  { v: "text", l: "Text" },
  { v: "email", l: "Email" },
] as const;

export type MemberGoal = (typeof MEMBER_GOALS)[number]["v"];
export type MemberExperience = (typeof MEMBER_EXPERIENCE)[number]["v"];
export type CoachingInterest = (typeof COACHING_INTEREST)[number]["v"];
export type ContactMethod = (typeof CONTACT_METHODS)[number]["v"];

export type MemberAnswers = {
  goal: string;
  experience: string;
  coaching_interest: string;
  full_name: string;
  contact_method: string;
  email: string;
  instagram: string;
  phone: string;
};

export const EMPTY_MEMBER_ANSWERS: MemberAnswers = {
  goal: "",
  experience: "",
  coaching_interest: "",
  full_name: "",
  contact_method: "",
  email: "",
  instagram: "",
  phone: "",
};

/**
 * The screens, in order: three taps first (what they want, where they're
 * at, coaching), then their name, how to reach them, and the details that
 * way needs. One question per screen; taps move on by themselves.
 */
export type MemberStepKey = "goal" | "experience" | "coaching_interest" | "full_name" | "contact_method" | "contact";
export const MEMBER_STEPS: readonly MemberStepKey[] = [
  "goal",
  "experience",
  "coaching_interest",
  "full_name",
  "contact_method",
  "contact",
];

/** Words the consent line says, stored with the application. Bump when they change. */
export const CONSENT_VERSION = "v1";
export function consentText(method: string): string {
  const how = method === "text" ? "text" : method === "email" ? "email" : "Instagram DM";
  return `I'm OK with Jared from JF Effect contacting me about my application by ${how} and email.`;
}

const inList = (list: ReadonlyArray<{ v: string }>, v: string) => list.some((x) => x.v === v);

/** Instagram is the coach's favourite way in: always asked, required only when it's how they want to be reached. */
export function contactNeeds(method: string): { instagram: "required" | "optional"; phone: "required" | "hidden" } {
  return {
    instagram: method === "instagram" ? "required" : "optional",
    phone: method === "text" ? "required" : "hidden",
  };
}

export type FieldProblem = { field: keyof MemberAnswers; message: string };

/** What's wrong on one screen, in the order the fields sit, said the way they can fix it. */
export function memberStepProblem(step: MemberStepKey, a: MemberAnswers): FieldProblem | null {
  switch (step) {
    case "goal":
      return inList(MEMBER_GOALS, a.goal) ? null : { field: "goal", message: "Pick the one that fits best." };
    case "experience":
      return inList(MEMBER_EXPERIENCE, a.experience) ? null : { field: "experience", message: "Pick the closest one." };
    case "coaching_interest":
      // optional: skipping is an answer
      return !a.coaching_interest || inList(COACHING_INTEREST, a.coaching_interest)
        ? null
        : { field: "coaching_interest", message: "Pick one, or skip it." };
    case "full_name": {
      const n = a.full_name.trim();
      if (n.length < 2) return { field: "full_name", message: "Add your name so Jared knows who he's talking to." };
      if (n.length > 120) return { field: "full_name", message: "That name is too long." };
      return null;
    }
    case "contact_method":
      return inList(CONTACT_METHODS, a.contact_method) ? null : { field: "contact_method", message: "Pick how you'd like to hear back." };
    case "contact": {
      if (!emailOk(a.email)) return { field: "email", message: a.email.trim() ? "That email doesn't look right. Check for typos." : "Add your email. Your invite goes there." };
      const needs = contactNeeds(a.contact_method);
      const ig = a.instagram.trim();
      if (needs.instagram === "required" && !ig) return { field: "instagram", message: "Add your Instagram so Jared can DM you." };
      if (ig && !instagramHandle(ig)) return { field: "instagram", message: "That handle doesn't look right (letters, numbers, dots and underscores)." };
      if (needs.phone === "required" && !phoneOk(a.phone)) return { field: "phone", message: "Add your number with the area code." };
      return null;
    }
  }
}

/** The first screen still to fix before sending, or -1 when it can go. */
export function firstMemberProblem(a: MemberAnswers): number {
  return MEMBER_STEPS.findIndex((s) => memberStepProblem(s, a) !== null);
}

/** The answers as they're stored: trimmed, the handle cleaned, the phone only when texting is how. */
export function cleanMemberAnswers(a: MemberAnswers) {
  const method = a.contact_method as ContactMethod;
  return {
    goal: a.goal as MemberGoal,
    experience: a.experience as MemberExperience,
    coaching_interest: (a.coaching_interest || null) as CoachingInterest | null,
    full_name: a.full_name.trim().replace(/\s+/g, " "),
    contact_method: method,
    email: a.email.trim().toLowerCase(),
    instagram: a.instagram.trim() ? instagramHandle(a.instagram) : null,
    phone: contactNeeds(method).phone === "required" ? a.phone.trim() : null,
  };
}

export const goalLabelOf = (v: string | null | undefined) => MEMBER_GOALS.find((g) => g.v === v)?.l ?? "";
export const goalTagOf = (v: string | null | undefined) => MEMBER_GOALS.find((g) => g.v === v)?.tag ?? null;
export const experienceLabelOf = (v: string | null | undefined) => MEMBER_EXPERIENCE.find((g) => g.v === v)?.l ?? "";
export const contactLabelOf = (v: string | null | undefined) => CONTACT_METHODS.find((g) => g.v === v)?.l ?? "";

export function firstNameFrom(fullName: string | null | undefined): string {
  return String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/* ------------------------------------------------------------------ */
/* Where an application stands (the coach's screen)                    */
/* ------------------------------------------------------------------ */

export type ApplicationStatus = "pending" | "approved" | "declined";
export type ContactStatus = "not_contacted" | "messaged" | "talking";

export type MemberApplication = {
  id: string;
  created_at: string;
  updated_at?: string | null;
  full_name: string;
  email: string;
  instagram: string | null;
  phone: string | null;
  goal: string;
  experience: string;
  coaching_interest: string | null;
  contact_method: string;
  status: ApplicationStatus;
  flagged: boolean;
  contact_status: ContactStatus;
  contacted_at: string | null;
  admin_notes: string | null;
  decided_at: string | null;
  invite_sent_at: string | null;
  invite_count: number;
  activated_at: string | null;
  client_id: string | null;
  existing_account: boolean;
  source_page: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
};

/** Still waiting on the coach: not decided, whether or not they've been messaged yet. */
export function needsDecision(a: Pick<MemberApplication, "status">): boolean {
  return a.status === "pending";
}

/** Waiting on the coach and nobody has written to them yet: the ones to answer first. */
export function needsFirstReply(a: Pick<MemberApplication, "status" | "contact_status" | "flagged">): boolean {
  return a.status === "pending" && a.contact_status === "not_contacted" && !a.flagged;
}

/** Approved, invite out, and they haven't come in yet. */
export function awaitingActivation(a: Pick<MemberApplication, "status" | "activated_at" | "existing_account">): boolean {
  return a.status === "approved" && !a.activated_at && !a.existing_account;
}

export type StageTone = "new" | "warn" | "done" | "muted";

/** Where they stand, in a word or two, for a row. */
export function applicationStage(
  a: Pick<MemberApplication, "status" | "flagged" | "contact_status" | "activated_at" | "invite_sent_at" | "existing_account">,
): { label: string; tone: StageTone } {
  if (a.status === "declined") return { label: "Declined", tone: "muted" };
  if (a.status === "approved") {
    if (a.activated_at) return { label: "Joined", tone: "done" };
    if (a.existing_account) return { label: "Has an account", tone: "done" };
    return { label: a.invite_sent_at ? "Invite sent" : "Approved", tone: "done" };
  }
  if (a.flagged) return { label: "Flagged", tone: "warn" };
  if (a.contact_status === "talking") return { label: "Talking", tone: "muted" };
  if (a.contact_status === "messaged") return { label: "Messaged", tone: "muted" };
  return { label: "New", tone: "new" };
}

/** Order for the coach: needs a first reply, then the rest still pending (oldest first in each), then everything else newest first. */
export function sortForReview<T extends MemberApplication>(apps: readonly T[]): T[] {
  const rank = (a: T) => (needsFirstReply(a) ? 0 : a.status === "pending" ? 1 : 2);
  return [...apps].sort((x, y) => {
    const r = rank(x) - rank(y);
    if (r !== 0) return r;
    const tx = Date.parse(x.created_at);
    const ty = Date.parse(y.created_at);
    return rank(x) < 2 ? tx - ty : ty - tx;
  });
}

/** "Build muscle · New to lifting": what they're after, for a row. */
export function applicationLine(a: Pick<MemberApplication, "goal" | "experience">): string {
  return [goalLabelOf(a.goal), experienceLabelOf(a.experience)].filter(Boolean).join(" · ");
}

/** Instagram profile in the app (a tap opens it), from "@handle". */
export function instagramProfileUrl(handle: string | null | undefined): string | null {
  const h = instagramHandle(String(handle ?? ""));
  return h ? `https://instagram.com/${h.slice(1)}` : null;
}

/* ------------------------------------------------------------------ */
/* Words the coach sends (his voice, no AI needed)                      */
/* ------------------------------------------------------------------ */

const GOAL_HOOK: Record<string, string> = {
  build_muscle: "building muscle",
  lose_fat: "dropping some fat",
  get_stronger: "getting stronger",
  powerlifting: "powerlifting",
  back_in_shape: "getting back in shape",
  general_fitness: "getting fit",
};

/** A first message before deciding: say hi and learn about them. */
export function hiMessage(a: Pick<MemberApplication, "full_name" | "goal" | "experience" | "coaching_interest">): string {
  const first = firstNameFrom(a.full_name);
  const hey = first ? `Hey ${first}!` : "Hey!";
  const hook = GOAL_HOOK[a.goal] ?? "your training";
  const ask =
    a.experience === "new"
      ? "What's got you wanting to start lifting?"
      : "What's your training look like right now?";
  const coaching = a.coaching_interest === "yes" ? " Happy to chat coaching too whenever you want." : "";
  return `${hey} Jared from JF Effect here. Got your application, love that you're focused on ${hook}. ${ask}${coaching}`;
}

/** The approval, with their link, for a DM or a text. */
export function approvedMessage(a: Pick<MemberApplication, "full_name">, link: string): string {
  const first = firstNameFrom(a.full_name);
  return `${first ? `${first}, you're in` : "You're in"} 🙌 Approved you for JF Effect. Tap this to set your password and get started: ${link}`;
}

/* ------------------------------------------------------------------ */
/* Their first move (the welcome after activation)                      */
/* ------------------------------------------------------------------ */

export type FirstMove = { title: string; body: string; cta: string; to: string };

/**
 * The most useful first thing for this person: a program they can start
 * today (the JF Effect library leads with the right one for their goal and
 * level), never "explore the app".
 */
export function firstMove(goal: string | null | undefined, experience: string | null | undefined): FirstMove {
  const newer = experience === "new" || experience === "beginner";
  if (goal === "powerlifting") {
    return {
      title: "Start a powerlifting program",
      body: "Squat, bench and deadlift with real progression. Pick the one for your level and it lands on your training days.",
      cta: "See powerlifting programs",
      to: "/portal/programs?tab=jf",
    };
  }
  if (newer) {
    return {
      title: "Start a beginner program",
      body: "A simple plan that tells you exactly what to do each day. Log your sets and the app tracks your progress for you.",
      cta: "Pick my first program",
      to: "/portal/programs?tab=jf",
    };
  }
  return {
    title: "Pick your program",
    body: "Start one of the JF Effect programs, or build your own and log it like you always have. Every set, PR and estimated max gets tracked.",
    cta: "See programs",
    to: "/portal/programs?tab=jf",
  };
}

/** What Jared says when they come in, with their goal in it. */
export function welcomeNote(first: string, goal: string | null | undefined): string[] {
  const hook = GOAL_HOOK[goal ?? ""] ?? "your training";
  return [
    `${first ? `${first}, welcome` : "Welcome"} to JF Effect.`,
    `I built this for people who are done guessing and want to actually see progress. You told me you're focused on ${hook}, so start there: pick a program, log every set, and let the numbers show you it's working.`,
    "Post your wins in the Crew. Everyone here is chasing something, and you'd be surprised how much it helps to have people notice.",
    "Glad you're here. Let's get to work.",
  ];
}

/* ------------------------------------------------------------------ */
/* The funnel (how people find and join)                                */
/* ------------------------------------------------------------------ */

export type FunnelCounts = {
  visitors: number;
  starts: number;
  submitted: number;
  pending: number;
  approved: number;
  activated: number;
  engaged: number;
};

/** Each stage with the share of the stage before it (null when the one before is 0). */
export function funnelRows(c: FunnelCounts): Array<{ key: keyof FunnelCounts; label: string; value: number; rate: number | null; hint: string }> {
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
  return [
    { key: "visitors", label: "Visited the page", value: c.visitors, rate: null, hint: "People who opened jfeffect.com" },
    { key: "starts", label: "Started applying", value: c.starts, rate: rate(c.starts, c.visitors), hint: "Answered the first question" },
    { key: "submitted", label: "Sent an application", value: c.submitted, rate: rate(c.submitted, c.starts), hint: "Applications in this period" },
    { key: "approved", label: "Approved", value: c.approved, rate: rate(c.approved, c.submitted), hint: "Of those sent in this period" },
    { key: "activated", label: "Joined", value: c.activated, rate: rate(c.activated, c.approved), hint: "Set a password and came in" },
    { key: "engaged", label: "Trained in week one", value: c.engaged, rate: rate(c.engaged, c.activated), hint: "Logged a workout, started a program or posted in 7 days" },
  ];
}

/** Funnel step keys the page reports as someone moves through (the database refuses anything else). */
export const FUNNEL_EVENTS = ["landing_view", "apply_start", "apply_step", "apply_submit"] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
