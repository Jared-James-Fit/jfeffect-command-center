import { useRef } from "react";
import { preloadMediaTools } from "@/lib/community-media";

/**
 * The phone's own photo library and camera for the New post screen, always
 * in the page (not inside the lazily loaded composer), so the very tap on +
 * can open the library (Instagram opens on your photos): a browser only
 * opens a picker from inside a tap. Files come back through `onFiles`;
 * `live` = straight from the camera (a lock in's "LIVE" stamp).
 */
/** Where a pick comes from: the library (all), photos only, videos only, or the phone's camera. */
export type ComposerPickHow = "library" | "photos" | "videos" | "camera";

export function useComposerPicker(onFiles: (files: File[], live: boolean) => void) {
  const lib = useRef<HTMLInputElement | null>(null);
  const cam = useRef<HTMLInputElement | null>(null);
  // the phone's own picker, filtered to photos or videos (a web page can't read albums; the picker has them)
  const photos = useRef<HTMLInputElement | null>(null);
  const videos = useRef<HTMLInputElement | null>(null);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  const take = (e: React.ChangeEvent<HTMLInputElement>, live: boolean) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) cb.current(files, live);
  };
  const inputs = (
    <>
      <input ref={lib} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => take(e, false)} onClick={() => preloadMediaTools()} data-composer-library />
      <input ref={cam} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => take(e, true)} data-composer-camera />
      <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => take(e, false)} data-composer-photos />
      <input ref={videos} type="file" accept="video/*" multiple hidden onChange={(e) => take(e, false)} onClick={() => preloadMediaTools()} data-composer-videos />
    </>
  );
  /** Open a picker: the library (photos and videos), just photos, just videos, or the phone's camera. */
  const open = (how: ComposerPickHow) => (how === "camera" ? cam : how === "photos" ? photos : how === "videos" ? videos : lib).current?.click();
  return { inputs, library: () => lib.current?.click(), camera: () => cam.current?.click(), open };
}

/** A phone or tablet (a finger, not a mouse): the + opens the photo library in the same tap, Instagram's way. */
export function opensLibraryOnTap(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
