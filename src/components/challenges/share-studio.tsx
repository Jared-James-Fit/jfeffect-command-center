// Preview, pick and share a result card. The file for what's on screen is
// painted ahead of the tap, so the phone's share sheet opens inside the tap
// itself (iOS refuses a share started after an await).
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Link2, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { canShareFiles, downloadFiles, isTouchDevice } from "@/lib/file-share";
import { track } from "@/lib/challenges/api";
import type { CardInput } from "@/lib/challenges/share";
import { CARD_FORMATS, CARD_STYLES, canvasToFile, cardFileName, paintChallengeCard, type CardFormat, type CardStyle } from "@/lib/challenges/share-card";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
            value === o.value ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-secondary",
          )}
        >
          {o.label}
          {o.hint && <span className={cn("text-xs font-medium", value === o.value ? "text-background/70" : "text-muted-foreground")}>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function ShareStudio({
  build,
  headlines,
  caption,
  link,
  slug,
  handle,
  fileWho,
  defaultStyle = "championship",
}: {
  /** The card for a headline (the person picks one of `headlines`). */
  build: (headline: string) => CardInput;
  headlines: string[];
  caption: string;
  link: string;
  slug: string;
  handle?: string | null;
  fileWho?: string | null;
  defaultStyle?: CardStyle;
}) {
  const [format, setFormat] = useState<CardFormat>("story");
  const [style, setStyle] = useState<CardStyle>(defaultStyle);
  const [headline, setHeadline] = useState(headlines[0] ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState<"caption" | "link" | null>(null);
  const job = useRef(0);

  useEffect(() => {
    if (!headlines.includes(headline)) setHeadline(headlines[0] ?? "");
  }, [headlines, headline]);

  const input = useMemo(() => build(headline), [build, headline]);
  const key = `${format}|${style}|${JSON.stringify(input)}`;

  useEffect(() => {
    let alive = true;
    const id = ++job.current;
    setBusy(true);
    setFile(null);
    (async () => {
      try {
        const canvas = await paintChallengeCard(input, format, style);
        const f = await canvasToFile(canvas, cardFileName(slug, fileWho, format));
        if (!alive || id !== job.current) return;
        const url = URL.createObjectURL(f);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setFile(f);
      } catch {
        if (alive) toast.error("Couldn't draw the card. Try another look.");
      } finally {
        if (alive && id === job.current) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canShare = !!file && isTouchDevice() && canShareFiles([file]);

  function share() {
    if (!file) return;
    // caption to the clipboard and the sheet open, both inside the tap
    const copying = copyText(caption);
    track(slug, "share_sheet", { handle });
    navigator
      .share({ files: [file] })
      .then(() => undefined)
      .catch((e: { name?: string }) => {
        if (e?.name === "NotAllowedError") toast("Tap Share once more to open the share sheet.");
      });
    void copying.then((ok) => ok && toast.success("Caption copied: paste it under your post."));
  }

  function download() {
    if (!file) return;
    track(slug, "card_download", { handle });
    downloadFiles([file]);
    void copyText(caption).then((ok) => ok && toast.success("Saved. Caption copied too."));
  }

  async function copy(what: "caption" | "link") {
    const ok = await copyText(what === "caption" ? caption : link);
    if (ok) {
      track(slug, what === "caption" ? "copy_caption" : "copy_link", { handle });
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } else toast.error("Couldn't copy. Press and hold to copy instead.");
  }

  const aspect = format === "story" ? "9 / 16" : format === "portrait" ? "4 / 5" : "1 / 1";

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-[300px]">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-muted" style={{ aspectRatio: aspect }}>
          {preview && <img src={preview} alt="Your result card" className={cn("h-full w-full object-cover transition-opacity", busy && "opacity-60")} />}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Chips label="Size" value={format} options={CARD_FORMATS} onChange={setFormat} />
        <Chips label="Look" value={style} options={CARD_STYLES} onChange={setStyle} />
        {headlines.length > 1 && (
          <Chips label="Headline" value={headline} options={headlines.map((h) => ({ value: h, label: h.charAt(0) + h.slice(1).toLowerCase() }))} onChange={setHeadline} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {canShare ? (
          <button
            type="button"
            onClick={share}
            disabled={!file}
            className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" /> Share card
          </button>
        ) : null}
        <button
          type="button"
          onClick={download}
          disabled={!file}
          className={cn(
            "flex h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-semibold disabled:opacity-50",
            canShare ? "border border-border bg-background" : "col-span-2 bg-primary text-primary-foreground",
          )}
        >
          <Download className="h-4 w-4" /> {canShare ? "Save" : "Download card"}
        </button>
        <button type="button" onClick={() => copy("caption")} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background text-[15px] font-semibold">
          {copied === "caption" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />} Caption
        </button>
        <button
          type="button"
          onClick={() => copy("link")}
          className={cn("flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background text-[15px] font-semibold", !canShare && "col-span-2")}
        >
          {copied === "link" ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />} Copy link
        </button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Instagram doesn't take a caption from other apps, so it's copied for you to paste.
      </p>
    </div>
  );
}
