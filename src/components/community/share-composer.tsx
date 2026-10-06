import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Camera, Check, Copy, Download, Image as ImageIcon, Lock, Share2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  CAPTION_MAX,
  SCOPE_WORD,
  featuredLift,
  formatTopSet,
  isPrMoment,
  pickCardStats,
  type CommunityVisibility,
} from "@/lib/community";
import { invalidateCommunity, saveCommunityPost, useCompletionPreview, useMyPostForCompletion, type SavePostInput } from "@/lib/community.queries";
import { pickMedia, releasePicked, removeCommunityFiles, signCommunityPaths, uploadPicked, type PickedMedia } from "@/lib/community-media";
import {
  canvasToBlob,
  drawWorkoutShareCard,
  shareCardImage,
  type ShareCardData,
  type ShareFormat,
} from "@/lib/workout-share-card";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** pl_day_completions.id of the finished workout. */
  completionId: string;
  athleteName?: string | null;
  workoutTitle?: string | null;
  unit: "kg" | "lb";
};

const firstName = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || null;

/**
 * Optional "Share workout" composer, opened from the workout recap.
 *
 * Posting to the community and sharing the card outside the app are two
 * independent actions: neither requires the other, and nothing leaves the
 * device until the athlete taps a button. The workout numbers always come from
 * the canonical completion (via RPC); this component only adds a photo and
 * a few words.
 */
