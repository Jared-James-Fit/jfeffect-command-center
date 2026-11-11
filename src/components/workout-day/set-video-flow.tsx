/**
 * The picked clip, handed to the background uploader. Mounted only once a
 * clip is picked (lazy), so the trimmer is here for the rare clip over a
 * coach chat's 10 minutes; everything else goes straight up.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVideoTrimmer } from "@/components/video-trimmer";
import type { StartSetVideo } from "@/lib/set-videos/uploader";

export default function SetVideoFlow({
  file,
  start,
  onDone,
}: {
  file: File;
  start: Omit<StartSetVideo, "file" | "trim">;
  onDone: () => void;
}) {
  const trimmer = useVideoTrimmer();
  const begun = useRef(false);
  const trim = trimmer.request;
  useEffect(() => {
    if (begun.current) return;
    begun.current = true;
    void import("@/lib/set-videos/uploader")
      .then((m) => m.startSetVideo({ ...start, file, trim }))
      .catch(() => {
        toast.error("The video couldn't start. Check your connection and try again.");
      })
      // the clip is read and queued (or refused): this pick is done (the upload carries on by itself)
      .finally(onDone);
    // once per pick (each pick mounts its own, keyed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return trimmer.element;
}
