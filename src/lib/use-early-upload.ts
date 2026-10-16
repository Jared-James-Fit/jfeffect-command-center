import { useCallback, useEffect, useRef, useState } from "react";
import { removeCommunityFiles, uploadPicked, type PickedMedia, type UploadedMedia } from "@/lib/community-media";

type Entry = { media: PickedMedia; promise: Promise<UploadedMedia>; kept: boolean };

/**
 * Start uploading a picked photo or clip the moment it's picked, so by the
 * time the caption's written Post only has to save (Instagram uploads while
 * you edit). Swapped for another, or closed without posting: its files are
 * thrown away once they land. `take` hands Post the running upload (or a
 * fresh one if it failed); `keep` marks it posted so it stays.
 */
export function useEarlyUpload(media: PickedMedia | null, userId: string | undefined) {
  const entry = useRef<Entry | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    if (!media || !userId) return;
    const e: Entry = { media, kept: false, promise: Promise.resolve() as unknown as Promise<UploadedMedia> };
    e.promise = uploadPicked(media, userId, (p) => {
      if (entry.current === e) setProgress(p);
    });
    e.promise.catch(() => {});
    entry.current = e;
    return () => {
      if (entry.current === e) entry.current = null;
      if (!e.kept) void e.promise.then((up) => removeCommunityFiles([up.media_path, up.media_thumb_path]), () => {});
    };
  }, [media, userId]);

  const take = useCallback(
    (m: PickedMedia, onProgress?: (pct: number) => void): Promise<UploadedMedia> => {
      const e = entry.current;
      if (!userId) return Promise.reject(new Error("Sign in again to post."));
      if (!e || e.media !== m) return uploadPicked(m, userId, onProgress);
      return e.promise.catch(() => uploadPicked(m, userId, onProgress));
    },
    [userId],
  );

  const keep = useCallback((m: PickedMedia | null) => {
    if (m && entry.current?.media === m) entry.current.kept = true;
  }, []);

  return { progress, take, keep };
}
