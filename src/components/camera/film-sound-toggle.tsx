import { Mic, Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { askForMicAgain, micRefused } from "@/lib/video-mic";

/** What the camera says when sound is switched (one toast, replaced on the next tap). */
export const FILM_SOUND_WORDS = {
  music: { title: "Your music keeps playing", description: "Clips film without sound. Tap the mic to record sound." },
  sound: { title: "Recording sound", description: "Your music pauses while you film." },
} as const;

export function sayFilmSound(sound: boolean) {
  const w = FILM_SOUND_WORDS[sound ? "sound" : "music"];
  toast.message(w.title, { description: w.description, id: "film-sound" });
}

/**
 * Music or sound, one tap on the camera itself (Nov 21 2026): a phone pauses
 * the music in someone's earbuds the moment a page opens its mic, so filming
 * without sound is the only way to keep it playing. The music note is "your
 * music keeps playing, no sound recorded"; the mic (white, like the light when
 * it's on) is "recording sound, your music pauses". Shared by the set camera
 * and the Crew studio (film-settings.ts `sound`), and never changed mid-clip.
 * Turning sound on after a "Don't Allow" asks for the mic again inside the
 * tap, the only way the question can show.
 */
export function FilmSoundToggle({ sound, onChange, className }: { sound: boolean; onChange: (sound: boolean) => void; className?: string }) {
  const tap = () => {
    const next = !sound;
    if (next && micRefused()) {
      void askForMicAgain().then((ok) => {
        if (!ok) {
          toast.message("The microphone isn't allowed", { description: "Allow it for JF Effect in your phone's Settings to film with sound.", id: "film-sound" });
          return;
        }
        onChange(true);
        sayFilmSound(true);
      });
      return;
    }
    onChange(next);
    sayFilmSound(next);
  };
  return (
    <button
      type="button"
      onClick={tap}
      aria-pressed={sound}
      aria-label={sound ? "Recording sound. Tap to keep your music playing" : "Your music keeps playing. Tap to record sound"}
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full active:scale-95", sound ? "bg-white text-black" : "bg-black/40 text-white", className)}
      data-film-sound={sound ? "sound" : "music"}
    >
      {sound ? <Mic className="h-5 w-5" aria-hidden /> : <Music className="h-5 w-5" aria-hidden />}
    </button>
  );
}
