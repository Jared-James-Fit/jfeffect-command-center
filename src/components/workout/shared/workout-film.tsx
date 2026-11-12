/**
 * A finished workout's film, on the workout's own card and its recap:
 *   🎥 3 sets on film · In the feed ✓  (View)
 *   🎥 3 sets on film · 1 still uploading, posts when it's done
 *   🎥 3 sets on film · Not posted     (Post to Crew)
 * and the switch at the end of the review that decides whether it posts by
 * itself (saved on the account). Only the athlete sees any of it, never a
 * coach viewing as them, and only when the workout has a clip.
 */
import { useNavigate } from "@tanstack/react-router";
import { Check, Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { useChatSignedUrl } from "@/hooks/use-chat-signed-urls";
import { isActiveJob, useSetVideoJobs } from "@/lib/set-videos/jobs";
import { useSetVideosForDay } from "@/components/workout-day/set-video-cell";
import { useFilmAutoPost, useSetFilmAutoPost, useWorkoutFilm } from "@/lib/workout-film-client";

const sets = (n: number) => `${n} ${n === 1 ? "set" : "sets"} on film`;

/** The film's line: what's on film, where it is, and the one thing to do. */
export function WorkoutFilmRow({
  completionId,
  dayId,
  className,
  auto = true,
}: {
  completionId: string | null | undefined;
  dayId: string | null | undefined;
  className?: string;
  /** May post by itself now (the review is in): until then their switch in the review decides. */
  auto?: boolean;
}) {
  const navigate = useNavigate();
  const film = useWorkoutFilm(completionId, dayId, { auto });
  if (!completionId || (!film.clips && !film.uploading)) return null;

  const tooBig = film.clips - film.postable;
  let status: React.ReactNode;
  let action: React.ReactNode = null;
  if (film.uploading > 0) {
    status = (
      <>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {film.uploading} still uploading{film.autoOn !== false && !film.hidden ? ", posts when done" : ""}
      </>
    );
  } else if (film.posting) {
    status = (
      <>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Posting your film…
      </>
    );
  } else if (film.error) {
    status = <span className="text-destructive">{film.error}</span>;
    action = (
      <Button variant="outline" className="h-10 shrink-0 gap-1.5 px-3" onClick={() => void post()}>
        <RefreshCw className="h-4 w-4" /> Try again
      </Button>
    );
  } else if (film.posted) {
    status = (
      <span className="inline-flex items-center gap-1 font-medium text-success">
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> In the feed
      </span>
    );
    action = film.postId ? (
      <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={() => navigate({ to: "/portal/community", hash: `post=${film.postId}` })}>
        View
      </Button>
    ) : null;
  } else if (film.postable === 0) {
    status = "Too long for Crew (90 seconds a clip)";
  } else if (!auto && film.autoOn !== false && !film.hidden) {
    // their switch is on, and the review (where it lives) comes first
    status = "Posts after your review";
    action = (
      <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={() => void post()}>
        Post now
      </Button>
    );
  } else {
    status = film.hidden ? "Hidden from Crew" : "Not posted";
    action = (
      <Button variant="outline" className="h-10 shrink-0 gap-1.5 px-3" onClick={() => void post()}>
        Post to Crew
      </Button>
    );
  }

  async function post() {
    const res = await film.postNow();
    if (res?.status === "posted") toast.success("Your film is in the feed 🎥");
    else if (res?.status === "no_crew") toast.error("Crew isn't on for your account.");
    else if (res?.status === "no_clips") toast.error("No clips fit a Crew post yet (90 seconds a clip).");
  }

  return (
    <div className={cn("flex items-center gap-3", className)} data-workout-film={film.posted ? "posted" : film.uploading ? "uploading" : "ready"}>
      <PosterStack paths={film.posterPaths} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{sets(film.clips + film.uploading)}</div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">{status}</div>
        {tooBig > 0 && film.postable > 0 && !film.uploading && (
          <div className="text-[11px] text-muted-foreground">{tooBig} over 90 seconds stay in your coach chat only</div>
        )}
      </div>
      {action}
    </div>
  );
}

/** Up to three clip posters, fanned (a film icon until one has a poster). */
function PosterStack({ paths }: { paths: string[] }) {
  if (!paths.length) {
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground" aria-hidden>
        <Clapperboard className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className="relative h-11 shrink-0" style={{ width: 44 + (paths.length - 1) * 12 }} aria-hidden>
      {paths.map((p, i) => (
        <Poster key={p} path={p} className="absolute top-0" style={{ left: i * 12, zIndex: paths.length - i }} />
      ))}
    </span>
  );
}

function Poster({ path, className, style }: { path: string; className?: string; style?: React.CSSProperties }) {
  const url = useChatSignedUrl(path);
  return (
    <span className={cn("block h-11 w-11 overflow-hidden rounded-xl border-2 border-card bg-muted", className)} style={style}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
    </span>
  );
}

/**
 * The end of the review: "Post my film to Crew", their saved switch, shown
 * only when this workout has a clip. Off, the film stays private and the
 * workout's card offers Post to Crew any time later.
 */
export function FilmAutoPostSwitch({ dayId }: { dayId: string }) {
  const viewingAsClient = useViewingAsClient();
  const { data: videos } = useSetVideosForDay(dayId, !viewingAsClient);
  const jobs = useSetVideoJobs();
  const autoOn = useFilmAutoPost(!viewingAsClient);
  const set = useSetFilmAutoPost();
  const count = (videos ?? []).filter((v) => !!v.result_id).length + jobs.filter((j) => j.dayId === dayId && isActiveJob(j)).length;
  if (viewingAsClient || count === 0) return null;
  const on = autoOn !== false;
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-3" data-film-auto-switch>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground" aria-hidden>
        <Clapperboard className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Post my film to Crew</span>
        <span className="block text-xs leading-snug text-muted-foreground">
          {sets(count)}. {on ? "Each clip goes up with its set details." : "It stays private. You can post it later from this workout."}
        </span>
      </span>
      <Switch
        checked={on}
        onCheckedChange={(v) => set.mutate(v, { onError: () => toast.error("Couldn't save that. Try again.") })}
        aria-label="Post my film to Crew automatically"
      />
    </label>
  );
}
