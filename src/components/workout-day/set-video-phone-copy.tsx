/**
 * Set videos filmed in the app go to the phone too (set-videos/phone-copy.ts
 * says which ones and why it takes a tap: iOS only saves to Photos through the
 * share sheet's Save Video, from a tap):
 *   · offerPhoneCopy: the moment a set is filmed, "Save it to your Photos too?" · Save
 *   · useSaveSetVideos: Save to Photos on a clip in the set's sheet, and before one is removed
 *   · PhoneCopyReminder: at the end of the workout, "2 videos you filmed aren't in your Photos" · Save
 * Saving hands the clip filmed this session straight to the share sheet (the
 * original, nothing downloaded); after a reload it comes back down from storage.
 */
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { isTouchDevice, saveFiles } from "@/lib/file-share";
import { holdSaveFile, warmSave, type SaveItem } from "@/lib/save-media";
import { useSaveMedia } from "@/components/messages/save-media";
import { getSetVideoJobs } from "@/lib/set-videos/jobs";
import { filmedFile, forgetFilmed, useUnsavedFilmed, type FilmedEntry } from "@/lib/set-videos/phone-copy";
import { useSetVideosForDay, type SetVideo } from "@/components/workout-day/set-video-cell";

function phoneOS(): "ios" | "android" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** What saving is called here: Photos on an iPhone, the phone on Android, a download on a computer. */
export function phoneSaveWords(os = phoneOS()) {
  if (os === "ios") return { label: "Save to Photos", place: "in your Photos", how: "Tap Save, then Save Video." };
  if (os === "android") return { label: "Save to phone", place: "on your phone", how: "Tap Save to keep a copy on your phone." };
  return { label: "Download", place: "saved", how: "" };
}

/**
 * Right after a set is filmed in the app: one tap away from Save Video (the
 * share sheet opens from the toast's button, with the clip as it was filmed).
 * Only on a phone (a computer's file is already on the computer).
 */
const offerId = (jobId: string) => `phone-copy-${jobId}`;

/** Saved (or removed) some other way: its offer comes down. */
export function dismissPhoneCopyOffer(jobId: string | null | undefined) {
  if (jobId) toast.dismiss(offerId(jobId));
}

export function offerPhoneCopy(userId: string, jobId: string, file: File) {
  if (!isTouchDevice() || !userId || !file) return;
  const w = phoneSaveWords();
  const id = offerId(jobId);
  const show = (again: boolean) =>
    toast(again ? "Tap Save again" : w.label === "Save to Photos" ? "Save it to your Photos too?" : "Keep a copy on your phone?", {
      id,
      description: again ? w.how : `Filmed in the app, it only goes to your coach. ${w.how}`,
      duration: 20_000,
      action: {
        label: "Save",
        onClick: () => {
          void saveFiles([file]).then((o) => {
            if (o === "shared" || o === "saved") forgetFilmed(userId, { jobIds: [jobId] });
            else if (o === "again") show(true);
            else if (o === "failed") toast.error("Couldn't save it. Try Save on the set's video.");
          });
        },
      },
    });
  show(false);
}

/** A clip to save: the one filmed this session (`jobId`) or the stored one (`path`). */
export type SetVideoSaveTarget = {
  jobId?: string | null;
  setVideoId?: string | null;
  path?: string | null;
  name: string;
  mime?: string | null;
};

function itemOf(t: SetVideoSaveTarget): { item: SaveItem; file: File | null } {
  const file = t.jobId ? filmedFile(t.jobId) : null;
  const item: SaveItem = {
    kind: "video",
    path: t.path ?? null,
    // a clip still on its way has no stored path yet: it's held under its own key
    url: t.path ? null : t.jobId ? `local:set-video:${t.jobId}` : null,
    name: file?.name || t.name,
    mime: file?.type || t.mime || null,
  };
  return { item, file };
}

/**
 * Save set videos to the phone: the clip filmed this session when there is
 * one (handed over in the tap), else the stored copy (downloaded first, with
 * "Tap Save" when it took too long for the same tap). Saved ones stop being
 * offered.
 */
