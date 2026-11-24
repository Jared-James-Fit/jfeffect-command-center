/**
 * The live camera's picture size as it's shown (turned the way the phone is
 * held), once the first frame is in: what the set camera (FilmCamera) and the
 * Crew camera (ShareStudio) check against 9:16 before they settle on a stream.
 */
export function pictureSize(v: HTMLVideoElement, ms: number): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const read = () => (v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
    const now = read();
    if (now) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      v.removeEventListener("loadedmetadata", finish);
      v.removeEventListener("resize", finish);
      resolve(read());
    };
    const t = setTimeout(finish, ms);
    v.addEventListener("loadedmetadata", finish);
    v.addEventListener("resize", finish);
  });
}

/** How long to wait for the first frame's size before judging the picture's shape. */
export const PICTURE_WAIT_MS = 1_500;
