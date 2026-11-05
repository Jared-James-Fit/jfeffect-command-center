import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Heart, History, ImageIcon, Loader2, MessageCircle, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NoteEditor } from "@/components/community/note-editor";
import { useFullMediaUrl } from "@/lib/community.queries";
import { DAILY_FORMATS, DAILY_STYLES, DAILY_STYLE_KEYS, DAILY_THEMES, DAILY_TOPICS, dailyCaption, type DailyStyle, type DailyTheme } from "@/lib/daily-visuals";
import { cn } from "@/lib/utils";

const db = supabase as any;

type Audience = "women" | "men" | "everyone";
type ReviewSummary = { score?: number; passed?: boolean; why?: string | null; text_seen?: string; scores?: Record<string, number> } | null;
type Day = {
  id: string;
  day: string;
  theme: DailyTheme;
  audience: Audience;
  faith: boolean;
  style: string | null;
  format: string | null;
  topic: string | null;
  message: string | null;
  situation: string | null;
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
  made_at: string | null;
  versions: number;
  likes: number | null;
  comments: number | null;
  views: number | null;
};
type Overview = {
  on: boolean;
  paused: boolean;
  lovable: boolean;
  today: string;
  learned: string | null;
  maker: string | null;
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
  audience: Audience | null;
  style: string | null;
  format: string | null;
  topic: string | null;
  review: ReviewSummary;
};
type Action = "full" | "caption" | "picture" | "reject" | "approve" | "unapprove" | "line" | "skip" | "unskip" | "post";

