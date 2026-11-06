/**
 * The coaching application (/coaching/apply), one question per screen. Pure:
 * the page, the server's checks and the tests share these rules, so the page
 * can never accept something the server then refuses (Devin's application
 * never arrived, and nobody could tell why).
 */

export const APPLY_GOALS = [
  { v: "powerlifting", l: "Powerlifting" },
  { v: "fat_loss", l: "Fat Loss" },
  { v: "build_muscle", l: "Build Muscle" },
  { v: "general_fitness", l: "General Fitness" },
  { v: "other", l: "Other" },
] as const;

export const APPLY_TIMELINES = [
  { v: "asap", l: "ASAP" },
  { v: "this_month", l: "This month" },
  { v: "one_three_months", l: "In the next 1–3 months" },
  { v: "exploring", l: "Just exploring" },
] as const;

export type ApplyAnswers = {
  full_name: string;
  main_goal: string;
  target_outcome: string;
  timeline: string;
  email: string;
  phone: string;
  instagram: string;
};

export type ApplyStep = {
  key: keyof ApplyAnswers;
  kind: "text" | "long" | "email" | "tel" | "choice";
  question: string;
  hint?: string;
  placeholder?: string;
  options?: readonly { v: string; l: string }[];
};

/** In order: the easy, engaging ones first, how to reach them last. */
export const APPLY_STEPS: readonly ApplyStep[] = [
  { key: "full_name", kind: "text", question: "What's your name?", placeholder: "First and last name" },
  { key: "main_goal", kind: "choice", question: "What do you want help with?", options: APPLY_GOALS },
  {
    key: "target_outcome",
    kind: "long",
    question: "What result are you after?",
    hint: "A sentence or two is plenty.",
    placeholder: "e.g. Lose 15 lb and keep my strength",
  },
  { key: "timeline", kind: "choice", question: "When do you want to start?", options: APPLY_TIMELINES },
  { key: "email", kind: "email", question: "What's your email?", hint: "Where your next steps go.", placeholder: "you@example.com" },
  { key: "phone", kind: "tel", question: "Best number to reach you?", hint: "Any format works.", placeholder: "(204) 555-0123" },
  {
    key: "instagram",
    kind: "text",
    question: "What's your Instagram?",
    hint: "Your @username, or paste your profile link.",
    placeholder: "@username",
  },
];

/** A goal handed over in the link from the coaching page (`/coaching/apply?goal=fat_loss`), or null when it isn't one of ours. */
export function goalFromLink(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  return APPLY_GOALS.some((g) => g.v === v) ? v : null;
}

export const EMPTY_ANSWERS: ApplyAnswers = {
  full_name: "", main_goal: "", target_outcome: "", timeline: "", email: "", phone: "", instagram: "",
};

export const OUTCOME_MAX = 250;

/** "(204) 555-0123", "204.555.0123", "+1 204 555 0123": anything with 7 to 15 digits. */
export function phoneDigits(raw: string): number {
  return (String(raw ?? "").match(/\d/g) ?? []).length;
}

export function phoneOk(raw: string): boolean {
  const n = phoneDigits(raw);
  return n >= 7 && n <= 15;
}

export function emailOk(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw ?? "").trim());
}

/**
 * "@jamie.lifts", "jamie.lifts", "instagram.com/jamie.lifts",
 * "https://www.instagram.com/jamie.lifts/?igsh=abc" → "@jamie.lifts"; null when it isn't a handle.
 */
export function instagramHandle(raw: string): string | null {
  let s = String(raw ?? "").trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/+([^/?#\s]+)/i);
  if (link) s = link[1]!;
  s = s.replace(/^@+/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? `@${s}` : null;
}

/** What's wrong with an answer, said the way the person can fix it; null when it's fine. */
export function stepError(key: keyof ApplyAnswers, value: string): string | null {
  const v = String(value ?? "").trim();
  switch (key) {
    case "full_name":
      return v.length >= 2 ? null : "Add your name so we know who we're talking to.";
    case "main_goal":
      return APPLY_GOALS.some((g) => g.v === v) ? null : "Pick the one that fits best.";
    case "target_outcome":
      return v.length >= 2 ? null : "Tell us in a few words.";
    case "timeline":
      return APPLY_TIMELINES.some((t) => t.v === v) ? null : "Pick when you'd like to start.";
    case "email":
      return emailOk(v) ? null : "That email doesn't look right. Check for typos.";
    case "phone":
      return phoneOk(v) ? null : "Add a number with the area code.";
    case "instagram":
      return instagramHandle(v) ? null : "Add your @username (letters, numbers, dots and underscores).";
  }
}

/** The first question still to answer, or -1 when everything is ready to send. */
export function firstUnanswered(answers: ApplyAnswers): number {
  return APPLY_STEPS.findIndex((s) => stepError(s.key, answers[s.key]) !== null);
}

/** How many questions are answered, for the progress bar. */
export function answeredCount(answers: ApplyAnswers): number {
  return APPLY_STEPS.filter((s) => stepError(s.key, answers[s.key]) === null).length;
}

/** Worth saving as an unfinished application: there's a way to reach them. */
export function hasContact(answers: Pick<ApplyAnswers, "email" | "phone">): boolean {
  return emailOk(answers.email) || phoneOk(answers.phone);
}

/** Long tracking links (Instagram's fbclid, UTMs) are trimmed, never a reason to refuse. */
export function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}
