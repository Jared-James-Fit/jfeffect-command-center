import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Bookmark, CalendarClock, Check, Heart, History, ImageIcon, Loader2, MessageCircle, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NoteEditor } from "@/components/community/note-editor";
import { useFullMediaUrl } from "@/lib/community.queries";
import {
  ART_STYLES,
  DAILY_LIGHTS,
  DAILY_PILLARS,
  DAILY_STYLES,
  DAILY_STYLE_KEYS,
  FILM_LOOK_VERSION,
  LEGACY_ART_NAMES,
  LEGACY_LIGHT_NAMES,
  LEGACY_SHOT_NAMES,
  LEGACY_STYLE_NAMES,
  dailyCaption,
  formatName,
  pictureDaysLabel,
  pillarOf,
  qualityChecks,
  relevanceOf,
  topicName,
  type CoachPostDay,
  type DailyArt,
  type DailyLight,
  type DailyStyle,
  type DailyTheme,
} from "@/lib/daily-visuals";
import { cn } from "@/lib/utils";

const db = supabase as any;

type Scores = { scores?: Record<string, number> } | null;
type ReviewSummary = { score?: number; passed?: boolean; why?: string | null; text_seen?: string; scores?: Record<string, number> } | null;
type Day = {
  id: string;
  day: string;
  theme: DailyTheme;
  faith: boolean;
  style: string | null;
  light: string | null;
  art: string | null;
  look: string | null;
  format: string | null;
  topic: string | null;
  pillar?: string | null;
  message: string | null;
  situation: string | null;
  visual?: string | null;
  editor?: (Scores & { passed?: boolean; score?: number; why?: string }) | null;
  line: string | null;
  own: boolean;
  verse_ref: string | null;
  verse_text: string | null;
  picture: string | null;
  review: ReviewSummary;
  status: "planned" | "ready" | "posted" | "skipped" | "failed";
  error: string | null;
  post_id: string | null;
  regen: "full" | "caption" | "picture" | null;
  regen_style: string | null;
  working: boolean;
  step: "concept" | "picture" | null;
  approved: boolean;
  /** Didn't fully pass its checks: waits for the coach's OK (community_daily_visual_held). */
  held?: boolean;
  /** Published, then taken out of the feed. */
  archived?: boolean;
  made_at: string | null;
  versions: number;
  likes: number | null;
  comments: number | null;
  saves?: number | null;
  views: number | null;
};
/** A test post: the whole pipeline, never a day or a post (runDailyVisualTest). */
type Test = {
  id: string;
  at: string;
  theme: DailyTheme;
  style: string;
  light: string | null;
  art?: string | null;
  look?: string | null;
  pillar?: string | null;
  topic?: string | null;
  caption: string;
  picture: string;
  passed: boolean;
  score: number;
  medium: string;
};
type Overview = {
  on: boolean;
  paused: boolean;
  lovable: boolean;
  today: string;
  learned: string | null;
  maker: string | null;
  /** The weekdays they go out (ISO, Monday = 1). */
  insight_days?: number[];
  tests?: Test[];
  /** The coming 7 days and what goes out on each (null = an Athlete Insight, "off" = not a picked day). */
  week?: CoachPostDay[];
  days: Day[];
};
type Version = {
  id: string;
  created_at: string;
  reason: string;
  line: string | null;
  own: boolean;
  caption: string | null;
  picture: string | null;
  style: string | null;
  format: string | null;
  topic: string | null;
  review: ReviewSummary;
};
type Action = "full" | "caption" | "picture" | "reject" | "approve" | "unapprove" | "line" | "skip" | "unskip" | "post";

