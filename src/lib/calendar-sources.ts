import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getClientWorkouts } from "@/lib/pl-programs";
import { resolveWeekDayDates } from "@/lib/workout-today";
import { listGoogleEventsRange, getGoogleConnectionStatus } from "@/lib/google-cal.functions";
import { resolveClientWeekDays, type ResolvedWorkoutDate } from "@/lib/resolved-client-days";
import { toLocalISO } from "@/lib/today";

/**
 * Phase 1 calendar item — a single chip rendered on the calendar grid.
 * Read-only aggregation across multiple existing tables.
 */
export type CalendarKind =
  | "event"
  | "important_date"
  | "appointment"
  | "pt_session"
  | "workout"
  | "check_in"
  | "google_event"
  | "membership_event"
  | "cardio";

export type CalendarItem = {
  id: string;             // stable unique id (kind-prefixed)
  kind: CalendarKind;
  date: string;           // yyyy-mm-dd local-date for grid placement
  startsAt?: string | null; // ISO if known
  endsAt?: string | null;
  title: string;
  subtitle?: string | null;
  importance?: "Low" | "Medium" | "High" | "Critical" | null;
  status?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  // CTA: where to send the user when they tap "Open"
  href?: { to: string; params?: Record<string, string> } | null;
  raw?: any;
};

