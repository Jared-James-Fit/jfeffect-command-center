import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { appSoundsEnabled, setAppSoundsEnabled, subscribeAppSounds } from "@/lib/app-sounds";

/** The app's one sounds setting (also in Settings → Notifications), kept in sync everywhere. */
export function useAppSoundsOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(appSoundsEnabled());
    return subscribeAppSounds(setOn);
  }, []);
  return [on, setAppSoundsEnabled];
}

/** A speaker button for screens that play sound (the workout recap): one tap mutes everything. */
export function SoundToggleButton({ className, onMute }: { className?: string; onMute?: () => void }) {
  const [on, setOn] = useAppSoundsOn();
  return (
    <button
      type="button"
      data-testid="sound-toggle"
      aria-pressed={on}
      aria-label={on ? "Mute sounds" : "Turn sounds on"}
      onClick={() => {
        if (on) onMute?.();
        setOn(!on);
      }}
      className={cn("grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/10 active:scale-95", className)}
    >
      {on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
}
