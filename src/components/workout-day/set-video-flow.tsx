/**
 * The picked clip, handed to the background uploader. Mounted only once a
 * clip is picked (lazy), so the trimmer is here for the rare clip over a
 * coach chat's 10 minutes; everything else goes straight up. A clip filmed in
 * the app is remembered until it's saved to the phone, and offered right away
 * (set-videos/phone-copy.ts).
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVideoTrimmer } from "@/components/video-trimmer";
import type { StartSetVideo } from "@/lib/set-videos/uploader";
import { getSetVideoJobs } from "@/lib/set-videos/jobs";
import { linkFilmed, noteFilmed } from "@/lib/set-videos/phone-copy";
import { offerPhoneCopy } from "@/components/workout-day/set-video-phone-copy";
import { isTouchDevice } from "@/lib/file-share";

export default function SetVideoFlow({
  file,
  filmedHere = false,
  start,
  onDone,
}: {
  file: File;
  /** Straight from the camera: not in the phone's Photos. */
  filmedHere?: boolean;
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
      .then((res) => {
        // on its way: a clip filmed here is kept for the phone until it's saved there
        if (!res.ok || !res.id || !filmedHere || !isTouchDevice()) return;
        noteFilmed(start.userId, { jobId: res.id, dayId: start.dayId, file });
        const landed = getSetVideoJobs().find((j) => j.id === res.id)?.setVideoId;
        if (landed) linkFilmed(start.userId, res.id, landed);
        offerPhoneCopy(start.userId, res.id, file);
      })
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
