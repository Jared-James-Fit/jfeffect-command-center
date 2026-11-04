import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Heart, ImageIcon, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteEditor } from "@/components/community/note-editor";
import { useFullMediaUrl } from "@/lib/community.queries";
import { DAILY_THEMES, type DailyTheme } from "@/lib/daily-visuals";
import { cn } from "@/lib/utils";

const db = supabase as any;

type Day = {
  id: string;
  day: string;
  theme: DailyTheme;
  audience: "women" | "men";
  faith: boolean;
  style: "photo" | "illustration" | null;
  line: string | null;
  own: boolean;
  verse_ref: string | null;
  verse_text: string | null;
  picture: string | null;
  status: "planned" | "ready" | "posted" | "skipped" | "failed";
  error: string | null;
  post_id: string | null;
  likes: number | null;
  views: number | null;
};
type Overview = {
  on: boolean;
  paused: boolean;
  today: string;
  learned: string | null;
  days: Day[];
};
type Action = "words" | "picture" | "line" | "skip" | "unskip" | "post";

const KEY = ["community-daily-visuals"];

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function learnedText(raw: string | null): string | null {
  try {
    const j = raw ? JSON.parse(raw) : null;
    return typeof j?.text === "string" ? j.text : null;
  } catch {
    return null;
  }
}

/**
 * Crew → Posts: the daily pictures (daily-visuals.ts), last week and the week
 * ahead. Each day's words and picture are made two days ahead in the
 * background; the coach can put his own words on one, ask for new words or a
 * new picture, skip a day, send today's early, or switch them all off.
 */
