import { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { appSoundsEnabled, setAppSoundsEnabled, subscribeAppSounds } from "@/lib/app-sounds";
import { backgroundMusicHeld, onBackgroundMusicHold } from "@/lib/music-hold";
import type { RankingsTheme } from "@/lib/rankings-music";

/** The two boards' themes, named here so the button can say what's playing without loading the music. */
export const THEME_NAMES: Record<RankingsTheme, { title: string; board: string }> = {
  league: { title: "Points on the Board", board: "Monthly League" },
  hall: { title: "Iron Legacy", board: "Hall of Strength" },
};

const KEY = "jf-rankings-music";

/** Theme music is a choice made on this phone (off until someone turns it on). */
export function readRankingsMusic(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function writeRankingsMusic(on: boolean) {
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

/**
 * Plays the board's theme while it's on and Rankings is on screen: the
 * theme follows the board (a crossfade, the old one fading under the new),
 * goes quiet when the app is in the background, when the sounds switch is
 * off, and while the Monthly Recap plays its own music, and fades out when
 * Rankings closes. The music module loads only when it's first needed.
 */
export function useRankingsMusic(theme: RankingsTheme) {
  const [on, setOn] = useState(() => (typeof window === "undefined" ? false : readRankingsMusic()));
  const [sounds, setSounds] = useState(() => (typeof window === "undefined" ? true : appSoundsEnabled()));
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [held, setHeld] = useState(() => backgroundMusicHeld());

  useEffect(() => subscribeAppSounds(setSounds), []);
  useEffect(() => onBackgroundMusicHold(setHeld), []);
  useEffect(() => {
    const v = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);

  const playing = on && sounds && visible && !held;
  useEffect(() => {
    if (!playing) return;
    let stop: ((fade?: number) => void) | null = null;
    let cancelled = false;
    void import("@/lib/rankings-music").then((m) => {
      if (!cancelled) stop = m.playRankingsTheme(theme);
    }, () => { /* offline and never loaded: stay quiet */ });
    return () => {
      cancelled = true;
      stop?.(0.8);
    };
  }, [playing, theme]);

  const toggle = () => {
    const next = !on;
    writeRankingsMusic(next);
    setOn(next);
    feedback("tap");
    if (next && !appSoundsEnabled()) {
      toast("App sounds are off", {
        description: "Theme music plays with sounds on.",
        action: { label: "Turn on", onClick: () => setAppSoundsEnabled(true) },
      });
    } else if (next) {
      toast(`Now playing: ${THEME_NAMES[theme].title}`, { description: `${THEME_NAMES[theme].board} theme. Follows your silent switch.`, duration: 2600 });
    }
  };

  return { on, playing, toggle };
}

/** The music button beside the board switch: a note when off, moving bars while it plays. */
export function RankingsMusicButton({ theme, on, playing, onToggle }: { theme: RankingsTheme; on: boolean; playing: boolean; onToggle: () => void }) {
  const name = THEME_NAMES[theme];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? `Theme music on: ${name.title}. Turn off` : `Play the ${name.board} theme`}
      title={on ? `${name.title} · ${name.board} theme` : "Theme music"}
      data-rankings-music={on ? "on" : "off"}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors",
        on ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground active:bg-muted",
      )}
    >
      {on ? <PlayingBars still={!playing} /> : <Music className="h-[18px] w-[18px]" />}
    </button>
  );
}

/** Three bars bouncing while the music plays (held still under reduced motion, or while it's paused). */
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
