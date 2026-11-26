/**
 * The picked clip, handed to the background uploader. Mounted only once a
 * clip is picked (lazy). First a quick look in the trimmer: the lift is found
 * on the phone in a second or two and the handles glide to it (the walk to
 * the bar, the wait and the walk back to the phone cut; Whole clip one tap
 * away), then Send, and it goes up in the background. A clip filmed in the
 * app is remembered until it's saved to the phone, with its copy for the phone
 * cut and held: the trimmed part, as filmed (set-videos/phone-copy.ts,
 * uploader.ts phoneCopyFor), never the whole recording. Nothing pops up after
 * filming (Nov 25 2026): saving is the finished workout's one small "Save N
 * videos to device" and each clip's own Save in its sheet.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVideoTrimmer } from "@/components/video-trimmer";
import type { StartSetVideo } from "@/lib/set-videos/uploader";
import { getSetVideoJobs } from "@/lib/set-videos/jobs";
import { setTitle } from "@/lib/set-videos/label";
import { holdFilmedFile, linkFilmed, noteFilmed } from "@/lib/set-videos/phone-copy";
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
  start: Omit<StartSetVideo, "file" | "trim" | "offer">;
  onDone: () => void;
}) {
  const trimmer = useVideoTrimmer();
  const begun = useRef(false);
  const trim = trimmer.request;
  useEffect(() => {
    if (begun.current) return;
    begun.current = true;
    void import("@/lib/set-videos/uploader")
      .then((m) => {
        const forPhone = filmedHere && isTouchDevice();
        return m.startSetVideo({ ...start, file, trim, phoneCopy: forPhone, offer: { suggestLift: true, title: `${start.exerciseName} · ${setTitle(start.setIndex)}`, doneLabel: "Send" } });
      })
      .then((res) => {
        // on its way: a clip filmed here is kept for the phone until it's saved there
        if (!res.ok || !res.id || !filmedHere || !isTouchDevice()) return;
        const jobId = res.id;
        // remembered at once (a reload still offers it, from storage); the copy itself once it's cut
        noteFilmed(start.userId, { jobId, dayId: start.dayId });
        const landed = getSetVideoJobs().find((j) => j.id === jobId)?.setVideoId;
        if (landed) linkFilmed(start.userId, jobId, landed);
        void res.phoneCopy?.then((copy) => {
          // held for the finished workout's save (saved or removed meanwhile: nothing to hold)
          if (copy) holdFilmedFile(start.userId, jobId, copy);
        });
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
