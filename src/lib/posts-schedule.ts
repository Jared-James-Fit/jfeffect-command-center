/**
 * The coach's Posts tab, read as one schedule (Nov 8 2026: "The organization
 * of the admin/coach posts to view/ manage them is confusing"): every post
 * that goes out under his name in the next two weeks, day by day in the order
 * they go out, whatever made it (a lesson, an Athlete Insight, Tuesday's tip,
 * Wednesday Wins, a holiday, a birthday), and what's gone out lately. Pure, so
 * it's tested; the screen (posts-schedule.tsx) opens each one's own editor.
 */

export type ScheduleKind = "lesson" | "insight" | "tip" | "wins" | "recap" | "series" | "holiday" | "birthday";
/**
 * ready: written, goes out on its own · making: being made right now ·
 * planned: made closer to its day · from_logs: written from the crew's logs as
 * it goes out · needs_ok: waits for his OK (lessons on "Review each one") ·
 * paused: posting is paused · posted: out · not_set: nothing picked ·
 * problem: couldn't be made or didn't go out (its editor says why).
 */
export type ScheduleStatus = "ready" | "making" | "planned" | "from_logs" | "needs_ok" | "paused" | "posted" | "not_set" | "problem";

export type ScheduleItem = {
  key: string;
  kind: ScheduleKind;
  /** Its local day (Winnipeg), YYYY-MM-DD. */
  day: string;
  /** "7 am", "8:30 pm". */
  time: string;
  /** Minutes after midnight, for the order within a day. */
  minute: number;
  /** "Lesson", "Athlete Insight", "Tuesday Tip"… */
  label: string;
  title: string;
  status: ScheduleStatus;
  /** A picture's storage path, when it has one. */
  picture: string | null;
  postId: string | null;
  /** What opens it: a lesson plan row, an Insight, a birthday post (or a birthday not written yet), a series. */
  ref: { lesson?: string; insight?: string; birthday?: string; birthdayClient?: string; series?: string };
};
export type ScheduleDay = { day: string; label: string; items: ScheduleItem[] };

export const KIND_LABEL: Record<ScheduleKind, string> = {
  lesson: "Lesson",
  insight: "Athlete Insight",
  tip: "Tuesday Tip",
  wins: "Wednesday Wins",
  recap: "Sunday Recap",
  series: "Daily series",
  holiday: "Holiday",
  birthday: "Birthday",
};

export const STATUS_LABEL: Record<ScheduleStatus, string> = {
  ready: "Ready",
  making: "Being made",
  planned: "Planned",
  from_logs: "From the logs",
  needs_ok: "Needs your OK",
  paused: "Paused",
  posted: "Posted",
  not_set: "Nothing picked",
  problem: "Needs a look",
};

/** The series that post on their own (Wins always, the rest while they're on): ISO weekday and time. */
export const SERIES_SLOT: Record<string, { dow: number; minute: number; kind: ScheduleKind; name: string }> = {
  monday_motivation: { dow: 1, minute: 7 * 60, kind: "series", name: "Monday Motivation" },
  tuesday_tips: { dow: 2, minute: 12 * 60, kind: "tip", name: "Tuesday Tip" },
  wednesday_wins: { dow: 3, minute: 12 * 60, kind: "wins", name: "Wednesday Wins" },
  try_it_thursday: { dow: 4, minute: 12 * 60, kind: "series", name: "Try it Thursday" },
  finish_strong_friday: { dow: 5, minute: 7 * 60, kind: "series", name: "Finish Strong Friday" },
  saturday_spirit: { dow: 6, minute: 9 * 60, kind: "series", name: "Saturday Spirit" },
  sunday_recap: { dow: 7, minute: 19 * 60, kind: "recap", name: "Sunday Recap" },
};
/** An Athlete Insight goes out at 7, a holiday at 9, a birthday at 8 (Winnipeg). */
export const INSIGHT_MINUTE = 7 * 60;
export const HOLIDAY_MINUTE = 9 * 60;
export const BIRTHDAY_MINUTE = 8 * 60;

