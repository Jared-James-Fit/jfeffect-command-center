import { Section, SectionTitle } from "./sales-page-shell";
import img1 from "@/assets/transformations/1.png.asset.json";
import img2 from "@/assets/transformations/2.png.asset.json";
import img15 from "@/assets/transformations/15.png.asset.json";
import img18 from "@/assets/transformations/18.png.asset.json";
import img22 from "@/assets/transformations/22.png.asset.json";
import img23 from "@/assets/transformations/23.png.asset.json";
import img31 from "@/assets/transformations/31.png.asset.json";
import img35 from "@/assets/transformations/35.png.asset.json";
import img38 from "@/assets/transformations/38.png.asset.json";
import img102 from "@/assets/transformations/102.png.asset.json";

const PHOTOS = [img1, img2, img18, img22, img23, img31, img35, img38, img15, img102];

export function TransformationsGallery({
  eyebrow = "Transformations",
  title = "Real clients. Real transformations.",
}: {
  eyebrow?: string;
  title?: string;
}) {
  return (
    <Section>
      <SectionTitle eyebrow={eyebrow} title={title} />
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-2 sm:grid-cols-3 md:gap-3 lg:grid-cols-5">
        {PHOTOS.map((p, idx) => (
          <img
            key={idx}
            src={p.url}
            alt="Client transformation — before and after"
            loading="lazy"
            decoding="async"
            className="aspect-square w-full rounded-lg object-cover ring-1 ring-white/5"
          />
        ))}
      </div>
    </Section>
  );
}