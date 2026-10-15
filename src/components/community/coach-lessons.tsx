import { useMemo, useState } from "react";
import {
  AlertTriangle, BarChart3, BookOpen, CalendarClock, Check, ChevronDown, ChevronRight, Clock, Eye, ImageIcon, Library, PenLine, Plus,
  RefreshCw, Send, Shuffle, SkipForward, Sparkles, Sticker, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CommunityPost, PostSlide } from "@/lib/community";
import { useFullMediaUrl, useSeriesAction, useSeriesOverview } from "@/lib/community.queries";
import { lessonArtStatus, makeLessonArt } from "@/lib/lesson-art.functions";
import {
  LESSON_LEVELS, LESSON_LIFTS, LESSON_TRACK, LESSON_TRACKS, LEVEL_LABEL, LIFT_LABEL, clockLabel, coachClock, coachInstant, coachTimeLabel, dayLabel,
  canHaveArt, lessonKicker, lessonStatusLabel, missingLevels, needsReview,
  type LessonItem, type LessonLevel, type LessonLift, type LessonPlanRow, type LessonsOverview, type LessonTrack, type StickerSpec,
} from "@/lib/lessons";
import { lessonKeys, useLessonAct, useLessonLibrary, useLessonsOverview, useLessonsSettings, useSaveLessonItem, type LessonAction } from "@/lib/lessons.queries";
import { LessonCard, LessonStoryFrame } from "@/components/community/lesson-card";
import { StickerPreview } from "@/components/community/story-sticker";
import { StickerEditorSheet } from "@/components/community/sticker-editor";
import { NoteEditor } from "@/components/community/note-editor";
import { openCommunityPost } from "@/components/community/shared-comment";

/**
 * The coach's lessons: the next two weeks planned from his library, one a day
 * on Mon, Tue, Thu, Fri and Sat (Wednesday Wins and Sunday Recap keep theirs).
 * While "Review each one" is on (the default), nothing goes out until he's
 * approved it; "Post on their own" lets the plan run. Every lesson can be
 * previewed as the crew will see it (the post and the story), reworded, given
 * a photo or a different sticker, swapped, moved, skipped or posted now.
 * Underneath: when they go out and why, this month's troubleshooting levels,
 * how lessons are landing, and the library.
 */
