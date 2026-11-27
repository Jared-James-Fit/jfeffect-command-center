/**
 * The coach's form library (pure, tested): one model for the Forms page and
 * the chat's form picker, so search, favorites, recently sent, categories and
 * suggestions read the same in both places.
 *
 * Who sees a form is the database's call (nf_staff_form_ids: a coach's own,
 * the organization's, and colleagues' shared ones; an admin sees all). This
 * file only arranges what came back.
 */

/** Offered when naming a category; a coach can type any other. */
export const CATEGORY_SUGGESTIONS = [
  "Client Onboarding",
  "Weekly Check-Ins",
  "Powerlifting & Competitions",
  "Nutrition",
  "Training Feedback",
  "Goal Setting",
  "Assessments",
  "Custom Forms",
] as const;

export const UNCATEGORIZED = "Custom Forms";

export type LibraryForm = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  kind?: string | null;
  active?: boolean | null;
  archived?: boolean | null;
  owner_id?: string | null;
  shared?: boolean | null;
  is_template?: boolean | null;
  form_type?: string | null;
  allow_updates?: boolean | null;
  created_at: string;
  updated_at?: string | null;
};

export function isSetupSystemForm(f: Pick<LibraryForm, "form_type">): boolean {
  return f.form_type === "setup_goals" || f.form_type === "setup_competition";
}

export function categoryOf(f: Pick<LibraryForm, "category">): string {
  const c = f.category?.trim();
  return c || UNCATEGORIZED;
}