const KEY = ["community-daily-visuals"];
const AUDIENCE: Record<Audience, string> = { women: "for her", men: "for him", everyone: "for everyone" };
const REASON: Record<string, string> = {
  rebuild: "The original, before the rebuild",
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
const styleName = (s: string | null) => (s && s in DAILY_STYLES ? DAILY_STYLES[s as DailyStyle].name : s === "illustration" ? "Illustration" : s === "photo" ? "Photo" : null);
const formatName = (f: string | null) => (f && f in DAILY_FORMATS ? DAILY_FORMATS[f as keyof typeof DAILY_FORMATS].name : null);
const topicName = (t: string | null) => (t && t in DAILY_TOPICS ? DAILY_TOPICS[t as keyof typeof DAILY_TOPICS].split(" (")[0] : null);

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function statusLine(d: Day, today: string, off: boolean): { text: string; tone?: "warn" | "good" } {
  if (d.regen) {
    const what = d.regen === "caption" ? "New words" : d.regen === "picture" ? "New picture" : d.status === "planned" ? "Being made" : "Being remade";
    const step = d.step === "picture" ? " · picture and check" : d.step === "concept" ? " · words" : "";
    return { text: `${what}${step}…${d.error ? ` (${d.error})` : ""}` };
  }
  if (d.status === "failed") return { text: d.error ?? "Couldn't make it", tone: "warn" };
  if (d.error) return { text: d.error, tone: "warn" };
  if (d.status === "posted") return { text: `Posted · ${d.likes ?? 0} likes · ${d.comments ?? 0} comments · ${d.views ?? 0} seen`, tone: "good" };
  if (d.status === "skipped") return { text: "Skipped" };
  if (d.status === "ready") return { text: off ? "Ready · posting is off" : d.day === today ? "Ready · goes out at 7" : d.approved ? "Ready · approved" : "Ready" };
  return { text: "Made 3 days before" };
}

/**
 * Crew → Posts: the daily pictures (daily-visuals.ts). Every day is made
 * concept first and checked before it goes live (daily-visuals.server.ts);
 * tap a day to see it as the crew will, approve or reject it, remake the
 * whole post, the words or the picture (in a style you pick), write your own
 * words, or go back to any earlier version, a posted day included (it
 * changes in place).
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
      toast.success(on ? "Daily pictures are on" : "Daily pictures are off", { description: on ? "Every morning at 7." : undefined });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });
  const setLovable = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_daily_visuals_set_lovable", { _on: on });
      if (error) throw error;
      return on;
    },
    onSuccess: (on) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(on ? "Lovable AI allowed for daily pictures" : "Daily pictures use OpenAI only");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const off = !data.on || data.paused;
  const ahead = data.days.filter((d) => d.day >= data.today && d.status !== "posted");
  const out = data.days.filter((d) => d.status === "posted").reverse();
  const learned = parse<{ text?: string }>(data.learned)?.text ?? null;
  const maker = parse<{ blocked?: string; at?: string }>(data.maker);
  const open = data.days.find((d) => d.id === openId) ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" data-daily-pictures>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Daily pictures</div>
          <div className="truncate text-[12px] text-muted-foreground">Every morning at 7 · each one checked before it goes out</div>
        </div>
        <Switch checked={data.on} disabled={setOn.isPending} onCheckedChange={(v) => setOn.mutate(v)} aria-label="Daily pictures on" />
      </header>

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

      {ahead.length > 0 && <SectionLabel>Coming up</SectionLabel>}
      <ul>
        {ahead.map((d) => (
          <DayRow key={d.id} d={d} today={data.today} off={off} onOpen={() => setOpenId(d.id)} />
        ))}
      </ul>

      {out.length > 0 && <SectionLabel>Out</SectionLabel>}
      <ul>
        {out.map((d) => (
          <DayRow key={d.id} d={d} today={data.today} off={off} onOpen={() => setOpenId(d.id)} />
        ))}
      </ul>

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
        <Switch checked={data.lovable} disabled={setLovable.isPending} onCheckedChange={(v) => setLovable.mutate(v)} aria-label="Use Lovable AI for daily pictures" />
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
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50" data-daily-day={d.day}>
        <Thumb path={d.picture} busy={!!d.regen && !d.picture} className="w-[72px]" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold">
              {dayLabel(d.day, today)} · {DAILY_THEMES[d.theme].name}
            </span>
            <Chip>{AUDIENCE[d.audience]}</Chip>
            {styleName(d.style) && <Chip>{styleName(d.style)}</Chip>}
            {d.faith && <Chip>faith</Chip>}
            {d.approved && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-success">
                <Check className="h-3 w-3" /> approved
              </span>
            )}
          </div>
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

/** One day: as the crew sees it, what it's about, and everything the coach can do with it. */
function DaySheet({ d, today, off, onClose }: { d: Day | null; today: string; off: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [style, setStyle] = useState<string>("auto");
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

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
  const run = (action: Action, done: string, extra?: { line?: string; style?: string | null }) =>
    act.mutate({ action, ...extra }, { onSuccess: (r) => toast.success(done, { description: r?.status === "not_ready" ? "Not ready yet." : undefined }) });
  const chosen = style === "auto" ? null : style;
  const busy = act.isPending || !!d?.regen;
  const posted = d?.status === "posted";

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
                {dayLabel(d.day, today)} · {DAILY_THEMES[d.theme].name}
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
                  <span>{d.views ?? 0} seen</span>
                </div>
              )}
            </div>

            <div className="space-y-4 px-4 py-4">
              <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">For</dt>
                <dd>{AUDIENCE[d.audience].replace("for ", "")}</dd>
                {topicName(d.topic) && (
                  <>
                    <dt className="text-muted-foreground">Topic</dt>
                    <dd>{topicName(d.topic)}</dd>
                  </>
                )}
                {(formatName(d.format) || styleName(d.style)) && (
                  <>
                    <dt className="text-muted-foreground">Made as</dt>
                    <dd>{[formatName(d.format), styleName(d.style)].filter(Boolean).join(" · ")}</dd>
                  </>
                )}
                {d.message && (
                  <>
                    <dt className="text-muted-foreground">Saying</dt>
                    <dd>{d.message}</dd>
                  </>
                )}
                {d.review?.score != null && (
                  <>
                    <dt className="text-muted-foreground">Check</dt>
                    <dd>
                      {d.review.passed === false ? `Best try, didn't fully pass (${d.review.score}/5)` : `Passed · ${d.review.score}/5`}
                    </dd>
                  </>
                )}
              </dl>

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

                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 text-[13px] font-semibold">Make it again</div>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="mb-2 h-10" aria-label="Style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Style: let it pick</SelectItem>
                        {DAILY_STYLE_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {DAILY_STYLES[k].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="secondary" disabled={busy} onClick={() => run("full", "A new post is being made", { style: chosen })}>
                        Whole post
                      </Button>
                      <Button variant="secondary" disabled={busy || !d.picture} onClick={() => run("caption", "New words are being written")}>
                        Words
                      </Button>
                      <Button variant="secondary" disabled={busy || !d.line} onClick={() => run("picture", "A new picture is being made", { style: chosen })}>
                        Picture
                      </Button>
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {posted ? "It changes in place: same post, same likes and comments, no new notification." : "What's there stays until the new one passes its check."}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={act.isPending} onClick={() => setEditing(true)}>
                      Edit words
                    </Button>
                    <Button variant="outline" disabled={!d.versions} onClick={() => setVersionsOpen((v) => !v)}>
                      <History className="mr-1.5 h-4 w-4" /> Versions{d.versions ? ` (${d.versions})` : ""}
                    </Button>
                  </div>
                  {d.status === "ready" && d.day === today && !off && (
                    <Button className="w-full" variant="outline" disabled={act.isPending} onClick={() => run("post", "Posted")}>
                      Post it now
                    </Button>
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
                      Skip this day
                    </Button>
                  )
                )}
              </div>
            </div>

            <NoteEditor
              open={editing}
              title={`${DAILY_THEMES[d.theme].name}: your words`}
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
              <span className="truncate text-[11px] text-muted-foreground">{[styleName(v.style), v.audience ? AUDIENCE[v.audience] : null].filter(Boolean).join(" · ")}</span>
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
