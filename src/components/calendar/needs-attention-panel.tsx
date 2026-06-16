import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, MessageSquareWarning, CalendarClock, Phone, Trophy, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/lib/calendar-sources";

function isoDate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Admin "operational command center" — derives high-priority operational
 * counts from the already-aggregated calendar items plus a few cheap reads
 * for things the calendar feed doesn't carry (overdue check-ins, outstanding
 * form responses).
 */
export function AdminNeedsAttentionPanel({ items }: { items: CalendarItem[] }) {
  const today = isoDate(new Date());
  const now = new Date();
  const in7 = isoDate(new Date(now.getTime() + 7 * 86400000));
  const in48hMs = now.getTime() + 48 * 3600 * 1000;

  // Derived from already-aggregated items
  const apptsToday = useMemo(
    () => items.filter((i) => i.kind === "appointment" && i.date === today && (i.status ?? "Scheduled") === "Scheduled"),
    [items, today],
  );
  const upcomingCalls = useMemo(
    () => items.filter((i) =>
      i.kind === "appointment" && (i.status ?? "Scheduled") === "Scheduled" &&
      i.startsAt && new Date(i.startsAt).getTime() <= in48hMs && i.date >= today
    ),
    [items, today, in48hMs],
  );
  const meetWeekAthletes = useMemo(() => {
    const cids = new Set<string>();
    for (const i of items) {
      if (i.date < today || i.date > in7) continue;
      const isMeet =
        i.kind === "important_date" ||
        (i.kind === "event" && ((i.raw?.event_type ?? "").toLowerCase().includes("meet") ||
                                 (i.raw?.event_type ?? "").toLowerCase().includes("competition") ||
                                 i.importance === "High" || i.importance === "Critical"));
      if (isMeet && i.clientId) cids.add(i.clientId);
    }
    return cids;
  }, [items, today, in7]);

  // Lightweight extra queries (read-only, no writes, RLS-friendly admin reads)
  const overdueCheckinsQ = useQuery({
    queryKey: ["admin-overdue-checkins"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { count } = await (supabase.from("nf_assignments") as any)
        .select("id", { count: "exact", head: true })
        .lt("next_due_at", nowIso);
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const outstandingFormsQ = useQuery({
    queryKey: ["admin-outstanding-form-reviews"],
    queryFn: async () => {
      const { count } = await (supabase.from("nf_submissions") as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "submitted");
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const tiles: AdminTile[] = [
    {
      icon: <ClipboardCheck className="h-4 w-4" />,
      tone: "rose",
      label: "Overdue Check-Ins",
      count: overdueCheckinsQ.data ?? 0,
      href: "/admin/check-ins",
    },
    {
      icon: <CalendarClock className="h-4 w-4" />,
      tone: "blue",
      label: "Appointments Today",
      count: apptsToday.length,
      hint: apptsToday.length === 1 ? apptsToday[0].title : undefined,
    },
    {
      icon: <Phone className="h-4 w-4" />,
      tone: "violet",
      label: "Upcoming Calls",
      hint: "Next 48 hours",
      count: upcomingCalls.length,
    },
    {
      icon: <Trophy className="h-4 w-4" />,
      tone: "amber",
      label: "Meet-Week Athletes",
      hint: "Next 7 days",
      count: meetWeekAthletes.size,
    },
    {
      icon: <FileText className="h-4 w-4" />,
      tone: "sky",
      label: "Outstanding Forms",
      hint: "Needs review",
      count: outstandingFormsQ.data ?? 0,
      href: "/admin/forms",
    },
  ];

  const totalCount = tiles.reduce((a, t) => a + (t.count || 0), 0);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Needs Attention</h3>
        <Badge variant="outline" className="text-[10px]">{totalCount}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => <AdminStat key={t.label} t={t} />)}
      </div>
    </div>
  );
}

type Tone = "rose" | "amber" | "blue" | "violet" | "sky";
type AdminTile = {
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  count: number;
  hint?: string;
  href?: string;
};
const TONE_CLASSES: Record<Tone, { border: string; eyebrow: string; iconBg: string }> = {
  rose:   { border: "border-rose-500/40 hover:border-rose-500/70",     eyebrow: "text-rose-300",   iconBg: "bg-rose-500/15 text-rose-300" },
  amber:  { border: "border-amber-500/30 hover:border-amber-500/60",   eyebrow: "text-amber-300",  iconBg: "bg-amber-500/15 text-amber-300" },
  blue:   { border: "border-blue-500/30 hover:border-blue-500/60",     eyebrow: "text-blue-300",   iconBg: "bg-blue-500/15 text-blue-300" },
  violet: { border: "border-violet-500/30 hover:border-violet-500/60", eyebrow: "text-violet-300", iconBg: "bg-violet-500/15 text-violet-300" },
  sky:    { border: "border-sky-500/30 hover:border-sky-500/60",       eyebrow: "text-sky-300",    iconBg: "bg-sky-500/15 text-sky-300" },
};
function AdminStat({ t }: { t: AdminTile }) {
  const tone = TONE_CLASSES[t.tone];
  const inner = (
    <Card className={cn("group flex flex-col gap-1 border bg-card p-3 transition-colors", tone.border)}>
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", tone.iconBg)}>{t.icon}</span>
        <span className={cn("text-[10px] font-black uppercase tracking-widest", tone.eyebrow)}>{t.label}</span>
      </div>
      <div className="text-2xl font-black leading-none">{t.count}</div>
      {t.hint && <div className="text-[11px] text-muted-foreground">{t.hint}</div>}
      {t.href && (
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-foreground/80 group-hover:text-foreground">
          Open <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </Card>
  );
  if (t.href) return <Link to={t.href as any} className="block">{inner}</Link>;
  return inner;
}