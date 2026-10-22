import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Hash, Instagram, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cardArtElement, paintCardFile } from "@/components/community/post-art";
import { type CommunityPost, type PostSlide } from "@/lib/community";
import { signCommunityPaths } from "@/lib/community-media";
import { loadPostArt, postArtKey } from "@/lib/post-art";
import { useWeightUnit } from "@/lib/use-weight-unit";
import { cn } from "@/lib/utils";
import {
  IG_SIZES,
  copyText,
  hasFormatChoice,
  instagramCaption,
  instagramFileName,
  instagramHeadsUp,
  instagramPlan,
  instagramTags,
  isTouchDevice,
  mediaType,
  sendToInstagram,
  toggleTags,
  type IgFormat,
} from "@/lib/instagram-export";

const TAGS_KEY = "jf.instagram.tags";

function readTagsPref(): boolean {
  try {
    return localStorage.getItem(TAGS_KEY) !== "off";
  } catch {
    return true;
  }
}
function saveTagsPref(on: boolean) {
  try {
    localStorage.setItem(TAGS_KEY, on ? "on" : "off");
  } catch {
    /* a private window: it just won't be remembered */
  }
}

type Prepared = { file: File; url: string; video: boolean; aspect: string };

/** A slide's shape in the preview: its own, kept inside what Instagram's feed shows (4:5 to 16:9). */
function slideAspect(s: PostSlide): string {
  const r = s.width && s.height ? s.width / s.height : 0.8;
  return String(Math.min(16 / 9, Math.max(0.8, r)));
}

/** The post's own photos / clips as files (the full-size originals), numbered after the card when there is one. */
async function slideFiles(post: CommunityPost, slides: PostSlide[], first: number): Promise<File[]> {
  const signed = await signCommunityPaths(slides.map((s) => s.path));
  return Promise.all(
    slides.map(async (s, i) => {
      const url = signed[s.path];
      if (!url) throw new Error("no link");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      const type = mediaType(blob.type, s.path, s.type);
      return new File([blob], instagramFileName(post, first + i, type), { type });
    }),
  );
}

/**
 * Share to Instagram, for a coach (any post's ⋯ or ✈️): what will go out,
 * already made (the post's photos / clips, or its card painted 4:5 for the
 * feed or 9:16 for a story), the caption (his words, tags as plain names,
 * hashtags he can switch off), and one tap that copies the caption and opens
 * the share sheet, where Instagram is. The files are ready before the tap,
 * because iOS only opens the sheet from the tap itself. The 4:5 card is the
 * very picture the feed shows (post-art.ts, painted once); `unit` is the one
 * the feed painted it in.
 */