export type ScheduleSource = {
  /** Today, the coach's local day (YYYY-MM-DD). */
  today: string;
  /** How many days ahead, today included (14 by default). */
  days?: number;
  tz?: string;
  /** Coach posts paused: nothing goes out until they're back on. */
  paused?: boolean;
  lessonMode?: "review" | "auto";
  lessons?: {
    id: string;
    day: string;
    post_at: string;
    status: string;
    posted_as?: string | null;
    post_id: string | null;
    item: { title: string } | null;
  }[];
  /** Athlete Insights switched on (off: none go out, so none are listed). */
  insightsOn?: boolean;
  insights?: {
    id: string;
    day: string;
    status: string;
    line: string | null;
    picture: string | null;
    regen?: string | null;
    working?: boolean;
    held?: boolean;
    post_id: string | null;
    archived?: boolean;
  }[];
  /** The switched series that are on (Wins always runs). */
  seriesOn?: string[];
  /** The next library item for each series (Tuesday's tip). */
  nextItems?: Partial<Record<string, { body: string }>>;
  /** Series posts already out, to mark a day's as posted (and for Recently out). */
  history?: { id: string; series: string; created_at: string; caption: string | null }[];
  holidays?: { key: string; name: string; date: string; body: string; posted: boolean }[];
  birthdays?: { id: string; post_at: string; status: string; post_id: string | null; person?: { name: string } | null }[];
  /** Birthdays coming up that aren't written yet (the draft lands the evening before). */
  birthdaysNext?: { client_id: string; birthday: string; person?: { name: string } | null }[];
};

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** ISO weekday (Monday = 1) of a YYYY-MM-DD. */
export const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Manitoba kept UTC-5 when the clocks would have fallen back (Nov 1 2026, 2 am CDT); a phone or runtime with older zone rules still drops it to UTC-6. */
const MANITOBA_FIXED_FROM = Date.parse("2026-11-01T07:00:00Z");
const MANITOBA_ZONES = new Set(["America/Winnipeg", "America/Rainy_River", "Canada/Central"]);

