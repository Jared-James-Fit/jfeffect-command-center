import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, BookOpen, Cake, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ImageIcon, Lightbulb, PartyPopper, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SERIES_LABEL } from "@/lib/community";
import { useBirthdayPosts, useBirthdaysNext, useSeriesAction, useSeriesOverview } from "@/lib/community.queries";
import { useLessonsOverview } from "@/lib/lessons.queries";
import { clockLabel, storyRows } from "@/lib/lessons";
import { openCommunityPost } from "@/lib/community-notifications";
import { scrollPageToTop } from "@/lib/tab-refresh";
import {
  STATUS_LABEL, buildRecent, buildSchedule, dayLabel, localParts, nextUp,
  type ScheduleItem, type ScheduleKind, type ScheduleSource, type ScheduleStatus,
} from "@/lib/posts-schedule";
import { CoachLessons, LessonSheet } from "@/components/community/coach-lessons";
import { DailyPicturesCard, DaySheet, Thumb, useInsightsOverview } from "@/components/community/daily-pictures-card";
import { CoachWeeklyPosts } from "@/components/community/coach-weekly-posts";
import { BirthdayPostSheet, BirthdayPostsCard } from "@/components/community/birthday-posts";
import { LessonStoryPlayer } from "@/components/community/lesson-story-player";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";

const db = supabase as any;

/** The four places a coach post is set up: its own settings, library and history. */
export type ManageKey = "lessons" | "insights" | "series" | "birthdays";
const MANAGE_KEYS: ManageKey[] = ["lessons", "insights", "series", "birthdays"];

/** Which settings page a link asks for (`#tab=posts&manage=lessons`); old birthday links open Birthdays. */
export function manageFromHash(h: string): { manage: ManageKey | null; open: string | null } {
  const m = /manage=([a-z]+)/.exec(h)?.[1] as ManageKey | undefined;
  const open = /open=([a-z_]+)/.exec(h)?.[1] ?? null;
  if (m && MANAGE_KEYS.includes(m)) return { manage: m, open };
  if (/birthday=|tab=birthdays/.test(h)) return { manage: "birthdays", open: null };
  return { manage: null, open: null };
}

