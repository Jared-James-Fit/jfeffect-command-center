/**
 * Footage: an athlete's set videos, competition lifts first, each with what
 * was on the bar, the reps, the effort they logged against the one planned,
 * and measured bar speed when there is one. A clip plays slow, a frame at a
 * time and full screen, beside an earlier one to compare, with the
 * specialist's own notes under it.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Columns2, Maximize, Pause, Play, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QueryState, ListSkeleton, EmptyState } from "@/components/loading";
import { cn } from "@/lib/utils";
import { billingDay } from "@/lib/date-range";
import {
  FILTER_LABELS,
  availableFilters,
  compareCandidates,
  defaultFilter,
  footageLine,
  speedWords,
  matchesFilter,
  type FootageFilter,
  type FootageItem,
} from "@/lib/team-access/footage";
import {
  getSpecialistFootage,
  getSpecialistVideo,
  markFootageWatched,
} from "@/lib/team-access/specialist.functions";
import { useSpecialist } from "./specialist-context";
import { NotShared } from "./specialist-shell";
import { SpecialistNotes } from "./specialist-notes";

export function FootageTab() {
  const { athlete } = useSpecialist();
  if (!athlete) return null;
  if (!athlete.footage) return <NotShared what="Footage" />;
  return <FootageList clientId={athlete.clientId} />;
}

function UnitSwitch() {
  const { unit, setUnit } = useSpecialist();
  return (
    <div
      className="inline-flex rounded-lg border border-border p-0.5 text-xs"
      role="radiogroup"
      aria-label="Unit"
    >
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={unit === u}
          onClick={() => setUnit(u)}
          className={cn(
            "rounded-md px-2.5 py-1",
            unit === u ? "bg-secondary font-semibold" : "text-muted-foreground",
          )}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
export { UnitSwitch };

function FootageList({ clientId }: { clientId: string }) {
  const load = useServerFn(getSpecialistFootage);
  const footage = useQuery({
    queryKey: ["specialist-footage", clientId],
    queryFn: () => load({ data: { clientId } }),
    // signed thumbnails last 30 minutes
    staleTime: 15 * 60_000,
  });
  const [filter, setFilter] = useState<FootageFilter | null>(null);
  const [open, setOpen] = useState<FootageItem | null>(null);
  return (
    <QueryState
      query={footage}
      what="the footage"
      skeleton={<ListSkeleton rows={6} />}
      isEmpty={(d) => !d.items.length}
      empty={
        <EmptyState
          title="No footage yet"
          detail="Set videos show here as soon as they're filmed."
        />
      }
    >
      {(data) => {
        const watched = new Set(data.watched);
        const f = filter ?? defaultFilter(data.items);
        const chips = availableFilters(data.items, watched);
        const shown = data.items.filter((i) => matchesFilter(i, f, watched));
        const byDay = new Map<string, FootageItem[]>();
        for (const i of shown) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
                {chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilter(c)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-xs",
                      f === c
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {FILTER_LABELS[c]}
                  </button>
                ))}
              </div>
              <UnitSwitch />
            </div>
            {!shown.length && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
            )}
            {[...byDay.entries()].map(([day, items]) => (
              <section key={day} className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">{billingDay(day)}</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((i) => (
                    <FootageCard
                      key={i.id}
                      item={i}
                      thumb={data.thumbs[i.id]}
                      watched={watched.has(i.id)}
                      onOpen={() => setOpen(i)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {open && (
              <VideoSheet
                clientId={clientId}
                item={open}
                all={data.items}
                thumbs={data.thumbs}
                watched={watched.has(open.id)}
                onClose={() => setOpen(null)}
              />
            )}
          </div>
        );
      }}
    </QueryState>
  );
}

function FootageCard({
  item,
  thumb,
  watched,
  onOpen,
}: {
  item: FootageItem;
  thumb?: string;
  watched: boolean;
  onOpen: () => void;
}) {
  const { unit } = useSpecialist();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full gap-3 rounded-xl border border-border p-2 text-left hover:bg-muted/40"
    >
      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        <Play className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" />
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-1.5">
          {!watched && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#0095f6]" aria-label="Not watched" />
          )}
          <span className="truncate text-sm font-semibold">{item.exercise}</span>
        </div>
        <div className="text-xs text-muted-foreground">{item.setName}</div>
        <div className="mt-0.5 text-sm">{footageLine(item, unit) || "Not logged"}</div>
        <div className="text-xs text-muted-foreground">
          {[item.prescribedEffort && `Planned ${item.prescribedEffort}`, speedWords(item.velocity)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </button>
  );
}

const SPEEDS = [0.25, 0.5, 1] as const;
const FRAME = 1 / 30;

function Player({
  videoId,
  poster,
  onPlayed,
}: {
  videoId: string;
  poster?: string;
  onPlayed?: () => void;
}) {
  const load = useServerFn(getSpecialistVideo);
  const src = useQuery({
    queryKey: ["specialist-video", videoId],
    queryFn: () => load({ data: { videoId } }),
    staleTime: 20 * 60_000,
  });
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [full, setFull] = useState(false);
  const played = useRef(false);
  const step = (dir: 1 | -1) => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir * FRAME));
  };
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const fullscreen = () => {
    const v = ref.current as any;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };
  return (
    <QueryState query={src} what="the clip" errorSize="inline">
      {(s) => (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-xl bg-black">
            <video
              ref={ref}
              src={(full ? s.url : (s.fastUrl ?? s.url)) ?? undefined}
              poster={s.poster ?? poster}
              playsInline
              preload="metadata"
              className="max-h-[55dvh] w-full object-contain"
              onPlay={() => {
                setPlaying(true);
                if (!played.current) {
                  played.current = true;
                  onPlayed?.();
                }
              }}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={() => {
                if (ref.current) ref.current.playbackRate = speed;
              }}
              onClick={toggle}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => step(-1)}
              aria-label="Back one frame"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => step(1)}
              aria-label="Forward one frame"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div
              className="inline-flex rounded-lg border border-border p-0.5 text-xs"
              role="radiogroup"
              aria-label="Speed"
            >
              {SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  role="radio"
                  aria-checked={speed === sp}
                  onClick={() => {
                    setSpeed(sp);
                    if (ref.current) ref.current.playbackRate = sp;
                  }}
                  className={cn(
                    "rounded-md px-2 py-1",
                    speed === sp ? "bg-secondary font-semibold" : "text-muted-foreground",
                  )}
                >
                  {sp === 1 ? "1×" : `${sp}×`}
                </button>
              ))}
            </div>
            {s.fastUrl && (
              <button
                type="button"
                onClick={() => setFull((v) => !v)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {full ? "Lighter copy" : "Full quality"}
              </button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto"
              onClick={fullscreen}
              aria-label="Full screen"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </QueryState>
  );
}

function VideoSheet({
  clientId,
  item,
  all,
  thumbs,
  watched,
  onClose,
}: {
  clientId: string;
  item: FootageItem;
  all: FootageItem[];
  thumbs: Record<string, string>;
  watched: boolean;
  onClose: () => void;
}) {
  const { unit, athlete } = useSpecialist();
  const mark = useServerFn(markFootageWatched);
  const qc = useQueryClient();
  const [compare, setCompare] = useState<FootageItem | null>(null);
  const [picking, setPicking] = useState(false);
  const candidates = useMemo(() => compareCandidates(all, item), [all, item]);
  const setWatched = async (w: boolean) => {
    try {
      await mark({ data: { videoId: item.id, watched: w } });
      await qc.invalidateQueries({ queryKey: ["specialist-footage", clientId] });
    } catch {
      /* the dot stays; nothing else depends on it */
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[100dvh] w-full max-w-2xl overflow-y-auto p-4 sm:rounded-2xl">
        <div className="flex items-start gap-2 pr-8">
          <div className="min-w-0">
            <DialogTitle className="text-base">{item.exercise}</DialogTitle>
            <div className="text-xs text-muted-foreground">
              {billingDay(item.day)} · {item.setName}
            </div>
          </div>
        </div>
        <Player
          videoId={item.id}
          poster={thumbs[item.id]}
          onPlayed={() => !watched && void setWatched(true)}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Fact
            label="Lifted"
            value={footageLine({ ...item, loggedEffort: null }, unit) || "Not logged"}
          />
          <Fact label="Logged effort" value={item.loggedEffort ?? "Not rated"} />
          <Fact
            label="Planned"
            value={
              [item.prescribedReps && `${item.prescribedReps} reps`, item.prescribedEffort]
                .filter(Boolean)
                .join(" @ ") || "—"
            }
          />
          <Fact label="Bar speed" value={speedWords(item.velocity) ?? "Not measured"} />
        </dl>
        <div className="flex flex-wrap gap-2">
          {candidates.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setPicking((v) => !v)}>
              <Columns2 className="mr-1.5 h-4 w-4" /> Compare with an earlier set
            </Button>
          )}
          {watched && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void setWatched(false)}>
              Mark not watched
            </Button>
          )}
        </div>
        {picking && (
          <div className="space-y-1 rounded-xl border border-border p-2">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setCompare(c);
                  setPicking(false);
                }}
              >
                <span className="truncate">
                  {c.exercise} · {c.setName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {billingDay(c.day)} · {footageLine(c, unit)}
                </span>
              </button>
            ))}
          </div>
        )}
        {compare && (
          <div className="space-y-2 rounded-xl border border-border p-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {billingDay(compare.day)} · {compare.setName} · {footageLine(compare, unit)}
              </span>
              <button
                type="button"
                aria-label="Close comparison"
                onClick={() => setCompare(null)}
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Player videoId={compare.id} poster={thumbs[compare.id]} />
          </div>
        )}
        {athlete && (
          <SpecialistNotes
            clientId={clientId}
            athleteFirstName={athlete.firstName}
            targetKind="set_video"
            targetId={item.id}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
