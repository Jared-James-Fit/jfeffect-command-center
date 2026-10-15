import { useState } from "react";
import { Check, ChevronDown, Send, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SERIES_LABEL, isRecapStats, postTimeLabel, type CommunitySeries } from "@/lib/community";
import { useSeriesAction, useSeriesOverview, useSeriesPreview, useViewerUnit } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { SundayRecapCard } from "@/components/community/series-cards";

type DataSeries = Extract<CommunitySeries, "wednesday_wins" | "sunday_recap">;
const ORDER: DataSeries[] = ["wednesday_wins", "sunday_recap"];
const WHEN: Record<DataSeries, string> = { wednesday_wins: "Wed · 12 pm", sunday_recap: "Sun · 7 pm" };
const SOURCE: Record<DataSeries, string> = { wednesday_wins: "last week's logs", sunday_recap: "this week's logs" };

/** Today in Winnipeg, Monday = 0. */
function todayIndex(): number {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", weekday: "short" }).format(new Date());
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(day);
}

/**
 * The two posts the crew's own training writes: Wednesday Wins (last week's
 * PRs and shout-outs) and Sunday Recap (the week's report card). They go out
 * on their own from the logs; here they can be previewed as they'd read right
 * now, or posted early. The other five days are lessons (CoachLessons), and
 * the on/off switch for every coach post lives there.
 */
export function CoachWeeklyPosts() {
  const { data, isLoading, isError } = useSeriesOverview(true);
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const act = useSeriesAction();
  const [open, setOpen] = useState<DataSeries | null>(() => (todayIndex() >= 3 ? "sunday_recap" : "wednesday_wins"));
  const sunday = useSeriesPreview("sunday_recap", open === "sunday_recap");

  if (isLoading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const run = (series: DataSeries) =>
    act.mutate(
      { kind: "publish", series },
      {
        onSuccess: (r) => {
          if (r?.status && r.status !== "published")
            toast.message(r.status === "exists" ? "Already posted this week" : r.status === "paused" ? "Coach posts are paused" : r.status === "no_wins" ? "Nobody has trained yet" : "Nothing to post");
          else toast.success(`${SERIES_LABEL[series].name} posted`);
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
      },
    );

  const recaps = data.history.filter((h) => h.series === "wednesday_wins" || h.series === "sunday_recap");
  return (
    <section className="w-full">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Trophy className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black">Wins & Recap</div>
            <div className="truncate text-[11px] text-muted-foreground">Written from the crew's logs · Winnipeg time</div>
          </div>
        </header>
        <div className="divide-y divide-border/60">
          {ORDER.map((series) => {
            const wins = series === "wednesday_wins";
            const preview = wins ? data.wins_preview : null;
            const done = data.this_week?.[series];
            const expanded = open === series;
            const recapNow = !wins ? sunday.data : null;
            return (
              <div key={series}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button type="button" onClick={() => setOpen(expanded ? null : series)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded}>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black">{SERIES_LABEL[series].name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {WHEN[series]} · {SOURCE[series]}
                      </div>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  {done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Posted
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={act.isPending || data.paused || (wins && !preview)}
                      onClick={() => run(series)}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" /> Post now
                    </button>
                  )}
                </div>
                {expanded && (
                  <div className="px-4 pb-3">
                    {wins ? (
                      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          {preview ? `${preview.next_week ? "Next week so far" : "Goes out"} · ${preview.featured} featured · ${preview.trainers} trained` : "Nobody has logged a session yet"}
                        </div>
                        {preview && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{preview.body}</div>}
                      </div>
                    ) : (
                      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          {sunday.isLoading ? "Adding up the week…" : recapNow ? "This week so far" : "Nobody has trained this week yet"}
                        </div>
                        {recapNow?.caption && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{recapNow.caption}</div>}
                        {isRecapStats(recapNow?.stats) && <SundayRecapCard stats={recapNow!.stats} unit={unit} className="mt-2.5" />}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {recaps.length > 0 && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Recent</div>
            <ul className="space-y-1">
              {recaps.slice(0, 4).map((h) => (
                <li key={h.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-8 shrink-0 font-bold">{SERIES_LABEL[h.series]?.short ?? ""}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.caption}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{postTimeLabel(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
