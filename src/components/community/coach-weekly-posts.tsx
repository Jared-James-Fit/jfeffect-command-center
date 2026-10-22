import { useState } from "react";
import { CalendarClock, Check, ChevronDown, PartyPopper, PenLine, Send } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SERIES_LABEL, TIP_KIND_LABEL, isRecapStats, postTimeLabel, type CommunitySeries, type CrewCompare } from "@/lib/community";
import { useSeriesAction, useSeriesOverview, useSeriesPreview, useViewerUnit, type LibrarySeries, type SeriesItem } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { CompareBars, SundayRecapCard } from "@/components/community/series-cards";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { NoteEditor } from "@/components/community/note-editor";

type DailySeries = Exclude<CommunitySeries, "lesson">;
const ORDER: DailySeries[] = ["monday_motivation", "tuesday_tips", "wednesday_wins", "try_it_thursday", "finish_strong_friday", "saturday_spirit", "sunday_recap"];
const WHEN: Record<DailySeries, string> = {
  monday_motivation: "Mon · 7 am",
  tuesday_tips: "Tue · 12 pm",
  wednesday_wins: "Wed · 12 pm",
  try_it_thursday: "Thu · 12 pm",
  finish_strong_friday: "Fri · 7 am",
  saturday_spirit: "Sat · 9 am",
  sunday_recap: "Sun · 7 pm",
};
const SOURCE: Partial<Record<DailySeries, string>> = { wednesday_wins: "last week's logs", sunday_recap: "this week's logs" };
const DAYS: Record<LibrarySeries, string> = {
  monday_motivation: "Mondays",
  tuesday_tips: "Tuesdays",
  try_it_thursday: "Thursdays",
  finish_strong_friday: "Fridays",
  saturday_spirit: "Saturdays",
};
const isLibrary = (s: DailySeries): s is LibrarySeries => !(s === "wednesday_wins" || s === "sunday_recap");

/** What the "Up next" label calls a library post. */
function itemName(series: LibrarySeries, item: Pick<SeriesItem, "mentor" | "data">): string {
  if (series === "tuesday_tips") return TIP_KIND_LABEL[item.mentor] ?? "Tip";
  if (series === "try_it_thursday") return (item.data?.title as string) ?? item.mentor;
  if (series === "saturday_spirit") return "Picture post";
  return item.mentor;
}

/** "Sat, Oct 31" for a yyyy-mm-dd day. */
function holidayDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * Every coach post that goes out on its own, besides the lessons: the daily
 * series, one per day, and the holidays coming up.
 *
 * Wednesday Wins and Sunday Recap are written from the crew's logs and always
 * run. The other five (Monday Motivation, Tuesday Tips, Try it Thursday,
 * Finish Strong Friday, Saturday Spirit) post from their libraries, each on
 * its own switch, alongside that day's lesson. Each day shows what goes out
 * next (library posts can be edited first) or what it'd say right now, and can
 * be posted early. Pausing coach posts (the Lessons card) stops all of it.
 */
