/**
 * Everything the week's Split view reads, worked out once (Nov 25 2026):
 * each workout's title and status (week-split.ts), how long a finished one
 * took (session-duration.ts: measured, reconstructed or not shown), how long
 * an upcoming one will likely take (their own pace against the plan's
 * estimate), and its time: the confirmed one, or a suggested one
 * (workout-time-suggest.ts) clear of their own Google events (read live, the
 * calendar's query; the athlete's own view only, never a coach's preview),
 * their sessions and appointments, and other workouts' confirmed times.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { clientGoogleQuery, type CalendarItem } from "@/lib/calendar-sources";
import { updateScheduledWorkoutTime } from "@/lib/scheduled-workouts.functions";
import { feedback } from "@/lib/feedback";
import { localStartOfToday, parseLocalDate, toLocalISO } from "@/lib/today";
import type { WorkoutItem } from "@/lib/workout-today";
import { isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";
import { buildWeekSplit, type SplitEntry, type SplitTime } from "@/lib/workouts/week-split";
import {
  durationKindOf,
  durationOfCompletion,
  predictDuration,
  type DurationHistory,
} from "@/lib/workouts/session-duration";
import {
  TODAY_LEAD_MIN,
  busyOnDay,
  confirmedClash,
  habitStart,
  parseTimeValue,
  suggestWorkoutTime,
  type BusyBlock,
  type StartHistory,
} from "@/lib/workouts/workout-time-suggest";

const DISMISSED_KEY = "jf.workouts.dismissed-times";
const DISMISSED_MAX = 200;

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function useWeekSplit({
  clientId,
  self,
  items,
  byDate,
  selectedDate,
  sessionsByDate,
}: {
  clientId: string;
  /** the athlete's own view: suggestions and their Google; a coach sees confirmed times only */
  self: boolean;
  items: readonly WorkoutItem[];
  byDate: Map<string, WorkoutItem[]>;
  selectedDate: Date;
  sessionsByDate: Map<string, CalendarItem[]>;
}) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekIso = toLocalISO(weekStart);
  const google = useQuery({ ...clientGoogleQuery(self ? clientId : null), enabled: self && !!clientId });
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  // Their own history: each finished workout's length against its estimate, and when it started.
  const { durationHistory, startHistory } = useMemo(() => {
    const done = items
      .filter((it) => it.completion?.completed_at && !isAtHomeBackupSessionBlock(it.block))
      .sort((a, b) => String(a.completion.completed_at).localeCompare(String(b.completion.completed_at)));
    const durationHistory: DurationHistory[] = [];
    const startHistory: StartHistory[] = [];
    for (const it of done) {
      const est = it.completion.estimated_duration_min ?? it.estimated_minutes ?? null;
      const read = durationOfCompletion(it.completion, { estimatedMin: est });
      if (!read) continue;
      durationHistory.push({ estimatedMin: est, actualMin: read.minutes, source: read.source });
      if (read.source !== "estimated" && read.performedStart) {
        const d = read.performedStart;
        startHistory.push({ weekday: d.getDay(), startMin: d.getHours() * 60 + d.getMinutes() });
      }
    }
    return { durationHistory, startHistory: startHistory.slice(-30) };
  }, [items]);

  const week = useMemo(() => {
    const now = new Date();
    const today = localStartOfToday();
    const googleEvents = (google.data as any)?.events ?? [];
    const predictionOf = (it: WorkoutItem) => predictDuration(it.estimated_minutes ?? null, durationHistory);
    const busyFor = (iso: string, except: WorkoutItem): BusyBlock[] => {
      const day = parseLocalDate(iso)!;
      const out: BusyBlock[] = [];
      for (const s of sessionsByDate.get(iso) ?? []) {
        const b = busyOnDay(day, { start: s.startsAt, end: s.endsAt });
        if (b) out.push(b);
      }
      const dayEnd = addDays(day, 1).getTime();
      for (const g of googleEvents) {
        if (g.allDay) {
          // all-day: information only, on the days it covers
          if (String(g.start) <= iso && (!g.end || String(g.end) > iso)) out.push({ start: 0, end: 1440, informational: true });
          continue;
        }
        const s = new Date(g.start).getTime();
        if (!(s < dayEnd) || (g.end && new Date(g.end).getTime() <= day.getTime())) continue;
        const b = busyOnDay(day, { start: g.start, end: g.end, free: !!g.free });
        if (b) out.push(b);
      }
      for (const other of byDate.get(iso) ?? []) {
        if (other === except) continue;
        const t = parseTimeValue(other.scheduledTime);
        if (t == null) continue;
        const len = predictionOf(other)?.minutes ?? other.estimated_minutes ?? 60;
        out.push({ start: t, end: t + len });
      }
      return out;
    };
    const timeOf = (it: WorkoutItem, iso: string): SplitTime | null => {
      const confirmed = parseTimeValue(it.scheduledTime);
      const pred = predictionOf(it);
      if (confirmed != null) {
        return { kind: "confirmed", startMin: confirmed, clash: confirmedClash(confirmed, pred?.minutes ?? 60, busyFor(iso, it)) };
      }
      if (!self || !it.scheduledWorkoutId || dismissed.has(it.scheduledWorkoutId) || !pred) return null;
      const isToday = iso === toLocalISO(today);
      const s = suggestWorkoutTime({
        busy: busyFor(iso, it),
        durationMin: pred.minutes,
        durationHighMin: pred.high,
        habitStartMin: habitStart(startHistory, parseLocalDate(iso)!.getDay()),
        notBeforeMin: isToday ? now.getHours() * 60 + now.getMinutes() + TODAY_LEAD_MIN : null,
      });
      return s ? { kind: "suggested", startMin: s.startMin } : { kind: "none" };
    };
    return buildWeekSplit({
      weekStart,
      byDate,
      today,
      now,
      include: (it) => !isAtHomeBackupSessionBlock(it.block),
      durationOf: (it) => {
        const read = durationOfCompletion(it.completion, { estimatedMin: it.completion?.estimated_duration_min ?? it.estimated_minutes ?? null });
        return read ? { minutes: read.minutes, kind: durationKindOf(read) } : null;
      },
      predictionOf,
      timeOf,
    });
    // weekIso stands for weekStart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekIso, byDate, sessionsByDate, google.data, dismissed, durationHistory, startHistory, self]);

  const qc = useQueryClient();
  const setTime = useServerFn(updateScheduledWorkoutTime);
  const [pending, setPending] = useState(false);
  const confirm = useCallback(
    async (entry: SplitEntry, time: string | null) => {
      const id = entry.item.scheduledWorkoutId;
      if (!id) return;
      setPending(true);
      try {
        // the time only: never the date, the prescription or the order
        await setTime({ data: { instanceId: id, time } });
        feedback("success");
        await qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't save the time.");
      } finally {
        setPending(false);
      }
    },
    [setTime, qc, clientId],
  );
  const dismiss = useCallback((entry: SplitEntry) => {
    const id = entry.item.scheduledWorkoutId;
    if (!id) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-DISMISSED_MAX)));
      } catch {
        /* this visit only */
      }
      return next;
    });
  }, []);

  return { week, weekStart, timeActions: { confirm, dismiss, pending } };
}
