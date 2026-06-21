import { Section } from "./sales-page-shell";
import { Button } from "@/components/ui/button";
import img1 from "@/assets/transformations/1.png.asset.json";
import img2 from "@/assets/transformations/2.png.asset.json";
import img15 from "@/assets/transformations/15.png.asset.json";
import img16 from "@/assets/transformations/16.png.asset.json";
import img18 from "@/assets/transformations/18.png.asset.json";
import img21 from "@/assets/transformations/21.png.asset.json";
import img22 from "@/assets/transformations/22.png.asset.json";
import img23 from "@/assets/transformations/23.png.asset.json";
import img26 from "@/assets/transformations/26.png.asset.json";
import img31 from "@/assets/transformations/31.png.asset.json";
import img35 from "@/assets/transformations/35.png.asset.json";
import img38 from "@/assets/transformations/38.png.asset.json";
import img42 from "@/assets/transformations/42.png.asset.json";
import img44 from "@/assets/transformations/44.png.asset.json";
import img48 from "@/assets/transformations/48.png.asset.json";
import img53 from "@/assets/transformations/53.png.asset.json";
import img71 from "@/assets/transformations/71.png.asset.json";
import img98 from "@/assets/transformations/98.png.asset.json";
import img102 from "@/assets/transformations/102.png.asset.json";
import img108 from "@/assets/transformations/108.png.asset.json";

const PHOTOS = [
  img1, img2, img15, img16, img18, img21, img22, img23, img26, img31,
  img35, img38, img42, img44, img48, img53, img71, img98, img102, img108,
];

export function TransformationsStrip({
  eyebrow = "REAL RESULTS",
  headline = "100+ clients coached. Real transformations.",
  sub = "Members and 1:1 clients who showed up and did the work.",
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

        {/* Mobile-first: 2-col grid, 3-col on sm, 4-col on lg. Lazy-loaded, fixed aspect to prevent CLS. */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {PHOTOS.map((p, idx) => (
            <img
              key={idx}
              src={p.url}
              alt="Client transformation — before and after"
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
              className="aspect-square w-full rounded-lg object-cover ring-1 ring-white/5"
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