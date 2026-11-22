import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Film, Loader2, MoreHorizontal, RectangleVertical, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/instagram-export";
import { canShareFiles, downloadFiles, saveFiles } from "@/lib/file-share";
import { SHARE_DESTINATIONS, withPromo, type ShareDestination, type ShareFormat } from "@/lib/share-out";

const PROMO_KEY = "jf.share-out.promo";
function readPromo(): boolean {
  try {
    return localStorage.getItem(PROMO_KEY) !== "0";
  } catch {
    return true;
  }
}

const ICONS: Record<ShareDestination["key"], typeof Square> = {
  ig_story: RectangleVertical,
  ig_post: Square,
  tiktok: Film,
  more: MoreHorizontal,
  save: Download,
  copy: Copy,
};

/**
 * Share outside the app (Nov 22 2026): the picture in the right shape for
 * where it's going and a caption written from the workout, from the recap, a
 * PR and the story camera alike. The files are made when the sheet opens, so
 * each tap hands them straight to the phone's share sheet (iOS only opens it
 * from the tap itself). The caption is copied only by a tap that says so.
 */
export function ShareOutSheet({
  open,
  onOpenChange,
  make,
  caption,
  promoLine,
  look,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picture at a shape (painted exactly as the preview shows it). */
  make: (format: ShareFormat) => Promise<File | null>;
  /** The caption written from the workout, without its promo line. */
  caption: string;
  promoLine: string;
  look?: string | null;
}) {
  const [files, setFiles] = useState<Partial<Record<ShareFormat, File | null>>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [promo, setPromo] = useState(readPromo);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const makeRef = useRef(make);
  makeRef.current = make;

  // the caption, fresh each time it opens (the promo line as they left it)
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setText(withPromo(caption, promoLine, readPromo()));
  }, [open, caption, promoLine]);

  // both shapes, made once per opening, before any tap
  useEffect(() => {
    if (!open) return;
    let live = true;
    let url: string | null = null;
    setFiles({});
    void (async () => {
      const story = await makeRef.current("story").catch(() => null);
      if (!live) return;
      if (story) {
        url = URL.createObjectURL(story);
        setPreview(url);
      }
      setFiles((f) => ({ ...f, story }));
      const feed = await makeRef.current("feed").catch(() => null);
      if (live) setFiles((f) => ({ ...f, feed }));
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [open, look]);

  const togglePromo = (on: boolean) => {
    setPromo(on);
    setText((t) => withPromo(t, promoLine, on));
    try {
      localStorage.setItem(PROMO_KEY, on ? "1" : "0");
    } catch {
      /* this visit only */
    }
  };

  const go = (d: ShareDestination) => {
    feedback("tap");
    // the caption first, inside the tap (only where the tile says it copies)
    if (d.copies) {
      void copyText(text).then((ok) => {
        setCopied(ok);
        if (d.key === "copy") toast.message(ok ? "Caption copied" : "Couldn't copy it here", { description: ok ? "Paste it wherever you post." : "Select the caption and copy it." });
      });
    }
    if (!d.format) return;
    const file = files[d.format];
    if (!file) return void toast.message("Still getting it ready", { description: "Try again in a second." });
    if (d.key === "save") {
      void saveFiles([file]).then((o) => {
        if (o === "again") toast.message("Tap Save once more", { description: "Your phone needs one more tap." });
        if (o === "saved") toast.message("Saved", { description: "It's in your downloads." });
      });
      return;
    }
    if (canShareFiles([file])) {
      navigator.share({ files: [file], ...(d.withText && text ? { text } : {}) }).then(
        () => {
          if (d.copies) toast.message("Caption copied", { description: "Paste it under your post." });
        },
        (e: { name?: string }) => {
          if (e?.name === "NotAllowedError") toast.message("Tap once more", { description: "Your phone needs one more tap to open sharing." });
        },
      );
      return;
    }
    // a computer: the file downloads, posted from there
    if (downloadFiles([file])) toast.message("Downloaded", { description: d.key.startsWith("ig") || d.key === "tiktok" ? "Post it from the app with this picture." : undefined });
  };

  const ready = !!files.story;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[92svh] overflow-y-auto rounded-t-2xl px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3" data-share-out>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetTitle className="text-[17px] font-semibold">Share</SheetTitle>
        <SheetDescription className="sr-only">Share this outside the app, or save it.</SheetDescription>
        <div className="mt-3 flex gap-3">
          <div className="relative aspect-[9/16] w-[84px] shrink-0 overflow-hidden rounded-lg bg-muted">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <Loader2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="block w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[16px] leading-snug"
              aria-label="Caption"
              data-share-out-caption
            />
            <label className="mt-2 flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
              <span>Add {promoLine}</span>
              <Switch checked={promo} onCheckedChange={togglePromo} aria-label={`Add ${promoLine}`} />
            </label>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Where to share">
          {SHARE_DESTINATIONS.map((d) => {
            const Icon = d.key === "copy" && copied ? Check : ICONS[d.key];
            const waiting = !!d.format && !files[d.format];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => go(d)}
                disabled={waiting && !ready}
                className={cn("flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl bg-muted px-1 py-2 text-center active:scale-[0.97] disabled:opacity-50")}
                data-share-out-to={d.key}
              >
                {waiting ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Icon className="h-5 w-5" />}
                <span className="text-[13px] font-semibold leading-tight">{d.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{d.sub}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] leading-snug text-muted-foreground" data-share-out-note>
          Your phone's share sheet opens: pick the app there. Instagram and TikTok don't take captions from other apps, so those copy yours to paste.
        </p>
      </SheetContent>
    </Sheet>
  );
}
