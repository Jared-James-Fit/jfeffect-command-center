import { useState } from "react";
import { CalendarClock, Check, ChevronDown, PenLine, Send } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SERIES_LABEL, TIP_KIND_LABEL, isRecapStats, postTimeLabel, type CommunitySeries, type CrewCompare } from "@/lib/community";
import { useSeriesAction, useSeriesOverview, useSeriesPreview, useViewerUnit, type SeriesItem } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { CompareBars, SundayRecapCard } from "@/components/community/series-cards";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { NoteEditor } from "@/components/community/note-editor";

const ORDER: CommunitySeries[] = [
  "monday_motivation",
  "tuesday_tips",
  "wednesday_wins",
  "try_it_thursday",
  "finish_strong_friday",
  "saturday_spirit",
  "sunday_recap",
];
const WHEN: Record<CommunitySeries, string> = {
  monday_motivation: "Mon · 7 am",
  tuesday_tips: "Tue · 12 pm",
  wednesday_wins: "Wed · 12 pm",
  try_it_thursday: "Thu · 12 pm",
  finish_strong_friday: "Fri · 7 am",
  saturday_spirit: "Sat · 9 am",
  sunday_recap: "Sun · 7 pm",
};
const SOURCE: Partial<Record<CommunitySeries, string>> = {
  wednesday_wins: "last week's logs",
  sunday_recap: "this week's logs",
};

/** What the "Up next" label calls a library item. */
function itemName(series: CommunitySeries, item: Pick<SeriesItem, "mentor" | "data">): string {
  if (series === "tuesday_tips") return TIP_KIND_LABEL[item.mentor] ?? "Tip";
  if (series === "try_it_thursday") return (item.data?.title as string) ?? item.mentor;
  if (series === "saturday_spirit") return "Picture post";
  return item.mentor;
}

/** Today in Winnipeg, Monday = 0. */
function todayIndex(): number {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", weekday: "short" }).format(new Date());
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(day);
}

/**
 * Coach controls for the daily posts: on/off, what goes out next (edit
 * library posts first if you like), post now, recent history, and a plain
 * "write a post". The data days (Tuesday's observation, Wednesday Wins,
 * Thursday's stat, Sunday Recap) show what they'd say right now. One row per
 * day; the next one to go out starts open.
 */
