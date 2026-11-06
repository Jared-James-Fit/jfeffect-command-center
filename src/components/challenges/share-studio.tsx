import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Link2, Loader2, Share2, Swords } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CARD_SIZES,
  STYLE_LABEL,
  loadCardImage,
  previewResultCard,
  renderResultCard,
  type CardFormat,
  type CardKind,
  type CardStyle,
  type ResultCardData,
} from "@/lib/challenges/cards";
import { challengeUrl, mediaUrl, resultUrl, shortLink, track } from "@/lib/challenges/api";
import {
  clockTime,
  eventWhen,
  firstName,
  formatScore,
  scoreUnit,
  scoreValue,
  shareCaption,
  type EntryPublic,
} from "@/lib/challenges/model";

const CTAS_SCORED = ["Can you beat me?", "Your turn.", "Come try it."];
const CTAS_INVITE = ["Think you can beat me?", "Come watch.", "Your turn."];

function cardKind(e: EntryPublic): CardKind {
  if (e.score == null) return "invite";
  const rank = rankFor(e);
  if (!e.challenge.final) return "live";
  if (rank === 1) return "winner";
  if (rank != null && rank <= 3) return "podium";
  return "result";
}

/** On a board split by load, a result is its division's. */
function rankFor(e: EntryPublic) {
  return e.challenge.separate_divisions ? e.rank_div : e.rank;
}
function tiedFor(e: EntryPublic) {
  return !!(e.challenge.separate_divisions ? e.tied_div : e.tied);
}
function ofFor(e: EntryPublic) {
  return e.challenge.separate_divisions ? e.of_div : e.of;
}