export function InstagramShareSheet({ post, open, onOpenChange, unit: shownUnit }: { post: CommunityPost; open: boolean; onOpenChange: (open: boolean) => void; unit?: "kg" | "lb" }) {
  const { unit: myUnit } = useWeightUnit();
  const unit = shownUnit ?? myUnit;
  const plan = useMemo(() => instagramPlan(post), [post]);
  const [format, setFormat] = useState<IgFormat>("feed");
  const [tagsOn, setTagsOn] = useState(true);
  const tags = useMemo(() => instagramTags(post).join(" "), [post]);
  const [caption, setCaption] = useState("");
  const [prepared, setPrepared] = useState<{ key: string; items: Prepared[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  // iOS wouldn't open the sheet from the first tap: the caption is copied, the next tap only shares
  const [copiedOnce, setCopiedOnce] = useState(false);
  const touch = useMemo(() => isTouchDevice(), []);
  const headsUp = useMemo(() => instagramHeadsUp(post), [post]);

  // fresh every time it opens: the caption from the post, the hashtags as last left
  // (a refetch of the same post while it's open never resets what he's typed)
  const postRef = useRef(post);
  postRef.current = post;
  useEffect(() => {
    if (!open) return;
    const on = readTagsPref();
    setTagsOn(on);
    setCaption(instagramCaption(postRef.current, { tags: on }));
    setFormat("feed");
    setCopiedOnce(false);
    setFailed(false);
  }, [open, post.id]);

  // A lesson's diagram / Saturday's scene: drawn here off screen, then copied as a picture for the card.
  const drawing = useMemo(() => (plan.card ? cardArtElement(post, plan.card) : null), [plan, post]);
  // the sheet's content mounts a frame after it opens (its portal), so the drawing is read once its host is there
  const [artHost, setArtHost] = useState<HTMLDivElement | null>(null);
  const hostReady = !drawing || !!artHost;

  // What's being made right now: only files made for exactly this can go out
  // (switch Post / Story and the old card is never shared by a quick tap).
  const prepKey = `${post.id}:${format}:${unit}:${attempt}:${hostReady ? 1 : 0}`;
  // The post's own files load once per opening (a clip isn't fetched again when the card's shape changes).
  const slidesRef = useRef<{ key: string; files: Promise<File[]> } | null>(null);
  useEffect(() => {
    if (!open) return;
    if (!hostReady) return; // the drawing is a frame away
    let alive = true;
    const made: string[] = [];
    setFailed(false);
    (async () => {
      const out: Prepared[] = [];
      if (plan.card) {
        const card = plan.card;
        // 4:5: the feed's own picture (kept, or painted once for both); 9:16: painted for the story
        const file =
          format === "feed"
            ? (await loadPostArt(postArtKey(post, card, unit), instagramFileName(post, 0, "image/jpeg"), () => paintCardFile(post, card, "feed", unit, artHost)))?.file
            : await paintCardFile(post, card, format, unit, artHost);
        if (!file) throw new Error("card");
        out.push({ file, url: "", video: false, aspect: `${IG_SIZES[format].w} / ${IG_SIZES[format].h}` });
      }
      if (plan.slides.length) {
        const key = `${post.id}:${attempt}`;
        if (slidesRef.current?.key !== key) slidesRef.current = { key, files: slideFiles(post, plan.slides, plan.card ? 1 : 0) };
        const files = await slidesRef.current.files;
        files.forEach((file, i) => out.push({ file, url: "", video: file.type.startsWith("video/"), aspect: slideAspect(plan.slides[i]) }));
      }
      return out;
    })()
      .then((out) => {
        if (!alive) return;
        for (const p of out) {
          p.url = URL.createObjectURL(p.file);
          made.push(p.url);
        }
        setPrepared({ key: prepKey, items: out });
      })
      .catch(() => {
        if (!alive) return;
        slidesRef.current = null;
        setFailed(true);
      });
    return () => {
      alive = false;
      // a beat later, so the previews on screen don't blank before the next ones land
      window.setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 1500);
    };
  }, [open, plan, format, post, unit, hostReady, artHost, attempt, prepKey]);

  const items = prepared?.items ?? null;
  const files = items?.map((i) => i.file) ?? [];
  const ready = prepared?.key === prepKey && !!items?.length && !failed;

  const share = () => {
    if (!ready || busy) return;
    setBusy(true);
    // everything below starts in this tap: iOS opens the share sheet only from a tap
    void sendToInstagram(files, copiedOnce ? null : caption)
      .then(({ outcome, copied }) => {
        if (outcome === "again") {
          setCopiedOnce(true);
          toast.message(copied ? "Caption copied. Tap Share once more to open Instagram." : "Tap Share once more to open Instagram.");
          return;
        }
        if (outcome === "shared") {
          toast.success(copied || copiedOnce ? "Caption copied" : "Shared", { description: copied || copiedOnce ? "Paste it into Instagram's caption." : undefined });
          onOpenChange(false);
        } else if (outcome === "saved") {
          toast.success(files.length > 1 ? `${files.length} files saved${copied ? ", caption copied" : ""}` : `Saved${copied ? ", caption copied" : ""}`, {
            description: "Post them from Instagram and paste the caption.",
            action: { label: "Open Instagram", onClick: () => window.open("https://www.instagram.com/", "_blank", "noopener") },
          });
        } else if (outcome === "failed") {
          toast.error("Couldn't share that. Try Save instead.");
        }
        if (!copied && !copiedOnce && outcome !== "cancelled") toast.error("Couldn't copy the caption. Use Copy caption below.");
      })
      .finally(() => setBusy(false));
  };

  const copyOnly = () => {
    void copyText(caption).then((ok) => (ok ? toast.success("Caption copied") : toast.error("Couldn't copy. Select the caption and copy it.")));
  };

  const setTags = (on: boolean) => {
    setTagsOn(on);
    saveTagsPref(on);
    setCaption((c) => toggleTags(c, tags, on));
  };

  const cardShape = `${IG_SIZES[format].w} / ${IG_SIZES[format].h}`;
  const count = (plan.card ? 1 : 0) + plan.slides.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-instagram-sheet>
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-2 pt-4 text-left">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)] text-white">
              <Instagram className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-black leading-tight">Share to Instagram</SheetTitle>
              <SheetDescription className="text-[12px] leading-tight text-muted-foreground">
                {touch ? "Copies the caption, then pick Instagram and paste it in" : "Saves the files and copies the caption"}
              </SheetDescription>
            </div>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>

        <div className="space-y-4 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-2">
          {hasFormatChoice(plan) && (
            <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="radiogroup" aria-label="Shape" data-ig-format>
              {(["feed", "story"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => setFormat(f)}
                  className={cn("h-9 rounded-full text-[13px] font-bold transition-colors", format === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                >
                  {f === "feed" ? "Post · 4:5" : "Story · 9:16"}
                </button>
              ))}
            </div>
          )}

          {/* what goes out, exactly */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" data-ig-preview>
            {failed ? (
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex h-[200px] w-[160px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-[13px] font-semibold text-muted-foreground">
                <RotateCcw className="h-5 w-5" /> Couldn't load it. Tap to try again
              </button>
            ) : items ? (
              items.map((p, i) =>
                p.video ? (
                  <video key={p.url} src={p.url} muted playsInline loop autoPlay className={cn("h-[200px] shrink-0 rounded-2xl bg-black object-cover transition-opacity", !ready && "opacity-60")} style={{ aspectRatio: p.aspect }} aria-label={`Clip ${i + 1}`} />
                ) : (
                  <img key={p.url} src={p.url} alt={`Picture ${i + 1}`} className={cn("h-[200px] shrink-0 rounded-2xl bg-muted object-cover transition-opacity", !ready && "opacity-60")} style={{ aspectRatio: p.aspect }} />
                ),
              )
            ) : (
              Array.from({ length: Math.max(1, count) }, (_, i) => (
                <div key={i} className="grid h-[200px] shrink-0 place-items-center rounded-2xl bg-muted" style={{ aspectRatio: i === 0 && plan.card ? cardShape : "4 / 5" }}>
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Getting it ready" />
                </div>
              ))
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="ig-caption" className="text-[13px] font-bold">
                Caption
              </label>
              <button
                type="button"
                onClick={() => setTags(!tagsOn)}
                aria-pressed={tagsOn}
                className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-bold", tagsOn ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}
                data-ig-tags
              >
                <Hash className="h-3.5 w-3.5" /> Hashtags
              </button>
            </div>
            <textarea
              id="ig-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              maxLength={2200}
              className="block max-h-[34dvh] min-h-[132px] w-full resize-none rounded-2xl border border-border bg-background px-3.5 py-3 text-[16px] leading-snug outline-none focus:border-foreground/40"
              data-ig-caption
            />
            <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{caption.length} / 2,200</div>
          </div>

          {headsUp && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[12px] font-semibold leading-snug text-amber-800 dark:text-amber-300">{headsUp}</p>}

          <div className="space-y-2">
            <button
              type="button"
              onClick={share}
              disabled={!ready || busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(90deg,#f58529,#dd2a7b_45%,#8134af)] text-[15px] font-black text-white shadow-sm transition-opacity active:scale-[0.99] disabled:opacity-50"
              data-ig-share
            >
              {!ready && !failed ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Getting it ready…
                </>
              ) : copiedOnce ? (
                <>
                  <Check className="h-4 w-4" /> Caption copied · Share
                </>
              ) : touch ? (
                <>
                  <Instagram className="h-4 w-4" /> Copy caption & share
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Copy caption & save
                </>
              )}
            </button>
            <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={copyOnly} className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold text-muted-foreground hover:bg-muted" data-ig-copy>
                <Copy className="h-4 w-4" /> Copy caption
              </button>
              {touch && ready && (
                <button
                  type="button"
                  onClick={() => {
                    const n = files.length;
                    if (n) {
                      // the share sheet has Save Image; a phone's download opens a preview instead
                      void sendToInstagram(files, null).then(({ outcome }) => outcome === "again" && toast.message("Tap Save once more."));
                    }
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold text-muted-foreground hover:bg-muted"
                  data-ig-save
                >
                  <Download className="h-4 w-4" /> Save
                </button>
              )}
            </div>
            {count > 1 && touch && <p className="text-center text-[11px] leading-snug text-muted-foreground">{count} files. If Instagram isn't in the share list, tap Save {count} items and pick them in Instagram.</p>}
          </div>
        </div>

        {/* a lesson's diagram / Saturday's scene, drawn (never shown) to be copied onto the card */}
        {open && drawing && (
          <div ref={setArtHost} hidden aria-hidden>
            {drawing}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