export function CoachWeeklyPosts() {
  const { data, isLoading, isError } = useSeriesOverview(true);
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const act = useSeriesAction();
  const [editing, setEditing] = useState<{ series: CommunitySeries; item: SeriesItem } | null>(null);
  const [open, setOpen] = useState<CommunitySeries | null | undefined>(undefined);

  const isOpen = (s: CommunitySeries) => open === s;
  const tuesday = useSeriesPreview("tuesday_tips", isOpen("tuesday_tips"));
  const thursday = useSeriesPreview("try_it_thursday", isOpen("try_it_thursday"));
  const sunday = useSeriesPreview("sunday_recap", isOpen("sunday_recap"));

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  // The next day that hasn't gone out yet starts open.
  if (open === undefined) {
    const t = Math.max(0, todayIndex());
    const next = [...ORDER.slice(t), ...ORDER.slice(0, t)].find((s) => !data.this_week?.[s]) ?? null;
    setOpen(next);
  }

  const run = (a: Parameters<typeof act.mutate>[0], ok: string) =>
    act.mutate(a, {
      onSuccess: (r) => {
        if (r?.status && r.status !== "published")
          toast.message(r.status === "exists" ? "Already posted this week" : r.status === "paused" ? "Turn daily posts on first" : r.status === "no_wins" ? "Nobody has trained yet" : "Nothing to post");
        else toast.success(ok);
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
    });

  return (
    <section className="w-full">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black">Daily posts</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {data.author ? `Posts as ${data.author.name} · Winnipeg time` : "No posting account set"}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-bold">
            {data.paused ? "Paused" : "On"}
            <Switch checked={!data.paused} disabled={act.isPending} onCheckedChange={(on) => run({ kind: "pause", paused: !on }, on ? "Daily posts are on" : "Daily posts paused")} />
          </label>
        </header>

        <div className="divide-y divide-border/60">
          {ORDER.map((series) => {
            const wins = series === "wednesday_wins";
            const recap = series === "sunday_recap";
            const next = wins || recap ? undefined : data.next?.[series];
            const preview = wins ? data.wins_preview : null;
            const done = data.this_week?.[series];
            const expanded = isOpen(series);
            const obs = series === "tuesday_tips" ? tuesday.data : null;
            const stat = series === "try_it_thursday" ? (thursday.data as CrewCompare | null | undefined) : null;
            const recapNow = recap ? sunday.data : null;
            return (
              <div key={series}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button type="button" onClick={() => setOpen(expanded ? null : series)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded}>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black">{SERIES_LABEL[series].name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {WHEN[series]} · {SOURCE[series] ?? `${data.library?.[series] ?? 0} in rotation`}
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
                      disabled={act.isPending || data.paused || (wins ? !preview : recap ? false : !next)}
                      onClick={() => run({ kind: "publish", series }, `${SERIES_LABEL[series].name} posted`)}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" /> Post now
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="space-y-2 px-4 pb-3">
                    {obs && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary">Goes out instead · from the crew's data</div>
                        <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{obs.caption}</div>
                        <CompareBars compare={obs as CrewCompare} className="mt-2.5" />
                      </div>
                    )}
                    {next && (
                      <button type="button" onClick={() => setEditing({ series, item: next })} className={cn("block w-full rounded-xl bg-muted/60 px-3 py-2.5 text-left", obs && "opacity-70")}>
                        <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          <span className="truncate">{obs ? "Then next tip" : "Up next"} · {itemName(series, next)}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                            <PenLine className="h-3 w-3" /> Edit
                          </span>
                        </div>
                        {series === "saturday_spirit" && isSpiritScene(next.data?.scene) && (
                          <SpiritScene scene={next.data!.scene} className="mt-2 w-[120px] rounded-lg" />
                        )}
                        {next.quote && <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold">“{next.quote}”</div>}
                        <div className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-muted-foreground">{next.body}</div>
                      </button>
                    )}
                    {series === "try_it_thursday" && next?.data?.habit && (
                      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          {thursday.isLoading ? "Checking the crew's numbers…" : stat ? "Adds this from the crew's data" : "Posts without a number (not a big enough gap right now)"}
                        </div>
                        {stat && <CompareBars compare={stat} className="mt-2.5" />}
                      </div>
                    )}
                    {wins && (
                      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          {preview
                            ? `${preview.next_week ? "Next week so far" : "Goes out"} · ${preview.featured} featured · ${preview.trainers} trained`
                            : "Nobody has logged a session yet"}
                        </div>
                        {preview && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{preview.body}</div>}
                        {preview && <div className="mt-1.5 text-[11px] text-muted-foreground">The numbers card is on Sunday's recap now, so Wednesday is just the shout-outs (unless Sunday didn't go out).</div>}
                      </div>
                    )}
                    {recap && (
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

        {data.history.length > 0 && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Recent</div>
            <ul className="space-y-1">
              {data.history.slice(0, 5).map((h) => (
                <li key={h.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className={cn("w-7 shrink-0 font-bold", h.series === "monday_motivation" ? "text-primary" : "text-foreground")}>{SERIES_LABEL[h.series]?.short ?? "Note"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {h.mentor && (h.series === "monday_motivation" || h.series === "finish_strong_friday") ? `${h.mentor} · ` : ""}
                    {h.caption}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{postTimeLabel(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Tap a day to see what goes out next. Numbers only go out when they're real (3+ people on each side).
      </p>

      <NoteEditor
        open={!!editing}
        title={`Edit the next ${editing ? itemName(editing.series, editing.item) : ""} post`}
        initial={editing?.item.body ?? ""}
        quote={editing?.item.quote ? { text: editing.item.quote, author: editing.item.mentor } : null}
        saving={act.isPending}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (!editing) return;
          await act.mutateAsync({ kind: "item", id: editing.item.id, body });
          toast.success("Saved. It goes out like this.");
        }}
      />
    </section>
  );
}
