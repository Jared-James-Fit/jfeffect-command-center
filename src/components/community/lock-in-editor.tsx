import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Camera, Check, Images, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CAPTION_MAX, LOCK_IN_CAPTIONS, lockInTimeLabel, type CommunityVisibility } from "@/lib/community";
import { invalidateCommunity, saveCommunityPost, type MyPostRow, type SavePostInput } from "@/lib/community.queries";
import { pickMedia, releasePicked, removeCommunityFiles, signCommunityPaths, uploadPicked, type PickedMedia } from "@/lib/community-media";
import { TEMPLATE_LABEL, canvasToBlob, drawWorkoutShareCard, shareCardImage, type ShareCardData, type ShareTemplate } from "@/lib/workout-share-card";
import { InstagramGlyph } from "@/components/community/glyphs";
import { AudiencePicker } from "@/components/community/audience-picker";
import type { LockInPick } from "@/components/community/lock-in";

const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";
const firstName = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string | null;
  ensureStarted: () => Promise<string | null>;
  workoutTitle: string;
  athleteName: string | null;
  existing: MyPostRow | null;
  /** Latest photo chosen in the bar's camera / library inputs. */
  pick: LockInPick | null;
  onCamera: () => void;
  onLibrary: () => void;
  /** Today's exercises ("4 × 5"), for the Today's plan card. */
  plan?: { name: string; detail: string }[];
  /** The look they shot on in the camera. */
  initialTemplate?: LockTemplate | null;
};

export type LockTemplate = Extract<ShareTemplate, "lockin" | "lockclock" | "lockplan">;

/**
 * The lock-in editor: the LOCKED IN card with their photo, a one-tap caption,
 * then Post (JF community) and/or Share (Instagram story). Posting starts the
 * session if it hasn't been; sharing out never posts, posting never shares.
 */
