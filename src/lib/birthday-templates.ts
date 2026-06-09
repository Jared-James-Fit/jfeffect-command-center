// Default birthday card content + selectable templates.
// Headline supports a [First Name] token that we substitute at render time.

export type BirthdayTemplateKey =
  | "strong"
  | "simple"
  | "jf_effect"
  | "client_win";

export interface BirthdayTemplate {
  key: BirthdayTemplateKey;
  name: string;
  description: string;
  headline: string;
  message: string;
  quote: string;
  coach_message: string;
}

export const BIRTHDAY_TEMPLATES: BirthdayTemplate[] = [
  {
    key: "strong",
    name: "Strong + Motivational",
    description: "Premium, no-nonsense, raise-the-standard energy.",
    headline: "Happy Birthday, [First Name] 🎉",
    message: "Another year older. Another year stronger.",
    quote: "New year. Higher standard.",
    coach_message:
      "Hope you have a great day. Proud of the work you've been putting in. Enjoy today — then we keep building.",
  },
  {
    key: "simple",
    name: "Simple + Personal",
    description: "Warm, human, less intense.",
    headline: "Happy Birthday, [First Name] 🎉",
    message:
      "Hope you have an amazing day. Enjoy it, celebrate it, and keep building the person you're becoming.",
    quote: "Every year is a chance to level up.",
    coach_message:
      "Wishing you a great birthday. Take a moment to appreciate how far you've come.",
  },
  {
    key: "jf_effect",
    name: "JF Effect Style",
    description: "On-brand, sharp, premium voice.",
    headline: "Happy Birthday, [First Name].",
    message: "Another year. Another level.",
    quote: "Celebrate today. Then we keep raising the standard.",
    coach_message:
      "Enjoy your day. Then back to work — the standard doesn't lower itself.",
  },
  {
    key: "client_win",
    name: "Client Win Style",
    description: "Acknowledges the work they've already put in.",
    headline: "Happy Birthday, [First Name] 🎉",
    message: "Proud of the work you've been putting in.",
    quote: "Use this next year to keep building momentum.",
    coach_message:
      "You've earned a great year. Enjoy today and let's keep stacking wins.",
  },
];

export const DEFAULT_TEMPLATE_KEY: BirthdayTemplateKey = "strong";

export function getTemplate(key: BirthdayTemplateKey | string | null | undefined): BirthdayTemplate {
  return (
    BIRTHDAY_TEMPLATES.find((t) => t.key === key) ??
    BIRTHDAY_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!
  );
}

export interface ResolvedBirthdayCard {
  headline: string;
  message: string;
  quote: string;
  coach_message: string;
  celebration_effect: boolean;
  show_message_coach_button: boolean;
  enabled: boolean;
  template_key: BirthdayTemplateKey;
}

/** Merge stored overrides on top of the selected template defaults. */
export function resolveBirthdayCard(stored: {
  enabled?: boolean | null;
  template_key?: string | null;
  headline?: string | null;
  message?: string | null;
  quote?: string | null;
  coach_message?: string | null;
  celebration_effect?: boolean | null;
  show_message_coach_button?: boolean | null;
} | null | undefined): ResolvedBirthdayCard {
  const t = getTemplate(stored?.template_key);
  return {
    headline: stored?.headline?.trim() || t.headline,
    message: stored?.message?.trim() || t.message,
    quote: stored?.quote?.trim() || t.quote,
    coach_message: stored?.coach_message?.trim() || t.coach_message,
    celebration_effect: stored?.celebration_effect ?? true,
    show_message_coach_button: stored?.show_message_coach_button ?? true,
    enabled: stored?.enabled ?? true,
    template_key: t.key,
  };
}

export function applyFirstName(text: string, firstName: string | null | undefined): string {
  const name = (firstName || "").trim() || "there";
  return text.replaceAll("[First Name]", name);
}

export function prefilledBirthdayMessage(firstName: string | null | undefined): string {
  const name = (firstName || "").trim() || "there";
  return `Happy birthday, ${name} 🎉\n\nHope you have a great day. Another year older, another year stronger.\n\nEnjoy it today — then we keep building.`;
}