/**
 * Set videos filmed in the app go to the phone too (set-videos/phone-copy.ts
 * says which ones and why it takes a tap: iOS only saves to Photos through the
 * share sheet's Save Video, from a tap):
 *   · useSaveSetVideos: Save to Photos on a clip in the set's sheet, and before one is removed
 *   · SaveVideosInline: on the finished workout's recap, one small "↓ Save 2 videos to
 *     device", at most once per workout (save-offer.ts); nothing pops up after filming,
 *     nothing during the review, nothing when a finished workout is reopened
 *   · useEligibleSetVideoSaves: the same clips for the recap's Share sheet (Save videos)
 * Saving hands the clip filmed this session straight to the share sheet (the
 * original, nothing downloaded); after a reload it comes back down from storage.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { isTouchDevice } from "@/lib/file-share";
import { markOffered, saveVideosLabel, shouldOfferSave, wasOffered } from "@/lib/set-videos/save-offer";
import { holdSaveFile, warmSave, type SaveItem } from "@/lib/save-media";
import { useSaveMedia } from "@/components/messages/save-media";
import { getSetVideoJobs } from "@/lib/set-videos/jobs";
import { setWord } from "@/lib/set-videos/label";
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
 * The clips filmed in the app for this workout that aren't saved to the phone
 * yet (the athlete's own, never a coach viewing as them, only on a phone):
 * what "Save N videos to device" hands to the share sheet in one go.
 */
export function useEligibleSetVideoSaves(dayId: string | null | undefined) {
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
            name: `${v?.exercise_name ?? "Set"} ${v?.set_index != null ? setWord(v.set_index) : ""}`.trim(),
          },
        ];
      }),
    [mine, videos],
  );
  const eligible = viewingAsClient || !dayId || !isTouchDevice() ? [] : targets;
  return { targets: eligible, userId: user?.id ?? null, viewingAsClient, save, warm };
}

/**
 * The recap's one small save utility: "↓ Save 7 videos to device", shown the
 * first time this workout's recap has clips to save and never again for it
 * (shown or dismissed is remembered, save-offer.ts). It never says the clips
 * are in Photos: a save hands them to the phone's share sheet, and once that
 * happened they stop counting, so the line simply goes.
 */
export function SaveVideosInline({ dayId, workoutKey, className }: { dayId: string | null | undefined; workoutKey: string | null | undefined; className?: string }) {
  const { targets, userId, save, warm } = useEligibleSetVideoSaves(dayId);
  const [show, setShow] = useState<boolean | null>(null);
  const n = targets.length;
  useEffect(() => {
    if (show !== null || !userId || !workoutKey || n === 0) return;
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }
    const offer = shouldOfferSave({ eligible: n, viewingAsClient: false, phone: true, offeredBefore: wasOffered(storage, userId, workoutKey) });
    if (offer) markOffered(storage, userId, workoutKey);
    setShow(offer);
  }, [show, userId, workoutKey, n]);
  if (!show || n === 0) return null;
  return (
    <div className={cn("flex items-center justify-center gap-1", className)} data-save-videos-inline={n}>
      <button
        type="button"
        onPointerDown={() => warm(targets)}
        onClick={() => save(targets)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-foreground active:bg-muted"
      >
        <ArrowDownToLine className="h-4 w-4" aria-hidden />
        {saveVideosLabel(n)}
      </button>
      <button type="button" onClick={() => setShow(false)} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Not now">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