export function ShareStudio({ entry }: { entry: EntryPublic }) {
  const c = entry.challenge;
  const kind = cardKind(entry);
  const [format, setFormat] = useState<CardFormat>("story");
  const [style, setStyle] = useState<CardStyle>(entry.photo ? "spotlight" : "championship");
  const ctas = kind === "invite" ? CTAS_INVITE : CTAS_SCORED;
  const [cta, setCta] = useState(ctas[0]!);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [painting, setPainting] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const division = c.divisions.find((d) => d.id === entry.division_id)?.name ?? null;
  const pageUrl = challengeUrl(c.slug);
  const myResultUrl = resultUrl(c.slug, entry.code);
  const friendUrl = challengeUrl(c.slug, { ref: entry.code });

  useEffect(() => {
    let off = false;
    void loadCardImage(mediaUrl(entry.photo)).then((img) => !off && setPhoto(img));
    return () => {
      off = true;
    };
  }, [entry.photo]);

  const data: ResultCardData = useMemo(() => {
    const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
    const statusLine =
      kind === "invite"
        ? [eventWhen(c.starts_at, c.timezone)?.split(" · ")[0], c.city?.split(",")[0]]
            .filter(Boolean)
            .join(" · ") || "I'M IN"
        : kind === "live"
          ? `LIVE · ${clockTime(new Date().toISOString(), c.timezone)}`
          : "FINAL RESULT";
    return {
      kind,
      style: style === "spotlight" && !photo ? "championship" : style,
      format,
      eventTitle: c.title,
      eventLine: [c.activity, c.load_label].filter(Boolean).join(" · ") || null,
      athlete: entry.name,
      photo,
      scoreBig: entry.score == null ? null : scoreValue(entry.score, shape),
      scoreUnit:
        entry.score == null || (c.measure === "time" && Number(entry.score) >= 60)
          ? null
          : scoreUnit(entry.score, shape),
      rank: rankFor(entry),
      tied: tiedFor(entry),
      of: ofFor(entry),
      division,
      statusLine,
      cta,
      link: shortLink(pageUrl),
      qr: kind === "invite" ? pageUrl : myResultUrl,
      sponsor: c.sponsors?.[0]?.name ?? null,
    };
  }, [c, entry, kind, style, format, photo, cta, division, pageUrl, myResultUrl]);

  // paint the preview, then keep the file ready so Share works inside the tap
  useEffect(() => {
    let off = false;
    setPainting(true);
    setFile(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    void previewResultCard(canvas, data).then(async () => {
      const blob = await renderResultCard(data);
      if (off) return;
      setFile(
        blob
          ? new File([blob], `${c.slug}-${firstName(entry.name).toLowerCase()}-${format}.png`, {
              type: "image/png",
            })
          : null,
      );
      setPainting(false);
    });
    return () => {
      off = true;
    };
  }, [data, c.slug, entry.name, format]);

  const caption = shareCaption(
    {
      name: entry.name,
      score: entry.score,
      rank: rankFor(entry),
      tied: tiedFor(entry),
      of: ofFor(entry),
    },
    c,
    kind === "invite" ? pageUrl : friendUrl,
  );

  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    track("download", { slug: c.slug, code: entry.code });
  };

  const share = () => {
    if (!file) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const payload: ShareData = { files: [file], text: caption };
    if (typeof nav.share === "function" && (!nav.canShare || nav.canShare(payload))) {
      // called straight from the tap: iPhones only open the sheet from the tap itself
      nav.share(payload).then(
        () => track("share", { slug: c.slug, code: entry.code }),
        (e: unknown) => {
          if ((e as { name?: string })?.name !== "AbortError") download();
        },
      );
      return;
    }
    download();
    toast("Saved the picture. Post it from your photos.");
  };

  const copy = async (text: string, what: "link" | "caption" | "friend") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
      track(what === "caption" ? "copy_caption" : "copy_link", { slug: c.slug, code: entry.code });
    } catch {
      toast.error("Couldn't copy. Press and hold to copy instead.");
    }
  };

  const challengeFriend = () => {
    const text =
      entry.score == null
        ? `I'm doing the ${c.title}. You in? ${friendUrl}`
        : `I did ${formatScore(entry.score, c)} at the ${c.title}. Think you can beat it? ${friendUrl}`;
    const nav = navigator as Navigator;
    if (typeof nav.share === "function") {
      nav.share({ text, url: friendUrl }).then(
        () => track("share", { slug: c.slug, code: entry.code }),
        () => undefined,
      );
      return;
    }
    void copy(text, "friend");
  };

  const sz = CARD_SIZES[format];
  const styles: CardStyle[] = entry.photo
    ? ["spotlight", "championship", "scoreboard", "light"]
    : ["championship", "scoreboard", "light"];

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Card shape">
        {(Object.keys(CARD_SIZES) as CardFormat[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={format === f}
            onClick={() => setFormat(f)}
            className={cn(
              "h-10 flex-1 rounded-lg text-sm font-medium",
              format === f ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            {CARD_SIZES[f].label} <span className="text-xs opacity-60">{CARD_SIZES[f].hint}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <div className="relative w-full" style={{ maxWidth: format === "story" ? 300 : 380 }}>
          <canvas
            ref={canvasRef}
            width={sz.w}
            height={sz.h}
            className="h-auto w-full rounded-2xl border border-border bg-muted"
            style={{ aspectRatio: `${sz.w} / ${sz.h}` }}
            aria-label="Your result card"
          />
          {painting ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Card look">
        {styles.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStyle(s)}
            className={cn(
              "h-10 shrink-0 rounded-full px-4 text-sm font-medium",
              style === s ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
            )}
          >
            {STYLE_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Line on the card">
        {ctas.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setCta(t)}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3 text-sm",
              cta === t ? "border-foreground" : "border-border text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {kind === "live" ? (
        <p className="text-xs text-muted-foreground">
          The event is still going, so the card says LIVE with the time. Your place can still change
          until results are final.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button className="h-12 text-base" onClick={share} disabled={!file}>
          <Share2 className="mr-2 h-4 w-4" /> Share
        </Button>
        <Button variant="outline" className="h-12 text-base" onClick={download} disabled={!file}>
          <Download className="mr-2 h-4 w-4" /> Save image
        </Button>
        <Button
          variant="outline"
          className="h-11"
          onClick={() => void copy(kind === "invite" ? pageUrl : myResultUrl, "link")}
        >
          {copied === "link" ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" />
          )}{" "}
          Copy link
        </Button>
        <Button variant="outline" className="h-11" onClick={() => void copy(caption, "caption")}>
          {copied === "caption" ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}{" "}
          Copy caption
        </Button>
      </div>
      <Button variant="secondary" className="h-12 w-full text-base" onClick={challengeFriend}>
        {copied === "friend" ? (
          <Check className="mr-2 h-4 w-4" />
        ) : (
          <Swords className="mr-2 h-4 w-4" />
        )}{" "}
        Challenge a friend
      </Button>
      <p className="text-xs text-muted-foreground">
        For an Instagram story: Share, then Instagram (or Save image and add it from your photos).
        Instagram drops shared text, so Copy caption first.
      </p>
    </div>
  );
}
