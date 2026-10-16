import { useEffect, useState } from "react";

/**
 * The Focus intro: a small card under the List / Focus switch that shows what
 * Focus is (a looping mini phone: a tap on the right, the next exercise) and
 * offers to try it. It appears once per app launch, in the first workout the
 * person opens to log, until they use the switch once (tried_at on their
 * account). "Not now" hides it until the next launch. A launch is a fresh load
 * of the app, so this state lives in the module (a reload starts it over).
 */
const launch = { day: null as string | null, closed: false, counted: false };

/** Tests only: start a new "launch". */
export function resetFocusIntroLaunch() {
  launch.day = null;
  launch.closed = false;
  launch.counted = false;
}

/** Pure: whether the intro shows (the hook adds this launch's state). */
export function introShows(a: { eligible: boolean; known: boolean; tried: boolean; closed: boolean; launchDay: string | null; dayId: string }): boolean {
  return a.eligible && a.known && !a.tried && !a.closed && (a.launchDay === null || a.launchDay === a.dayId);
}

export function useFocusIntro({
  dayId,
  eligible,
  tried,
  known,
  noteIntro,
}: {
  dayId: string;
  /** A workout to log right now (not finished, not a coach's preview, 2+ exercises, in the list). */
  eligible: boolean;
  /** They've used the switch before (account or this phone). */
  tried: boolean;
  /** The account has answered (never guess "not tried" from a stale copy). */
  known: boolean;
  noteIntro: (event: "shown" | "dismissed") => void;
}) {
  const [closed, setClosed] = useState(launch.closed);
  // one workout per launch: the first one it's shown in
  const show = introShows({ eligible, known, tried, closed, launchDay: launch.day, dayId });
  useEffect(() => {
    if (!show) return;
    launch.day = dayId;
    if (!launch.counted) {
      launch.counted = true;
      noteIntro("shown");
    }
  }, [show, dayId, noteIntro]);
  const dismiss = () => {
    launch.closed = true;
    setClosed(true);
    noteIntro("dismissed");
  };
  return { show, dismiss };
}

/** A tiny phone: a tap on the right and the next exercise slides in while the bars fill (loops; still with reduced motion). */
function FocusIntroAnimation() {
  return (
    <div
      aria-hidden
      className="jf-fi-phone relative h-[78px] w-[50px] shrink-0 overflow-hidden rounded-[11px] border-2 border-foreground/70 bg-background shadow-sm"
    >
      <div className="absolute inset-x-1.5 top-1.5 flex gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`jf-fi-bar jf-fi-bar-${i} h-[2px] flex-1 rounded-full bg-foreground/20`} />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-1.5 top-[11px] overflow-hidden">
        <div className="jf-fi-track flex h-full w-[300%]">
          {["bg-emerald-500", "bg-sky-500", "bg-primary"].map((tone, i) => (
            <div key={i} className="h-full w-1/3 px-1.5">
              <div className="flex h-full flex-col gap-[3px] rounded-[5px] border border-border bg-card p-1">
                <span className={`h-[3px] w-3 rounded-full ${tone}`} />
                <span className="h-[2px] w-5 rounded-full bg-foreground/40" />
                <span className="mt-auto h-[5px] w-full rounded-[2px] bg-foreground/15" />
                <span className="h-[5px] w-full rounded-[2px] bg-foreground/15" />
                <span className="h-[5px] w-full rounded-[2px] bg-foreground/15" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="jf-fi-finger absolute bottom-7 right-1.5 h-3.5 w-3.5 rounded-full bg-foreground/60 ring-2 ring-background" />
    </div>
  );
}

export function FocusIntro({ onTry, onDismiss }: { onTry: () => void; onDismiss: () => void }) {
  return (
    <div
      data-testid="focus-intro"
      role="region"
      aria-label="New: Focus"
      className="relative flex items-center gap-3.5 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.13] via-card to-card p-3.5 animate-in fade-in-0 slide-in-from-top-2 duration-500"
    >
      <FocusIntroAnimation />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-black uppercase tracking-wider text-primary-foreground">New</span>
          <span className="text-sm font-bold text-foreground">Focus</span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          One exercise at a time, full screen. Log your sets, then tap the right side for the next one.
        </p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            data-testid="focus-intro-try"
            onClick={onTry}
            className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/25 transition active:scale-95"
          >
            Try Focus
          </button>
          <button
            type="button"
            data-testid="focus-intro-dismiss"
            onClick={onDismiss}
            className="h-9 rounded-full px-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-95"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
