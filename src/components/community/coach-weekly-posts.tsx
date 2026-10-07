import { useState } from "react";
import { CalendarClock, Check, PenLine, Send } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { SERIES_LABEL, postTimeLabel, type CommunitySeries } from "@/lib/community";
import { useSeriesAction, useSeriesOverview, type SeriesItem } from "@/lib/community.queries";
import { NoteEditor } from "@/components/community/note-editor";

const ORDER: CommunitySeries[] = ["monday_motivation", "wednesday_wins", "finish_strong_friday"];
const WHEN: Record<CommunitySeries, string> = {
  monday_motivation: "Mondays · 7:00 am",
  wednesday_wins: "Wednesdays · 12:00 pm",
  finish_strong_friday: "Fridays · 7:00 am",
};

/**
 * Coach controls for the weekly posts: on/off, what goes out next (edit
 * library posts first if you like), post now, recent history, and a plain
 * "write a post". Wednesday Wins is written from last week's training, so it
 * shows a live preview instead of a library item; edit it once it's posted.
 * Everything here publishes through the same community posts.
 */
export function CoachWeeklyPosts() {
  const { data, isLoading, isError } = useSeriesOverview(true);
  const act = useSeriesAction();
  const [editing, setEditing] = useState<{ item: SeriesItem } | null>(null);
  const [writing, setWriting] = useState(false);

  if (isLoading) return <Skeleton className="mx-3 mt-3 h-40 rounded-2xl sm:mx-auto sm:max-w-[560px]" />;
  if (isError || !data) return null;

  const run = (a: Parameters<typeof act.mutate>[0], ok: string) =>
    act.mutate(a, {
      onSuccess: (r) => {
        if (r?.status && r.status !== "published") toast.message(r.status === "exists" ? "Already posted this week" : r.status === "paused" ? "Turn weekly posts on first" : "Nothing to post");
        else toast.success(ok);
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
    });

  return (
    <section className="mx-auto mt-3 w-full max-w-[560px] px-3 sm:px-4">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black">Weekly posts</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {data.author ? `Posts as ${data.author.name} · Winnipeg time` : "No posting account set"}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-bold">
            {data.paused ? "Paused" : "On"}
            <Switch checked={!data.paused} disabled={act.isPending} onCheckedChange={(on) => run({ kind: "pause", paused: !on }, on ? "Weekly posts are on" : "Weekly posts paused")} />
          </label>
        </header>

        <div className="divide-y divide-border/60">
          {ORDER.map((series) => {
            const wins = series === "wednesday_wins";
            const next = wins ? undefined : data.next?.[series];
            const preview = wins ? data.wins_preview : null;
            const done = data.this_week?.[series];
            return (
              <div key={series} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-black">{SERIES_LABEL[series].name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {WHEN[series]} · {wins ? "from last week's logs" : `${data.library?.[series] ?? 0} in rotation`}
                    </div>
                  </div>
                  {done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Posted this week
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={act.isPending || data.paused || (wins ? !preview : !next)}
                      onClick={() => run({ kind: "publish", series }, `${SERIES_LABEL[series].name} posted`)}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" /> Post now
                    </button>
                  )}
                </div>
                {next && (
                  <button type="button" onClick={() => setEditing({ item: next })} className="mt-2 block w-full rounded-xl bg-muted/60 px-3 py-2.5 text-left">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                      <span>Up next · {next.mentor}</span>
                      <span className="inline-flex items-center gap-1 text-primary">
                        <PenLine className="h-3 w-3" /> Edit
                      </span>
                    </div>
                    {next.quote && <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold">“{next.quote}”</div>}
                    <div className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-muted-foreground">{next.body}</div>
                  </button>
                )}
                {wins && (
                  <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2.5">
                    <div className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                      {preview
                        ? `${preview.next_week ? "Next week so far" : "Goes out"} · ${preview.featured} featured · ${preview.trainers} trained`
                        : "Nobody has logged a session yet"}
                    </div>
                    {preview && <div className="mt-1.5 line-clamp-6 whitespace-pre-line text-[12px] text-muted-foreground">{preview.body}</div>}
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
              {data.history.slice(0, 4).map((h) => (
                <li key={h.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className={cn("shrink-0 font-bold", h.series === "monday_motivation" ? "text-primary" : "text-foreground")}>{SERIES_LABEL[h.series]?.short ?? "Note"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.mentor ? `${h.mentor} · ` : ""}{h.caption}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{postTimeLabel(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border/60 px-4 py-3">
          {data.author && <UserAvatar src={data.author.avatar_url} name={data.author.name} size={30} expandable={false} />}
          <button type="button" onClick={() => setWriting(true)} className="h-10 flex-1 rounded-full bg-muted px-4 text-left text-[13px] text-muted-foreground">
            Write a post for the crew…
          </button>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Monday and Friday come from a prepared library; quotes are only used where the wording and source are on record. Wednesday Wins is built from last week's logs: everyone who trained is named, and the full shout-outs rotate so each client gets one within the month.
      </p>

      <NoteEditor
        open={!!editing}
        title={`Edit the next ${editing ? editing.item.mentor : ""} post`}
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
      <NoteEditor
        open={writing}
        title="Write a post"
        initial=""
        saving={act.isPending}
        onClose={() => setWriting(false)}
        onSave={async (body) => {
          await act.mutateAsync({ kind: "note", body });
          toast.success("Posted to the community");
        }}
      />
    </section>
  );
}
