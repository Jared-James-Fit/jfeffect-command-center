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

const photos = [
  img1, img2, img15, img16, img18, img21, img22, img23, img26, img31,
  img35, img38, img42, img44, img48, img53, img71, img98, img102, img108,
];

export function AboutTransformations() {
  return (
    <div>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {["Madison · 20 lb fat loss", "Kyrstin · 35 lb fat loss", "Shaina · 10+ lb muscle gained"].map((result) => (
          <div key={result} className="bg-card px-4 py-3 text-center text-sm font-bold">
            {result}
          </div>
        ))}
      </div>
      <div
        className="mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]"
        aria-label="Client transformation gallery"
      >
        {photos.map((photo, index) => (
          <img
            key={photo.asset_id}
            src={photo.url}
            alt={`JF Effect client transformation ${index + 1}`}
            loading="lazy"
            decoding="async"
            width={320}
            height={320}
            className="aspect-square w-[72vw] max-w-72 shrink-0 snap-start rounded-lg object-cover object-top sm:w-64" style={{ transform: "scale(1.18)" }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Swipe to view all 20 client transformations.</p>
    </div>
  );
}