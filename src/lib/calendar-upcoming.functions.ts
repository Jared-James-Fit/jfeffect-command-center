import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  windowDays: z.number().int().min(1).max(60).default(30),
  coachId: z.string().uuid().optional().nullable(),
});

export type UnifiedRow = {
  key: string;
  source: "appointment" | "pt_session" | "google";
  source_id: string;
  starts_at: string;
  ends_at: string | null;
  timezone?: string | null;
  title: string;
  appointment_type?: string | null;
  status?: string | null;
  meet_link?: string | null;
  google_event_id?: string | null;
  google_html_link?: string | null;
  google_synced?: boolean;
  sync_state?: "synced" | "google_only" | "app_only" | "sync_failed" | null;
  location?: string | null;
  attendee_name?: string | null;
  attendee_email?: string | null;
  attendee_phone?: string | null;
  client_id?: string | null;
  client_lifecycle?: string | null;
  client_lead_temperature?: string | null;
  client_is_active?: boolean;
  host_coach_id?: string | null;
  host_coach_name?: string | null;
};

/** Unified upcoming list: appointments + pt_sessions + Google Calendar events, deduplicated. */
export const listUpcomingUnified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000).toISOString(); // include last 24h so "today" past items still show
    const future = new Date(now.getTime() + data.windowDays * 24 * 3600 * 1000).toISOString();

    // 1. Appointments
    const apptQ = supabase
      .from("appointments")
      .select(
        "id, host_coach_id, client_id, external_name, external_email, external_phone, appointment_type, title, starts_at, ends_at, timezone, location, meet_link, google_event_id, status, source, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name), client:clients(id, full_name, email, phone, lifecycle_stage, lead_temperature, status, user_id, archived)",
      )
      .gte("starts_at", past)
      .lte("starts_at", future)
      .order("starts_at", { ascending: true });
    if (data.coachId) apptQ.eq("host_coach_id", data.coachId);

    // 2. PT sessions
    const ptQ = supabase
      .from("pt_sessions")
      .select("id, client_id, title, session_type, custom_type, starts_at, ends_at, timezone, location, status")
      .not("starts_at", "is", null)
      .gte("starts_at", past)
      .lte("starts_at", future)
      .order("starts_at", { ascending: true });

    // 3. Google events (best-effort)
    let googleEvents: any[] = [];
    try {
      const { gcalListEvents } = await import("./google-cal.server");
      googleEvents = await gcalListEvents(data.coachId ?? null, past, future);
    } catch {
      googleEvents = [];
    }

    const [appts, pts] = await Promise.all([apptQ, ptQ]);
    if (appts.error) throw new Error(appts.error.message);
    if (pts.error) throw new Error(pts.error.message);

    // Hydrate PT client info in one query
    const ptClientIds = Array.from(new Set((pts.data ?? []).map((r: any) => r.client_id).filter(Boolean)));
    let ptClientMap: Record<string, any> = {};
    if (ptClientIds.length) {
      const { data: cs } = await supabase
        .from("clients")
        .select("id, full_name, email, phone, lifecycle_stage, lead_temperature, status, user_id, archived")
        .in("id", ptClientIds as string[]);
      ptClientMap = Object.fromEntries((cs ?? []).map((c: any) => [c.id, c]));
    }

    const rows: UnifiedRow[] = [];
    const apptByGoogleId = new Map<string, any>();

    // Appointments → unified rows
    for (const a of appts.data ?? []) {
      if (a.google_event_id) apptByGoogleId.set(a.google_event_id, a);
      const c = a.client;
      const isActive = !!(c && c.lifecycle_stage === "active_client" && !c.archived);
      rows.push({
        key: `appt:${a.id}`,
        source: "appointment",
        source_id: a.id,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        timezone: a.timezone,
        title: a.title || a.appointment_type || "Appointment",
        appointment_type: a.appointment_type,
        status: a.status,
        meet_link: a.meet_link,
        google_event_id: a.google_event_id,
        google_synced: !!a.google_event_id,
        sync_state: a.google_event_id ? "synced" : "app_only",
        location: a.location,
        attendee_name: c?.full_name || a.external_name,
        attendee_email: c?.email || a.external_email,
        attendee_phone: c?.phone || a.external_phone,
        client_id: a.client_id,
        client_lifecycle: c?.lifecycle_stage,
        client_lead_temperature: c?.lead_temperature,
        client_is_active: isActive,
        host_coach_id: a.host_coach_id,
        host_coach_name: a.host_coach?.full_name,
      });
    }

    // PT sessions → unified rows (skip if same client + overlapping time exists as appt with matching title; otherwise include)
    for (const s of pts.data ?? []) {
      const c = ptClientMap[s.client_id];
      rows.push({
        key: `pt:${s.id}`,
        source: "pt_session",
        source_id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        timezone: s.timezone,
        title: s.title,
        appointment_type: s.custom_type || s.session_type,
        status: s.status,
        location: s.location,
        attendee_name: c?.full_name,
        attendee_email: c?.email,
        attendee_phone: c?.phone,
        client_id: s.client_id,
        client_lifecycle: c?.lifecycle_stage,
        client_is_active: !!(c && c.lifecycle_stage === "active_client" && !c.archived),
        sync_state: "app_only",
      });
    }

    // Google events: dedupe by google_event_id (primary), else composite (start time + 1 min tolerance + matching title)
    for (const g of googleEvents) {
      if (apptByGoogleId.has(g.id)) {
        // attach extra Google details to the matching appt row
        const matched = rows.find((r) => r.source === "appointment" && r.google_event_id === g.id);
        if (matched) {
          matched.google_html_link = g.htmlLink;
          if (!matched.meet_link && g.hangoutLink) matched.meet_link = g.hangoutLink;
        }
        continue;
      }
      // composite fallback: same start time (±60s) + same title to a non-google-linked appt
      const gStart = new Date(g.start).getTime();
      const fallback = rows.find((r) =>
        r.source === "appointment" &&
        !r.google_event_id &&
        Math.abs(new Date(r.starts_at).getTime() - gStart) < 60_000 &&
        (r.title || "").trim().toLowerCase() === (g.summary || "").trim().toLowerCase(),
      );
      if (fallback) {
        fallback.google_event_id = g.id;
        fallback.google_html_link = g.htmlLink;
        fallback.google_synced = true;
        fallback.sync_state = "synced";
        if (!fallback.meet_link && g.hangoutLink) fallback.meet_link = g.hangoutLink;
        continue;
      }
      rows.push({
        key: `gcal:${g.id}`,
        source: "google",
        source_id: g.id,
        starts_at: g.start,
        ends_at: g.end ?? null,
        title: g.summary || "(busy)",
        google_event_id: g.id,
        google_html_link: g.htmlLink,
        meet_link: g.hangoutLink,
        location: g.location,
        google_synced: true,
        sync_state: "google_only",
      });
    }

    rows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return { rows, fetched_at: new Date().toISOString(), google_event_count: googleEvents.length };
  });