export const KIND_META: Record<CalendarKind, { label: string; chip: string; dot: string }> = {
  event:          { label: "Event",        chip: "bg-primary/15 text-primary border-primary/30",                dot: "bg-primary" },
  important_date: { label: "Key Date",     chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",          dot: "bg-amber-400" },
  appointment:    { label: "Appointment",  chip: "bg-blue-500/15 text-blue-300 border-blue-500/30",             dot: "bg-blue-400" },
  pt_session:     { label: "PT Session",   chip: "bg-violet-500/15 text-violet-300 border-violet-500/30",       dot: "bg-violet-400" },
  workout:        { label: "Workout",      chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",    dot: "bg-emerald-400" },
  check_in:       { label: "Check-In",     chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",           dot: "bg-amber-400" },
  google_event:   { label: "Google",       chip: "bg-sky-500/15 text-sky-300 border-sky-500/30",                dot: "bg-sky-400" },
  membership_event: { label: "Membership", chip: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",    dot: "bg-fuchsia-400" },
  cardio:           { label: "Cardio",      chip: "bg-rose-500/15 text-rose-300 border-rose-500/30",              dot: "bg-rose-400" },
};

/** Per-kind action label so clients/admins see the *thing they can do*, not just "Open". */
export const CTA_LABELS: Record<CalendarKind, string> = {
  event:          "View Event Details",
  important_date: "View Details",
  appointment:    "Open Appointment",
  pt_session:     "View Session Details",
  workout:        "Open Workout",
  check_in:       "Submit Check-In",
  google_event:   "Open in Google",
  membership_event: "Open Member",
  cardio:           "View Cardio",
};
export function ctaLabel(item: { kind: CalendarKind; raw?: any }): string {
  if (item.kind === "event") {
    const t = (item.raw?.event_type ?? "").toLowerCase();
    if (t.includes("meet") || t.includes("competition")) return "View Meet Details";
  }
  return CTA_LABELS[item.kind];
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeFromTimeStr(t?: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

/* ============================================================
 * CLIENT
 * ============================================================ */
export function useClientCalendarSources(clientId: string | null | undefined) {
  const enabled = !!clientId;

  const eventsQ = useQuery({
    queryKey: ["cal-client-events", clientId],
    enabled,
    queryFn: async () => {
      // Explicit client_id scoping (not RLS-dependent) so admin POV does not
      // leak admin-visible events. We accept rows that are either:
      //   - assigned to this client via event_assignments, OR
      //   - scoped to all_coaching audience.
      const [assignsRes, eventsRes] = await Promise.all([
        (supabase.from("event_assignments") as any)
          .select("event_id")
          .eq("client_id", clientId!),
        (supabase.from("events") as any)
          .select("id,name,event_type,event_date,start_time,end_time,timezone,location,importance,status,client_facing_notes,description,audience_scope")
          .in("status", ["Active", "Completed"]),
      ]);
      const assignedIds = new Set<string>(((assignsRes.data ?? []) as any[]).map((r) => r.event_id));
      const events = ((eventsRes.data ?? []) as any[]).filter(
        (e) => assignedIds.has(e.id) || e.audience_scope === "all_coaching",
      );
      return events;
    },
  });

  const importantQ = useQuery({
    queryKey: ["cal-client-important", clientId],
    enabled,
    queryFn: async () => {
      const { data } = await (supabase.from("important_dates") as any)
        .select("id,title,date_type,custom_type,target_date,notes,status")
        .eq("client_id", clientId!)
        .eq("visible_to_client", true);
      return (data ?? []) as any[];
    },
  });

  const apptsQ = useQuery({
    queryKey: ["cal-client-appts", clientId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id,title,appointment_type,starts_at,ends_at,timezone,status,location,meet_link")
        .eq("client_id", clientId!);
      return (data ?? []) as any[];
    },
  });

  const ptQ = useQuery({
    queryKey: ["cal-client-pt", clientId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("id,title,session_type,session_date,start_time,end_time,status,location,notes,client_visible_notes")
        .eq("client_id", clientId!);
      return (data ?? []) as any[];
    },
  });

  const workoutsQ = useQuery({
    queryKey: ["cal-client-workouts", clientId],
    enabled,
    queryFn: () => getClientWorkouts(clientId!),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  // Fetch client committed training days for calendar date resolution.
  // ROOT CAUSE FIX 2026-06-26: without this, dayScheduledDate uses linear
  // distribution instead of the client's actual schedule (e.g. Mon/Wed/Fri).
  const clientQ = useQuery({
    queryKey: ["cal-client-data", clientId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("committed_training_days")
        .eq("id", clientId!)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });
  const committedDays = (clientQ.data as any)?.committed_training_days ?? null;

  const checkinsQ = useQuery({
    queryKey: ["cal-client-checkins", clientId],
    enabled,
    queryFn: async () => {
      const { data } = await (supabase.from("nf_assignments") as any)
        .select("id,form_id,next_due_at,nf_forms!inner(id,title,active,archived)")
        .eq("client_id", clientId!)
        .not("next_due_at", "is", null);
      return ((data ?? []) as any[]).filter((r) => r.nf_forms?.active && !r.nf_forms?.archived);
    },
  });

  // Fetch active cardio targets + client schedule to generate calendar events
  const cardioQ = useQuery({
    queryKey: ["cal-client-cardio", clientId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [targetsRes, clientRes, overridesRes] = await Promise.all([
        supabase
          .from("cardio_targets")
          .select("id,day_type,custom_day_type,cardio_type,custom_type,duration_minutes,intensity,frequency_per_week,status,enabled,visible_to_client,client_notes")
          .eq("client_id", clientId!)
          .eq("status", "Active")
          .eq("enabled", true)
          .eq("visible_to_client", true)
          .is("program_name", null),
        supabase
          .from("clients")
          .select("committed_training_days,preferred_training_days,preferred_rest_days,preferred_high_days,full_cardio_rest_days")
          .eq("id", clientId!)
          .maybeSingle(),
        (supabase.from("nutrition_day_overrides") as any)
          .select("override_date,day_label")
          .eq("client_id", clientId!),
      ]);
      return {
        targets: (targetsRes.data ?? []) as any[],
        schedule: clientRes.data as any,
        overrides: (overridesRes.data ?? []) as Array<{ override_date: string; day_label: string }>,
      };
    },
  });

  // Realtime: keep the workouts layer in sync when a coach/admin reschedules
  // a day, edits a week range, or toggles block visibility. Without this the
  // calendar only updates after a manual refresh or window focus.
  const qc = useQueryClient();
  useEffect(() => {
    if (!clientId) return;
    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: ["cal-client-workouts", clientId] });
    };
    const channel = supabase
      .channel(`cal-workouts:${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_blocks", filter: `client_id=eq.${clientId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_weeks" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_days" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_day_completions", filter: `client_id=eq.${clientId}` }, invalidate)
      // Phase 2a: reflect newly scheduled / moved / copied instances live.
      .on("postgres_changes", { event: "*", schema: "public", table: "pl_scheduled_workouts", filter: `client_id=eq.${clientId}` }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clientId, qc]);

  const items: CalendarItem[] = useMemo(() => {
    const out: CalendarItem[] = [];

    for (const e of (eventsQ.data ?? [])) {
      const dt = e.event_date as string;
      if (!dt) continue;
      out.push({
        id: `event:${e.id}`,
        kind: "event",
        date: dt,
        title: e.name,
        subtitle: [e.event_type, timeFromTimeStr(e.start_time), e.location].filter(Boolean).join(" · "),
        importance: e.importance,
        status: e.status,
        href: { to: "/portal/events/$id", params: { id: e.id } },
        raw: e,
      });
    }
    for (const d of (importantQ.data ?? [])) {
      if (!d.target_date) continue;
      out.push({
        id: `important:${d.id}`,
        kind: "important_date",
        date: d.target_date,
        title: d.title,
        subtitle: d.custom_type ?? d.date_type ?? null,
        status: d.status,
        raw: d,
      });
    }
    for (const a of (apptsQ.data ?? [])) {
      if (!a.starts_at) continue;
      out.push({
        id: `appt:${a.id}`,
        kind: "appointment",
        date: toLocalDate(a.starts_at),
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        title: a.title || a.appointment_type || "Appointment",
        subtitle: [a.appointment_type, a.location].filter(Boolean).join(" · "),
        status: a.status,
        href: { to: "/portal/appointments" },
        raw: a,
      });
    }
    for (const s of (ptQ.data ?? [])) {
      if (!s.session_date) continue;
      out.push({
        id: `pt:${s.id}`,
        kind: "pt_session",
        date: s.session_date,
        title: s.title || "PT Session",
        subtitle: [s.session_type, timeFromTimeStr(s.start_time), s.location].filter(Boolean).join(" · "),
        status: s.status,
        href: { to: "/portal/calendar" },
        raw: s,
      });
    }
    // Group workout items by week so we can resolve every day's date in a
    // single collision-aware pass. This guarantees every day in the client's
    // program shows up on the calendar exactly once, even when a coach has
    // pinned some days to explicit dates that would otherwise clash with
    // derived dates for their siblings.
    {
      const workoutItems = (workoutsQ.data ?? []) as any[];
      const byWeek = new Map<string, any[]>();
      for (const it of workoutItems) {
        if (!it.day?.id || !it.week?.id) continue;
        const arr = byWeek.get(it.week.id) ?? [];
        arr.push(it);
        byWeek.set(it.week.id, arr);
      }
      for (const [, weekItems] of byWeek) {
        const week = weekItems[0]?.week;
        const block = weekItems[0]?.block;
        const dayRows = weekItems.map((it) => it.day);
        const dateMap = resolveWeekDayDates(dayRows, week, block, committedDays);
        for (const it of weekItems) {
          const resolved = dateMap.get(it.day.id);
          if (!resolved) continue;
          const date = toLocalISO(resolved);
          const completed = !!it.completion?.completed_at;
          out.push({
            // Phase 2a: stacked instances (two cards on the same date) need
            // distinct calendar IDs so React keys don't collide.
            id: `workout:${it.scheduledWorkoutId ?? it.day.id}`,
            kind: "workout",
            date: it.scheduledDate ?? date,
            title: it.day?.title || `Day ${it.day?.day_index ?? ""}`.trim(),
            subtitle: [it.block?.name, it.day?.focus].filter(Boolean).join(" · "),
            status: completed ? "Completed" : "Scheduled",
            href: { to: "/portal/workouts/$dayId", params: { dayId: it.day.id } },
            raw: it,
          });
        }
      }
    }
    for (const c of (checkinsQ.data ?? [])) {
      if (!c.next_due_at) continue;
      out.push({
        id: `checkin:${c.id}`,
        kind: "check_in",
        date: toLocalDate(c.next_due_at),
        startsAt: c.next_due_at,
        title: c.nf_forms?.title || "Check-In",
        subtitle: "Check-in due",
        href: { to: "/portal/check-ins" },
        raw: c,
      });
    }

    // Generate cardio calendar events for the current week ± 4 weeks
    const cardioTargets = cardioQ.data?.targets ?? [];
    const schedule = cardioQ.data?.schedule;
    const overridesList = cardioQ.data?.overrides ?? [];
    const overrideByDate = new Map<string, string>();
    for (const o of overridesList) overrideByDate.set(o.override_date, o.day_label);
    if (cardioTargets.length > 0) {
      // Resolve exact date-level cardio from the same canonical schedule map
      // used by week views and daily cardio cards. Frequency stays as a weekly
      // summary; date placement is driven by committed workouts + High Day.
      const workoutDatesInRange: ResolvedWorkoutDate[] = [];
      {
        const workoutItems = (workoutsQ.data ?? []) as any[];
        const byWeek = new Map<string, any[]>();
        for (const it of workoutItems) {
          if (!it.day?.id || !it.week?.id) continue;
          const arr = byWeek.get(it.week.id) ?? [];
          arr.push(it);
          byWeek.set(it.week.id, arr);
        }
        for (const [, weekItems] of byWeek) {
          const week = weekItems[0]?.week;
          const block = weekItems[0]?.block;
          const dayRows = weekItems.map((it) => it.day);
          const dateMap = resolveWeekDayDates(dayRows, week, block, committedDays);
          for (const it of weekItems) {
            const d = dateMap.get(it.day.id);
            if (d) {
              workoutDatesInRange.push({
                date: toLocalISO(d),
                workoutId: it.day.id,
                workout: it.day,
                isWorkoutOverride: !!it.day.schedule_locked,
              });
            }
          }
        }
      }

      function emit(target: any, dateStr: string) {
        const cardioName = target.cardio_type === "Custom" ? (target.custom_type || "Cardio") : (target.cardio_type || "Cardio");
        const subtitle = [target.duration_minutes ? `${target.duration_minutes} min` : null, target.intensity].filter(Boolean).join(" · ");
        out.push({
          id: `cardio:${target.id}:${dateStr}`,
          kind: "cardio",
          date: dateStr,
          title: cardioName,
          subtitle,
          status: null,
          href: { to: "/portal/workouts" },
          raw: { ...target, _date: dateStr },
        });
      }

      function emitRest(dateStr: string) {
        out.push({
          id: `cardio-rest:${clientId}:${dateStr}`,
          kind: "cardio",
          date: dateStr,
          title: "Full Cardio Rest",
          subtitle: "No cardio scheduled",
          status: null,
          href: { to: "/portal/workouts" },
          raw: { _date: dateStr, day_type: "Full Cardio Rest", rest: true },
        });
      }

      // Range: 2 weeks past → 3 weeks future (5 weeks total)
      const today = new Date();
      const startOfRange = new Date(today);
      startOfRange.setDate(today.getDate() - today.getDay() - 14);
      const endOfRange = new Date(startOfRange);
      endOfRange.setDate(startOfRange.getDate() + 35);

      // Walk each date and emit one resolved cardio prescription
      const cursor = new Date(startOfRange);
      while (cursor <= endOfRange) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;
        const weekStart = new Date(cursor);
        weekStart.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
        const weekDates = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        });
        const resolved = resolveClientWeekDays({
          clientId: clientId!,
          weekDates,
          workouts: workoutDatesInRange,
          recurringHighDays: schedule?.preferred_high_days ?? null,
          highDayOverrides: overridesList,
          fullCardioRestDays: schedule?.full_cardio_rest_days ?? null,
          cardioTargets,
        }).find((d) => d.date === dateStr);
        const target = resolved?.cardioTargetId ? cardioTargets.find((t: any) => t.id === resolved.cardioTargetId) : null;
        if (target) emit(target, dateStr);
        else if (resolved?.cardioDayType === "rest") emitRest(dateStr);

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return out.sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")));
  }, [eventsQ.data, importantQ.data, apptsQ.data, ptQ.data, workoutsQ.data, checkinsQ.data, cardioQ.data]);

  return {
    items,
    isLoading:
      eventsQ.isLoading || importantQ.isLoading || apptsQ.isLoading ||
      ptQ.isLoading || workoutsQ.isLoading || checkinsQ.isLoading,
  };
}

/* ============================================================
 * ADMIN
 * ============================================================ */
export type AdminCalendarFilters = {
  clientId?: string | "all";
  kinds?: Set<CalendarKind>;
  includeGoogle?: boolean;
};

export function useAdminCalendarSources(filters: AdminCalendarFilters) {
  const eventsQ = useQuery({
    queryKey: ["cal-admin-events"],
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("id,name,event_type,event_date,start_time,end_time,timezone,location,importance,status,audience_scope")
        .neq("status", "Archived");
      return (data ?? []) as any[];
    },
  });

  const eventAssignsQ = useQuery({
    queryKey: ["cal-admin-event-assignments"],
    queryFn: async () => {
      const { data } = await (supabase.from("event_assignments") as any)
        .select("event_id,client_id");
      return (data ?? []) as any[];
    },
  });

  const apptsQ = useQuery({
    queryKey: ["cal-admin-appts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id,title,appointment_type,starts_at,ends_at,timezone,status,location,client_id,external_name,meet_link");
      return (data ?? []) as any[];
    },
  });

  const ptQ = useQuery({
    queryKey: ["cal-admin-pt"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("id,title,session_type,session_date,start_time,end_time,status,location,client_id");
      return (data ?? []) as any[];
    },
  });

  const importantQ = useQuery({
    queryKey: ["cal-admin-important"],
    queryFn: async () => {
      const { data } = await (supabase.from("important_dates") as any)
        .select("id,title,date_type,custom_type,target_date,status,client_id");
      return (data ?? []) as any[];
    },
  });

  // Google Calendar overlay — only fetched when explicitly toggled on.
  const googleQ = useQuery({
    queryKey: ["cal-admin-google"],
    enabled: !!filters.includeGoogle,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59).toISOString();
      try {
        return await listGoogleEventsRange({ data: { timeMin, timeMax } as any });
      } catch {
        return [];
      }
    },
  });

  const clientsQ = useQuery({
    queryKey: ["cal-admin-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id,full_name,first_name,last_name,archived,status")
        .eq("archived", false);
      return (data ?? []) as any[];
    },
  });

  const clientById = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of (clientsQ.data ?? [])) m.set(c.id, c);
    return m;
  }, [clientsQ.data]);

  const items: CalendarItem[] = useMemo(() => {
    const out: CalendarItem[] = [];
    const filterClient = filters.clientId && filters.clientId !== "all" ? filters.clientId : null;

    // Build event -> client(s) map
    const eventClients = new Map<string, string[]>();
    for (const ea of (eventAssignsQ.data ?? [])) {
      if (!ea.event_id || !ea.client_id) continue;
      const arr = eventClients.get(ea.event_id) ?? [];
      arr.push(ea.client_id);
      eventClients.set(ea.event_id, arr);
    }

    for (const e of (eventsQ.data ?? [])) {
      if (!e.event_date) continue;
      const cids = eventClients.get(e.id) ?? [];
      if (filterClient && !cids.includes(filterClient) && e.audience_scope !== "all_coaching") continue;
      const clientName =
        cids.length === 1 ? (clientById.get(cids[0])?.full_name ?? null)
        : cids.length > 1 ? `${cids.length} clients`
        : e.audience_scope === "all_coaching" ? "All clients" : null;
      out.push({
        id: `event:${e.id}`,
        kind: "event",
        date: e.event_date,
        title: e.name,
        subtitle: [e.event_type, timeFromTimeStr(e.start_time), e.location].filter(Boolean).join(" · "),
        importance: e.importance,
        status: e.status,
        clientId: cids[0] ?? null,
        clientName,
        href: { to: "/admin/events/$id", params: { id: e.id } },
        raw: e,
      });
    }

    for (const a of (apptsQ.data ?? [])) {
      if (!a.starts_at) continue;
      if (filterClient && a.client_id !== filterClient) continue;
      const c = a.client_id ? clientById.get(a.client_id) : null;
      out.push({
        id: `appt:${a.id}`,
        kind: "appointment",
        date: toLocalDate(a.starts_at),
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        title: a.title || a.appointment_type || "Appointment",
        subtitle: [a.appointment_type, a.location].filter(Boolean).join(" · "),
        status: a.status,
        clientId: a.client_id,
        clientName: c?.full_name ?? a.external_name ?? null,
        href: a.client_id ? { to: "/admin/clients/$id", params: { id: a.client_id } } : { to: "/admin/calendar" },
        raw: a,
      });
    }

    for (const s of (ptQ.data ?? [])) {
      if (!s.session_date) continue;
      if (filterClient && s.client_id !== filterClient) continue;
      const c = s.client_id ? clientById.get(s.client_id) : null;
      out.push({
        id: `pt:${s.id}`,
        kind: "pt_session",
        date: s.session_date,
        title: s.title || "PT Session",
        subtitle: [s.session_type, timeFromTimeStr(s.start_time), s.location].filter(Boolean).join(" · "),
        status: s.status,
        clientId: s.client_id,
        clientName: c?.full_name ?? null,
        href: s.client_id ? { to: "/admin/clients/$id", params: { id: s.client_id } } : { to: "/admin/calendar" },
        raw: s,
      });
    }

    for (const d of (importantQ.data ?? [])) {
      if (!d.target_date) continue;
      if (filterClient && d.client_id !== filterClient) continue;
      const c = d.client_id ? clientById.get(d.client_id) : null;
      out.push({
        id: `important:${d.id}`,
        kind: "important_date",
        date: d.target_date,
        title: d.title,
        subtitle: d.custom_type ?? d.date_type ?? null,
        status: d.status,
        clientId: d.client_id,
        clientName: c?.full_name ?? null,
        href: d.client_id ? { to: "/admin/clients/$id", params: { id: d.client_id } } : null,
        raw: d,
      });
    }

    // Google Calendar overlay items — only present when toggled and not client-filtered.
    if (filters.includeGoogle && !filterClient) {
      for (const g of (googleQ.data ?? []) as any[]) {
        if (!g.start) continue;
        const startISO = g.allDay ? `${g.start}T00:00:00` : g.start;
        out.push({
          id: `gcal:${g.id}`,
          kind: "google_event",
          date: toLocalDate(startISO),
          startsAt: g.allDay ? null : g.start,
          endsAt: g.allDay ? null : g.end,
          title: g.summary || "(busy)",
          subtitle: g.location || (g.allDay ? "All day" : null),
          status: null,
          clientId: null,
          clientName: "Google Calendar",
          href: null,
          raw: { ...g, html_link: g.htmlLink, meet_link: g.hangoutLink ?? null, external_url: g.htmlLink },
        });
      }
    }

    const filtered = filters.kinds && filters.kinds.size > 0
      ? out.filter((i) => filters.kinds!.has(i.kind))
      : out;

    return filtered.sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")));
  }, [filters.clientId, filters.kinds, filters.includeGoogle, eventsQ.data, eventAssignsQ.data, apptsQ.data, ptQ.data, importantQ.data, googleQ.data, clientById]);

  return {
    items,
    clients: clientsQ.data ?? [],
    isLoading:
      eventsQ.isLoading || eventAssignsQ.isLoading || apptsQ.isLoading ||
      ptQ.isLoading || importantQ.isLoading || clientsQ.isLoading ||
      (!!filters.includeGoogle && googleQ.isLoading),
  };
}

/** Hook: returns Google Calendar connection status for the current user. */
export function useGoogleCalendarStatus() {
  return useQuery({
    queryKey: ["gcal-status"],
    queryFn: () => getGoogleConnectionStatus(),
    staleTime: 60_000,
  });
}