/** The first `n` days of the schedule that have anything on them, then the rest behind "Show more". */
const FIRST_DAYS = 7;
/** A status worth a chip on its row (the rest read from the row itself, or the banner says it). */
const QUIET: ScheduleStatus[] = ["ready", "planned", "from_logs", "paused"];
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Coach posts this week and last (what's out, for "Recently out" and to mark a day's series as posted). */
function useRecentCoachPosts() {
  return useQuery({
    queryKey: ["coach-posts-recent"],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; series: string; created_at: string; caption: string | null }[]> => {
      const since = new Date(Date.now() - 9 * 86_400_000).toISOString();
      const { data, error } = await db
        .from("community_posts")
        .select("id, series, created_at, caption")
        .not("series", "is", null)
        .is("archived_at", null)
        .not("story_only", "is", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Crew → Posts (Nov 8 2026: "The organization of the admin/coach posts to
 * view/ manage them is confusing… make it easy to use and publish"): one
 * schedule of every post that goes out under his name in the next two weeks,
 * day by day, whatever makes it (posts-schedule.ts). Every one goes out on
 * its own; a tap opens that post's own editor (read, edit, move, skip, post
 * now). Then what's out lately, and Manage: each kind's settings, library and
 * history on a page of its own (the hash holds it, so Back returns here).
 * Posting on / paused is said once, at the top.
 */
export function CoachPostsTab() {
  const navigate = useNavigate();
  const routeHash = useRouterState({ select: (s) => s.location.hash });
  const { manage, open } = manageFromHash(`#${routeHash}`);
  const pushed = useRef(false);

  useEffect(() => {
    scrollPageToTop("auto");
  }, [manage]);

  const go = (m: ManageKey, item?: string) => {
    pushed.current = true;
    void navigate({ to: ".", hash: `tab=posts&manage=${m}${item ? `&open=${item}` : ""}`, resetScroll: false });
  };
  const back = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else void navigate({ to: ".", hash: "tab=posts", replace: true, resetScroll: false });
  };

  if (manage) return <ManagePage which={manage} open={open} onBack={back} />;
  return <PostsOverview onManage={go} />;
}

function PostsOverview({ onManage }: { onManage: (m: ManageKey, item?: string) => void }) {
  const lessons = useLessonsOverview(true);
  const insights = useInsightsOverview();
  const series = useSeriesOverview(true);
  const birthdays = useBirthdayPosts();
  const birthdaysNext = useBirthdaysNext();
  const recentPosts = useRecentCoachPosts();
  const seriesAct = useSeriesAction();
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [playId, setPlayId] = useState<string | null>(null);
  const [insightId, setInsightId] = useState<string | null>(null);
  const [birthdayId, setBirthdayId] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const now = localParts(new Date());
  const today = lessons.data?.today ?? insights.data?.today ?? now.day;
  const paused = series.data?.paused ?? lessons.data?.paused ?? false;
  const src: ScheduleSource = useMemo(
    () => ({
      today,
      paused,
      lessonMode: lessons.data?.mode,
      lessons: lessons.data?.plan,
      insightsOn: insights.data?.on,
      insights: insights.data?.days,
      seriesOn: series.data?.series_on,
      nextItems: series.data?.next,
      history: recentPosts.data ?? series.data?.history,
      holidays: series.data?.holidays,
      birthdays: birthdays.data,
      birthdaysNext: birthdaysNext.data,
    }),
    [today, paused, lessons.data, insights.data, series.data, recentPosts.data, birthdays.data, birthdaysNext.data],
  );
  const days = useMemo(() => buildSchedule(src), [src]);
  const recent = useMemo(() => buildRecent(src).slice(0, 8), [src]);

  if (lessons.isLoading || insights.isLoading || series.isLoading) return <PostsSkeleton />;

  const next = nextUp(days, now);
  const firstDays = days.slice(0, FIRST_DAYS);
  const laterDays = days.slice(FIRST_DAYS);
  const shown = more ? days : firstDays;
  const laterCount = laterDays.reduce((n, d) => n + d.items.length, 0);
  const stories = lessons.data ? storyRows(lessons.data.plan, lessons.data.today) : [];

  const openItem = (it: ScheduleItem, fromRecent = false) => {
    if (it.ref.insight) return setInsightId(it.ref.insight);
    if (it.ref.lesson && !(fromRecent && it.postId)) return setLessonId(it.ref.lesson);
    if (it.ref.birthday && !fromRecent) return setBirthdayId(it.ref.birthday);
    if (it.ref.birthdayClient) return onManage("birthdays");
    if (it.status === "posted" && it.postId) return openCommunityPost(it.postId);
    if (it.ref.series === "holiday") return onManage("series", "holidays");
    if (it.ref.series) return onManage("series", it.ref.series);
  };

  const setPaused = (on: boolean) =>
    seriesAct.mutate(
      { kind: "pause", paused: !on },
      {
        onSuccess: () =>
          toast.success(on ? "Posting is back on" : "Coach posts paused", {
            description: on ? "Everything goes out at its time again." : "Lessons, Athlete Insights, the daily series, holidays and birthdays all wait until you turn it back on.",
          }),
        onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
      },
    );

  const lesson = lessons.data?.plan.find((r) => r.id === lessonId) ?? null;
  const insight = insights.data?.days.find((d) => d.id === insightId) ?? null;
  const birthday = birthdays.data?.find((b) => b.id === birthdayId) ?? null;

  return (
    <div className="space-y-3" data-posts-schedule>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">Schedule</div>
            <div className="truncate text-[12px] text-muted-foreground" data-posts-next>
              {paused ? "Paused · nothing goes out" : next ? `Next: ${next.label} · ${dayLabel(next.day, today)} ${next.time}` : "Nothing coming up"}
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
            {paused ? "Paused" : "Posting"}
            <Switch checked={!paused} disabled={seriesAct.isPending || !series.data} onCheckedChange={setPaused} aria-label="Coach posts on" />
          </label>
        </header>

        {paused ? (
          <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2.5 text-[13px] font-medium" data-posts-paused>
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> Nothing goes out until you turn posting back on.
          </div>
        ) : (
          <p className="border-b border-border px-4 py-2.5 text-[12px] text-muted-foreground">
            Everything here goes out on its own at its time (Winnipeg). Tap one to read it, edit it, move it, skip it or post it now.
          </p>
        )}

        {days.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing planned for the next two weeks.</p>}
        {shown.map((d) => (
          <div key={d.day} data-posts-day={d.day}>
            <div className="px-4 pb-1 pt-3 text-[13px] font-semibold">{d.label}</div>
            <ul>
              {d.items.map((it) => (
                <ScheduleRow key={it.key} it={it} onOpen={() => openItem(it)} />
              ))}
            </ul>
          </div>
        ))}
        {laterDays.length > 0 && (
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="flex min-h-[48px] w-full items-center justify-center gap-1.5 border-t border-border text-[13px] font-medium text-muted-foreground"
            data-posts-more
          >
            {more ? "Show less" : `The week after · ${laterCount} more`}
            <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
          </button>
        )}
      </section>

      {recent.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card" data-posts-recent>
          <header className="border-b border-border px-4 py-3">
            <div className="text-[16px] font-semibold">Recently out</div>
          </header>
          <ul>
            {recent.map((it) => (
              <ScheduleRow key={it.key} it={it} dayText={dayLabel(it.day, today)} quiet onOpen={() => openItem(it, true)} />
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-card" data-posts-manage>
        <header className="border-b border-border px-4 py-3">
          <div className="text-[16px] font-semibold">Manage</div>
          <div className="text-[12px] text-muted-foreground">Each kind's settings, library and history.</div>
        </header>
        <ul>
          <ManageRow
            icon={<BookOpen className="h-4 w-4" />}
            title="Lessons"
            sub={
              lessons.data
                ? `Mon & Thu at ${clockLabel(lessons.data.time.fixed ?? lessons.data.time.learned.time)} · ${lessons.data.mode === "auto" ? "post on their own" : "you approve each one"}`
                : "Mon & Thu"
            }
            onClick={() => onManage("lessons")}
            data-manage="lessons"
          />
          <ManageRow
            icon={<ImageIcon className="h-4 w-4" />}
            title="Athlete Insights"
            sub={insights.data ? (insights.data.on ? `${(insights.data.insight_days ?? [5, 6, 7]).map((n) => WEEKDAY[n - 1]).join(", ")} at 7 am` : "Off") : "Fri, Sat, Sun at 7 am"}
            onClick={() => onManage("insights")}
            data-manage="insights"
          />
          <ManageRow
            icon={<Lightbulb className="h-4 w-4" />}
            title="Daily series & holidays"
            sub={seriesLine(series.data?.series_on, series.data?.holidays?.filter((h) => !h.posted).length ?? 0)}
            onClick={() => onManage("series")}
            data-manage="series"
          />
          <ManageRow
            icon={<Cake className="h-4 w-4" />}
            title="Birthdays"
            sub={birthdayLine(birthdaysNext.data?.[0], today)}
            onClick={() => onManage("birthdays")}
            data-manage="birthdays"
          />
        </ul>
      </section>

      {lesson && lessons.data && (
        <LessonSheet
          row={lesson}
          data={lessons.data}
          onClose={() => setLessonId(null)}
          onPlay={stories.some((x) => x.id === lesson.id) ? () => setPlayId(lesson.id) : undefined}
        />
      )}
      {playId && lessons.data && <LessonStoryPlayer rows={stories} startId={playId} data={lessons.data} onClose={() => setPlayId(null)} />}
      {insights.data && <DaySheet d={insight} today={insights.data.today} off={!insights.data.on || insights.data.paused} onClose={() => setInsightId(null)} />}
      <BirthdayPostSheet post={birthday} onClose={() => setBirthdayId(null)} />
    </div>
  );
}

/** "Tuesday Tips, Wednesday Wins · 2 holidays coming up" */
function seriesLine(on: string[] | undefined, holidays: number): string {
  const running = ["monday_motivation", "tuesday_tips", "wednesday_wins", "try_it_thursday", "finish_strong_friday", "saturday_spirit", "sunday_recap"]
    .filter((s) => s === "wednesday_wins" || (on ?? []).includes(s))
    .map((s) => SERIES_LABEL[s as keyof typeof SERIES_LABEL]?.name ?? s);
  const h = holidays ? ` · ${holidays} ${holidays === 1 ? "holiday" : "holidays"} coming up` : "";
  return `${running.join(", ")}${h}`;
}

/** "Next: Marc · Dec 21" */
function birthdayLine(n: { birthday: string; person: { name: string } } | undefined, today: string): string {
  if (!n) return "Written the evening before, out at 8 am on the day";
  return `Next: ${n.person.name} · ${dayLabel(n.birthday, today)}`;
}

const KIND_ICON: Record<ScheduleKind, typeof BookOpen> = {
  lesson: BookOpen,
  insight: ImageIcon,
  tip: Lightbulb,
  wins: Trophy,
  recap: BarChart3,
  series: CalendarDays,
  holiday: PartyPopper,
  birthday: Cake,
};

function StatusChip({ status }: { status: ScheduleStatus }) {
  if (QUIET.includes(status)) return null;
  const tone =
    status === "posted"
      ? "bg-success/10 text-success"
      : status === "needs_ok" || status === "problem" || status === "not_set"
        ? "bg-warning/10 text-warning"
        : "bg-muted text-muted-foreground";
  return <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{STATUS_LABEL[status]}</span>;
}

function ScheduleRow({ it, dayText, quiet, onOpen }: { it: ScheduleItem; dayText?: string; quiet?: boolean; onOpen: () => void }) {
  const Icon = KIND_ICON[it.kind];
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left active:bg-muted/60" data-posts-item={it.kind} data-status={it.status}>
        {it.picture || it.status === "making" ? (
          <Thumb path={it.picture} busy={it.status === "making"} className="w-10" />
        ) : (
          <span className="grid aspect-[4/5] w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-muted-foreground">
            {dayText ? `${dayText} · ` : ""}
            {it.time} · {it.label}
          </span>
          <span className="block truncate text-[14px] font-medium">{it.title}</span>
        </span>
        {!quiet && <StatusChip status={it.status} />}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function ManageRow({ icon, title, sub, onClick, ...rest }: { icon: ReactNode; title: string; sub: string; onClick: () => void; "data-manage"?: string }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted/60" {...rest}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">{title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

const MANAGE_TITLE: Record<ManageKey, string> = {
  lessons: "Lessons",
  insights: "Athlete Insights",
  series: "Daily series & holidays",
  birthdays: "Birthdays",
};

/** One kind's own page: its settings, library and history (the card that used to sit on the long Posts page). */
function ManagePage({ which, open, onBack }: { which: ManageKey; open: string | null; onBack: () => void }) {
  return (
    <div className="space-y-3" data-posts-manage-page={which}>
      <button type="button" onClick={onBack} className="-ml-1 inline-flex h-10 items-center gap-0.5 pr-2 text-[15px] font-medium" aria-label={`Back to the schedule from ${MANAGE_TITLE[which]}`}>
        <ChevronLeft className="h-5 w-5" /> Schedule
      </button>
      {which === "lessons" && <CoachLessons />}
      {which === "insights" && <DailyPicturesCard />}
      {which === "series" && <CoachWeeklyPosts focus={open} />}
      {which === "birthdays" && (
        <div className="space-y-3">
          <BirthdayPostsCard />
          <UpcomingBirthdaysWidget windowDays={30} hideWhenEmpty />
        </div>
      )}
    </div>
  );
}

function PostsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="h-5 w-5 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        {[0, 1, 2].map((d) => (
          <div key={d} className="space-y-2 px-4 py-3">
            <Skeleton className="h-3.5 w-20" />
            {[0, 1].map((r) => (
              <div key={r} className="flex items-center gap-3">
                <Skeleton className="aspect-[4/5] w-10 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