/** An instant's local day and minutes after midnight (Manitoba as it really is, whatever the device's zone rules). */
export function localParts(iso: string | Date, tz = "America/Winnipeg"): { day: string; minute: number } {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  if (MANITOBA_ZONES.has(tz) && t.getTime() >= MANITOBA_FIXED_FROM) {
    const local = new Date(t.getTime() - 5 * 3_600_000);
    return { day: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/** "7 am", "12 pm", "8:30 pm". */
export function clockText(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "Today", "Tomorrow", "Yesterday", else "Mon, Nov 10". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** A caption's first line, short enough for a row. */
export function firstLine(text: string | null | undefined, max = 90): string | null {
  const line = (text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Statuses that are still on their way out (paused stops them). */
const WAITING: ScheduleStatus[] = ["ready", "planned", "from_logs", "needs_ok", "making"];

function lessonStatus(r: NonNullable<ScheduleSource["lessons"]>[number], mode: "review" | "auto"): ScheduleStatus {
  if (r.status === "posted") return "posted";
  if (r.status === "failed" || r.status === "missed") return "problem";
  if (!r.item) return "not_set";
  if (r.status === "planned" && mode === "review") return "needs_ok";
  return "ready";
}

function insightStatus(d: NonNullable<ScheduleSource["insights"]>[number]): ScheduleStatus {
  if (d.status === "posted") return "posted";
  if (d.working || d.regen) return "making";
  if (d.status === "failed") return "problem";
  if (d.held) return "needs_ok";
  if (d.status === "ready") return "ready";
  return "planned";
}

/** Every post under his name from today for `days` days, grouped by day in the order they go out. */
export function buildSchedule(src: ScheduleSource): ScheduleDay[] {
  const tz = src.tz ?? "America/Winnipeg";
  const span = src.days ?? 14;
  const last = addDays(src.today, span - 1);
  const inside = (day: string) => day >= src.today && day <= last;
  const items: ScheduleItem[] = [];

  for (const r of src.lessons ?? []) {
    if (r.status === "skipped" || !inside(r.day)) continue;
    const at = localParts(r.post_at, tz);
    items.push({
      key: `lesson:${r.id}`,
      kind: "lesson",
      day: r.day,
      time: clockText(at.minute),
      minute: at.minute,
      label: KIND_LABEL.lesson,
      title: r.posted_as === "data" ? "The crew's own numbers" : (r.item?.title ?? "Nothing picked for this day"),
      status: lessonStatus(r, src.lessonMode ?? "auto"),
      picture: null,
      postId: r.post_id,
      ref: { lesson: r.id },
    });
  }

  if (src.insightsOn !== false) {
    for (const d of src.insights ?? []) {
      if (!inside(d.day) || d.status === "skipped" || d.archived) continue;
      const status = insightStatus(d);
      items.push({
        key: `insight:${d.id}`,
        kind: "insight",
        day: d.day,
        time: clockText(INSIGHT_MINUTE),
        minute: INSIGHT_MINUTE,
        label: KIND_LABEL.insight,
        title: firstLine(d.line) ?? (status === "making" ? "Being written and drawn" : "Written and drawn a week before"),
        status,
        picture: d.picture,
        postId: d.post_id,
        ref: { insight: d.id },
      });
    }
  }

  // the series that post on their own: Wins every week, the switched ones while they're on
  const on = new Set(["wednesday_wins", ...(src.seriesOn ?? [])]);
  const out = new Map<string, { id: string; caption: string | null }>();
  for (const h of src.history ?? []) out.set(`${h.series}:${localParts(h.created_at, tz).day}`, { id: h.id, caption: h.caption });
  const seen = new Set<string>();
  for (let i = 0; i < span; i++) {
    const day = addDays(src.today, i);
    for (const [series, slot] of Object.entries(SERIES_SLOT)) {
      if (!on.has(series) || slot.dow !== isoDow(day)) continue;
      const done = out.get(`${series}:${day}`);
      const fromLogs = series === "wednesday_wins" || series === "sunday_recap";
      const next = seen.has(series) ? undefined : src.nextItems?.[series];
      seen.add(series);
      items.push({
        key: `series:${series}:${day}`,
        kind: slot.kind,
        day,
        time: clockText(slot.minute),
        minute: slot.minute,
        label: slot.name,
        title: done
          ? (firstLine(done.caption) ?? slot.name)
          : series === "wednesday_wins"
            ? "Last week's wins, from the logs"
            : series === "sunday_recap"
              ? "This week's numbers, from the logs"
              : (firstLine(next?.body) ?? "The next one from its library"),
        status: done ? "posted" : fromLogs ? "from_logs" : "ready",
        picture: null,
        postId: done?.id ?? null,
        ref: { series },
      });
    }
  }

  for (const h of src.holidays ?? []) {
    if (!inside(h.date)) continue;
    items.push({
      key: `holiday:${h.key}:${h.date}`,
      kind: "holiday",
      day: h.date,
      time: clockText(HOLIDAY_MINUTE),
      minute: HOLIDAY_MINUTE,
      label: KIND_LABEL.holiday,
      title: h.name,
      status: h.posted ? "posted" : "ready",
      picture: null,
      postId: null,
      ref: { series: "holiday" },
    });
  }

  const written = new Set<string>();
  for (const b of src.birthdays ?? []) {
    if (b.status === "skipped") continue;
    const at = localParts(b.post_at, tz);
    if (!inside(at.day)) continue;
    written.add(at.day + (b.person?.name ?? ""));
    items.push({
      key: `birthday:${b.id}`,
      kind: "birthday",
      day: at.day,
      time: clockText(at.minute),
      minute: at.minute,
      label: KIND_LABEL.birthday,
      title: b.person?.name ? `${b.person.name}'s birthday` : "A birthday",
      status: b.status === "posted" ? "posted" : "ready",
      picture: null,
      postId: b.post_id,
      ref: { birthday: b.id },
    });
  }
  for (const n of src.birthdaysNext ?? []) {
    if (!inside(n.birthday) || written.has(n.birthday + (n.person?.name ?? ""))) continue;
    items.push({
      key: `birthday-next:${n.client_id}`,
      kind: "birthday",
      day: n.birthday,
      time: clockText(BIRTHDAY_MINUTE),
      minute: BIRTHDAY_MINUTE,
      label: KIND_LABEL.birthday,
      title: n.person?.name ? `${n.person.name}'s birthday · written the evening before` : "A birthday · written the evening before",
      status: "planned",
      picture: null,
      postId: null,
      ref: { birthdayClient: n.client_id },
    });
  }

  if (src.paused) for (const it of items) if (WAITING.includes(it.status)) it.status = "paused";

  const byDay = new Map<string, ScheduleItem[]>();
  for (const it of items) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, label: dayLabel(day, src.today), items: list.sort((a, b) => a.minute - b.minute || a.key.localeCompare(b.key)) }));
}

/** The next one still to go out from `now` (a past time today that isn't out yet still counts: it's late, not gone). */
export function nextUp(days: ScheduleDay[], now: { day: string; minute: number }): ScheduleItem | null {
  const waiting = days.flatMap((d) => d.items).filter((it) => it.status !== "posted" && it.status !== "problem" && it.status !== "not_set");
  return waiting.find((it) => it.day > now.day || (it.day === now.day && it.minute >= now.minute)) ?? waiting[0] ?? null;
}

/** What's gone out lately (the last `recentDays` days, newest first): lessons, Insights, the series, holidays and birthdays. */
export function buildRecent(src: ScheduleSource & { recentDays?: number }): ScheduleItem[] {
  const tz = src.tz ?? "America/Winnipeg";
  const first = addDays(src.today, -(src.recentDays ?? 7));
  const within = (day: string) => day >= first && day <= src.today;
  const out: ScheduleItem[] = [];
  for (const r of src.lessons ?? []) {
    if (r.status !== "posted" || !within(r.day)) continue;
    const at = localParts(r.post_at, tz);
    out.push({
      key: `lesson:${r.id}`, kind: "lesson", day: r.day, time: clockText(at.minute), minute: at.minute, label: KIND_LABEL.lesson,
      title: r.posted_as === "data" ? "The crew's own numbers" : (r.item?.title ?? KIND_LABEL.lesson), status: "posted", picture: null, postId: r.post_id, ref: { lesson: r.id },
    });
  }
  for (const d of src.insights ?? []) {
    if (d.status !== "posted" || d.archived || !within(d.day)) continue;
    out.push({
      key: `insight:${d.id}`, kind: "insight", day: d.day, time: clockText(INSIGHT_MINUTE), minute: INSIGHT_MINUTE, label: KIND_LABEL.insight,
      title: firstLine(d.line) ?? KIND_LABEL.insight, status: "posted", picture: d.picture, postId: d.post_id, ref: { insight: d.id },
    });
  }
  // every other coach post that went out (a lesson or Insight the plans above already hold counts once)
  const OWN_KIND: Record<string, ScheduleKind> = { lesson: "lesson", daily_visual: "insight", holiday: "holiday" };
  for (const h of src.history ?? []) {
    const at = localParts(h.created_at, tz);
    if (!within(at.day)) continue;
    const slot = SERIES_SLOT[h.series];
    const kind = slot?.kind ?? OWN_KIND[h.series] ?? "series";
    out.push({
      key: `post:${h.id}`, kind, day: at.day, time: clockText(at.minute), minute: at.minute,
      label: slot?.name ?? KIND_LABEL[kind], title: firstLine(h.caption) ?? slot?.name ?? KIND_LABEL[kind], status: "posted",
      picture: null, postId: h.id, ref: { series: h.series },
    });
  }
  for (const b of src.birthdays ?? []) {
    if (b.status !== "posted") continue;
    const at = localParts(b.post_at, tz);
    if (!within(at.day)) continue;
    out.push({
      key: `birthday:${b.id}`, kind: "birthday", day: at.day, time: clockText(at.minute), minute: at.minute, label: KIND_LABEL.birthday,
      title: b.person?.name ? `${b.person.name}'s birthday` : "A birthday", status: "posted", picture: null, postId: b.post_id, ref: { birthday: b.id },
    });
  }
  // one row per post, newest first
  const byPost = new Map<string, ScheduleItem>();
  for (const it of out) byPost.set(it.postId ?? it.key, byPost.get(it.postId ?? it.key) ?? it);
  return [...byPost.values()].sort((a, b) => b.day.localeCompare(a.day) || b.minute - a.minute);
}
