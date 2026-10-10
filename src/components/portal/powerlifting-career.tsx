import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Ban, Check, ExternalLink, History, Landmark, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWeightUnit } from "@/lib/use-weight-unit";
import type { WeightUnit } from "@/lib/weight-lifted";
import { formatLoad } from "@/lib/strength-board";
import {
  LEVELS,
  attemptsMade,
  byYear,
  careerBests,
  coachingStatus,
  competitorTier,
  honours,
  isDq,
  normalizeCareer,
  placeLabel,
  placeNum,
  podiums,
  totalRecords,
  type CareerMeet,
  type CoachingStatus,
  type MeetLevel,
} from "@/lib/powerlifting-career";

const db = supabase as any;

export function useCareer(athleteId: string | null) {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["powerlifting-career", athleteId, viewerId],
    enabled: !!athleteId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_powerlifting_career", { _athlete_id: athleteId, ...(viewerId ? { _as_user: viewerId } : {}) });
      if (error) throw error;
      return normalizeCareer(data);
    },
  });
}

export function LevelBadge({ level, place, className }: { level: MeetLevel; place?: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide", LEVELS[level].tone, className)}>
      {place != null && place <= 3 ? <span className="mr-0.5">{["🥇", "🥈", "🥉"][place - 1]}</span> : null}
      {LEVELS[level].label}
    </span>
  );
}

