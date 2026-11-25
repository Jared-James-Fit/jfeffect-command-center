/** Browser entry for the post-design harness (scripts/post-design/screens.cjs). */
import { paintInstagramCard } from "@/lib/instagram-cards";
import { instagramPlan } from "@/lib/instagram-export";
import { FIXTURES } from "./fixtures";
import { lastPaintReport } from "@/lib/post-design-paint";
import { reportProblems } from "@/lib/post-design";

declare global {
  interface Window {
    __paintAll: () => Promise<{ label: string; slides: string[]; problems: string[] }[]>;
  }
}

window.__paintAll = async () => {
  const out: { label: string; slides: string[]; problems: string[] }[] = [];
  for (const f of FIXTURES) {
    const plan = instagramPlan(f.post);
    const n = (plan as { cards?: number }).cards ?? 1;
    const slides: string[] = [];
    const problems: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      await paintInstagramCard(c, { card: plan.card!, format: "feed", post: f.post, unit: "lb", slide: i });
      slides.push(c.toDataURL("image/jpeg", 0.9));
      const r = lastPaintReport();
      if (r) problems.push(...reportProblems(r).map((p) => `slide ${i}: ${p}`));
    }
    out.push({ label: f.label, slides, problems });
  }
  return out;
};
