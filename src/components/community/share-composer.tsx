import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Copy, Download, ImagePlus, RefreshCw, Send, Share2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CAPTION_MAX, buildShareCardFields, lockInTimeLabel, type CommunityVisibility } from "@/lib/community";
import { invalidateCommunity, saveCommunityPost, useCompletionPreview, useMyPostForCompletion, type SavePostInput } from "@/lib/community.queries";
import { InstagramGlyph } from "@/components/community/glyphs";
import { AudiencePicker } from "@/components/community/audience-picker";
import { pickMedia, releasePicked, removeCommunityFiles, signCommunityPaths, uploadPicked, type PickedMedia } from "@/lib/community-media";
import {
  TEMPLATE_LABEL,
  availableTemplates,
  canvasToBlob,
  copyImageToClipboard,
  downloadBlob,
  drawWorkoutShareCard,
  exportType,
  shareCardImage,
  type ShareCardData,
  type ShareFormat,
  type ShareTemplate,
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

/** Instagram-ish gradient for the one action we want people to take. */
const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";

/**
 * Full-screen share editor, opened from the workout recap.
 *
 * Swipe through card templates, add a photo with one tap, then either share
 * the card (OS share sheet → Instagram etc.), copy the transparent sticker for
 * an Instagram Story, or post to the JF Effect community. Those are
 * independent: nothing leaves the phone until a button is tapped. Every
 * number comes from the canonical completion via RPC.
 */
export function ShareComposer({ open, onOpenChange, completionId, athleteName, workoutTitle, unit }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading, isError: statsError } = useCompletionPreview(completionId, open);
  const { data: existing } = useMyPostForCompletion(completionId, open);

  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [existingDrawable, setExistingDrawable] = useState<HTMLImageElement | null>(null);
  const [removedExisting, setRemovedExisting] = useState(false);
  const [shareFormat, setShareFormat] = useState<ShareFormat>("story");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<null | "share" | "copy" | "save">(null);
  const [stickerHelp, setStickerHelp] = useState(false);

  // Community post sheet
  const [postOpen, setPostOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("community");
  const [hideLoads, setHideLoads] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [postedAs, setPostedAs] = useState<CommunityVisibility | null>(null);
  const hydratedFor = useRef<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  // State, not a ref: the dialog's content mounts a render after `open`, so
  // the stage has to be measured whenever it actually appears. With a ref the
  // effect ran before it existed and, when the workout was already cached,
  // never ran again: the card stayed 0x0 and the editor looked empty.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const canvases = useRef<Partial<Record<ShareTemplate, HTMLCanvasElement | null>>>({});

  // Editing, not duplicating: start from the post already made for this workout.
  useEffect(() => {
    if (!open || existing === undefined || hydratedFor.current === completionId) return;
    hydratedFor.current = completionId;
    if (existing) {
      setCaption(existing.caption ?? "");
      setVisibility(existing.visibility);
      setHideLoads(!!existing.hide_loads);
    }
  }, [open, existing, completionId]);

  // Show an already-attached photo on the cards (same-origin blob keeps the canvas exportable).
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
        /* cards fall back to the data styles; the attached photo is untouched */
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 2000);
    };
  }, [open, existing?.media_path, existing?.media_thumb_path, existing?.media_type, media, removedExisting]);

  // Reset when closed.
  useEffect(() => {
    if (open) return;
    hydratedFor.current = null;
    setCaption("");
    setVisibility("community");
    setHideLoads(false);
    setRemovedExisting(false);
    setPostedAs(null);
    setPostOpen(false);
    setStickerHelp(false);
    setProgress(0);
    setIndex(0);
    setMedia((m) => {
      releasePicked(m);
      return null;
    });
  }, [open]);

  const drawable = media?.drawable ?? existingDrawable ?? null;
  const hasMedia = !!media || (!!existing?.media_path && !removedExisting);

  const base = useMemo(() => {
    if (!stats) return null;
    return buildShareCardFields({
      stats,
      unit,
      athleteName: firstName(athleteName),
      workoutTitle,
      dateLabel: format(new Date(stats.completed_at), "EEE, MMM d"),
    });
  }, [stats, unit, athleteName, workoutTitle]);

  const templates = useMemo<ShareTemplate[]>(
    () => (base ? availableTemplates({ isPr: base.isPr, exercises: base.exercises, volume: base.volume, media: drawable }) : []),
    [base, drawable],
  );
  const current: ShareTemplate | undefined = templates[Math.min(index, templates.length - 1)];

  // Locked in earlier? The finished photo card carries that time ("LOCKED IN 6:02 PM").
  const lockedInTime = lockInTimeLabel(existing?.locked_in_at);
  const dataFor = useCallback(
    (template: ShareTemplate): ShareCardData | null =>
      base ? { ...base, template, format: shareFormat, media: drawable, lockedIn: lockedInTime ? { time: lockedInTime, live: false } : null } : null,
    [base, shareFormat, drawable, lockedInTime],
  );

  // Draw every slide (≤5, ~30 ms each). Latest-wins so a stale draw never lands.
  // Re-runs when the stage mounts, since the canvases only exist from then.
  const drawToken = useRef(0);
  useEffect(() => {
    if (!open || !base || !stageEl) return;
    const token = ++drawToken.current;
    (async () => {
      for (const t of templates) {
        if (token !== drawToken.current) return;
        const c = canvases.current[t];
        const d = dataFor(t);
        if (c && d) await drawWorkoutShareCard(c, d);
      }
    })();
  }, [open, base, templates, dataFor, stageEl]);

  // Keep the selected slide in view when templates change (e.g. a photo was added).
  const goTo = (i: number, smooth = true) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setIndex(i);
  };
  const onScroll = () => {
    const rail = railRef.current;
    if (!rail || !rail.clientWidth) return;
    const i = Math.round(rail.scrollLeft / rail.clientWidth);
    if (i !== index) setIndex(i);
  };

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
    // Jump to the photo card so the athlete sees their photo straight away.
    requestAnimationFrame(() => {
      const next = availableTemplates({ isPr: !!base?.isPr, exercises: base?.exercises ?? [], volume: base?.volume ?? null, media: res.media.drawable });
      goTo(Math.max(0, next.indexOf("photo")), false);
    });
  };

  const removeMedia = () => {
    setMedia((m) => {
      releasePicked(m);
      return null;
    });
    if (existing?.media_path) setRemovedExisting(true);
    setExistingDrawable(null);
  };

  /* ---- external share --------------------------------------------- */
  const renderBlob = async (t: ShareTemplate): Promise<Blob | null> => {
    const d = dataFor(t);
    if (!d) return null;
    const c = document.createElement("canvas");
    await drawWorkoutShareCard(c, d);
    return canvasToBlob(c, exportType(t), 0.92);
  };

  const shareOut = async () => {
    if (!current || busy) return;
    setBusy("share");
    try {
      const blob = await renderBlob(current);
      if (!blob) throw new Error("Couldn't build the card");
      const ext = current === "sticker" ? "png" : "jpg";
      const outcome = await shareCardImage(blob, { filename: `jf-effect-${current}.${ext}` });
      if (outcome === "shared") toast.success("Nice. Go get those 🔥");
      else if (outcome === "downloaded") toast.success("Card saved", { description: "Post it from your photos." });
      else if (outcome === "failed") toast.error("Couldn't share on this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't share the card");
    } finally {
      setBusy(null);
    }
  };

  // Clipboard write must start inside the tap (Safari), so pass the render promise straight in.
  const copySticker = async () => {
    if (busy) return;
    setBusy("copy");
    const ok = await copyImageToClipboard(renderBlob("sticker"));
    setBusy(null);
    if (ok) setStickerHelp(true);
    else {
      toast.message("Copy isn't supported here, so the sticker opens in your share sheet instead.");
      await shareOut();
    }
  };

  const saveImage = async () => {
    if (!current || busy) return;
    setBusy("save");
    try {
      const blob = await renderBlob(current);
      if (blob) downloadBlob(blob, `jf-effect-${current}.${current === "sticker" ? "png" : "jpg"}`);
    } finally {
      setBusy(null);
    }
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

      await saveCommunityPost({ completionId, caption, visibility, media: mediaArg, hideLoads });
      if (mediaArg.action !== "keep" && existing?.media_path) await removeCommunityFiles([existing.media_path, existing.media_thumb_path]);

      invalidateCommunity(qc);
      setPostedAs(visibility);
      setPostOpen(false);
      setRemovedExisting(false);
      // The uploaded photo is now the post's; keep showing it via the existing-post path.
      setMedia((m) => {
        releasePicked(m);
        return null;
      });
      if (visibility === "community") {
        toast.success(existing ? "Post updated 🔥" : "You're in the feed 🔥", {
          action: { label: "View", onClick: () => navigate({ to: "/portal/community" }) },
        });
      } else if (visibility === "coach") {
        toast.success("Sent to your coach", { description: "Only you and your coach can see it." });
      } else {
        toast.success("Saved to your profile", { description: "Only you can see it." });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  // Fit the card into whatever space is left between the bars (any phone size).
  useEffect(() => {
    if (!open || !stageEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [open, stageEl]);
  const cardSize = (r: number) => {
    const maxW = Math.max(0, box.w - 40);
    const maxH = Math.max(0, box.h - 20);
    const w = Math.min(maxW, maxH * r);
    return { width: Math.round(w), height: Math.round(w / r) };
  };
  const cardBox = cardSize(shareFormat === "story" ? 9 / 16 : 4 / 5);
  const stickerBox = cardSize(9 / 16);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none focus:outline-none focus-visible:outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Share workout</DialogTitle>
        <DialogDescription className="sr-only">Pick a card, add a photo, then share it or post it to the community.</DialogDescription>

        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between px-3 pb-1" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <button type="button" onClick={() => onOpenChange(false)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <div className="inline-flex rounded-full bg-white/10 p-1" role="group" aria-label="Card shape">
            {([["story", "Story"], ["feed", "Post"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={shareFormat === k}
                onClick={() => setShareFormat(k)}
                className={cn("h-9 rounded-full px-4 text-[13px] font-bold transition-colors", shareFormat === k ? "bg-white text-black" : "text-white/70")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95"
            aria-label={hasMedia ? "Change photo" : "Add a photo"}
          >
            {hasMedia ? <RefreshCw className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
          </button>
          {/* One input: iOS/Android offer "Take photo" and "Photo library" themselves. */}
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {/* Cards — swipe sideways */}
        <div ref={setStageEl} className="relative min-h-0 flex-1">
          {statsError ? (
            <div className="grid h-full place-items-center px-8 text-center text-sm text-white/70">Couldn't load this workout. Close and try again.</div>
          ) : statsLoading || !base ? (
            <div className="grid h-full place-items-center">
              <div className="aspect-[9/16] h-[70%] animate-pulse rounded-3xl bg-white/10" />
            </div>
          ) : (
            <div ref={railRef} onScroll={onScroll} className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {templates.map((t) => (
                <div key={t} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
                  <div className="relative" style={t === "sticker" ? stickerBox : cardBox}>
                    {t === "sticker" ? (
                      <StickerStage drawable={drawable}>
                        <canvas ref={(el) => { canvases.current[t] = el; }} className="block h-auto w-full" aria-label="Sticker preview" />
                      </StickerStage>
                    ) : (
                      <canvas ref={(el) => { canvases.current[t] = el; }} className="block h-full w-full rounded-3xl shadow-2xl" aria-label={`${TEMPLATE_LABEL[t]} card preview`} />
                    )}
                    {t === "photo" && !hasMedia && (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="absolute inset-x-0 top-[28%] mx-auto flex w-max flex-col items-center gap-3 active:scale-95"
                      >
                        <span className="grid h-20 w-20 place-items-center rounded-full bg-white text-black shadow-xl">
                          <ImagePlus className="h-8 w-8" />
                        </span>
                        <span className="rounded-full bg-black/50 px-3 py-1 text-[13px] font-bold backdrop-blur">Add your training photo</span>
                      </button>
                    )}
                    {t === "photo" && hasMedia && (
                      <button type="button" onClick={removeMedia} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/55 backdrop-blur active:scale-95" aria-label="Remove photo">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Template chips */}
        {templates.length > 1 && (
          <div className="flex shrink-0 justify-center gap-1.5 px-3 pt-1">
            {templates.map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => goTo(i)}
                className={cn("h-8 rounded-full px-3 text-[12px] font-bold transition-colors", i === index ? "bg-white text-black" : "bg-white/10 text-white/70")}
              >
                {TEMPLATE_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="shrink-0 space-y-2 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
          {current === "sticker" ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button type="button" disabled={!!busy || !base} onClick={() => void copySticker()} className={cn("h-14 rounded-2xl text-[16px] font-black text-white shadow-lg", SHARE_GRADIENT)}>
                <Copy className="mr-2 h-5 w-5" />
                {busy === "copy" ? "Copying…" : "Copy sticker"}
              </Button>
              <Button type="button" variant="secondary" disabled={!!busy || !base} onClick={() => void shareOut()} className="h-14 w-14 rounded-2xl bg-white/10 text-white hover:bg-white/20" aria-label="Share sticker">
                <Share2 className="h-5 w-5" />
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button type="button" disabled={!!busy || !base} onClick={() => void shareOut()} className={cn("h-14 rounded-2xl text-[16px] font-black text-white shadow-lg", SHARE_GRADIENT)}>
                <InstagramGlyph className="mr-2 h-5 w-5" />
                {busy === "share" ? "Preparing…" : "Share to Instagram & more"}
              </Button>
              <Button type="button" variant="secondary" disabled={!!busy || !base} onClick={() => void saveImage()} className="h-14 w-14 rounded-2xl bg-white/10 text-white hover:bg-white/20" aria-label="Save image">
                <Download className="h-5 w-5" />
              </Button>
            </div>
          )}
          <Button
            type="button"
            disabled={!base || !!statsError}
            onClick={() => setPostOpen(true)}
            className="h-12 w-full rounded-2xl bg-white text-[15px] font-black text-black hover:bg-white/90"
          >
            {postedAs ? <Check className="mr-2 h-5 w-5 text-emerald-600" /> : <Users className="mr-2 h-5 w-5" />}
            {postedAs === "community" ? "Posted. Edit post" : postedAs === "coach" ? "Sent to coach. Edit" : postedAs === "private" ? "Saved. Edit post" : existing ? "Edit community post" : "Post to JF Community"}
          </Button>
        </div>

        {/* Sticker how-to (after a successful copy) */}
        {stickerHelp && (
          <Overlay onClose={() => setStickerHelp(false)}>
            <div className="text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-6 w-6" /></div>
              <div className="mt-3 text-lg font-black">Sticker copied</div>
            </div>
            <ol className="mt-4 space-y-2.5 text-[14px] text-white/85">
              <li><b className="text-white">1.</b> Open Instagram and start a Story</li>
              <li><b className="text-white">2.</b> Snap or pick your gym photo</li>
              <li><b className="text-white">3.</b> Tap the screen and choose <b className="text-white">Paste</b> (or the sticker pop-up)</li>
            </ol>
            <a href="instagram://story-camera" className={cn("mt-5 flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-black text-white", SHARE_GRADIENT)}>
              <InstagramGlyph className="mr-2 h-5 w-5" /> Open Instagram
            </a>
            <button type="button" onClick={() => setStickerHelp(false)} className="mt-2 h-11 w-full rounded-2xl text-[14px] font-bold text-white/70">Done</button>
          </Overlay>
        )}

        {/* Post to the JF community */}
        {postOpen && (
          <Overlay onClose={() => !posting && setPostOpen(false)} light>
            <div className="text-lg font-black text-foreground">Post it</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {hasMedia ? "Your photo + workout. Pick who sees it." : "Your workout. Add a photo to stand out."}
            </p>
            <Textarea
              autoFocus
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
              rows={3}
              placeholder="How did it feel? (optional)"
              className="mt-3 resize-none rounded-2xl text-[16px]"
              aria-label="Caption"
            />
            <div className="mt-3">
              <AudiencePicker value={visibility} onChange={setVisibility} hideLoads={hideLoads} onHideLoads={setHideLoads} />
            </div>
            <Button type="button" className="mt-4 h-13 w-full rounded-2xl py-3.5 text-[16px] font-black" disabled={posting} onClick={() => void post()}>
              <Send className="mr-2 h-5 w-5" />
              {posting
                ? media?.kind === "video" && progress > 0 && progress < 100 ? `Uploading ${progress}%` : "Posting…"
                : visibility === "private" ? "Save to my profile" : visibility === "coach" ? (existing ? "Update" : "Send to my coach") : existing ? "Update post" : "Post"}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">Sharing to Instagram never posts here, and posting here never shares outside the app.</p>
          </Overlay>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Sticker preview on top of the athlete's own photo (or a neutral backdrop). */
function StickerStage({ drawable, children }: { drawable: HTMLImageElement | HTMLCanvasElement | null; children: React.ReactNode }) {
  const src = useMemo(
    () => (drawable instanceof HTMLImageElement ? drawable.src : drawable instanceof HTMLCanvasElement ? safeDataUrl(drawable) : null),
    [drawable],
  );
  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl"
      style={
        src
          ? { backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" }
          : { background: "radial-gradient(120% 80% at 30% 20%, #3f4b59 0%, #1b2027 55%, #0c0e12 100%)" }
      }
    >
      <div className="w-[88%]">{children}</div>
      {!src && <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] font-semibold text-white/60">Pastes on top of your own photo</div>}
    </div>
  );
}

function safeDataUrl(c: HTMLCanvasElement): string | null {
  try {
    return c.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

function Overlay({ children, onClose, light }: { children: React.ReactNode; onClose: () => void; light?: boolean }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn("w-full rounded-t-[28px] px-5 pt-5", light ? "bg-background text-foreground" : "bg-zinc-900 text-white")}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn("mx-auto mb-4 h-1 w-10 rounded-full", light ? "bg-muted-foreground/25" : "bg-white/25")} />
        {children}
      </div>
    </div>
  );
}