/** Categories with forms in them, suggested ones first in their order, then the coach's own A–Z. */
export function libraryCategories(forms: LibraryForm[]): string[] {
  const used = new Set(forms.filter((f) => !f.archived).map(categoryOf));
  const known = (CATEGORY_SUGGESTIONS as readonly string[]).filter((c) => used.has(c));
  const own = [...used].filter((c) => !(CATEGORY_SUGGESTIONS as readonly string[]).includes(c)).sort((a, b) => a.localeCompare(b));
  return [...known, ...own];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Every word typed is somewhere in the title, category or description ("meet check" finds "Meet Day — … Checklist"). */
export function matchesSearch(f: LibraryForm, query: string): boolean {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = norm([f.title, f.category ?? "", f.description ?? ""].join(" "));
  return words.every((w) => hay.includes(w));
}

/** Where a form came from, in a word: "Yours", "Template", "Shared by the team". */
export function ownerLabel(f: LibraryForm, me: string | null | undefined): string | null {
  if (f.is_template) return "Template";
  if (!f.owner_id) return null;
  if (me && f.owner_id === me) return f.shared ? "Yours · shared" : null;
  return "Shared";
}

export type PickerTab = "suggested" | "favorites" | "recent" | "all" | `cat:${string}`;

export type RecentSend = { form_id: string; last_sent_at: string | null };

/**
 * The picker's list for a tab and a search: archived forms never; a search
 * looks through everything (whatever tab); favorites and recent keep their own
 * order (newest first), the rest A–Z.
 */
export function pickerList(
  forms: LibraryForm[],
  opts: { tab: PickerTab; query?: string; favorites: Set<string>; recent: RecentSend[]; suggested?: string[] },
): LibraryForm[] {
  const live = forms.filter((f) => !f.archived && !isSetupSystemForm(f));
  const byTitle = (a: LibraryForm, b: LibraryForm) => a.title.localeCompare(b.title);
  const q = opts.query?.trim() ?? "";
  if (q) {
    // Favorites first, then the rest, each A–Z.
    const hits = live.filter((f) => matchesSearch(f, q));
    return [...hits.filter((f) => opts.favorites.has(f.id)).sort(byTitle), ...hits.filter((f) => !opts.favorites.has(f.id)).sort(byTitle)];
  }
  if (opts.tab === "favorites") return live.filter((f) => opts.favorites.has(f.id)).sort(byTitle);
  if (opts.tab === "recent") {
    const order = new Map<string, number>();
    [...opts.recent]
      .sort((a, b) => String(b.last_sent_at ?? "").localeCompare(String(a.last_sent_at ?? "")))
      .forEach((r, i) => !order.has(r.form_id) && order.set(r.form_id, i));
    return live.filter((f) => order.has(f.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  if (opts.tab === "suggested") {
    const ids = opts.suggested ?? [];
    return ids.map((id) => live.find((f) => f.id === id)).filter((f): f is LibraryForm => !!f);
  }
  if (opts.tab.startsWith("cat:")) {
    const cat = opts.tab.slice(4);
    return live.filter((f) => categoryOf(f) === cat).sort(byTitle);
  }
  return [...live].sort(byTitle);
}

/** The tab the picker opens on: what's suggested for this client, else favorites, else recent, else everything. */
export function startTab(opts: { suggested: number; favorites: number; recent: number }): PickerTab {
  if (opts.suggested > 0) return "suggested";
  if (opts.favorites > 0) return "favorites";
  if (opts.recent > 0) return "recent";
  return "all";
}

export type SuggestionInput = {
  today: string;
  /** Their next meet's date (a meet prep or their competition plan), if any. */
  nextMeetDate?: string | null;
  /** When the meet checklist was last sent to them / last answered. */
  meetChecklistSentAt?: string | null;
  /** They've answered the Competition Calendar + Strategy in the last year. */
  hasCompetitionPlan?: boolean;
  /** Competes, or says they want to (is_powerlifter). */
  competes?: boolean;
  /** A coaching applicant who hasn't started yet. */
  isLead?: boolean;
  forms: Array<Pick<LibraryForm, "id" | "form_type" | "category" | "archived" | "title">>;
};

export type Suggestion = { formId: string; reason: string };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * A form worth sending now, for this client, with the reason it shows (never
 * sent by itself): the meet checklist inside four weeks of a meet it hasn't
 * been sent for; the competition plan for someone who competes and has none
 * from the last year; an onboarding form for a new lead.
 */
export function formSuggestions(i: SuggestionInput): Suggestion[] {
  const live = i.forms.filter((f) => !f.archived && !isSetupSystemForm(f));
  const out: Suggestion[] = [];
  const meetForm = live.find((f) => f.form_type === "meet_checklist");
  if (meetForm && i.nextMeetDate && /^\d{4}-\d{2}-\d{2}$/.test(i.nextMeetDate)) {
    const days = daysBetween(i.today, i.nextMeetDate);
    const sentForThisMeet = !!i.meetChecklistSentAt && daysBetween(i.meetChecklistSentAt.slice(0, 10), i.nextMeetDate) <= 45;
    if (days >= 0 && days <= 28 && !sentForThisMeet) {
      out.push({ formId: meetForm.id, reason: days === 0 ? "Meet today" : `Meet in ${days} ${days === 1 ? "day" : "days"}` });
    }
  }
  const planForm = live.find((f) => f.form_type === "competition_strategy");
  if (planForm && i.competes && !i.hasCompetitionPlan) out.push({ formId: planForm.id, reason: "No competition plan yet" });
  if (i.isLead) {
    const onboarding = live.find((f) => (f.category ?? "").toLowerCase() === "client onboarding");
    if (onboarding) out.push({ formId: onboarding.id, reason: "New lead" });
  }
  return out;
}

/** Purpose and delivery are separate. These labels never assign a form or change its schedule. */
type DeliveryForm = { form_type?: string | null; settings?: Record<string, unknown> | null; recurrence?: string | null; auto_assign_new_clients?: boolean | null; popup_enabled?: boolean | null; visibility?: string | null; active?: boolean | null };
export function formPurpose(f: DeliveryForm): "core" | "service" | "other" {
  if (f.form_type === "setup_goals") return "core";
  if (f.form_type === "setup_competition") return "service";
  return "other";
}
export function formDeliveryLabel(f: DeliveryForm): string {
  if (f.settings?.system_setup === true || isSetupSystemForm(f)) return "Account setup";
  const labels: string[] = [];
  if (f.recurrence && f.recurrence !== "none") labels.push("Scheduled · " + f.recurrence);
  if (f.popup_enabled) labels.push("Scheduled popup");
  if (f.auto_assign_new_clients) labels.push("Auto-share with new clients");
  if (f.visibility === "all_active_clients") labels.push("Available to active clients");
  return labels.length ? labels.join(" · ") : "Manual";
}
export function formDeliveryMatches(f: DeliveryForm, filter: "manual" | "automatic"): boolean {
  const system = f.settings?.system_setup === true || isSetupSystemForm(f);
  if (filter === "manual") return !system; // native library forms can also be sent by hand
  return system || !!(f.recurrence && f.recurrence !== "none") || !!f.popup_enabled || !!f.auto_assign_new_clients;
}
