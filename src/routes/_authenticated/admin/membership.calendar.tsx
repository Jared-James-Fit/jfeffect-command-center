import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useGoogleCalendarStatus, type CalendarItem } from "@/lib/calendar-sources";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { Button } from "@/components/ui/button";
import { Calendar as CalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/membership/calendar")({
  component: MembershipCalendarPage,
});

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function MembershipCalendarPage() {
  const [includeGoogle, setIncludeGoogle] = useState(false);
  const { data: gcalStatus } = useGoogleCalendarStatus();
  const googleConnected = !!gcalStatus?.connected;

  const membersQ = useQuery({
    queryKey: ["membership-cal-members"],
    queryFn: async () => {
      const { data } = await (supabase.from("app_members") as any)
        .select("id,full_name,trial_end_at,current_period_end,cancel_at,cancelled_at,subscription_ended_at,grace_period_ends_at,hold_plan_started_at");
      return (data ?? []) as any[];
    },
  });

  const enrollmentsQ = useQuery({
    queryKey: ["membership-cal-enrollments"],
    queryFn: async () => {
      const { data } = await (supabase.from("member_plan_enrollments") as any)
        .select("id,member_id,plan_id,status,started_at,completed_at,workouts_completed,workouts_total,member_plans!inner(id,name)");
      return (data ?? []) as any[];
    },
  });

  const billingQ = useQuery({
    queryKey: ["membership-cal-billing"],
    queryFn: async () => {
      const { data } = await (supabase.from("jf_billing_events") as any)
        .select("id,type,member_id,processed_at")
        .order("processed_at", { ascending: false })
        .limit(500);
      return (data ?? []) as any[];
    },
  });

  const googleQ = useQuery({
    queryKey: ["membership-cal-google"],
    enabled: includeGoogle && googleConnected,
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

  const items: CalendarItem[] = useMemo(() => {
    const out: CalendarItem[] = [];
    const memberById = new Map<string, any>();
    for (const m of (membersQ.data ?? [])) memberById.set(m.id, m);

    for (const m of (membersQ.data ?? [])) {
      const name = m.full_name || "Member";
      const href = { to: "/admin/members/$memberId", params: { memberId: m.id } };
      const push = (suffix: string, dateISO: string, title: string, subtitle: string) => {
        out.push({
          id: `member:${m.id}:${suffix}`,
          kind: "membership_event",
          date: toLocalDate(dateISO),
          startsAt: dateISO,
          title,
          subtitle,
          clientId: m.id,
          clientName: name,
          href,
          raw: m,
        });
      };
      if (m.trial_end_at) push("trial-end", m.trial_end_at, `${name} — trial ends`, "Trial expiration");
      if (m.current_period_end) push("renew", m.current_period_end, `${name} — renews`, "Subscription period end");
      if (m.cancel_at) push("cancel", m.cancel_at, `${name} — cancellation scheduled`, "Cancellation");
      if (m.cancelled_at) push("cancelled", m.cancelled_at, `${name} — cancelled`, "Cancelled");
      if (m.subscription_ended_at) push("ended", m.subscription_ended_at, `${name} — subscription ended`, "Ended");
      if (m.grace_period_ends_at) push("grace", m.grace_period_ends_at, `${name} — grace period ends`, "Grace period");
      if (m.hold_plan_started_at) push("hold", m.hold_plan_started_at, `${name} — placed on hold`, "Hold started");
    }

    for (const e of (enrollmentsQ.data ?? [])) {
      const m = memberById.get(e.member_id);
      const name = m?.full_name ?? "Member";
      const planName = e.member_plans?.name ?? "Plan";
      if (e.started_at) {
        out.push({
          id: `enroll-start:${e.id}`,
          kind: "membership_event",
          date: toLocalDate(e.started_at),
          startsAt: e.started_at,
          title: `${name} — started ${planName}`,
          subtitle: `Enrollment · ${e.workouts_completed}/${e.workouts_total} workouts`,
          status: e.status,
          clientId: e.member_id,
          clientName: name,
          href: { to: "/admin/members/$memberId", params: { memberId: e.member_id } },
          raw: e,
        });
      }
      if (e.completed_at) {
        out.push({
          id: `enroll-complete:${e.id}`,
          kind: "membership_event",
          date: toLocalDate(e.completed_at),
          startsAt: e.completed_at,
          title: `${name} — completed ${planName}`,
          subtitle: `${e.workouts_completed}/${e.workouts_total} workouts`,
          status: "Completed",
          clientId: e.member_id,
          clientName: name,
          href: { to: "/admin/members/$memberId", params: { memberId: e.member_id } },
          raw: e,
        });
      }
    }

    for (const b of (billingQ.data ?? [])) {
      if (!b.processed_at) continue;
      const m = b.member_id ? memberById.get(b.member_id) : null;
      const name = m?.full_name ?? "Unknown";
      out.push({
        id: `billing:${b.id}`,
        kind: "membership_event",
        date: toLocalDate(b.processed_at),
        startsAt: b.processed_at,
        title: `${name} — ${b.type}`,
        subtitle: "Billing event",
        clientId: b.member_id,
        clientName: name,
        href: b.member_id ? { to: "/admin/members/$memberId", params: { memberId: b.member_id } } : null,
        raw: b,
      });
    }

    if (includeGoogle && googleConnected) {
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
          clientName: "Google Calendar",
          href: null,
          raw: { ...g, html_link: g.htmlLink, meet_link: g.hangoutLink ?? null, external_url: g.htmlLink },
        });
      }
    }

    return out.sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")));
  }, [membersQ.data, enrollmentsQ.data, billingQ.data, googleQ.data, includeGoogle, googleConnected]);

  const isLoading = membersQ.isLoading || enrollmentsQ.isLoading || billingQ.isLoading;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {googleConnected ? (
        <button
          type="button"
          onClick={() => setIncludeGoogle((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
            includeGoogle
              ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
              : "border-border text-muted-foreground opacity-60 hover:opacity-100",
          )}
        >
          <CalIcon className="h-3 w-3" /> Google
        </button>
      ) : (
        <Link
          to="/admin/calendar"
          search={{ tab: "google-calendar" } as any}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <CalIcon className="h-3 w-3" /> Connect Google
        </Link>
      )}
      <Link to="/admin/members" className="ml-auto">
        <Button size="sm" variant="outline" className="h-8 text-xs">Manage Members</Button>
      </Link>
    </div>
  );

  return (
    <>
      <PageHeader title="Membership Calendar" subtitle="Trial ends, renewals, enrollments, cancellations, and billing events." />
      <div className="p-3 sm:p-6 md:p-8 space-y-4">
        <Card className="border-border bg-card p-3 sm:p-4">
          <CalendarBoard
            items={items}
            isLoading={isLoading}
            showClientName
            toolbar={toolbar}
            emptyHint="Trials, renewals, enrollments, and billing events will appear here as members are added."
          />
        </Card>
      </div>
    </>
  );
}