import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { importWithRetry } from "@/lib/chunk-import";
import { canFilmInApp } from "@/lib/camera/film-settings";
import { primeCamera } from "@/lib/camera/camera-prime";
import type { CaptureShot } from "@/components/camera/film-camera";
import { PURPOSES, type MediaPurpose } from "@/lib/media/capture";
import { shotFile } from "@/lib/media/capture-file";

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
export function useFilmCamera({ maxSeconds, title, onClip, onLibrary, purpose, onShot }: {
  maxSeconds?: number;
  title?: string;
  onClip: (file: File) => void;
  onLibrary?: () => void;
  /**
   * The shared capture camera for a place (media/capture.ts): a tap takes a photo, a hold films (where
   * the place takes video), with that place's ratio, side and grid. Photos go to `onShot` (the whole
   * photo and its crop, for an editor that frames it) or, without it, to `onClip` cut to what the guide showed.
   */
  purpose?: MediaPurpose;
  onShot?: (shot: CaptureShot) => void;
}): { start: () => boolean; element: ReactNode } {
  const [open, setOpen] = useState(false);
  const [Cam, setCam] = useState<CameraComponent | null>(() => FilmCam);
  const clip = useRef(onClip);
  clip.current = onClip;
  const library = useRef(onLibrary);
  library.current = onLibrary;
  const shot = useRef(onShot);
  shot.current = onShot;
  const start = () => {
    if (!canFilmInApp()) return false;
    // the camera asked for in this tap, so a camera already allowed opens without asking again (camera-prime.ts)
    // (a selfie camera, a profile photo's, isn't primed: the back camera would open first)
    if (!purpose || PURPOSES[purpose].facing === "environment") primeCamera();
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
        maxSeconds={maxSeconds ?? (purpose ? PURPOSES[purpose].maxSeconds : 60)}
        capture={
          purpose
            ? {
                purpose,
                onShot: (s) => {
                  setOpen(false);
                  if (shot.current) return shot.current(s);
                  void shotFile(s).then((f) => clip.current(f));
                },
              }
            : undefined
        }
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