export function LockInEditor({ open, onOpenChange, completionId, ensureStarted, workoutTitle, athleteName, existing, pick, onCamera, onLibrary, plan = [], initialTemplate }: Props) {
  const [template, setTemplate] = useState<LockTemplate>(initialTemplate ?? "lockin");
  // A new shot from the camera brings its look with it.
  useEffect(() => {
    if (initialTemplate) setTemplate(initialTemplate);
  }, [initialTemplate, pick?.n]);
  const templates: LockTemplate[] = plan.length ? ["lockin", "lockclock", "lockplan"] : ["lockin", "lockclock"];
  const { user } = useAuth();
  const qc = useQueryClient();
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [live, setLive] = useState(false);
  const [existingDrawable, setExistingDrawable] = useState<HTMLImageElement | null>(null);
  const [removedExisting, setRemovedExisting] = useState(false);
  const [caption, setCaption] = useState(existing?.caption ?? "");
  const [visibility, setVisibility] = useState<CommunityVisibility>(existing?.visibility ?? "community");
  const [hideLoads, setHideLoads] = useState(!!existing?.hide_loads);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The stamp shows when they locked in: the saved time, or now.
  const [openedAt] = useState(() => new Date());
  const time = lockInTimeLabel(existing?.locked_in_at) ?? lockInTimeLabel(openedAt.toISOString()) ?? "";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // State, not a ref: the dialog mounts its content a frame later, and the
  // card has to be measured once it's actually there.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // A photo from the bar's inputs (camera or library).
  useEffect(() => {
    if (!pick) return;
    let cancelled = false;
    void pickMedia(pick.file).then((res) => {
      if (cancelled) return;
      if (!res.ok) return void toast.error(res.reason);
      setMedia((prev) => {
        releasePicked(prev);
        return res.media;
      });
      setLive(pick.live);
      setRemovedExisting(false);
      setPosted(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pick]);

  useEffect(() => () => releasePicked(media), [media]);

  // Editing: show the photo already on the post (same-origin blob keeps the canvas exportable).
  useEffect(() => {
    const path = existing?.media_type === "image" ? existing.media_path : existing?.media_thumb_path;
    if (!open || !path || media || removedExisting) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    (async () => {
      try {
        const url = (await signCommunityPaths([path]))[path];
        if (!url) return;
        blobUrl = URL.createObjectURL(await (await fetch(url)).blob());
        const img = new Image();
        img.onload = () => !cancelled && setExistingDrawable(img);
        img.src = blobUrl;
      } catch {
        /* card falls back to the brand glow */
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 2000);
    };
  }, [open, existing?.media_path, existing?.media_thumb_path, existing?.media_type, media, removedExisting]);

  const drawable = media?.drawable ?? (removedExisting ? null : existingDrawable);
  const hasPhoto = !!media || (!!existing?.media_path && !removedExisting);

  const card = useMemo<ShareCardData>(
    () => ({
      format: "story",
      template,
      athleteName: firstName(athleteName),
      workoutTitle: workoutTitle || "Workout",
      dateLabel: format(existing?.locked_in_at ? new Date(existing.locked_in_at) : openedAt, "EEE, MMM d"),
      lift: null,
      stats: [],
      isPr: false,
      exercises: plan.map((p) => ({ name: p.name, detail: p.detail, pr: false })),
      volume: null,
      sessionLine: null,
      media: drawable,
      lockedIn: { time, live: live && !!media },
    }),
    [athleteName, workoutTitle, existing?.locked_in_at, openedAt, drawable, time, live, media, template, plan],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (open && c) void drawWorkoutShareCard(c, card);
  }, [open, card, box.w]);

  useEffect(() => {
    if (!stageEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [stageEl]);
  const w = Math.max(0, Math.min(box.w - 40, (box.h - 12) * (9 / 16)));
  const cardBox = { width: Math.round(w), height: Math.round(w * (16 / 9)) };

  const removePhoto = () => {
    setMedia((m) => {
      releasePicked(m);
      return null;
    });
    if (existing?.media_path) setRemovedExisting(true);
    setExistingDrawable(null);
    setPosted(false);
  };

  const shareOut = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const c = document.createElement("canvas");
      await drawWorkoutShareCard(c, card);
      const blob = await canvasToBlob(c, "image/jpeg", 0.92);
      if (!blob) throw new Error("Couldn't build the card");
      const outcome = await shareCardImage(blob, { filename: "jf-effect-locked-in.jpg", title: "Locked in" });
      if (outcome === "shared") toast.success("Locked in. Now go get it 🔒");
      else if (outcome === "downloaded") toast.success("Card saved", { description: "Post it from your photos." });
      else if (outcome === "failed") toast.error("Couldn't share on this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't share the card");
    } finally {
      setSharing(false);
    }
  };

  const post = async () => {
    if (!user?.id || posting) return;
    setPosting(true);
    try {
      const id = completionId ?? (await ensureStarted());
      if (!id) throw new Error("Couldn't start your session. Try again.");
      let mediaArg: SavePostInput["media"] = { action: "keep" };
      if (media) mediaArg = { action: "set", ...(await uploadPicked(media, user.id, () => {})) };
      else if (removedExisting) mediaArg = { action: "remove" };
      await saveCommunityPost({ completionId: id, caption, visibility, media: mediaArg, hideLoads });
      if (mediaArg.action !== "keep" && existing?.media_path) await removeCommunityFiles([existing.media_path, existing.media_thumb_path]);
      invalidateCommunity(qc);
      setPosted(true);
      toast.success(visibility === "community" ? "You're locked in 🔒" : visibility === "coach" ? "Sent to your coach 🔒" : "Saved to your profile", {
        description:
          visibility === "community"
            ? "The crew sees you showed up. Your numbers land on it when you finish."
            : visibility === "coach"
              ? "Only you and your coach can see it."
              : "Only you can see it.",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none focus:outline-none focus-visible:outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Lock in</DialogTitle>
        <DialogDescription className="sr-only">Take or pick a photo, then post it to the community or share it to your story.</DialogDescription>

        <div className="flex shrink-0 items-center justify-between px-3 pb-1" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <button type="button" onClick={() => onOpenChange(false)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <div className="text-[15px] font-black tracking-wide">Lock in</div>
          <span className="h-11 w-11" />
        </div>

        {/* The card */}
        <div ref={setStageEl} className="relative min-h-0 flex-1">
          <div className="flex h-full items-center justify-center">
            <div className="relative" style={cardBox}>
              <canvas ref={canvasRef} className="block h-full w-full rounded-3xl shadow-2xl" aria-label="Locked in card preview" />
              {!hasPhoto ? (
                <div className="absolute inset-x-0 top-[22%] flex flex-col items-center gap-2.5">
                  <button type="button" onClick={onCamera} className="flex flex-col items-center gap-2.5 active:scale-95">
                    <span className="grid h-20 w-20 place-items-center rounded-full bg-white text-black shadow-xl">
                      <Camera className="h-8 w-8" />
                    </span>
                    <span className="whitespace-nowrap rounded-full bg-black/50 px-3 py-1 text-[13px] font-bold backdrop-blur">Snap your session</span>
                  </button>
                  <button type="button" onClick={onLibrary} className="whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-bold text-white/85 backdrop-blur active:scale-95">
                    <Images className="mr-1 inline h-3.5 w-3.5" /> or pick from library
                  </button>
                </div>
              ) : (
                <div className="absolute right-3 top-3 flex gap-2">
                  <button type="button" onClick={onCamera} className="grid h-9 w-9 place-items-center rounded-full bg-black/55 backdrop-blur active:scale-95" aria-label="Retake photo">
                    <Camera className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={onLibrary} className="grid h-9 w-9 place-items-center rounded-full bg-black/55 backdrop-blur active:scale-95" aria-label="Pick from library">
                    <Images className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={removePhoto} className="grid h-9 w-9 place-items-center rounded-full bg-black/55 backdrop-blur active:scale-95" aria-label="Remove photo">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Which card: Locked in · Clock · Today's plan */}
        <div className="flex shrink-0 justify-center gap-1.5 px-4 pt-2" role="group" aria-label="Card style">
          {templates.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={template === t}
              onClick={() => setTemplate(t)}
              className={cn("h-8 rounded-full px-3.5 text-[12px] font-black transition-colors", template === t ? "bg-white text-black" : "bg-white/10 text-white/75")}
            >
              {TEMPLATE_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Caption: one tap, or type your own */}
        <div className="shrink-0 space-y-2 px-4 pt-2">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LOCK_IN_CAPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCaption((cur) => (cur === c ? "" : c));
                  setPosted(false);
                }}
                className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-bold transition-colors", caption === c ? "bg-white text-black" : "bg-white/10 text-white/80")}
              >
                {c}
              </button>
            ))}
          </div>
          <div>
            <input
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value.slice(0, CAPTION_MAX));
                setPosted(false);
              }}
              placeholder="Say something (optional)"
              className="h-11 w-full rounded-xl border-0 bg-white/10 px-3 text-[16px] text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              aria-label="Caption"
            />
          </div>
          <AudiencePicker
            tone="dark"
            value={visibility}
            onChange={(v) => {
              setVisibility(v);
              setPosted(false);
            }}
            hideLoads={hideLoads}
            onHideLoads={(v) => {
              setHideLoads(v);
              setPosted(false);
            }}
          />
        </div>

        {/* Actions */}
        <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
          <Button type="button" disabled={sharing} onClick={() => void shareOut()} className={cn("h-14 rounded-2xl text-[15px] font-black text-white shadow-lg", posted ? SHARE_GRADIENT : "bg-white/10 hover:bg-white/20")}>
            <InstagramGlyph className="mr-2 h-5 w-5" />
            {sharing ? "Preparing…" : "Story"}
          </Button>
          <Button
            type="button"
            disabled={posting || posted}
            onClick={() => void post()}
            className={cn("h-14 rounded-2xl text-[15px] font-black shadow-lg", posted ? "bg-emerald-500 text-white disabled:opacity-100" : cn("text-white", SHARE_GRADIENT))}
          >
            {posted ? <Check className="mr-2 h-5 w-5" /> : <Send className="mr-2 h-5 w-5" />}
            {posting ? "Posting…" : posted ? (visibility === "coach" ? "Sent" : "Posted") : existing ? "Update" : visibility === "private" ? "Save" : visibility === "coach" ? "Send" : "Post"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
