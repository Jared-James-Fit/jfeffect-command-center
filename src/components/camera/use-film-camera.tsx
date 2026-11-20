import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { importWithRetry } from "@/lib/chunk-import";
import { canFilmInApp } from "@/lib/camera/film-settings";
import { primeCamera } from "@/lib/camera/camera-prime";

type CameraComponent = (typeof import("@/components/camera/film-camera"))["FilmCamera"];
/** Loaded on first use (the set camera's own loader keeps its module the same one). */
let FilmCam: CameraComponent | null = null;
const loadCamera = (): Promise<CameraComponent> =>
  FilmCam
    ? Promise.resolve(FilmCam)
    : importWithRetry(() => import("@/components/camera/film-camera")).then((m) => (FilmCam = m.FilmCamera));

/**
 * The app's own video camera for any place that films a video (progress
 * videos, a chat's Video): 1080p by default with the phone's own microphone
 * and no call processing (film-camera.tsx, video-mic.ts), where iOS's "Take
 * Video" picker records 480 × 360 with squeezed sound and nothing to set.
 * `start()` opens it and says true, or says false where a web page can't
 * film (the caller opens its picker instead, in the same tap). The clip goes
 * to `onClip` as a file, exactly as if it had been picked; Library hands over
 * to the caller's picker inside its tap (iOS needs that).
 */
export function useFilmCamera({ maxSeconds, title, onClip, onLibrary }: {
  maxSeconds: number;
  title?: string;
  onClip: (file: File) => void;
  onLibrary?: () => void;
}): { start: () => boolean; element: ReactNode } {
  const [open, setOpen] = useState(false);
  const [Cam, setCam] = useState<CameraComponent | null>(() => FilmCam);
  const clip = useRef(onClip);
  clip.current = onClip;
  const library = useRef(onLibrary);
  library.current = onLibrary;
  const start = () => {
    if (!canFilmInApp()) return false;
    // the camera asked for in this tap, so a camera already allowed opens without asking again (camera-prime.ts)
    primeCamera();
    if (Cam) {
      setOpen(true);
      return true;
    }
    loadCamera().then(
      (c) => {
        setCam(() => c);
        setOpen(true);
      },
      () => toast.error("Couldn't open the camera without a connection. Try again once you have signal."),
    );
    return true;
  };
  const element =
    open && Cam ? (
      <Cam
        title={title}
        maxSeconds={maxSeconds}
        onClose={() => setOpen(false)}
        onLibrary={
          onLibrary
            ? () => {
                // the picker opens inside this tap, then the camera lets go
                library.current?.();
                setOpen(false);
              }
            : undefined
        }
        onClip={(file) => {
          setOpen(false);
          clip.current(file);
        }}
      />
    ) : null;
  return { start, element };
}