export function DailyPicturesCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    // while something's being made, check back
    refetchInterval: (q) =>
      ((q.state.data as Overview | undefined)?.days ?? []).some(
        (d) => d.status === "planned" && d.day <= addDays((q.state.data as Overview).today, 2),
      )
        ? 30_000
        : false,
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await db.rpc("community_daily_visuals_overview");
      if (error) throw error;
      return data as Overview;
    },
  });
  const [editing, setEditing] = useState<Day | null>(null);

  const act = useMutation({
    mutationFn: async (v: { id: string; action: Action; line?: string }) => {
      const { data, error } = await db.rpc("community_daily_visual_act", {
        _id: v.id,
        _action: v.action,
        _line: v.line ?? null,
      });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
  });
  const setOn = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_daily_visuals_set_on", { _on: on });
      if (error) throw error;
      return on;
    },
    onSuccess: (on) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(on ? "Daily pictures are on" : "Daily pictures are off", {
        description: on ? "Every morning at 7." : undefined,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const ahead = data.days.filter((d) => d.day >= data.today);
  const out = data.days.filter((d) => d.day < data.today && d.status === "posted").reverse();
  const learned = learnedText(data.learned);
  const run = (d: Day, action: Action, done?: string) =>
    act.mutate(
      { id: d.id, action },
      {
        onSuccess: (r) =>
          done &&
          toast.success(done, {
            description: r?.status === "not_ready" ? "Not ready yet." : undefined,
          }),
      },
    );

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/70 bg-card"
      data-daily-pictures
    >
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Daily pictures</div>
          <div className="truncate text-[11px] text-muted-foreground">
            Every morning at 7 · a theme a day · learns what the crew likes
          </div>
        </div>
        <Switch
          checked={data.on}
          disabled={setOn.isPending}
          onCheckedChange={(v) => setOn.mutate(v)}
          aria-label="Daily pictures on"
        />
      </header>

      <ul className="divide-y divide-border/60">
        {ahead.map((d) => (
          <DayRow
            key={d.id}
            d={d}
            today={data.today}
            off={!data.on || data.paused}
            busy={act.isPending && act.variables?.id === d.id}
            onEdit={() => setEditing(d)}
            onAct={(a, done) => run(d, a, done)}
          />
        ))}
      </ul>

      {out.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">Out this week</div>
          <ul className="space-y-1.5">
            {out.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[12px]">
                <span className="w-16 shrink-0 font-semibold">{dayLabel(d.day, data.today)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.line}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                  <Heart className="h-3 w-3" /> {d.likes ?? 0} · {d.views ?? 0} seen
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {learned && (
        <div
          className="border-t border-border/60 px-4 py-3 text-[12px] text-muted-foreground"
          data-daily-learned
        >
          <span className="font-semibold text-foreground">What's working: </span>
          {learned}
        </div>
      )}

      <NoteEditor
        open={!!editing}
        title={editing ? `${DAILY_THEMES[editing.theme].name}: your words` : ""}
        initial={editing?.line ?? ""}
        saving={act.isPending}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (!editing) return;
          await act.mutateAsync({ id: editing.id, action: "line", line: body });
          toast.success("Saved. It goes out like this.");
          setEditing(null);
        }}
      />
    </div>
  );
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function DayRow({
  d,
  today,
  off,
  busy,
  onEdit,
  onAct,
}: {
  d: Day;
  today: string;
  off: boolean;
  busy: boolean;
  onEdit: () => void;
  onAct: (a: Action, done?: string) => void;
}) {
  const url = useFullMediaUrl(d.picture, !!d.picture).data ?? null;
  const soon = d.day <= addDays(today, 2);
  const making = d.status === "planned" && soon;
  const status =
    d.status === "posted" ? (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" /> Posted · {d.likes ?? 0} likes
      </span>
    ) : d.status === "skipped" ? (
      "Skipped"
    ) : d.status === "failed" ? (
      <span className="text-destructive">Couldn't make it{d.error ? `: ${d.error}` : ""}</span>
    ) : d.status === "ready" ? (
      off ? (
        "Ready · posting is off"
      ) : d.day === today ? (
        "Ready · goes out at 7"
      ) : (
        "Ready"
      )
    ) : making ? (
      d.error ? (
        `Trying again soon (${d.error})`
      ) : (
        "Being made…"
      )
    ) : (
      "Made 2 days before"
    );

  return (
    <li className="flex gap-3 px-4 py-3">
      {url ? (
        <img src={url} alt="" className="aspect-[4/5] w-[72px] shrink-0 rounded-lg object-cover" />
      ) : (
        <div
          className={cn(
            "grid aspect-[4/5] w-[72px] shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground",
            making && "animate-pulse",
          )}
        >
          {making ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">
            {dayLabel(d.day, today)} · {DAILY_THEMES[d.theme].name}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {d.audience === "women" ? "for her" : "for him"}
          </span>
          {d.faith && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              faith
            </span>
          )}
        </div>
        {d.line ? (
          <p className="line-clamp-3 whitespace-pre-line text-[12.5px] leading-snug">{d.line}</p>
        ) : null}
        {d.faith && d.verse_text && (
          <p className="line-clamp-2 text-[11.5px] italic text-muted-foreground">
            “{d.verse_text}” {d.verse_ref}
          </p>
        )}
        <div className="text-[11px] text-muted-foreground">
          {status}
          {d.own ? " · your words" : ""}
        </div>
      </div>
      {d.status !== "posted" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Change this day"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {d.status !== "skipped" && (
              <DropdownMenuItem onSelect={onEdit}>Write my own words</DropdownMenuItem>
            )}
            {d.status !== "skipped" && (
              <DropdownMenuItem onSelect={() => onAct("words", "New words on the way")}>
                New words
              </DropdownMenuItem>
            )}
            {d.status !== "skipped" && d.picture && (
              <DropdownMenuItem onSelect={() => onAct("picture", "New picture on the way")}>
                New picture
              </DropdownMenuItem>
            )}
            {d.status === "ready" && d.day === today && (
              <DropdownMenuItem onSelect={() => onAct("post", "Posted")}>
                Post it now
              </DropdownMenuItem>
            )}
            {d.status === "skipped" ? (
              <DropdownMenuItem onSelect={() => onAct("unskip", "It's back on")}>
                Bring it back
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onAct("skip", "Skipped")}>
                Skip this day
              </DropdownMenuItem>
            )}
            {d.status === "failed" && (
              <DropdownMenuItem onSelect={() => onAct("unskip", "Trying again")}>
                Try again
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