export function CoachWeeklyPosts() {
  const { data, isLoading, isError } = useSeriesOverview(true);
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const act = useSeriesAction();
  const [editing, setEditing] = useState<{ series: LibrarySeries; item: SeriesItem } | null>(null);
  // every day starts closed (Crew → Posts has "Next: …" at the top); tap one to see or edit it
  const [open, setOpen] = useState<DailySeries | null>(null);

  const isOn = (s: DailySeries) => !isLibrary(s) || (data?.series_on ?? []).includes(s);
  const tuesday = useSeriesPreview("tuesday_tips", open === "tuesday_tips" && isOn("tuesday_tips"));
  const thursday = useSeriesPreview("try_it_thursday", open === "try_it_thursday");
  const sunday = useSeriesPreview("sunday_recap", open === "sunday_recap");

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const post = (series: DailySeries) =>
    act.mutate(
      { kind: "publish", series },
      {
        onSuccess: (r) => {
          if (r?.status && r.status !== "published")
            toast.message(
              r.status === "exists"
                ? "Already posted this week"
                : r.status === "paused"
                  ? "Coach posts are paused"
                  : r.status === "no_wins"
                    ? "Nobody has trained yet"
                    : r.status === "no_items"
                      ? "Nothing left in this one's library"
                      : "Nothing to post",
            );
          else toast.success(`${SERIES_LABEL[series].name} posted`);
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
      },
    );

  const flip = (series: LibrarySeries, on: boolean) =>
    act.mutate(
      { kind: "series_on", series, on },
      {
        onSuccess: () =>
          toast.success(on ? `${SERIES_LABEL[series].name} is on` : `${SERIES_LABEL[series].name} is off`, {
            description: on ? `${DAYS[series]} at ${WHEN[series].split(" · ")[1]}, alongside that day's lesson.` : undefined,
          }),
        onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
      },
    );

  const recent = data.history.filter((h) => ORDER.includes(h.series as DailySeries));
  const holidays = data.holidays ?? [];
  return (
    <section className="w-full space-y-3">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black">Daily series</div>
            <div className="truncate text-[11px] text-muted-foreground">Alongside the lessons · Winnipeg time</div>
          </div>
        </header>

        <div className="divide-y divide-border/60">
          {ORDER.map((series) => {
            const library = isLibrary(series);
            const on = isOn(series);
            const wins = series === "wednesday_wins";
            const next = library ? data.next?.[series] : undefined;
            const preview = wins ? data.wins_preview : null;
            const done = data.this_week?.[series];
            const expanded = open === series;
            const obs = series === "tuesday_tips" && on ? tuesday.data : null;
            const stat = series === "try_it_thursday" ? (thursday.data as CrewCompare | null | undefined) : null;
            const recapNow = series === "sunday_recap" ? sunday.data : null;
            const canPost = !act.isPending && !data.paused && (wins ? !!preview : library ? !!next : true);
            return (
              <div key={series} data-daily-series={series}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button type="button" onClick={() => setOpen(expanded ? null : series)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded}>
                    <div className="min-w-0">
                      <div className={cn("truncate text-[13px] font-black", !on && "text-muted-foreground")}>{SERIES_LABEL[series].name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {WHEN[series]} · {library ? (done ? "posted this week" : on ? `${data.library?.[series] ?? 0} in rotation` : "off") : `always on · ${SOURCE[series]}`}
                      </div>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  {library ? (
                    <Switch checked={on} disabled={act.isPending} onCheckedChange={(v) => flip(series, v)} aria-label={`${SERIES_LABEL[series].name} on`} />
                  ) : done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Posted
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!canPost}
                      onClick={() => post(series)}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" /> Post now
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="space-y-2 px-4 pb-3">
                    {library && !on && (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Off: {DAYS[series]} only get the lesson.{" "}
                        {series === "tuesday_tips" ? "Turn it on and the crew's own numbers post here (when they hold) instead of in Tuesday's lesson." : "Turn it on and this goes out too."}
                      </p>
                    )}
                    {obs && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary">Goes out instead · from the crew's data</div>
                        <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{obs.caption}</div>
                        <CompareBars compare={obs as CrewCompare} className="mt-2.5" />
                      </div>
                    )}
                    {library && next && (
                      <button type="button" onClick={() => setEditing({ series, item: next })} className={cn("block w-full rounded-xl bg-muted/60 px-3 py-2.5 text-left", obs && "opacity-70")}>
                        <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          <span className="truncate">
                            {obs ? "Then next tip" : "Up next"} · {itemName(series, next)}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                            <PenLine className="h-3 w-3" /> Edit
                          </span>
                        </div>
                        {series === "saturday_spirit" && isSpiritScene(next.data?.scene) && <SpiritScene scene={next.data!.scene} className="mt-2 w-[120px] rounded-lg" />}
                        {next.quote && <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold">“{next.quote}”</div>}
                        <div className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-muted-foreground">{next.body}</div>
                        {!!next.media?.length && (
                          <div className="mt-1.5 text-[11px] font-bold text-primary">
                            + {next.media.length} {next.media.length === 1 ? "photo" : "photos / videos"}
                          </div>
                        )}
                      </button>
                    )}
                    {library && !next && <p className="text-[12px] text-muted-foreground">Nothing left in this one's library.</p>}
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
                          {preview ? `${preview.next_week ? "Next week so far" : "Goes out"} · ${preview.featured} featured · ${preview.trainers} trained` : "Nobody has logged a session yet"}
                        </div>
                        {preview && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{preview.body}</div>}
                      </div>
                    )}
                    {series === "sunday_recap" && (
                      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                          {sunday.isLoading ? "Adding up the week…" : recapNow ? "This week so far" : "Nobody has trained this week yet"}
                        </div>
                        {recapNow?.caption && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{recapNow.caption}</div>}
                        {isRecapStats(recapNow?.stats) && <SundayRecapCard stats={recapNow!.stats} unit={unit} className="mt-2.5" />}
                      </div>
                    )}
                    {library && !done && next && (
                      <button
                        type="button"
                        disabled={!canPost}
                        onClick={() => post(series)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" /> Post now
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {recent.length > 0 && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Recent</div>
            <ul className="space-y-1">
              {recent.slice(0, 4).map((h) => (
                <li key={h.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-8 shrink-0 font-bold">{SERIES_LABEL[h.series]?.short ?? ""}</span>
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

      {holidays.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card" data-coach-holidays>
          <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
            <PartyPopper className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-black">Holidays coming up</div>
              <div className="truncate text-[11px] text-muted-foreground">Post on their own at 9 am on the day</div>
            </div>
          </header>
          <ul className="divide-y divide-border/60">
            {holidays.map((h) => (
              <li key={`${h.key}:${h.date}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[13px] font-black">{h.name}</div>
                  {h.posted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Posted
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{holidayDay(h.date)} · 9 am</span>
                  )}
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-muted-foreground">{h.body}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <NoteEditor
        open={!!editing}
        title={`Edit the next ${editing ? itemName(editing.series, editing.item) : ""} post`}
        initial={editing?.item.body ?? ""}
        quote={editing?.item.quote ? { text: editing.item.quote, author: editing.item.mentor } : null}
        saving={act.isPending}
        onClose={() => setEditing(null)}
        media={editing ? { initial: editing.item.media, key: editing.item.id, hint: "Photos go out with this post once. The text stays for next time." } : undefined}
        onSave={async (body, _poll, media) => {
          if (!editing) return;
          await act.mutateAsync({ kind: "item", id: editing.item.id, body, media });
          toast.success("Saved. It goes out like this.");
        }}
      />
    </section>
  );
}
