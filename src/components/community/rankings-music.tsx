import { useEffect, useRef, useState } from "react";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { appSoundVolume, appSoundsEnabled, setAppSoundsEnabled, subscribeAppSoundVolume, subscribeAppSounds } from "@/lib/app-sounds";
import { backgroundMusicHeld, installMediaMusicHold, onBackgroundMusicHold } from "@/lib/music-hold";
import type { RankingsMusicStatus } from "@/lib/rankings-music";

/** The track's name, here so the button can say it without loading the music. */
export const RANKINGS_TRACK_TITLE = "Main Event";

const KEY = "jf-rankings-music";

/**
 * Rankings music is on by default; a mute is a choice made on this phone and
 * kept ("0"). Anything else (never touched, or turned back on) plays.
 */
export function readRankingsMusicMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "0";
  } catch {
    return false;
  }
}
function writeRankingsMusicMuted(muted: boolean) {
  try { window.localStorage.setItem(KEY, muted ? "0" : "1"); } catch { /* private mode */ }
}

/** The app's sounds switch and volume: with either off, there's no music. */
function useAppSoundsAudible(): boolean {
  const [on, setOn] = useState(() => (typeof window === "undefined" ? true : appSoundsEnabled() && appSoundVolume() > 0));
  useEffect(() => {
    const read = () => setOn(appSoundsEnabled() && appSoundVolume() > 0);
    const a = subscribeAppSounds(read);
    const b = subscribeAppSoundVolume(read);
    return () => {
      a();
      b();
    };
  }, []);
  return on;
}

/** Why the music isn't playing right now decides how quickly it goes. */
function fadeFor(reason: "leave" | "mute" | "hidden" | "held"): number {
  return reason === "hidden" ? 0.25 : reason === "held" ? 0.35 : reason === "mute" ? 0.5 : 0.7;
}

/**
 * Rankings' theme while Rankings is on screen: on by default, one track for
 * every board and audience (switching never restarts it), fading out when
 * Rankings closes, when the app goes to the background, while anything else
 * with sound plays (a video, a voice memo, the Monthly Recap's own music), with
 * the sounds switch off, and when muted here. The controller
 * (rankings-music.ts) loads with Rankings and makes sure there's only ever one
 * copy playing.
 */
export function useRankingsMusic() {
  const [muted, setMuted] = useState(() => (typeof window === "undefined" ? true : readRankingsMusicMuted()));
  const sounds = useAppSoundsAudible();
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [held, setHeld] = useState(() => backgroundMusicHeld());
  const [status, setStatusState] = useState<RankingsMusicStatus>("off");
  // the controller once it's loaded, so a mute acts inside the tap itself
  const ctrl = useRef<typeof import("@/lib/rankings-music") | null>(null);

  useEffect(() => {
    // listen for other media with sound before the music ever starts
    installMediaMusicHold();
    setHeld(backgroundMusicHeld());
    return onBackgroundMusicHold(setHeld);
  }, []);
  useEffect(() => {
    const v = () => setVisible(document.visibilityState !== "hidden");
    // a page put away whole (iOS's app switcher, the back-forward cache): let go of the music
    const away = () => setVisible(false);
    document.addEventListener("visibilitychange", v);
    window.addEventListener("pagehide", away);
    window.addEventListener("pageshow", v);
    return () => {
      document.removeEventListener("visibilitychange", v);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", v);
    };
  }, []);

  const on = !muted && sounds;
  const playing = on && visible && !held;
  const reason = !visible ? "hidden" : held ? "held" : !on ? "mute" : "leave";

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};
    void import("@/lib/rankings-music").then(
      (m) => {
        ctrl.current = m;
        if (cancelled) return;
        unsub = m.subscribeRankingsMusic(setStatusState);
        setStatusState(m.rankingsMusicStatus());
      },
      () => { /* offline and never loaded: stay quiet */ },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/rankings-music").then(
      (m) => {
        if (!cancelled) m.setRankingsMusic(playing, fadeFor(reason));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // reason only matters for the moment it turns off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // leaving Rankings: fade out (a later mount turns it back on)
  useEffect(
    () => () => {
      void import("@/lib/rankings-music").then((m) => m.setRankingsMusic(false, fadeFor("leave")), () => {});
    },
    [],
  );

  const toggle = () => {
    feedback("tap");
    if (!sounds) {
      // muted by the app's sounds switch, not here: say so, and unmute here so it plays once they're on
      writeRankingsMusicMuted(false);
      setMuted(false);
      toast("App sounds are off", {
        description: "Rankings music plays with sounds on.",
        action: { label: "Turn on", onClick: () => setAppSoundsEnabled(true) },
      });
      return;
    }
    const next = !muted;
    writeRankingsMusicMuted(next);
    setMuted(next);
    // now, not after the re-render: a first tap that wakes the audio must never start it first
    if (next) ctrl.current?.setRankingsMusic(false, fadeFor("mute"));
  };

  return { on, playing, status, toggle };
}

function musicWouldPlay(): boolean {
  return typeof window !== "undefined" && !readRankingsMusicMuted() && appSoundsEnabled() && appSoundVolume() > 0;
}

/** Fetch the track on Crew in idle time (only when it would play; never on a slow or data-saving connection). */
export function prefetchRankingsMusicIfOn() {
  if (!musicWouldPlay()) return;
  void import("@/lib/rankings-music").then((m) => m.prefetchRankingsMusic(), () => {});
}

/** A finger on the Rankings tab: decode now, so it's ready as Rankings opens. */
export function warmRankingsMusicIfOn() {
  if (!musicWouldPlay()) return;
  void import("@/lib/rankings-music").then((m) => m.warmRankingsMusic(), () => {});
}

/** The music button beside the board switch: moving bars while it plays, a note when muted. A plain mute / unmute. */
export function RankingsMusicButton({ on, status, onToggle }: { on: boolean; status: RankingsMusicStatus; onToggle: () => void }) {
  const sounding = on && status === "playing";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? "Mute Rankings music" : "Unmute Rankings music"}
      title={on ? `${RANKINGS_TRACK_TITLE} · tap to mute` : "Music muted · tap to unmute"}
      data-rankings-music={on ? "on" : "off"}
      data-rankings-music-status={status}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors",
        on ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground active:bg-muted",
      )}
    >
      {on ? <PlayingBars still={!sounding} /> : <Music className="h-[18px] w-[18px]" />}
    </button>
  );
}

/** Three bars bouncing while the music plays (held still under reduced motion, while it loads or waits for a tap). */
function PlayingBars({ still }: { still: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full bg-current", still ? "h-2" : "origin-bottom animate-[jf-eq_0.9s_ease-in-out_infinite] motion-reduce:animate-none")}
          style={still ? undefined : { animationDelay: `${i * -0.3}s`, height: "100%" }}
        />
      ))}
    </span>
  );
}
