import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, FileText, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadFiles, saveFiles } from "@/lib/file-share";
import { listCoachingPackages } from "@/lib/coaching-packages/packages.functions";
import { SITE, pricingText, shareLink, toPublic, type PublicPackage } from "@/lib/coaching-packages/packages";
import {
  CARD_SIZES,
  canvasPdf,
  canvasPng,
  cardFileName,
  loadLogo,
  paintPricingCard,
  type CardFormat,
  type CardLayout,
} from "@/lib/coaching-packages/pricing-card";

/**
 * Pricing cards to send: pick the packages, a size and one package or a
 * comparison, and the preview is the exact image that's shared or saved
 * (painted once, handed to the share sheet inside the tap). A package that
 * isn't active is stamped DRAFT and can't be shared from here.
 */
export function ShareCards({ initialSlugs }: { initialSlugs: string[] | null }) {
  const list = useServerFn(listCoachingPackages);
  const q = useQuery({ queryKey: ["coaching-packages-admin"], queryFn: () => list() });
  const all = useMemo(() => (q.data?.packages ?? []).filter((p) => p.status !== "archived"), [q.data]);
  const [format, setFormat] = useState<CardFormat>("post");
  const [layout, setLayout] = useState<CardLayout>("single");
  const [picked, setPicked] = useState<string[] | null>(initialSlugs);
  useEffect(() => {
    if (initialSlugs) setPicked(initialSlugs);
  }, [initialSlugs]);

  // Start on what's on the site (the recommended one first for a single card).
  const defaults = useMemo(() => {
    const live = all.filter((p) => p.status === "active" && p.is_public && p.kind !== "free");
    const rec = live.find((p) => p.recommended) ?? live[0];
    return layout === "single" ? (rec ? [rec.slug] : []) : live.map((p) => p.slug);
  }, [all, layout]);
  const slugs = picked ?? defaults;
  const chosen = all.filter((p) => slugs.includes(p.slug));
  const pkgs: PublicPackage[] = (layout === "single" ? chosen.slice(0, 1) : chosen).map(toPublic);
  const draft = chosen.some((p) => p.status !== "active");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [png, setPng] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const key = JSON.stringify([format, layout, pkgs, draft]);
  useEffect(() => {
    if (!pkgs.length) {
      setUrl(null);
      setPng(null);
      setPdf(null);
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    void (async () => {
      const logo = await loadLogo();
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      paintPricingCard(canvas, { format, layout, packages: pkgs, draft, logo });
      const file = await canvasPng(canvas, cardFileName(pkgs, layout, format, "png"));
      if (cancelled) return;
      made = URL.createObjectURL(file);
      setUrl(made);
      setPng(file);
      setPdf(null);
      const p = await canvasPdf(canvas, cardFileName(pkgs, layout, format, "pdf")).catch(() => null);
      if (!cancelled) setPdf(p);
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const share = async (file: File | null) => {
    if (!file) return;
    const out = await saveFiles([file]);
    if (out === "again") toast("Tap once more to share it.");
    else if (out === "failed") toast.error("Couldn't share it. Try Save image.");
    else if (out === "saved") toast.success("Saved");
  };
  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.error("Couldn't copy"),
    );

  const toggle = (slug: string) => {
    if (layout === "single") return setPicked([slug]);
    setPicked(slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug].slice(0, 4));
  };

  if (q.isLoading) return <div className="h-60 animate-pulse rounded-2xl bg-muted" />;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]" data-share-cards>
      <div className="space-y-5">
        <Choice
          label="Card"
          value={layout}
          options={[
            ["single", "One package"],
            ["compare", "Compare packages"],
          ]}
          onChange={(v) => {
            setLayout(v as CardLayout);
            setPicked(null);
          }}
        />
        <Choice
          label="Size"
          value={format}
          options={(Object.keys(CARD_SIZES) as CardFormat[]).map((f) => [f, CARD_SIZES[f].label])}
          onChange={(v) => setFormat(v as CardFormat)}
        />
        <div>
          <p className="text-[14px] font-medium">{layout === "single" ? "Package" : "Packages (up to 4)"}</p>
          <ul className="mt-2 space-y-1.5">
            {all.map((p) => {
              const on = slugs.includes(p.slug);
              const live = p.status === "active" && p.is_public;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.slug)}
                    aria-pressed={on}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-[15px] ring-1",
                      on ? "bg-foreground text-background ring-foreground" : "bg-background ring-border",
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className={cn("ml-3 shrink-0 text-[12px]", on ? "text-background/70" : "text-muted-foreground")}>
                      {live ? "On the site" : p.status === "active" ? "Unlisted" : "Draft"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="space-y-3 md:sticky md:top-4 md:self-start">
        <div
          className="overflow-hidden rounded-2xl bg-muted ring-1 ring-border"
          style={{ aspectRatio: `${CARD_SIZES[format].w} / ${CARD_SIZES[format].h}` }}
        >
          {url ? (
            <img src={url} alt="The pricing card as it will be shared" className="h-full w-full object-contain" data-card-preview />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-[14px] text-muted-foreground">Pick a package.</div>
          )}
        </div>
        {draft && (
          <p className="text-[13px] text-warning-foreground dark:text-warning" data-card-draft>
            A package here isn't active yet, so the card is stamped DRAFT and can't be shared.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void share(png)} disabled={!png || draft} data-card-share>
            <Share2 className="mr-1.5 h-4 w-4" /> Share
          </Button>
          <Button variant="outline" onClick={() => png && downloadFiles([png])} disabled={!png || draft}>
            <Download className="mr-1.5 h-4 w-4" /> Save image
          </Button>
          <Button variant="outline" onClick={() => void share(pdf)} disabled={!pdf || draft}>
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
          <Button
            variant="outline"
            disabled={!pkgs.length || draft}
            onClick={() => void copy(pricingText(pkgs, { from: "dm" }), "Pricing copied")}
          >
            <Copy className="mr-1.5 h-4 w-4" /> Copy text
          </Button>
        </div>
        <Button
          variant="ghost"
          className="w-full"
          disabled={!pkgs.length || draft}
          onClick={() =>
            void copy(
              layout === "single" && pkgs[0] ? shareLink(pkgs[0], "dm") : `${SITE}/coaching#pricing`,
              "Link copied",
            )
          }
        >
          <Link2 className="mr-1.5 h-4 w-4" /> Copy {layout === "single" ? "application" : "pricing page"} link
        </Button>
      </div>
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[14px] font-medium">{label}</p>
      <div className="mt-2 inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "h-9 rounded-md px-3 text-[14px] font-medium",
              value === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
