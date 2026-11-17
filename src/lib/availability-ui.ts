/**
 * Smart availability on the coach's screens: the week as bars of the day
 * (pure, tested), and saving his settings and date changes (RLS: coaches and
 * admins). The engine itself is smart-availability.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { hmToMin, minToHm, rangeLabel } from "@/lib/booking-slots";
import { localTimeHM } from "@/lib/schedule-time";
import { sanitizeAvailability, type AvailabilitySettings, type OverrideKind } from "@/lib/smart-availability";

const db = supabase as any;

export const AVAILABILITY_QUERY = "availability-preview";

export async function saveAvailabilitySettings(next: AvailabilitySettings, userId: string | null): Promise<void> {
  const clean = sanitizeAvailability(next);
  const { error } = await db
    .from("booking_availability")
    .upsert({ id: true, settings: clean, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function addAvailabilityOverride(o: {
  date: string;
  kind: OverrideKind;
  start?: string | null;
  end?: string | null;
  note?: string | null;
  userId: string | null;
}): Promise<void> {
  // One "day off" / "smart day" per date: a second tap is the same change.
  if (o.kind === "off" || o.kind === "smart") {
    await db.from("booking_availability_overrides").delete().eq("date", o.date).eq("kind", o.kind);
  }
  const { error } = await db.from("booking_availability_overrides").insert({
    date: o.date,
    kind: o.kind,
    start_time: o.kind === "block" || o.kind === "open" ? o.start : null,
    end_time: o.kind === "block" || o.kind === "open" ? o.end : null,
    note: o.note ?? null,
    created_by: o.userId,
  });
  if (error) throw new Error(error.message);
}

export async function removeAvailabilityOverride(id: string): Promise<void> {
  const { error } = await db.from("booking_availability_overrides").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Times to pick from: every half hour, 5 AM to 10 PM. */
export const TIME_CHOICES: string[] = Array.from({ length: (22 - 5) * 2 + 1 }, (_, i) => minToHm(5 * 60 + i * 30));

export function timeLabel(hmStr: string): string {
  const m = hmToMin(hmStr);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`;
}

export { rangeLabel };

/** The hours a week's bars cover: his day, an hour either side, stretched to whatever is on. */
export function barScale(
  settings: Pick<AvailabilitySettings, "dayStart" | "dayEnd">,
  edges: Array<{ start: number; end: number }>,
): { from: number; to: number } {
  let from = Math.max(0, hmToMin(settings.dayStart) - 60);
  let to = Math.min(24 * 60, hmToMin(settings.dayEnd) + 60);
  for (const e of edges) {
    from = Math.min(from, Math.max(0, e.start));
    to = Math.max(to, Math.min(24 * 60, e.end));
  }
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
}

/** An instant range as minutes of its day in his zone ("24:00" for a midnight end). */
export function toDayMinutes(r: { start: number; end: number }, tz: string): { start: number; end: number } {
  const s = hmToMin(localTimeHM(new Date(r.start), tz));
  let e = hmToMin(localTimeHM(new Date(r.end), tz));
  if (e <= s) e = 24 * 60;
  return { start: s, end: e };
}

/** Left / width in % of a bar covering [from, to] minutes. */
export function barPlace(r: { start: number; end: number }, scale: { from: number; to: number }): { left: number; width: number } | null {
  const span = scale.to - scale.from;
  const s = Math.max(scale.from, r.start);
  const e = Math.min(scale.to, r.end);
  if (e <= s || span <= 0) return null;
  return { left: ((s - scale.from) / span) * 100, width: ((e - s) / span) * 100 };
}

/** "Mon 16" */
export function shortDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}

export const WEEKDAY_CHOICES = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

export const MODE_COPY: Record<AvailabilitySettings["mode"], { label: string; line: string }> = {
  manual: { label: "Manual", line: "Each call type's own hours, minus anything busy and your protected time." },
  assisted: { label: "Assisted", line: "Your hours as they are. The smart picks are shown, and you accept them a day at a time." },
  auto: { label: "Automatic", line: "Calls go where they cost you least, inside your boundaries. Updates as your calendar changes." },
};

/** One line for the card: what this week offers. */
export function weekSummary(days: Array<{ slotCount: number; closed: boolean }>, mode: AvailabilitySettings["mode"]): string {
  const times = days.reduce((n, d) => n + d.slotCount, 0);
  const open = days.filter((d) => d.slotCount > 0).length;
  if (!times) return `${MODE_COPY[mode].label} · nothing open this week`;
  return `${MODE_COPY[mode].label} · ${times} call time${times === 1 ? "" : "s"} open on ${open} day${open === 1 ? "" : "s"} this week`;
}

export function windowsText(ranges: Array<{ start: number; end: number }>, tz: string): string {
  return ranges
    .map((r) => {
      const m = toDayMinutes(r, tz);
      return rangeLabel(minToHm(m.start), m.end >= 24 * 60 ? "24:00" : minToHm(m.end));
    })
    .join(", ");
}
