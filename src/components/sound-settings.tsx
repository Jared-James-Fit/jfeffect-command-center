/**
 * The app's sound settings, per device (a phone at the gym and a laptop at a
 * desk want different things): the master switch, then what plays (workout
 * sounds, timer alerts with their 3-2-1, messages & notifications) and how
 * loud. Each row can be heard before it's kept, at the volume set here.
 * Account → Notifications & sounds shows it whole; Workout Tools shows the
 * part an athlete reaches for mid-workout (`variant="workout"`).
 */
import { useEffect, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAppSoundsOn } from "@/components/sound-toggle";
import {
  previewSounds,
  readSoundPrefs,
  setSoundPrefs,
  subscribeSoundPrefs,
  DEFAULT_SOUND_PREFS,
  type AppSound,
  type SoundPrefs,
} from "@/lib/app-sounds";

/** The device's sound settings, kept in step with every other screen showing them. */
export function useSoundPrefs(): [SoundPrefs, (patch: Partial<SoundPrefs>) => void] {
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_SOUND_PREFS);
  useEffect(() => {
    setPrefs(readSoundPrefs());
    return subscribeSoundPrefs(setPrefs);
  }, []);
  return [prefs, (patch) => { setSoundPrefs(patch); }];
}

/** What each row plays when heard (seconds from the tap). */
export const SOUND_PREVIEWS: Record<"effects" | "timers" | "notifications" | "volume", Array<[AppSound, number]>> = {
  // a set, the exercise's last set, then a PR: the family from smallest to biggest
  effects: [["set", 0], ["exercise", 0.5], ["pr", 1.35]],
  // the 3-2-1 and the go, quicker than real time
  timers: [["count", 0], ["count", 0.55], ["count", 1.1], ["go", 1.65]],
  notifications: [["message", 0], ["notify", 0.75]],
  volume: [["exercise", 0]],
};

type Row = { key: "effects" | "timers" | "notifications"; title: string; help: string };
const ROWS: Row[] = [
  { key: "effects", title: "Workout sounds", help: "Sets, exercises, PRs, the finish and milestones" },
  { key: "timers", title: "Timer alerts", help: "When a rest or a timed set ends" },
  { key: "notifications", title: "Messages & notifications", help: "New messages and updates while the app is open" },
];

export function SoundSettings({ variant = "full", className }: { variant?: "full" | "workout"; className?: string }) {
  const [on, setOn] = useAppSoundsOn();
  const [prefs, setPrefs] = useSoundPrefs();
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);
  const hear = (list: Array<[AppSound, number]>) => {
    stopRef.current();
    stopRef.current = previewSounds(list);
  };
  const rows = variant === "workout" ? ROWS.filter((r) => r.key === "timers") : ROWS;

  return (
    <div className={cn("space-y-1", className)} data-sound-settings={variant}>
      <SettingRow
        title={variant === "workout" ? "Sounds" : "Play sounds"}
        help={variant === "workout"
          ? "Set logged, PRs, rest over, the finish. Plays over your music."
          : "Short sounds while the app is open. They follow your phone's silent switch and play over your music."}
        checked={on}
        onChange={setOn}
        testId="sounds-master"
        strong
      />
      {on && (
        <>
          <VolumeRow
            value={prefs.volume}
            onChange={(v) => setPrefs({ volume: v })}
            onCommit={() => hear(SOUND_PREVIEWS.volume)}
          />
          {rows.map((r) => (
            <div key={r.key}>
              <SettingRow
                title={r.title}
                help={r.help}
                checked={prefs[r.key]}
                onChange={(v) => {
                  setPrefs({ [r.key]: v } as Partial<SoundPrefs>);
                  if (v) hear(SOUND_PREVIEWS[r.key]);
                }}
                onHear={() => hear(SOUND_PREVIEWS[r.key])}
                testId={`sounds-${r.key}`}
              />
              {r.key === "timers" && prefs.timers && (
                <SettingRow
                  title="Count down the last 3 seconds"
                  help="A soft pip at 3, 2 and 1"
                  checked={prefs.countdown}
                  onChange={(v) => {
                    setPrefs({ countdown: v });
                    if (v) hear(SOUND_PREVIEWS.timers);
                  }}
                  testId="sounds-countdown"
                  indent
                />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function SettingRow({ title, help, checked, onChange, onHear, testId, strong = false, indent = false }: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onHear?: () => void;
  testId: string;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn("flex min-h-[52px] items-center gap-3 py-1.5", indent && "pl-4")}>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", strong ? "font-semibold" : "font-medium")}>{title}</div>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
      {onHear && checked && (
        <button
          type="button"
          onClick={onHear}
          aria-label={`Hear ${title.toLowerCase()}`}
          title="Hear it"
          data-sound-hear={testId}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
        >
          <Play className="h-4 w-4" />
        </button>
      )}
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} data-testid={testId} />
    </div>
  );
}

/** Volume: neutral, a finger-sized thumb; it's heard once it's let go. */
function VolumeRow({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: () => void }) {
  const Icon = value <= 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <div className="flex min-h-[52px] items-center gap-3 py-1.5" data-sound-volume>
      <div className="w-[4.5rem] shrink-0">
        <div className="text-sm font-medium">Volume</div>
        <div className="text-xs tabular-nums text-muted-foreground">{value <= 0 ? "Off" : `${value}%`}</div>
      </div>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <SliderPrimitive.Root
        value={[value]}
        min={0}
        max={100}
        step={5}
        onValueChange={(v) => onChange(v[0] ?? value)}
        onValueCommit={onCommit}
        aria-label="Sound volume"
        className="relative flex h-10 flex-1 touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-foreground" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Sound volume"
          className="block h-6 w-6 rounded-full border border-border bg-background shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-110"
        />
      </SliderPrimitive.Root>
    </div>
  );
}