/** Coaching them now, or in the past (and when): nobody should think a former athlete is still with JF Effect. */
function CoachingLine({ status }: { status: CoachingStatus }) {
  const current = status.kind === "current";
  return (
    <div className={cn("mt-3 flex items-center gap-2.5 rounded-xl border px-3 py-2",
      current ? "border-emerald-500/40 bg-emerald-500/10" : "border-dashed border-muted-foreground/40 bg-muted/40")}>
      {current ? (
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
      ) : (
        <History className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 leading-tight">
        <div className={cn("text-[13px] font-black", current ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>{status.title}</div>
        {status.detail && <div className="text-[11px] font-semibold text-muted-foreground">{status.detail}</div>}
      </div>
    </div>
  );
}

/** Coached or not, said in words on every meet. */
function CoachedTag({ coached }: { coached: boolean }) {
  return coached ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary-foreground">
      <Check className="h-3 w-3" strokeWidth={3} /> Coached by JF Effect
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-muted-foreground">
      <Ban className="h-3 w-3" /> Not coached by JF Effect
    </span>
  );
}

function PlaceTag({ place }: { place: string | null }) {
  const label = placeLabel(place);
  if (!label) return null;
  const n = placeNum(place);
  return (
    <span className={cn("shrink-0 text-[12px] font-black tabular-nums",
      label === "DQ" ? "text-destructive" : n === 1 ? "text-amber-500" : n != null && n <= 3 ? "text-foreground" : "text-muted-foreground")}>
      {n != null && n <= 3 ? `${["🥇", "🥈", "🥉"][n - 1]} ` : ""}{label}
    </span>
  );
}

/** Three dots per lift: filled = made, hollow red = missed. */
function AttemptDots({ attempts }: { attempts: (number | null)[] | undefined }) {
  const list = (attempts ?? []).filter((v): v is number => v != null && v !== 0);
  if (!list.length) return null;
  return (
    <span className="ml-1 inline-flex gap-[3px] align-middle" aria-label={`${list.filter((v) => v > 0).length} of ${list.length} made`}>
      {list.map((v, i) => (
        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", v > 0 ? "bg-emerald-500" : "border border-destructive")} />
      ))}
    </span>
  );
}

function MeetCard({ m, unit, record }: { m: CareerMeet; unit: WeightUnit; record: boolean }) {
  const made = attemptsMade(m);
  const lifts: [string, number | null, (number | null)[] | undefined][] = m.event === "B"
    ? [["Bench", m.bench_kg, m.attempts?.b]]
    : [["Squat", m.squat_kg, m.attempts?.s], ["Bench", m.bench_kg, m.attempts?.b], ["Deadlift", m.deadlift_kg, m.attempts?.d]];
  const details = [m.town, m.federation, m.division, m.weight_class ? `${m.weight_class} kg` : null, m.equipment && m.equipment !== "Raw" ? m.equipment : null]
    .filter(Boolean).join(" · ");
  return (
    <li className={cn("rounded-2xl p-3",
      m.coached ? "border border-l-4 border-primary/30 border-l-primary bg-card" : "border-2 border-dashed bg-muted/20")}>
      <div className="flex items-center gap-2">
        <CoachedTag coached={m.coached} />
        <span className="ml-auto"><PlaceTag place={m.place} /></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-muted-foreground">{format(new Date(m.date + "T12:00:00"), "MMM d, yyyy")}</span>
        <LevelBadge level={m.level} />
        {record && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-black">Total PR</span>}
      </div>
      <div className={cn("mt-0.5 text-sm font-bold leading-snug", !m.coached && "text-foreground/80")}>{m.meet_name}</div>
      {details && <div className="truncate text-[11px] text-muted-foreground">{details}</div>}
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {lifts.map(([label, kg, att]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-1 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}<AttemptDots attempts={att} /></div>
            <div className="text-[13px] font-black tabular-nums">{kg ? formatLoad(kg, unit) : "—"}</div>
          </div>
        ))}
        <div className={cn("rounded-lg px-1 py-1.5", m.event === "B" ? "col-span-3" : "", isDq(m) ? "bg-destructive/10" : m.coached ? "bg-foreground text-background" : "bg-muted")}>
          <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">{m.event === "B" ? "Bench only" : "Total"}</div>
          <div className="text-[13px] font-black tabular-nums">{isDq(m) ? "DQ" : m.event === "B" ? `@ ${m.bw_kg ? formatLoad(m.bw_kg, unit) : "—"}` : m.total_kg ? formatLoad(m.total_kg, unit) : "—"}</div>
        </div>
      </div>
      {(m.bw_kg || m.gl || made) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {m.event !== "B" && m.bw_kg ? <span>BW {formatLoad(m.bw_kg, unit)}</span> : null}
          {m.gl ? <span>{m.gl.toFixed(1)} GL</span> : null}
          {made ? <span>{made.made}/{made.taken} attempts made</span> : null}
        </div>
      )}
    </li>
  );
}

type Filter = "all" | "coached" | "other";

/** One athlete's powerlifting career: badges, bests and every meet, coached or not. */
export function PowerliftingCareer({ athleteId }: { athleteId: string }) {
  const { unit } = useWeightUnit();
  const { data: c, isPending, error, refetch, isFetching } = useCareer(athleteId);
  const [filter, setFilter] = useState<Filter>("all");

  // No Back of its own: the sheet's Back (top-left) leaves the career for the board. This only clears it.
  const back = <div className="h-11" aria-hidden />;
  if (isPending) return <div className="space-y-4">{back}<div className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div></div>;
  if (error || !c) {
    return (
      <div className="space-y-4">{back}
        <div className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">
          This career couldn't load. <button type="button" onClick={() => refetch()} className="font-bold text-primary">Try again</button>
        </div>
      </div>
    );
  }

  const meets = c.meets;
  const coachedCount = meets.filter((m) => m.coached).length;
  const tier = competitorTier(meets);
  const medals = honours(meets);
  const shown = filter === "all" ? meets : meets.filter((m) => (filter === "coached" ? m.coached : !m.coached));
  const bests = careerBests(filter === "all" ? meets : shown);
  const records = totalRecords(meets);
  const coaching = coachingStatus(c);
  const competedAs = [...new Set(meets.map((m) => m.entered_name).filter((n): n is string => !!n && n !== c.athlete.display_name))];

  return (
    <div className="space-y-4">
      {back}

      {/* Who */}
      <div className="rounded-2xl border bg-gradient-to-br from-amber-400/10 via-transparent to-transparent p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14 border">
            {c.athlete.avatar_url && <AvatarImage src={c.athlete.avatar_url} alt={c.athlete.display_name} />}
            <AvatarFallback className="text-lg font-black">{c.athlete.display_name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Powerlifting career</div>
            <div className="text-xl font-black leading-tight">{c.athlete.display_name}</div>
            {competedAs.length > 0 && <div className="text-[11px] text-muted-foreground">competed as {competedAs.join(", ")}</div>}
          </div>
        </div>
        <CoachingLine status={coaching} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tier && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide", LEVELS[tier.level].tone)}>
              <Landmark className="h-3.5 w-3.5" /> {tier.title}
            </span>
          )}
          {medals.map((h) => (
            <span key={h.level} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide", LEVELS[h.level].tone)}>
              {["🥇", "🥈", "🥉"][h.place - 1]} {h.title}{h.count > 1 ? ` ×${h.count}` : ""}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            [String(meets.length), "meets"],
            [String(coachedCount), "with JF Effect"],
            [String(podiums(meets)), "podiums"],
          ].map(([v, label]) => (
            <div key={label} className="rounded-xl bg-background/60 px-1 py-2">
              <div className="text-base font-black tabular-nums">{v}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Which meets */}
      <div className="grid grid-cols-3 rounded-xl bg-muted/50 p-1 text-xs font-bold" role="tablist" aria-label="Meets">
        {([["all", `All · ${meets.length}`], ["coached", `JF Effect · ${coachedCount}`], ["other", `Not coached · ${meets.length - coachedCount}`]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("min-h-10 rounded-lg px-1 transition", filter === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {/* Bests for what's shown */}
      <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
        {filter === "all" ? "Career bests" : filter === "coached" ? "Bests with JF Effect" : "Bests without JF Effect"}
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {([["Squat", bests.squat], ["Bench", bests.bench], ["Deadlift", bests.deadlift], ["Total", bests.total]] as const).map(([label, b]) => (
          <div key={label} className={cn("rounded-xl border px-1 py-2", label === "Total" && "border-amber-400/60 bg-amber-400/10")}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-sm font-black tabular-nums">{b ? formatLoad(b.kg, unit) : "—"}</div>
            <div className="truncate text-[9px] text-muted-foreground">{b ? b.meet.date.slice(0, 4) : ""}</div>
          </div>
        ))}
      </div>
      </div>

      {/* Legend: never ambiguous which meets were coached */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 rounded-full bg-primary" /> Solid card = coached by JF Effect</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border-2 border-dashed border-muted-foreground/60" /> Dashed = not coached by JF Effect</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No meets here.</div>
      ) : (
        byYear(shown).map(([year, list]) => (
          <section key={year} className="space-y-2">
            <div className="sticky top-0 z-10 -mx-1 bg-background/90 px-1 py-1 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              {year} <span className="font-semibold normal-case tracking-normal">· {list.length} {list.length === 1 ? "meet" : "meets"}</span>
            </div>
            <ul className="space-y-2">
              {list.map((m) => <MeetCard key={m.id} m={m} unit={unit} record={records.has(m.id)} />)}
            </ul>
          </section>
        ))
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          {c.athlete.synced_at ? `Synced from OpenPowerlifting ${formatDistanceToNowStrict(new Date(c.athlete.synced_at))} ago` : "Entered by your coach"}
        </span>
        {c.athlete.opl_url && (
          <a href={c.athlete.opl_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary">
            OpenPowerlifting <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