const KEY = ["community-daily-visuals"];
const WEEKDAYS = [
  { n: 1, short: "M", name: "Mon" },
  { n: 2, short: "T", name: "Tue" },
  { n: 3, short: "W", name: "Wed" },
  { n: 4, short: "T", name: "Thu" },
  { n: 5, short: "F", name: "Fri" },
  { n: 6, short: "S", name: "Sat" },
  { n: 7, short: "S", name: "Sun" },
] as const;
const TAKEN: Record<string, string> = {
  lesson: "a lesson",
  wednesday_wins: "Wednesday Wins",
  holiday: "a holiday post",
  monday_motivation: "Monday Motivation",
  tuesday_tips: "Tuesday Tips",
  try_it_thursday: "Try it Thursday",
  finish_strong_friday: "Finish Strong Friday",
  saturday_spirit: "Saturday Spirit",
};
const REASON: Record<string, string> = {
  rebuild: "The original, before the rebuild",
  restyle: "Before the new look",
  voice: "Before the new voice",
  coach: "Replaced when you asked for a new one",
  rejected: "You rejected it",
  edited: "Before your edit",
  restored: "Replaced by a restore",
  new: "Earlier try",
  replaced: "Earlier version",
};

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}
const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const styleName = (s: string | null) => (s && s in DAILY_STYLES ? DAILY_STYLES[s as DailyStyle].name : s ? (LEGACY_STYLE_NAMES[s] ?? LEGACY_SHOT_NAMES[s] ?? null) : null);
const lightName = (l: string | null) => (l && l in DAILY_LIGHTS ? DAILY_LIGHTS[l as DailyLight].name : l ? (LEGACY_LIGHT_NAMES[l] ?? LEGACY_SHOT_NAMES[l] ?? null) : null);
const artName = (a: string | null | undefined) => (a && a in ART_STYLES ? ART_STYLES[a as DailyArt].name : a ? (LEGACY_ART_NAMES[a] ?? null) : null);
/** "Coach's notes · Small jumps": what the post is about. */
const aboutName = (d: { pillar?: string | null; topic: string | null }) => {
  const p = pillarOf({ pillar: d.pillar, topic: d.topic });
  return [p ? DAILY_PILLARS[p].name : null, topicName(d.topic)].filter(Boolean).join(" · ") || null;
};

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** "Fri, Sat and Sun" from ISO weekdays. */
function daysName(days: number[]): string {
  const names = WEEKDAYS.filter((w) => days.includes(w.n)).map((w) => w.name);
  return names.length <= 1 ? (names[0] ?? "No days") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function statusLine(d: Day, today: string, off: boolean): { text: string; tone?: "warn" | "good" } {
  if (d.regen) {
    const what = d.regen === "caption" ? "New caption" : d.regen === "picture" ? "New image" : d.status === "planned" ? "Being made" : "Being remade";
    const step = d.step === "picture" ? " · image and check" : d.step === "concept" ? " · words" : "";
    return { text: `${what}${step}…${d.error ? ` (${d.error})` : ""}` };
  }
  if (d.status === "skipped") return { text: d.error ?? "Skipped" };
  if (d.status === "failed") return { text: d.error ?? "Couldn't make it", tone: "warn" };
  if (d.held) return { text: "Needs your OK: it didn't fully pass its checks", tone: "warn" };
  if (d.error) return { text: d.error, tone: "warn" };
  if (d.status === "posted" && d.archived) return { text: "Archived · not in the feed" };
  if (d.status === "posted")
    return { text: `Posted · ${d.likes ?? 0} likes · ${d.comments ?? 0} comments · ${d.saves ?? 0} saves · ${d.views ?? 0} seen`, tone: "good" };
  if (d.status === "ready") return { text: off ? "Ready · posting is off" : d.day === today ? "Ready · goes out at 7" : d.approved ? "Approved · goes out at 7" : "Ready · goes out at 7" };
  return { text: "Made 3 days before" };
}

/**
 * Crew → Posts: Athlete Insights (series `daily_visual`, daily-visuals.ts).
 * On the weekdays the coach picks (3 a week by default), an anime frame in
 * JF Effect's house style and a caption made together and checked before they go live
 * (daily-visuals.server.ts); a post that didn't fully pass waits for his OK.
 * Tap one to see it as the crew will, approve or reject it, make a new image
 * (caption kept) or a new caption (image kept), edit the words, publish it
 * now, move it to another day, or go back to any earlier version, a
 * published post included (it changes in place).
 */
export function DailyPicturesCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    // while something's being made, check back
    refetchInterval: (q) => (((q.state.data as Overview | undefined)?.days ?? []).some((d) => !!d.regen) ? 20_000 : false),
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await db.rpc("community_daily_visuals_overview");
      if (error) throw error;
      return data as Overview;
    },
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const setOn = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_daily_visuals_set_on", { _on: on });
      if (error) throw error;
      return on;
    },
    onSuccess: (on) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(on ? "Athlete Insights are on" : "Athlete Insights are off");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });
  const setDays = useMutation({
    mutationFn: async (days: number[]) => {
      const { data, error } = await db.rpc("community_daily_visuals_set_days", { _days: days });
      if (error) throw error;
      return data as { days: number[] };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(`${r.days.length} a week`, { description: `${daysName(r.days)} at 7.` });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change the days"),
  });
  const setLovable = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_daily_visuals_set_lovable", { _on: on });
      if (error) throw error;
      return on;
    },
    onSuccess: (on) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(on ? "Lovable AI allowed for Athlete Insights" : "Athlete Insights use OpenAI only");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const off = !data.on || data.paused;
  const insightDays = data.insight_days ?? [5, 6, 7];
  const ahead = data.days.filter((d) => d.day >= data.today && d.status !== "posted");
  const held = ahead.filter((d) => d.held).length;
  const out = data.days.filter((d) => d.status === "posted").reverse();
  const learned = parse<{ text?: string }>(data.learned)?.text ?? null;
  const maker = parse<{ blocked?: string; at?: string }>(data.maker);
  const open = data.days.find((d) => d.id === openId) ?? null;
  const thisWeek = pictureDaysLabel(data.week);
  // picked days another coach post takes this week (one coach post a day)
  const steppedAside = (data.week ?? []).filter((w) => w.post && w.post !== "off" && insightDays.includes(isoDow(w.day)));
  const toggle = (n: number) => {
    const next = insightDays.includes(n) ? insightDays.filter((d) => d !== n) : [...insightDays, n].sort();
    if (!next.length) return toast.error("Pick at least one day, or switch Athlete Insights off");
    setDays.mutate(next);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" data-daily-pictures data-athlete-insights>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Athlete Insights</div>
          <div className="truncate text-[12px] text-muted-foreground" data-daily-picture-days>
            {insightDays.length} a week · {thisWeek ? `${thisWeek} this week at 7` : "none this week"}
          </div>
        </div>
        <Switch checked={data.on} disabled={setOn.isPending} onCheckedChange={(v) => setOn.mutate(v)} aria-label="Athlete Insights on" />
      </header>

      <div className="border-b border-border px-4 py-3" data-insight-days>
        <div className="mb-2 text-[13px] font-semibold">Days</div>
        <div className="flex gap-1.5">
          {WEEKDAYS.map((w) => {
            const on = insightDays.includes(w.n);
            return (
              <button
                key={w.n}
                type="button"
                disabled={setDays.isPending}
                onClick={() => toggle(w.n)}
                aria-pressed={on}
                aria-label={w.name}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-full border text-[13px] font-semibold transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground",
                )}
              >
                {w.short}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Fewer, better posts: 3 a week is the default. A picked day that already has a lesson, Wins or a holiday steps aside (one coach post a day)
          {steppedAside.length ? `: this week ${steppedAside.map((w) => `${dayLabel(w.day, data.today)} has ${TAKEN[w.post!] ?? w.post}`).join(", ")}.` : "."}
        </p>
      </div>

      {maker?.blocked && (
        <div className="flex gap-2 border-b border-border px-4 py-3 text-[13px]" data-daily-blocked>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">New ones can't be made yet</div>
            <div className="text-muted-foreground">
              {maker.blocked} Add an OpenAI key (OPENAI_API_KEY) in Lovable → Cloud → Secrets, or allow Lovable AI below. Nothing already made is touched.
            </div>
          </div>
        </div>
      )}

      {ahead.length > 0 && <SectionLabel>{held ? `Coming up · ${held} ${held === 1 ? "needs" : "need"} your OK` : "Coming up"}</SectionLabel>}
      <ul>
        {ahead.map((d) => (
          <DayRow key={d.id} d={d} today={data.today} off={off} onOpen={() => setOpenId(d.id)} />
        ))}
      </ul>

      {out.length > 0 && <SectionLabel>Published</SectionLabel>}
      <ul>
        {out.map((d) => (
          <DayRow key={d.id} d={d} today={data.today} off={off} onOpen={() => setOpenId(d.id)} />
        ))}
      </ul>

      {(data.tests?.length ?? 0) > 0 && <Tests tests={data.tests!} />}

      <ApproveLook days={data.days} />

      {learned && (
        <div className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground" data-daily-learned>
          <span className="font-semibold text-foreground">What's working: </span>
          {learned}
        </div>
      )}

      <label className="flex min-h-[48px] items-center gap-3 border-t border-border px-4 py-2 text-[13px]">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Use Lovable AI</div>
          <div className="text-[12px] text-muted-foreground">Off: made on OpenAI only, never your Lovable balance.</div>
        </div>
        <Switch checked={data.lovable} disabled={setLovable.isPending} onCheckedChange={(v) => setLovable.mutate(v)} aria-label="Use Lovable AI for Athlete Insights" />
      </label>

      <DaySheet d={open} today={data.today} off={off} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-4 pb-1 pt-3 text-[12px] font-semibold text-muted-foreground">{children}</div>;
}

function Thumb({ path, busy, className }: { path: string | null; busy?: boolean; className?: string }) {
  const url = useFullMediaUrl(path, !!path).data ?? null;
  return url ? (
    <img src={url} alt="" className={cn("aspect-[4/5] shrink-0 rounded-lg object-cover", className)} />
  ) : (
    <div className={cn("grid aspect-[4/5] shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", busy && "animate-pulse", className)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
    </div>
  );
}

function DayRow({ d, today, off, onOpen }: { d: Day; today: string; off: boolean; onOpen: () => void }) {
  const s = statusLine(d, today, off);
  const about = aboutName(d);
  const relevance = relevanceOf({ pillar: d.pillar, topic: d.topic });
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50" data-daily-day={d.day}>
        <Thumb path={d.picture} busy={!!d.regen && !d.picture} className="w-[72px]" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold">{dayLabel(d.day, today)}</span>
            {relevance && <Chip>{relevance}</Chip>}
            {d.faith && <Chip>verse</Chip>}
            {d.approved && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-success">
                <Check className="h-3 w-3" /> approved
              </span>
            )}
          </div>
          {about && <div className="truncate text-[12px] text-muted-foreground" data-daily-about>{about}</div>}
          {d.line && <p className="line-clamp-2 whitespace-pre-line text-[13px] leading-snug">{d.line}</p>}
          <div className={cn("line-clamp-2 text-[12px]", s.tone === "warn" ? "text-warning" : s.tone === "good" ? "text-success" : "text-muted-foreground")}>
            {s.text}
            {d.own ? " · your words" : ""}
          </div>
        </div>
      </button>
    </li>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}

/** One post: as the crew sees it, what it's about, how it did on the checks, and everything the coach can do with it. */
function DaySheet({ d, today, off, onClose }: { d: Day | null; today: string; off: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [style, setStyle] = useState<string>("auto");
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");

  const act = useMutation({
    mutationFn: async (v: { action: Action; line?: string; style?: string | null }) => {
      const { data, error } = await db.rpc("community_daily_visual_act", { _id: d!.id, _action: v.action, _line: v.line ?? null, _style: v.style ?? null });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["daily-visual-versions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
  });
  const move = useMutation({
    mutationFn: async (day: string) => {
      const { data, error } = await db.rpc("community_daily_visual_move", { _id: d!.id, _day: day });
      if (error) throw error;
      return data as { status: string; day: string };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      setMoveTo("");
      toast.success(r.status === "unchanged" ? "It's already on that day" : `Moved to ${dayLabel(r.day, today)}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't move it"),
  });
  const run = (action: Action, done: string, extra?: { line?: string; style?: string | null }) =>
    act.mutate(
      { action, ...extra },
      {
        onSuccess: (r) =>
          toast.success(done, {
            description: r?.status === "not_ready" ? "Not ready yet." : r?.status === "needs_review" ? "It's waiting for your OK." : r?.status === "paused" ? "Coach posts are paused." : undefined,
          }),
      },
    );
  const chosen = style === "auto" ? null : style;
  const busy = act.isPending || !!d?.regen;
  const posted = d?.status === "posted";
  const checks = d ? qualityChecks(d.editor, d.review) : [];
  const checked = checks.some((c) => c.pass !== null);
  const relevance = d ? relevanceOf({ pillar: d.pillar, topic: d.topic }) : null;

  return (
    <Sheet open={!!d} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-daily-sheet>
        {d && (
          <>
            <SheetHeader className="relative space-y-0.5 border-b border-border py-3 pl-5 pr-14 pt-4 text-left">
              <SheetClose className="absolute right-4 top-3.5 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </SheetClose>
              <SheetTitle className="text-[17px] font-semibold">
                {dayLabel(d.day, today)}
                {aboutName(d) ? ` · ${aboutName(d)}` : ""}
              </SheetTitle>
              <SheetDescription className="text-[12px]">{statusLine(d, today, off).text}</SheetDescription>
            </SheetHeader>

            {/* as it shows in the feed: the picture edge to edge at 4:5, the name and words under it */}
            <div data-daily-preview>
              <Thumb path={d.picture} busy={!!d.regen && !d.picture} className="w-full rounded-none" />
              {d.line && (
                <p className="whitespace-pre-line px-4 pt-3 text-[15px] leading-snug">
                  <span className="font-semibold">JF Effect </span>
                  {dailyCaption(d.line, d.faith && d.verse_text && d.verse_ref ? { ref: d.verse_ref, text: d.verse_text } : null)}
                </p>
              )}
              {posted && (
                <div className="flex items-center gap-3 px-4 pt-2 text-[12px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Heart className="h-3.5 w-3.5" /> {d.likes ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-3.5 w-3.5" /> {d.comments ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Bookmark className="h-3.5 w-3.5" /> {d.saves ?? 0}
                  </span>
                  <span>{d.views ?? 0} seen</span>
                </div>
              )}
            </div>

            <div className="space-y-4 px-4 py-4">
              {d.held && !posted && (
                <div className="flex gap-2 rounded-xl border border-warning/40 p-3 text-[13px]" data-daily-held>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <div className="font-semibold">Needs your OK</div>
                    <div className="text-muted-foreground">It didn't fully pass its checks, so it won't go out on its own. Approve it, or make a new image or caption.</div>
                  </div>
                </div>
              )}

              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {relevance && (
                  <>
                    <dt className="text-muted-foreground">Relevant to</dt>
                    <dd>{relevance}</dd>
                  </>
                )}
                {aboutName(d) && (
                  <>
                    <dt className="text-muted-foreground">About</dt>
                    <dd>{aboutName(d)}</dd>
                  </>
                )}
                {d.message && (
                  <>
                    <dt className="text-muted-foreground">The point</dt>
                    <dd>{d.message}</dd>
                  </>
                )}
                {d.visual && (
                  <>
                    <dt className="text-muted-foreground">The image</dt>
                    <dd className="line-clamp-4">{d.visual}</dd>
                  </>
                )}
                {(formatName(d.format) || styleName(d.style)) && (
                  <>
                    <dt className="text-muted-foreground">Made as</dt>
                    <dd>{[formatName(d.format), artName(d.art), styleName(d.style), lightName(d.light)].filter(Boolean).join(" · ")}</dd>
                  </>
                )}
              </dl>

              {checked && (
                <div className="rounded-xl border border-border p-3" data-daily-quality>
                  <div className="mb-1.5 text-[13px] font-semibold">Checks</div>
                  <ul className="space-y-1 text-[13px]">
                    {checks.map((c) => (
                      <li key={c.key} className="flex items-center gap-2">
                        {c.pass === null ? (
                          <span className="h-4 w-4 shrink-0 text-center text-muted-foreground">·</span>
                        ) : c.pass ? (
                          <Check className="h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <X className="h-4 w-4 shrink-0 text-warning" />
                        )}
                        <span className={cn(c.pass === null && "text-muted-foreground")}>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {d.status !== "skipped" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={d.approved ? "secondary" : "default"}
                      disabled={busy || !d.picture}
                      onClick={() => run(d.approved ? "unapprove" : "approve", d.approved ? "Approval taken off" : "Approved")}
                    >
                      <Check className="mr-1.5 h-4 w-4" /> {d.approved ? "Approved" : "Approve"}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => run("reject", posted ? "Rejected. A new one replaces it in place." : "Rejected. A new one is being made.")}>
                      <X className="mr-1.5 h-4 w-4" /> Reject
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border p-3" data-daily-regenerate>
                    <div className="mb-2 text-[13px] font-semibold">Regenerate</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" disabled={busy || !d.line} onClick={() => run("picture", "A new image is being made. The caption stays.", { style: chosen })}>
                        New image
                      </Button>
                      <Button variant="secondary" disabled={busy || !d.picture} onClick={() => run("caption", "A new caption is being written. The image stays.")}>
                        New caption
                      </Button>
                    </div>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="mt-2 h-10" aria-label="Shot">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Shot: let it pick</SelectItem>
                        {DAILY_STYLE_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {DAILY_STYLES[k].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" className="mt-1 w-full" disabled={busy} onClick={() => run("full", "A whole new post is being made", { style: chosen })}>
                      Whole new post
                    </Button>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {posted ? "It changes in place: same post, same likes and comments, no new notification." : "What's there stays until the new one passes its checks."}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={act.isPending} onClick={() => setEditing(true)}>
                      Edit caption
                    </Button>
                    <Button variant="outline" disabled={!d.versions} onClick={() => setVersionsOpen((v) => !v)}>
                      <History className="mr-1.5 h-4 w-4" /> Versions{d.versions ? ` (${d.versions})` : ""}
                    </Button>
                  </div>

                  {!posted && (
                    <div className="rounded-xl border border-border p-3" data-daily-schedule>
                      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" /> Publish or reschedule
                      </div>
                      {d.status === "ready" && !off && (
                        <Button className="mb-2 w-full" disabled={act.isPending} onClick={() => run("post", "Published")}>
                          Publish now
                        </Button>
                      )}
                      <div className="flex gap-2">
                        <Input type="date" value={moveTo} min={today} onChange={(e) => setMoveTo(e.target.value)} className="h-10 flex-1 text-[16px]" aria-label="Move to" />
                        <Button variant="outline" className="h-10" disabled={!moveTo || move.isPending} onClick={() => move.mutate(moveTo)}>
                          Move
                        </Button>
                      </div>
                      <p className="mt-1 text-[12px] text-muted-foreground">Publish now counts as your OK. A day that already has a lesson, Wins or a holiday can't take it.</p>
                    </div>
                  )}
                </div>
              )}

              {versionsOpen && d.versions > 0 && <Versions id={d.id} posted={posted} />}

              <div className="flex justify-center">
                {d.status === "skipped" || d.status === "failed" ? (
                  <Button variant="ghost" disabled={act.isPending} onClick={() => run("unskip", d.status === "failed" ? "Trying again" : "It's back on")}>
                    <RefreshCcw className="mr-1.5 h-4 w-4" /> {d.status === "failed" ? "Try again" : "Bring it back"}
                  </Button>
                ) : (
                  !posted && (
                    <Button variant="ghost" className="text-muted-foreground" disabled={act.isPending} onClick={() => run("skip", "Skipped")}>
                      Skip this one
                    </Button>
                  )
                )}
              </div>
            </div>

            <NoteEditor
              open={editing}
              title={`${dayLabel(d.day, today)}: your caption`}
              initial={d.line ?? ""}
              saving={act.isPending}
              onClose={() => setEditing(false)}
              onSave={async (body) => {
                await act.mutateAsync({ action: "line", line: body });
                toast.success(posted ? "Saved. The post shows your words now." : "Saved. It goes out like this.");
                setEditing(false);
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Versions({ id, posted }: { id: string; posted: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["daily-visual-versions", id],
    queryFn: async (): Promise<Version[]> => {
      const { data, error } = await db.rpc("community_daily_visual_versions_list", { _id: id });
      if (error) throw error;
      return (data ?? []) as Version[];
    },
  });
  const restore = useMutation({
    mutationFn: async (versionId: string) => {
      const { error } = await db.rpc("community_daily_visual_restore", { _version_id: versionId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["daily-visual-versions", id] });
      toast.success(posted ? "Restored. The post shows it again." : "Restored");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't restore it"),
  });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  return (
    <ul className="space-y-2" data-daily-versions>
      {(data ?? []).map((v) => (
        <li key={v.id} className="flex gap-3 rounded-xl border border-border p-2.5">
          <Thumb path={v.picture} className="w-[56px]" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-muted-foreground">
              {REASON[v.reason] ?? "Earlier version"} · {new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-[13px] leading-snug">{v.caption ?? v.line}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-muted-foreground">{styleName(v.style)}</span>
              <Button size="sm" variant="outline" className="h-9" disabled={restore.isPending} onClick={() => restore.mutate(v.id)}>
                Restore
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Test posts: a new look tried before it reaches the feed. */
function Tests({ tests }: { tests: Test[] }) {
  return (
    <div className="border-t border-border px-4 py-3" data-daily-tests>
      <div className="mb-2 text-[12px] font-semibold text-muted-foreground">Test posts · never published</div>
      <ul className="grid grid-cols-3 gap-2">
        {tests.map((t) => (
          <li key={t.id} className="min-w-0">
            <Thumb path={t.picture} className="w-full" />
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{relevanceOf({ pillar: t.pillar, topic: t.topic }) ?? artName(t.art) ?? styleName(t.style)}</div>
            <div className={cn("text-[11px]", t.passed ? "text-success" : "text-warning")}>{t.passed ? `Passed · ${t.score}/5` : `Didn't pass · ${t.score}/5`}</div>
            <p className="line-clamp-3 text-[12px] leading-snug">{t.caption}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The coach's yes to the new look for posts already published: their images
 * are remade in the current look, captions, likes and comments kept, the old images in
 * Versions (community_daily_visuals_restyle). Upcoming posts move to it on
 * their own; a published one only when he says so.
 */
function ApproveLook({ days }: { days: Day[] }) {
  const qc = useQueryClient();
  const older = days.filter((d) => d.picture && d.status === "posted" && !d.archived && !d.regen && d.look !== FILM_LOOK_VERSION).length;
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("community_daily_visuals_restyle", { _look: FILM_LOOK_VERSION });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(`${n} ${n === 1 ? "image is" : "images are"} being remade`, { description: "Same posts, captions, likes and comments. The old images stay in Versions." });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't start it"),
  });
  if (!older) return null;
  return (
    <div className="border-t border-border px-4 py-3" data-daily-approve-look>
      <div className="text-[13px] font-semibold">Published posts in the old look</div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        {older} {older === 1 ? "post is" : "posts are"} still in an older look. Nothing published changes unless you say so: open one to give it a new image, or replace them all here (captions, likes and comments stay, the old images in Versions).
      </p>
      <Button className="w-full" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
        Give {older} {older === 1 ? "post" : "posts"} the new look
      </Button>
    </div>
  );
}