export function useSaveSetVideos() {
  const { user } = useAuth();
  const save = useSaveMedia();
  const userId = user?.id ?? null;
  const prepare = useCallback((targets: SetVideoSaveTarget[]) => {
    const list = targets.map(itemOf).filter(({ item, file }) => !!file || !!item.path);
    for (const { item, file } of list) if (file) holdSaveFile(item, file);
    return list.map((x) => x.item);
  }, []);
  /** As a finger lands on Save: the clips in hand are held, the others start downloading. */
  const warm = useCallback((targets: SetVideoSaveTarget[]) => warmSave(prepare(targets)), [prepare]);
  const run = useCallback(
    (targets: SetVideoSaveTarget[], opts: { onSaved?: () => void } = {}) => {
      const items = prepare(targets);
      if (!items.length) {
        toast.error("That video isn't on this phone any more.");
        return;
      }
      void save(items, {
        onSaved: () => {
          const jobIds = targets.map((t) => t.jobId).filter((x): x is string => !!x);
          if (userId)
            forgetFilmed(userId, {
              jobIds,
              setVideoIds: targets.map((t) => t.setVideoId).filter((x): x is string => !!x),
            });
          jobIds.forEach(dismissPhoneCopyOffer);
          opts.onSaved?.();
        },
      });
    },
    [prepare, save, userId],
  );
  return { save: run, warm };
}

/** The job a stored clip came from: this session's upload, else the record kept on the phone. */
export function jobIdForSetVideo(setVideoId: string, unsaved: FilmedEntry[]): string | null {
  return (
    getSetVideoJobs().find((j) => j.setVideoId === setVideoId)?.id ??
    unsaved.find((e) => e.setVideoId === setVideoId)?.jobId ??
    null
  );
}

/** Filmed in the app and not saved yet (a clip removed now would be gone from the phone too). */
export function isUnsavedFilmed(setVideoId: string, unsaved: FilmedEntry[]): boolean {
  return unsaved.some((e) => e.setVideoId === setVideoId);
}

/**
 * The end of a workout: the clips filmed in the app that aren't on the phone,
 * saved in one go ("Save 2 Videos" in the share sheet). Only the athlete's own,
 * on a phone, never a coach viewing as them; gone once they're saved.
 */
export function PhoneCopyReminder({ dayId, className }: { dayId: string | null | undefined; className?: string }) {
  const { user } = useAuth();
  const viewingAsClient = useViewingAsClient();
  const unsaved = useUnsavedFilmed(viewingAsClient ? null : user?.id);
  const mine = useMemo(() => unsaved.filter((e) => e.dayId === dayId), [unsaved, dayId]);
  const { data: videos } = useSetVideosForDay(dayId ?? "", !!dayId && mine.length > 0);
  const { save, warm } = useSaveSetVideos();
  const targets = useMemo(
    () =>
      mine.flatMap((e): SetVideoSaveTarget[] => {
        const v: SetVideo | undefined = e.setVideoId ? videos?.find((x) => x.id === e.setVideoId) : undefined;
        // removed from the set and gone from this phone: nothing left to save
        if (!filmedFile(e.jobId) && !v) return [];
        return [
          {
            jobId: e.jobId,
            setVideoId: e.setVideoId,
            path: v?.storage_path ?? null,
            name: `${v?.exercise_name ?? "Set"} set ${v?.set_index ?? ""}`.trim(),
          },
        ];
      }),
    [mine, videos],
  );
  if (viewingAsClient || !dayId || !targets.length || !isTouchDevice()) return null;
  const n = targets.length;
  const w = phoneSaveWords();
  return (
    <div
      className={cn("flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3", className)}
      data-phone-copy-reminder={n}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground" aria-hidden>
        <Smartphone className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {n === 1 ? "A video you filmed isn't" : `${n} videos you filmed aren't`} {w.place}
        </span>
        <span className="block text-xs leading-snug text-muted-foreground">
          Filmed in the app, {n === 1 ? "it's" : "they're"} only with your coach. {w.how}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        className="h-10 shrink-0 px-3"
        onPointerDown={() => warm(targets)}
        onClick={() => save(targets)}
      >
        Save
      </Button>
    </div>
  );
}