export function CoachLessons() {
  const { data, isLoading, isError, refetch } = useLessonsOverview(true);
  const series = useSeriesOverview(true);
  const seriesAct = useSeriesAction();
  const act = useLessonAct();
  const settings = useLessonsSettings();
  const [openId, setOpenId] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [stats, setStats] = useState(false);
  const [approveAll, setApproveAll] = useState(false);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (isError || !data) {
    return (
      <button type="button" onClick={() => refetch()} className="w-full rounded-2xl border border-border/70 bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        Couldn't load lessons. Tap to try again.
      </button>
    );
  }

  const paused = series.data?.paused ?? data.paused;
  const waiting = needsReview(
    data.plan.filter((r) => new Date(r.post_at).getTime() <= Date.now() + 7 * 86_400_000),
    data.mode,
  );
  const open = data.plan.find((r) => r.id === openId) ?? null;
  const upcoming = data.plan.filter((r) => r.day >= data.today);
  const earlier = data.plan.filter((r) => r.day < data.today && r.status === "posted").slice(-3);
  const weeks = groupWeeks(upcoming, data.today);
  const month = data.coverage?.[0];
  const missing = missingLevels(month?.levels);

  const runAll = async () => {
    let ok = 0;
    for (const r of waiting) {
      try {
        await act.mutateAsync({ kind: "approve", id: r.id });
        ok++;
      } catch {
        // the rest still go
      }
    }
    toast.success(ok === 1 ? "1 lesson approved" : `${ok} lessons approved`, { description: "They go out at their times. You can still change or skip any of them." });
  };

  return (
    <section className="w-full space-y-3" data-coach-lessons>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <BookOpen className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black">Lessons</div>
            <div className="truncate text-[11px] text-muted-foreground">{data.author ? `Posts as ${data.author.name} · Winnipeg time` : "No posting account set"}</div>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-bold">
            {paused ? "Paused" : "On"}
            <Switch
              checked={!paused}
              disabled={seriesAct.isPending}
              onCheckedChange={(on) =>
                seriesAct.mutate(
                  { kind: "pause", paused: !on },
                  { onSuccess: () => toast.success(on ? "Coach posts are on" : "Coach posts paused", { description: on ? undefined : "Lessons, Wins and Recap all wait until you turn them back on." }) },
                )
              }
              aria-label="Coach posts on"
            />
          </label>
        </header>

        {/* review first, or let them go */}
        <div className="border-b border-border/60 px-4 py-3">
          <div className="grid grid-cols-2 rounded-full bg-muted p-1" role="radiogroup" aria-label="How lessons go out">
            {(["review", "auto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={data.mode === m}
                disabled={settings.isPending}
                onClick={() =>
                  data.mode !== m &&
                  settings.mutate(
                    { mode: m },
                    { onSuccess: () => toast.success(m === "review" ? "Lessons wait for your OK" : "Lessons post on their own", { description: m === "auto" ? "Anything you skip still stays out." : undefined }) },
                  )
                }
                className={cn("h-9 rounded-full text-[13px] font-bold transition-colors", data.mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                data-lesson-mode={m}
              >
                {m === "review" ? "Review each one" : "Post on their own"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {data.mode === "review"
              ? "Nothing goes out until you approve it. One you don't get to just doesn't post, and comes back later in the rotation."
              : "Planned lessons go out at their time unless you skip them. Approving isn't needed."}
          </p>
        </div>

        {paused && (
          <div className="flex items-center gap-2 border-b border-border/60 bg-amber-500/10 px-4 py-2.5 text-[12px] font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Paused: nothing posts until it's back on.
          </div>
        )}

        {waiting.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border/60 bg-primary/10 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-[12px] font-bold text-primary">
              {waiting.length === 1 ? "1 lesson this week needs your OK" : `${waiting.length} lessons this week need your OK`}
            </span>
            <button type="button" onClick={() => setApproveAll(true)} disabled={act.isPending} className="shrink-0 rounded-full bg-primary px-3 py-1 text-[11px] font-black text-primary-foreground disabled:opacity-50" data-lesson-approve-all>
              Approve all
            </button>
          </div>
        )}

        {weeks.map((w) => (
          <div key={w.label}>
            <div className="bg-muted/40 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{w.label}</div>
            <ul className="divide-y divide-border/60">
              {w.rows.map((r) => (
                <PlanRow key={r.id} row={r} mode={data.mode} onOpen={() => setOpenId(r.id)} />
              ))}
            </ul>
          </div>
        ))}

        {earlier.length > 0 && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Recently posted</div>
            <ul className="space-y-1">
              {earlier.reverse().map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => r.post_id && openCommunityPost(r.post_id)} className="flex w-full items-baseline gap-2 text-left text-[12px]">
                    <span className="w-14 shrink-0 font-bold">{dayLabel(r.day).split(",")[0]}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.posted_as === "data" ? "Crew data" : r.item?.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 border-t border-border/60 px-4 py-3">
          <button type="button" onClick={() => setLibrary(true)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-[12px] font-bold" data-lesson-library-open>
            <Library className="h-4 w-4" /> Library
          </button>
          <button type="button" onClick={() => setStats((s) => !s)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-[12px] font-bold" aria-expanded={stats}>
            <BarChart3 className="h-4 w-4" /> How they're doing
          </button>
        </div>
        {stats && <StatsPanel data={data} />}
      </div>

      <div className="space-y-2 px-1 text-[11px] leading-snug text-muted-foreground">
        <TimeLine data={data} />
        <ArtLine />
        {month && (
          <p data-lesson-coverage>
            <span className="font-bold text-foreground">Technique fixes, {monthName(month.month)}:</span>{" "}
            {LESSON_LEVELS.map((l) => `${LEVEL_LABEL[l]} ${month.levels[l] ? "✓" : "–"}`).join(" · ")}
            {missing.length > 0 ? ". The planner fills the gaps on the Saturdays left." : ". All three levels this month."}
          </p>
        )}
      </div>

      {open && <LessonSheet row={open} data={data} onClose={() => setOpenId(null)} />}
      <LibrarySheet open={library} onClose={() => setLibrary(false)} />

      <AlertDialog open={approveAll} onOpenChange={setApproveAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {waiting.length === 1 ? "this lesson" : `these ${waiting.length} lessons`}?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-left">
              {waiting.map((r) => `${dayLabel(r.day)}: ${r.item?.title}`).join("\n")}
              {"\n\n"}They go out at their times. You can still change or skip any of them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={runAll}>Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ArtLine() {
  const art = useLessonArtStatus();
  if (!art) return null;
  return (
    <p data-lesson-art={art.enabled ? "on" : "off"}>
      <span className="font-bold text-foreground">Illustrations:</span>{" "}
      {art.enabled
        ? "technique and diagram lessons use the app's own drawings. Others can get an OpenAI cover when you tap Illustration, and you see it before it posts."
        : "the diagrams are drawn in the app. An OpenAI key (OPENAI_API_KEY) in the app's settings adds optional covers for lessons without one."}
    </p>
  );
}

function monthName(ym: string): string {
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/** "This week" / "Next week" / "Week of Nov 2" (weeks start Monday). */
export function groupWeeks(rows: LessonPlanRow[], today: string): { label: string; rows: LessonPlanRow[] }[] {
  const monday = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    const dow = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dow);
    return t.toISOString().slice(0, 10);
  };
  const thisWeek = monday(today);
  const out: { label: string; rows: LessonPlanRow[] }[] = [];
  for (const r of rows) {
    const w = monday(r.day);
    const diff = Math.round((+new Date(`${w}T12:00:00Z`) - +new Date(`${thisWeek}T12:00:00Z`)) / (7 * 86_400_000));
    const label = diff <= 0 ? "This week" : diff === 1 ? "Next week" : `Week of ${dayLabel(w).replace(/^\w+, /, "")}`;
    const g = out.find((x) => x.label === label);
    if (g) g.rows.push(r);
    else out.push({ label, rows: [r] });
  }
  return out;
}

const STATUS_TONE: Record<string, string> = {
  "Needs your OK": "bg-primary/10 text-primary",
  Approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Posted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Posted · crew data": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Goes out on its own": "bg-muted text-muted-foreground",
  Skipped: "bg-muted text-muted-foreground",
  Cleared: "bg-muted text-muted-foreground",
  Missed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "Didn't post": "bg-destructive/10 text-destructive",
  "Nothing picked": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function PlanRow({ row, mode, onOpen }: { row: LessonPlanRow; mode: "review" | "auto"; onOpen: () => void }) {
  const status = lessonStatusLabel(row, mode);
  const it = row.item;
  const off = row.status === "skipped";
  return (
    <li>
      <button type="button" onClick={onOpen} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/60", off && "opacity-60")} data-lesson-row={row.status}>
        <div className="w-11 shrink-0 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">{dayLabel(row.day).slice(0, 3)}</div>
          <div className="text-[19px] font-black leading-none">{Number(row.day.slice(8, 10))}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
              {it ? lessonKicker(it) : LESSON_TRACK[row.track].name}
            </span>
            <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-black", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>{status}</span>
          </div>
          <div className={cn("truncate text-[14px] font-bold", off && "line-through")}>{row.posted_as === "data" ? "The crew's own data" : it?.title ?? "Nothing in the library for this day"}</div>
          <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
              <Clock className="h-3 w-3" /> {coachTimeLabel(row.post_at)}
            </span>
            {row.sticker && (
              <span className="inline-flex items-center gap-1">
                <Sticker className="h-3 w-3" /> {row.sticker.type}
              </span>
            )}
            {it?.visual && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> diagram
              </span>
            )}
            {row.edited && <span className="inline-flex items-center gap-1"><PenLine className="h-3 w-3" /> edited</span>}
          </div>
        </div>
      </button>
    </li>
  );
}

function TimeLine({ data }: { data: LessonsOverview }) {
  const settings = useLessonsSettings();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(data.time.fixed ?? data.time.learned.time);
  const learned = data.time.learned;
  const at = data.time.fixed ?? learned.time;
  const why = data.time.fixed
    ? "your set time"
    : learned.learned
      ? `picked from when the crew opens the app (${learned.views} views, 8 weeks)`
      : `the crew's usual late-afternoon peak, until there's more to go on (${learned.views} of 150 views)`;
  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-foreground">Lessons go out at</span>
        <input type="time" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-[14px]" aria-label="Posting time" />
        <button
          type="button"
          disabled={settings.isPending || !value}
          onClick={() => settings.mutate({ time: value }, { onSuccess: () => { setEditing(false); toast.success(`Lessons go out at ${clockLabel(value)}`); } })}
          className="h-9 rounded-full bg-primary px-3 text-[12px] font-black text-primary-foreground"
        >
          Save
        </button>
        {data.time.fixed && (
          <button type="button" disabled={settings.isPending} onClick={() => settings.mutate({ time: null }, { onSuccess: () => { setEditing(false); toast.success("Back to the learned time"); } })} className="h-9 rounded-full border border-border px-3 text-[12px] font-bold">
            Use the learned time
          </button>
        )}
        <button type="button" onClick={() => setEditing(false)} className="h-9 px-2 text-[12px] font-bold">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <p data-lesson-time>
      <span className="font-bold text-foreground">Lessons go out at {clockLabel(at)}</span>: {why}.{" "}
      <button type="button" onClick={() => setEditing(true)} className="font-bold text-primary">
        Change
      </button>
    </p>
  );
}

function StatsPanel({ data }: { data: LessonsOverview }) {
  const s = data.stats;
  return (
    <div className="space-y-3 border-t border-border/60 px-4 py-3 text-[12px]" data-lesson-stats>
      {s.posts < 3 ? (
        <p className="text-muted-foreground">
          {s.posts === 0 ? "No lessons out yet." : `${s.posts} lesson${s.posts === 1 ? "" : "s"} out so far.`} Once a few weeks are posted this shows which days, topics and stickers the crew engages with (coaches not counted).
        </p>
      ) : (
        <>
          <div>
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">By day · last 12 weeks · coaches not counted</div>
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="py-1 font-black">Track</th>
                  <th className="py-1 text-right font-black">Posts</th>
                  <th className="py-1 text-right font-black">Avg views</th>
                  <th className="py-1 text-right font-black">❤️</th>
                  <th className="py-1 text-right font-black">💬</th>
                  <th className="py-1 text-right font-black">Answers</th>
                </tr>
              </thead>
              <tbody>
                {s.by_track.map((t) => (
                  <tr key={t.track} className="border-t border-border/50">
                    <td className="py-1.5 font-bold">{t.track === "data" ? "Crew data" : LESSON_TRACK[t.track].name}</td>
                    <td className="py-1.5 text-right">{t.posts}</td>
                    <td className="py-1.5 text-right">{t.views}</td>
                    <td className="py-1.5 text-right">{t.reactions}</td>
                    <td className="py-1.5 text-right">{t.comments}</td>
                    <td className="py-1.5 text-right">{t.answers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.posts < 15 && <p className="mt-1 text-[11px] text-muted-foreground">Small numbers so far: read these as hints, not a ranking.</p>}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Recent</div>
            <ul className="space-y-1">
              {s.recent.slice(0, 6).map((r) => (
                <li key={r.post_id}>
                  <button type="button" onClick={() => openCommunityPost(r.post_id)} className="flex w-full items-center gap-2 text-left">
                    <span className="min-w-0 flex-1 truncate">{r.title ?? "Crew data"}</span>
                    <span className="inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" /> {r.views}</span>
                      <span>❤️ {r.reactions}</span>
                      <span>💬 {r.comments}</span>
                      {r.sticker && <span>{r.answers} ans</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {s.interest.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">What the crew's story answers point to</div>
          <div className="flex flex-wrap gap-1.5">
            {s.interest.map((t) => (
              <span key={t.tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold">
                {t.tag.replace(/-/g, " ")} · {t.answers}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">The planner leans toward lessons on these. It's what people say interests them, not a diagnosis of anyone's lifts.</p>
        </div>
      )}
    </div>
  );
}

/* ---- one lesson ------------------------------------------------------ */

function LessonSheet({ row, data, onClose }: { row: LessonPlanRow; data: LessonsOverview; onClose: () => void }) {
  const act = useLessonAct();
  const [tab, setTab] = useState<"post" | "story">("post");
  const [words, setWords] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [swap, setSwap] = useState(false);
  const [move, setMove] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const it = row.item;
  const isTuesday = new Date(`${row.day}T12:00:00Z`).getUTCDay() === 2;
  const live = row.status === "planned" || row.status === "approved";
  const status = lessonStatusLabel(row, data.mode);

  const run = (a: LessonAction, ok?: string, after?: () => void) =>
    act.mutate(a, {
      onSuccess: (r) => {
        if (ok) toast.success(r?.as === "data" ? "Posted the crew's data" : ok);
        after?.();
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
    });

  const preview = useMemo(() => previewPost(row, data), [row, data]);
  const art = useLessonArt(row.id);
  const cover = (row.media[0] as { path?: string; type?: string } | undefined) ?? null;
  const { data: coverUrl } = useFullMediaUrl(cover?.type === "image" ? cover.path : null, !!cover);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[560px]" data-lesson-sheet>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 bg-background px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[16px] font-black">{it?.title ?? LESSON_TRACK[row.track].name}</SheetTitle>
            <SheetDescription className="text-[12px]">
              {dayLabel(row.day)} · {coachTimeLabel(row.post_at)} · {status}
            </SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>

        <div className="space-y-3 px-4 py-3">
          {row.error && (row.status === "failed" || row.attempts > 0) && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Didn't post: {row.error}. Post it now, move it, or skip it.</span>
            </div>
          )}
          {isTuesday && data.observation && live && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary">Goes out instead if the numbers still hold · the crew's own data</div>
              <div className="mt-1.5 whitespace-pre-line text-[12px] text-muted-foreground">{data.observation.caption}</div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">5+ people on each side, never more than once every 4 weeks. Approving this day approves either one.</div>
            </div>
          )}

          {it ? (
            <>
              <div className="grid grid-cols-2 rounded-full bg-muted p-1">
                {(["post", "story"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={cn("h-8 rounded-full text-[12px] font-bold", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    {t === "post" ? "In the feed" : "On the story"}
                  </button>
                ))}
              </div>
              {tab === "post" ? (
                <div className="rounded-2xl border border-border/70 bg-background" data-lesson-preview="post">
                  <div className="flex items-center gap-2 px-3.5 pt-3">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-muted" aria-hidden />
                    <div className="min-w-0 text-[13px] font-bold">{data.author?.name ?? "Coach"}</div>
                  </div>
                  {coverUrl && <img src={coverUrl} alt="" className="mx-4 mt-3 aspect-square w-[calc(100%-2rem)] rounded-2xl object-cover" />}
                  <p className="whitespace-pre-wrap px-4 pb-1 pt-2 text-[15px] leading-[1.45]">{preview.caption}</p>
                  {row.media.length > 1 && <p className="px-4 text-[11px] font-bold text-primary">+ {row.media.length - 1} more photo{row.media.length === 2 ? "" : "s"}</p>}
                  <LessonCard post={preview} className="mx-4 mb-3 mt-2" />
                </div>
              ) : (
                <StoryPreview post={preview} sticker={row.sticker} />
              )}
            </>
          ) : (
            <p className="rounded-xl bg-muted/60 px-3 py-3 text-[13px] text-muted-foreground">
              {row.status === "skipped" ? "This day is cleared. Bring a lesson back to it, or leave it empty." : "Nothing in the library for this day yet. Add one in the Library, or swap one in."}
            </p>
          )}

          {/* what to do */}
          {row.status === "posted" ? (
            <button type="button" onClick={() => row.post_id && openCommunityPost(row.post_id)} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-[14px] font-black text-primary-foreground">
              Open the post <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              {live && it && data.mode === "review" && (
                row.status === "approved" ? (
                  <button type="button" disabled={act.isPending} onClick={() => run({ kind: "unapprove", id: row.id }, "Back to needing your OK")} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-emerald-500/10 text-[14px] font-black text-emerald-700 dark:text-emerald-400" data-lesson-unapprove>
                    <Check className="h-4 w-4" /> Approved for {coachTimeLabel(row.post_at)} · <Undo2 className="h-3.5 w-3.5" /> Undo
                  </button>
                ) : (
                  <button type="button" disabled={act.isPending} onClick={() => run({ kind: "approve", id: row.id }, `Approved for ${dayLabel(row.day)} ${coachTimeLabel(row.post_at)}`, onClose)} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-[14px] font-black text-primary-foreground" data-lesson-approve>
                    <Check className="h-4 w-4" /> Approve for {dayLabel(row.day).split(",")[0]} {coachTimeLabel(row.post_at)}
                  </button>
                )
              )}
              {live && it && data.mode === "auto" && (
                <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-center text-[12px] font-bold text-muted-foreground">Goes out on its own {dayLabel(row.day)} at {coachTimeLabel(row.post_at)}</p>
              )}
              {row.status === "skipped" && (
                <button type="button" disabled={act.isPending} onClick={() => (new Date(row.post_at).getTime() < Date.now() + 120_000 ? setMove(true) : run({ kind: "restore", id: row.id }, "Back in the plan"))} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-[14px] font-black text-primary-foreground">
                  <RefreshCw className="h-4 w-4" /> {row.item ? "Bring it back" : "Put a lesson here"}
                </button>
              )}
              <div className="grid grid-cols-3 gap-2">
                {it && row.status !== "skipped" && (
                  <>
                    <Tool icon={PenLine} label="Words & photo" onClick={() => setWords(true)} />
                    <Tool icon={Sticker} label={row.sticker ? "Sticker" : "Add sticker"} onClick={() => setStickerOpen(true)} />
                  </>
                )}
                {row.status !== "skipped" && <Tool icon={Shuffle} label="Swap lesson" onClick={() => setSwap(true)} />}
                <Tool icon={CalendarClock} label="Move" onClick={() => setMove(true)} />
                {row.status !== "skipped" && <Tool icon={SkipForward} label="Skip" onClick={() => run({ kind: "skip", id: row.id }, "Skipped. It stays in the library for later.", onClose)} />}
                {it && row.status !== "skipped" && <Tool icon={Send} label="Post now" onClick={() => setConfirmNow(true)} />}
                {it && row.status !== "skipped" && art.enabled && canHaveArt(it) && (
                  <Tool icon={Sparkles} label={art.busy ? "Drawing…" : cover ? "New illustration" : "Illustration"} onClick={() => !art.busy && art.make()} />
                )}
              </div>
              {row.edited && it && (
                <button type="button" disabled={act.isPending} onClick={() => run({ kind: "save", id: row.id, body: it.body }, "Back to the library's words")} className="w-full text-center text-[12px] font-bold text-muted-foreground">
                  Use the library's words again
                </button>
              )}
            </>
          )}
          {it && it.refs.length > 0 && <p className="text-center text-[11px] text-muted-foreground">Sources are checked against their published records. Edit the words freely, keep the claims to what they say.</p>}
        </div>

        {it && (
          <NoteEditor
            open={words}
            title={`${dayLabel(row.day)}: ${it.title}`}
            initial={row.body ?? it.body}
            saving={act.isPending}
            onClose={() => setWords(false)}
            media={{ initial: row.media as PostSlide[], key: `lesson-${row.id}`, hint: "Photos go on top of this lesson. The diagram stays under the words." }}
            onSave={async (body, _poll, media) => {
              await act.mutateAsync({ kind: "save", id: row.id, body, ...(media ? { media } : {}) });
              toast.success("Saved. It goes out like this.");
            }}
          />
        )}
        <StickerEditorSheet
          open={stickerOpen}
          initial={row.sticker}
          title="Lesson sticker"
          saving={act.isPending}
          onClose={() => setStickerOpen(false)}
          onSave={(s: StickerSpec) => run({ kind: "save", id: row.id, sticker: s, stickerSet: true }, "Sticker saved", () => setStickerOpen(false))}
          onRemove={() => run({ kind: "save", id: row.id, sticker: null, stickerSet: true }, "No sticker on this one", () => setStickerOpen(false))}
        />
        <LibrarySheet open={swap} onClose={() => setSwap(false)} pickFor={row} onPicked={() => setSwap(false)} />
        <MoveSheet open={move} row={row} onClose={() => setMove(false)} />
        <AlertDialog open={confirmNow} onOpenChange={setConfirmNow}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Post this to the Crew now?</AlertDialogTitle>
              <AlertDialogDescription>
                {row.day === data.today ? "It goes up straight away instead of at its time." : `It takes today's spot. ${dayLabel(row.day)} stays clear unless you add another.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <AlertDialogAction onClick={() => run({ kind: "post_now", id: row.id }, "Posted to the Crew", onClose)}>Post now</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function useLessonArtStatus() {
  const statusFn = useServerFn(lessonArtStatus);
  return useQuery({ queryKey: ["lesson-art-status"], staleTime: 10 * 60_000, retry: false, queryFn: () => statusFn() }).data;
}

/**
 * An OpenAI cover for one planned lesson, when there's a key for it. Only on
 * a tap (never on a schedule), and it lands on the plan for the coach to
 * look at before approving; "Words & photo" removes it.
 */
function useLessonArt(planId: string) {
  const qc = useQueryClient();
  const makeFn = useServerFn(makeLessonArt);
  const data = useLessonArtStatus();
  const make = useMutation({
    mutationFn: () => makeFn({ data: { planId } }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.reason);
      toast.success("Illustration added on top", { description: "Look it over before you approve. Remove it in Words & photo." });
      qc.invalidateQueries({ queryKey: lessonKeys.overview });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't make an illustration"),
  });
  return { enabled: !!data?.enabled, busy: make.isPending, make: () => make.mutate() };
}

function Tool({ icon: Icon, label, onClick }: { icon: typeof Check; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-border text-[11px] font-bold active:bg-muted" data-lesson-tool={label}>
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/** The post as the crew will see it (built from the plan row, nothing posted). */
function previewPost(row: LessonPlanRow, data: LessonsOverview): CommunityPost {
  const it = row.item;
  return {
    id: `preview-${row.id}`,
    created_at: row.post_at,
    visibility: "community",
    caption: row.body ?? it?.body ?? "",
    media_path: null,
    media_thumb_path: null,
    media_type: null,
    media_width: null,
    media_height: null,
    completion_id: null,
    kind: "note",
    series: "lesson",
    series_extra: it
      ? { key: it.key, track: it.track, title: it.title, level: it.level, lift: it.lift, tags: it.tags, visual: it.visual, refs: it.refs }
      : null,
    is_mine: true,
    author: data.author ?? { user_id: "", name: "Coach", avatar_url: null, is_coach: true },
    stats: null,
    reactions: {},
    my_reaction: null,
    coach_reactions: [],
    comment_count: 0,
    coach_commented: false,
    sticker: null,
  } as CommunityPost;
}

/** The story frame, small: phone-shaped, the sticker where it'll sit. */
function StoryPreview({ post, sticker }: { post: CommunityPost; sticker: StickerSpec | null }) {
  const scale = 0.62;
  return (
    <div className="mx-auto overflow-hidden rounded-[22px] bg-black" style={{ width: 390 * scale, height: 720 * scale }} data-lesson-preview="story">
      <div className="relative flex flex-col text-white" style={{ width: 390, height: 720, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <LessonStoryFrame post={{ ...post, sticker: sticker ? ({ ...sticker, total: 0, is_mine: true, ...(sticker.type === "poll" ? { options: sticker.options.map((o) => ({ ...o, votes: 0 })) } : {}) } as CommunityPost["sticker"]) : null }} />
        {sticker && (
          <div className="absolute inset-x-0" style={{ bottom: 96 }}>
            <StickerPreview sticker={sticker} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- moving one ------------------------------------------------------ */

function MoveSheet({ open, row, onClose }: { open: boolean; row: LessonPlanRow; onClose: () => void }) {
  const act = useLessonAct();
  const now = coachClock(new Date().toISOString());
  const at = coachClock(row.post_at);
  const [date, setDate] = useState(at.date < now.date ? now.date : at.date);
  const [time, setTime] = useState(at.time);
  const save = () =>
    act.mutate(
      { kind: "reschedule", id: row.id, postAt: coachInstant(date, time) },
      {
        onSuccess: () => {
          toast.success(`Moved to ${dayLabel(date)} ${clockLabel(time)}`, { description: date !== row.day ? "If another lesson was there, they traded places." : undefined });
          onClose();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't move it"),
      },
    );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[480px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Move it</SheetTitle>
            <SheetDescription className="text-[12px]">Winnipeg time. Another day's lesson trades places with it.</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">Day</span>
            <input type="date" value={date} min={now.date} onChange={(e) => setDate(e.target.value)} className="mt-1 block h-11 rounded-xl border border-border bg-background px-3 text-[16px]" />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 block h-11 rounded-xl border border-border bg-background px-3 text-[16px]" />
          </label>
          <button type="button" disabled={act.isPending || !date || !time} onClick={save} className="ml-auto h-11 rounded-full bg-primary px-5 text-[14px] font-black text-primary-foreground disabled:opacity-50" data-lesson-move-save>
            Move
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---- the library ------------------------------------------------------ */

function LibrarySheet({ open, onClose, pickFor, onPicked }: { open: boolean; onClose: () => void; pickFor?: LessonPlanRow; onPicked?: () => void }) {
  const { data, isLoading } = useLessonLibrary(open);
  const act = useLessonAct();
  const [track, setTrack] = useState<LessonTrack | "all">(pickFor?.track ?? "all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<LessonItem | "new" | null>(null);
  const shown = (data ?? []).filter(
    (i) => (track === "all" || i.track === track) && (!q.trim() || `${i.title} ${i.body} ${i.tags.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const pick = (i: LessonItem | null) =>
    pickFor &&
    act.mutate(
      { kind: "swap", id: pickFor.id, itemId: i?.id ?? null },
      {
        onSuccess: () => {
          toast.success(i ? `Swapped in: ${i.title}` : "Swapped for the next one up");
          onPicked?.();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't swap it"),
      },
    );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="flex h-[90dvh] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[560px]" data-lesson-library>
        <SheetHeader className="space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-black">{pickFor ? "Swap in a lesson" : "Lesson library"}</SheetTitle>
              <SheetDescription className="text-[12px]">{pickFor ? `For ${dayLabel(pickFor.day)}` : `${data?.length ?? 0} lessons · least used go first`}</SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {(["all", ...LESSON_TRACKS] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTrack(t)} className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-bold", track === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                {t === "all" ? "All" : `${LESSON_TRACK[t].day} · ${LESSON_TRACK[t].name}`}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lessons" className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-[15px]" />
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {pickFor && (
            <button type="button" disabled={act.isPending} onClick={() => pick(null)} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-[13px] font-bold">
              <Shuffle className="h-4 w-4" /> Next one up for this day
            </button>
          )}
          {!pickFor && (
            <button type="button" onClick={() => setEditing("new")} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-[13px] font-bold" data-lesson-new>
              <Plus className="h-4 w-4" /> Write a new lesson
            </button>
          )}
          {isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
          <ul className="space-y-1.5">
            {shown.map((i) => {
              const taken = !!i.planned && pickFor && i.planned !== pickFor.day;
              const current = pickFor?.item?.id === i.id;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    disabled={!!taken || current || (pickFor && act.isPending)}
                    onClick={() => (pickFor ? pick(i) : setEditing(i))}
                    className={cn("w-full rounded-xl border border-border/70 px-3 py-2.5 text-left disabled:opacity-50", !i.active && "opacity-60")}
                    data-lesson-item={i.key}
                  >
                    <div className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">{lessonKicker(i)}</div>
                    <div className="truncate text-[14px] font-bold">{i.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{i.body}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                      <span>{i.use_count ? `Used ${i.use_count}×, last ${new Date(i.last_used_at!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not used yet"}</span>
                      {i.planned && <span className="font-bold text-primary">Planned {dayLabel(i.planned)}</span>}
                      {current && <span className="font-bold text-primary">On this day now</span>}
                      {!i.active && <span className="font-bold">Off</span>}
                      {i.story && <span>· {i.story.type} sticker</span>}
                      {i.visual && <span>· diagram</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {editing && <ItemEditor item={editing === "new" ? null : editing} defaultTrack={track === "all" ? "fix" : track} onClose={() => setEditing(null)} />}
      </SheetContent>
    </Sheet>
  );
}

function ItemEditor({ item, defaultTrack, onClose }: { item: LessonItem | null; defaultTrack: LessonTrack; onClose: () => void }) {
  const save = useSaveLessonItem();
  const [track, setTrack] = useState<LessonTrack>(item?.track ?? defaultTrack);
  const [title, setTitle] = useState(item?.title ?? "");
  const [level, setLevel] = useState<LessonLevel | "">(item?.level ?? "");
  const [lift, setLift] = useState<LessonLift | "">(item?.lift ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [story, setStory] = useState<StickerSpec | null>(item?.story ?? null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const submit = () =>
    save.mutate(
      {
        id: item?.id ?? null,
        body,
        active,
        data: { ...(item ?? {}), track, title, level: (level || null) as LessonLevel | null, lift: (lift || null) as LessonLift | null, story },
      },
      {
        onSuccess: () => {
          toast.success(item ? "Lesson saved" : "Added to the library");
          onClose();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
      },
    );
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[560px]" data-lesson-item-editor>
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">{item ? "Edit lesson" : "New lesson"}</SheetTitle>
            <SheetDescription className="text-[12px]">Changes apply the next time it's planned. Lessons already approved keep what you approved.</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">Title (just for you and the story)</span>
              <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px]" />
            </label>
            <Select label="Day" value={track} onChange={(v) => setTrack(v as LessonTrack)} options={LESSON_TRACKS.map((t) => [t, `${LESSON_TRACK[t].day} · ${LESSON_TRACK[t].name}`])} />
            <Select label="Lift" value={lift} onChange={(v) => setLift(v as LessonLift | "")} options={[["", "Any / none"], ...LESSON_LIFTS.map((l) => [l, LIFT_LABEL[l]] as [string, string])]} />
            {track === "fix" && <Select label="Level" value={level} onChange={(v) => setLevel(v as LessonLevel | "")} options={[["", "Pick one"], ...LESSON_LEVELS.map((l) => [l, LEVEL_LABEL[l]] as [string, string])]} />}
          </div>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">The post</span>
            <textarea value={body} maxLength={1200} onChange={(e) => setBody(e.target.value)} rows={10} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-[15px] leading-[1.45]" />
            <span className="text-[11px] text-muted-foreground">{body.length}/1200 · first line is the hook (it leads the story)</span>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStickerOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-bold">
              <Sticker className="h-4 w-4" /> {story ? `Sticker: ${story.q}` : "Add a story sticker"}
            </button>
            {story && (
              <button type="button" onClick={() => setStory(null)} className="text-[12px] font-bold text-muted-foreground">
                Remove
              </button>
            )}
          </div>
          {item?.visual && <p className="text-[11px] text-muted-foreground">Keeps its {item.visual.kind.replace(/_/g, " ")} diagram{item.refs.length ? ` and ${item.refs.length} source${item.refs.length === 1 ? "" : "s"}` : ""}.</p>}
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
            <span className="text-[13px] font-bold">In the rotation</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <button type="button" disabled={save.isPending || !title.trim() || !body.trim()} onClick={submit} className="h-11 w-full rounded-full bg-primary text-[14px] font-black text-primary-foreground disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save lesson"}
          </button>
        </div>
        <StickerEditorSheet open={stickerOpen} initial={story} title="Lesson sticker" onClose={() => setStickerOpen(false)} onSave={(s) => { setStory(s); setStickerOpen(false); }} />
      </SheetContent>
    </Sheet>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="relative mt-1 block">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full appearance-none rounded-xl border border-border bg-background pl-3 pr-8 text-[14px]">
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}
