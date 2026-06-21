import { Section } from "./sales-page-shell";
import { Button } from "@/components/ui/button";
import img1 from "@/assets/transformations/1.png.asset.json";
import img2 from "@/assets/transformations/2.png.asset.json";
import img15 from "@/assets/transformations/15.png.asset.json";
import img18 from "@/assets/transformations/18.png.asset.json";
import img22 from "@/assets/transformations/22.png.asset.json";
import img23 from "@/assets/transformations/23.png.asset.json";
import img31 from "@/assets/transformations/31.png.asset.json";
import img35 from "@/assets/transformations/35.png.asset.json";

const PHOTOS = [img1, img2, img15, img18, img22, img23, img31, img35];

export function TransformationsStrip({
  eyebrow = "Real results",
  headline = "100+ lives transformed",
  sub = "Real members, real progress — no filters, no shortcuts.",
  ctaLabel,
  ctaHref,
  onCta,
}: {
  eyebrow?: string;
  headline?: string;
  sub?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}) {
  return (
    <Section className="py-10 md:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              {eyebrow}
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">
              {headline}
            </h2>
            {sub ? (
              <p className="mt-1 text-sm text-muted-foreground md:text-base">{sub}</p>
            ) : null}
          </div>
        </div>

        {/* Mobile: horizontal scroll-snap carousel. Desktop: 4-col grid. */}
        <div
          className="mt-5 -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0 md:pb-0"
          style={{ scrollbarWidth: "none" }}
        >
          {PHOTOS.map((p, idx) => (
            <img
              key={idx}
              src={p.url}
              alt="Client transformation — before and after"
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
              className="aspect-square w-[68vw] max-w-[280px] shrink-0 snap-start rounded-lg object-cover ring-1 ring-white/5 md:w-full md:max-w-none"
            />
          ))}
        </div>

        {(ctaLabel && (ctaHref || onCta)) ? (
          <div className="mt-6 flex justify-center">
            {ctaHref ? (
              <a href={ctaHref}>
                <Button size="lg" className="h-12 px-6 text-base font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150">
                  {ctaLabel}
                </Button>
              </a>
            ) : (
              <Button onClick={onCta} size="lg" className="h-12 px-6 text-base font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150">
                {ctaLabel}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Section>
  );
}