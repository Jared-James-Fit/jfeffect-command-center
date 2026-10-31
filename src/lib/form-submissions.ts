// Admin → Forms → Submissions: everything clients send in, in one list.
// Weekly check-ins, Nutrition Updates and other native forms, progress photos
// and videos, old Fillout forms and website applications, newest first and
// grouped by day. Pure (the server function feeds it rows) and tested.

export type SubmissionKind = "weekly_checkin" | "nutrition_update" | "form" | "progress" | "fillout" | "application";
export type SubmissionSource = "checkin" | "native" | "progress" | "fillout" | "application";

export type FormSubmission = {
  /** `${source}:${id}`, unique across sources. */
  key: string;
  source: SubmissionSource;
  kind: SubmissionKind;
  /** The row's own id in its table (messenger_checkins / nf_submissions / progress_submissions / fillout_submissions / coaching_applications). */
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  /** The client's photo for the coach's list (clients.profile_picture_url), if any. */
  photo: string | null;
  submittedAt: string;
  /**
   * true / false where the coach marks it reviewed (check-ins, forms, Fillout,
   * applications); null where review lives elsewhere (progress photos and
   * videos are reviewed in Coaching → Progress), so they never count as waiting.
   */
  reviewed: boolean | null;
  /** One short extra: "182 lb", "Not matched to a client". */
  detail: string | null;
  formId: string | null;
};

/** Filter chips, in the order the coach works them. */
export const SUBMISSION_KINDS: Array<{ kind: SubmissionKind; label: string }> = [
  { kind: "weekly_checkin", label: "Weekly check-ins" },
  { kind: "nutrition_update", label: "Nutrition updates" },
  { kind: "progress", label: "Progress photos & videos" },
  { kind: "form", label: "Other forms" },
  { kind: "fillout", label: "Fillout" },
  { kind: "application", label: "Applications" },
];

export const KIND_LABEL: Record<SubmissionKind, string> = Object.fromEntries(
  SUBMISSION_KINDS.map((k) => [k.kind, k.label]),
) as Record<SubmissionKind, string>;

/**
 * An unreviewed submission counts as waiting on the coach only while it's this
 * fresh: older ones read "Not reviewed" but stay out of the count, so a
 * backlog from months ago never buries this week's.
 */
export const TO_REVIEW_DAYS = 30;

/** How long a form can go without a submission, a send or an edit before it's archived on its own (archive_unused_forms). */
export const FORM_UNUSED_DAYS = 60;

export function isToReview(s: Pick<FormSubmission, "reviewed" | "submittedAt">, now = Date.now()): boolean {
  if (s.reviewed !== false) return false;
  const t = Date.parse(s.submittedAt);
  return Number.isFinite(t) && now - t <= TO_REVIEW_DAYS * 86_400_000;
}

export type StatusFilter = "all" | "to_review";

export function filterSubmissions(
  rows: FormSubmission[],
  f: { kind: SubmissionKind | "all"; status: StatusFilter; search: string },
  now = Date.now(),
): FormSubmission[] {
  const q = f.search.trim().toLowerCase();
  return rows
    .filter((r) => f.kind === "all" || r.kind === f.kind)
    .filter((r) => f.status === "all" || isToReview(r, now))
    .filter((r) => !q || r.clientName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export type KindCount = { total: number; toReview: number };

/** Per chip: how many there are and how many are waiting on the coach. */
export function countByKind(rows: FormSubmission[], now = Date.now()): Record<SubmissionKind | "all", KindCount> {
  const out = { all: { total: 0, toReview: 0 } } as Record<SubmissionKind | "all", KindCount>;
  for (const k of SUBMISSION_KINDS) out[k.kind] = { total: 0, toReview: 0 };
  for (const r of rows) {
    const waiting = isToReview(r, now) ? 1 : 0;
    out[r.kind].total += 1;
    out[r.kind].toReview += waiting;
    out.all.total += 1;
    out.all.toReview += waiting;
  }
  return out;
}

const TZ = "America/Winnipeg";

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * "Today", "Yesterday", "Tuesday" (this week), then "Oct 12" (this year) and
 * "Dec 30, 2025". Days in the coach's time zone.
 */
export function dayLabel(iso: string, now = Date.now(), tz = TZ): string {
  const day = dayKey(iso, tz);
  const today = dayKey(new Date(now).toISOString(), tz);
  if (day === today) return "Today";
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString(), tz);
  if (day === yesterday) return "Yesterday";
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  const d = new Date(`${day}T12:00:00Z`);
  if (age > 0 && age < 7) return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** Rows already newest first → one group per day, in order. */
export function groupByDay(rows: FormSubmission[], now = Date.now(), tz = TZ): Array<{ label: string; rows: FormSubmission[] }> {
  const groups: Array<{ label: string; key: string; rows: FormSubmission[] }> = [];
  for (const r of rows) {
    const key = dayKey(r.submittedAt, tz);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else groups.push({ key, label: dayLabel(r.submittedAt, now, tz), rows: [r] });
  }
  return groups.map(({ label, rows }) => ({ label, rows }));
}

/** Which kind a native form submission is. */
export function nativeKind(formId: string | null, nutritionFormId: string): SubmissionKind {
  return formId === nutritionFormId ? "nutrition_update" : "form";
}