export function ShareComposer({ open, onOpenChange, completionId, athleteName, workoutTitle, unit }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading, isError: statsError } = useCompletionPreview(completionId, open);
  const { data: existing } = useMyPostForCompletion(completionId, open);

  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("community");
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [existingDrawable, setExistingDrawable] = useState<HTMLImageElement | null>(null);
  const [removedExisting, setRemovedExisting] = useState(false);
  const [shareFormat, setShareFormat] = useState<ShareFormat>("feed");
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [postedAs, setPostedAs] = useState<CommunityVisibility | null>(null);
  const hydratedFor = useRef<string | null>(null);

  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Start from the existing post (editing, not duplicating) once it has loaded.
  useEffect(() => {
    if (!open || existing === undefined) return;
    if (hydratedFor.current === completionId) return;
    hydratedFor.current = completionId;
    if (existing) {
      setCaption(existing.caption ?? "");
      setVisibility(existing.visibility);
    }
  }, [open, existing, completionId]);

  // Show the already-attached photo on the card preview (via a same-origin blob so the canvas stays exportable).
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    setExistingDrawable(null);
    const path = existing?.media_type === "image" ? existing.media_path : existing?.media_thumb_path;
    if (!open || !path || media || removedExisting) return;
    (async () => {
      try {
        const url = (await signCommunityPaths([path]))[path];
        if (!url) return;
        const blob = await (await fetch(url)).blob();
        blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => !cancelled && setExistingDrawable(img);
        img.src = blobUrl;
      } catch {
        /* card falls back to the data style; the attached photo is untouched */
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 2000);
    };
  }, [open, existing?.media_path, existing?.media_thumb_path, existing?.media_type, media, removedExisting]);

  // Reset local state when the composer closes.
  useEffect(() => {
    if (open) return;
    hydratedFor.current = null;
    setCaption("");
    setVisibility("community");
    setRemovedExisting(false);
    setPostedAs(null);
    setProgress(0);
    setMedia((m) => {
      releasePicked(m);
      return null;
    });
  }, [open]);

  const hasMedia = !!media || (!!existing?.media_path && !removedExisting);

  const cardData = useMemo<ShareCardData | null>(() => {
    if (!stats) return null;
    const lift = featuredLift(stats);
    return {
      format: shareFormat,
      athleteName: firstName(athleteName),
      workoutTitle: stats.workout_title || workoutTitle || "Workout",
      dateLabel: format(new Date(stats.completed_at), "EEE, MMM d"),
      lift: lift ? { name: lift.name, detail: formatTopSet(lift.detail, unit), prLabel: lift.pr ? SCOPE_WORD[lift.pr].toUpperCase() : null } : null,
      stats: pickCardStats(stats, unit),
      isPr: isPrMoment(stats),
      caption: caption.trim() || null,
      media: media?.drawable ?? existingDrawable ?? null,
    };
  }, [stats, shareFormat, athleteName, workoutTitle, unit, caption, media, existingDrawable]);

  // Latest-wins redraw so fast typing never paints an older frame over a newer one.
  const drawToken = useRef(0);
  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !cardData) return;
    const token = ++drawToken.current;
    await drawWorkoutShareCard(canvas, cardData);
    return token === drawToken.current;
  }, [cardData]);
  useEffect(() => {
    if (!open || !cardData) return;
    const t = setTimeout(() => void render(), caption ? 120 : 0);
    return () => clearTimeout(t);
  }, [open, cardData, render, caption]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    const res = await pickMedia(file);
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    setMedia((prev) => {
      releasePicked(prev);
      return res.media;
    });
    setRemovedExisting(false);
  };

  const removeMedia = () => {
    setMedia((m) => {
      releasePicked(m);
      return null;
    });
    if (existing?.media_path) setRemovedExisting(true);
    setExistingDrawable(null);
  };

  /* ---- community post ---------------------------------------------- */
  const post = async () => {
    if (!user?.id || posting) return;
    setPosting(true);
    setProgress(0);
    try {
      let mediaArg: SavePostInput["media"] = { action: "keep" };
      if (media) mediaArg = { action: "set", ...(await uploadPicked(media, user.id, setProgress)) };
      else if (removedExisting) mediaArg = { action: "remove" };

      await saveCommunityPost({ completionId, caption, visibility, media: mediaArg });

      // The old files are unreferenced now; clean them up (best effort).
      if (mediaArg.action !== "keep" && existing?.media_path) await removeCommunityFiles([existing.media_path, existing.media_thumb_path]);

      invalidateCommunity(qc);
      setPostedAs(visibility);
      setRemovedExisting(false);
      setMedia((m) => {
        releasePicked(m);
        return null;
      });
      if (visibility === "community") {
        toast.success(existing ? "Post updated" : "Posted to Community", {
          action: { label: "View", onClick: () => navigate({ to: "/portal/community" }) },
        });
      } else {
        toast.success(existing ? "Saved" : "Saved to your posts", { description: "Only you can see it." });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  /* ---- external share ------------------------------------------------ */
  const canShareFiles = useMemo(() => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    try {
      return !navigator.canShare || navigator.canShare({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });
    } catch {
      return false;
    }
  }, []);

  const shareOut = async () => {
    if (!cardData || sharing) return;
    setSharing(true);
    try {
      await render(); // make sure the exported frame matches what's on screen
      const canvas = canvasRef.current;
      const blob = canvas ? await canvasToBlob(canvas, "image/jpeg", 0.92) : null;
      if (!blob) throw new Error("Couldn't build the card");
      const outcome = await shareCardImage(blob, { filename: "jf-effect-workout.jpg", text: caption.trim() || undefined });
      if (outcome === "downloaded") toast.success("Card saved", { description: "Post it from your photos." });
      else if (outcome === "failed") toast.error("Couldn't share the card on this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't share the card");
    } finally {
      setSharing(false);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption.trim());
      toast.success("Caption copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  };

  const primaryLabel = posting
    ? media?.kind === "video" && progress > 0 && progress < 100 ? `Uploading ${progress}%` : "Posting…"
    : visibility === "private"
      ? existing ? "Save changes" : "Save to my posts"
      : existing ? "Update post" : "Post to Community";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bottom-0 top-auto flex w-full max-w-none translate-x-[-50%] translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-[24px] border-border/80 bg-background p-0 shadow-2xl sm:bottom-auto sm:top-1/2 sm:max-w-[480px] sm:-translate-y-1/2 sm:rounded-[24px] [&>button]:hidden"
        style={{ height: "min(96dvh, 860px)", maxHeight: "96dvh" }}
        // Don't auto-focus the close button on open (it paints a focus ring).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <div>
            <DialogTitle className="text-lg font-black tracking-tight">Share workout</DialogTitle>
            <DialogDescription className="text-[12px]">Optional. Nothing is posted until you tap a button.</DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={() => onOpenChange(false)} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Live preview: exactly what will be shared outside the app */}
          <div className="flex justify-center rounded-2xl bg-muted/50 p-2">
            {statsError ? (
              <div className="grid h-52 place-items-center px-6 text-center text-sm text-muted-foreground">Couldn't load this workout. Close and try again.</div>
            ) : statsLoading || !cardData ? (
              <Skeleton className="aspect-[4/5] max-h-[34dvh] w-full rounded-xl" />
            ) : (
              <canvas ref={canvasRef} className="block h-auto max-h-[34dvh] w-auto max-w-full rounded-xl shadow-md" aria-label="Preview of your workout card" />
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">{hasMedia ? "Looking good." : "Show the work."}</p>
            <div className="inline-flex rounded-full bg-muted p-0.5" role="group" aria-label="Card shape">
              {([["feed", "Post"], ["story", "Story"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={shareFormat === k}
                  onClick={() => setShareFormat(k)}
                  className={cn("h-8 rounded-full px-3 text-[12px] font-bold", shareFormat === k ? "bg-background shadow-sm" : "text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Media: permissions are only requested when one of these is tapped */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {hasMedia ? (
              <>
                <Button type="button" variant="outline" className="h-12 rounded-xl text-[13px] font-bold" onClick={() => libraryRef.current?.click()}>
                  <ImageIcon className="mr-1.5 h-4 w-4" />
                  Replace
                </Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl text-[13px] font-bold" onClick={removeMedia}>
                  <X className="mr-1.5 h-4 w-4" />
                  Remove
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="h-12 rounded-xl text-[13px] font-bold" onClick={() => cameraRef.current?.click()}>
                  <Camera className="mr-1.5 h-4 w-4" />
                  Add a photo
                </Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl text-[13px] font-bold" onClick={() => libraryRef.current?.click()}>
                  <ImageIcon className="mr-1.5 h-4 w-4" />
                  Photo or video
                </Button>
              </>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={libraryRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>

          <div className="mt-3">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
              rows={2}
              placeholder="Say something about it…"
              className="min-h-[72px] resize-none rounded-xl text-[16px]"
              aria-label="Caption"
            />
            {caption.length > CAPTION_MAX - 60 && <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{caption.length}/{CAPTION_MAX}</div>}
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">Who can see a post</div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Post visibility">
              {([
                ["community", "Community", Users],
                ["private", "Only me", Lock],
              ] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={visibility === k}
                  onClick={() => setVisibility(k)}
                  className={cn(
                    "flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-[13px] font-bold transition-colors",
                    visibility === k ? "border-primary bg-primary/[0.07] text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">Sharing the card outside the app is separate. It never posts to the community.</p>
          </div>
        </div>

        <footer className="shrink-0 border-t border-border/70 bg-background/95 px-4 pt-3 backdrop-blur" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
          {postedAs && (
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4" />
              {postedAs === "community" ? "Posted to the community" : "Saved. Only you can see it"}
            </div>
          )}
          <Button type="button" className="h-12 w-full rounded-xl text-[15px] font-black" disabled={posting || !!statsError || statsLoading} onClick={() => void post()}>
            {primaryLabel}
          </Button>
          <div className={cn("mt-2 grid gap-2", caption.trim() ? "grid-cols-2" : "grid-cols-1")}>
            <Button type="button" variant="outline" className="h-11 rounded-xl text-[13px] font-bold" disabled={sharing || !cardData} onClick={() => void shareOut()}>
              {canShareFiles ? <Share2 className="mr-1.5 h-4 w-4" /> : <Download className="mr-1.5 h-4 w-4" />}
              {sharing ? "Preparing…" : canShareFiles ? "Share card" : "Save card"}
            </Button>
            {caption.trim() && (
              <Button type="button" variant="outline" className="h-11 rounded-xl text-[13px] font-bold" onClick={() => void copyCaption()}>
                <Copy className="mr-1.5 h-4 w-4" />
                Copy caption
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
