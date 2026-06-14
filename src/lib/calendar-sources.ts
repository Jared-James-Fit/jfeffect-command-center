import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getClientWorkouts } from "@/lib/pl-programs";
import { dayScheduledDate } from "@/lib/workout-today";

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
  | "check_in";

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
  check_in:       { label: "Check-In",     chip: "bg-rose-500/15 text-rose-300 border-rose-500/30",             dot: "bg-rose-400" },
};

/** Per-kind action label so clients/admins see the *thing they can do*, not just "Open". */
export const CTA_LABELS: Record<CalendarKind, string> = {
  event:          "View Event Details",
  important_date: "View Details",
  appointment:    "Open Appointment",
  pt_session:     "View Session Details",
  workout:        "Open Workout",
  check_in:       "Submit Check-In",
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
      // RLS already scopes to the signed-in client.
      const { data } = await (supabase.from("events") as any)
        .select("id,name,event_type,event_date,start_time,end_time,timezone,location,importance,status,client_facing_notes,description")
        .in("status", ["Active", "Completed"]);
      return (data ?? []) as any[];
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
  });

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
    for (const it of (workoutsQ.data ?? []) as any[]) {
      if (!it.day?.id) continue;
      const sd = dayScheduledDate(it as any);
      if (!sd) continue;
      const date = toLocalDate(sd.toISOString());
      const completed = !!it.completion?.completed_at;
      out.push({
        id: `workout:${it.day.id}`,
        kind: "workout",
        date,
        title: it.day?.title || `Day ${it.day?.day_index ?? ""}`.trim(),
        subtitle: [it.block?.name, it.day?.focus].filter(Boolean).join(" · "),
        status: completed ? "Completed" : "Scheduled",
        href: { to: "/portal/workouts/$dayId", params: { dayId: it.day.id } },
        raw: it,
      });
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

    return out.sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")));
  }, [eventsQ.data, importantQ.data, apptsQ.data, ptQ.data, workoutsQ.data, checkinsQ.data]);

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

    const filtered = filters.kinds && filters.kinds.size > 0
      ? out.filter((i) => filters.kinds!.has(i.kind))
      : out;

    return filtered.sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")));
  }, [filters.clientId, filters.kinds, eventsQ.data, eventAssignsQ.data, apptsQ.data, ptQ.data, importantQ.data, clientById]);

  return {
    items,
    clients: clientsQ.data ?? [],
    isLoading:
      eventsQ.isLoading || eventAssignsQ.isLoading || apptsQ.isLoading ||
      ptQ.isLoading || importantQ.isLoading || clientsQ.isLoading,
  };
}