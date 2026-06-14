import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StickyMobileCta({ label, onClick, href, disabled, paused }: { label: string; onClick?: () => void; href?: string; disabled?: boolean; paused?: boolean }) {
  // Only reveal the sticky CTA once the visitor has scrolled past the hero /
  // primary inline CTA, then keep it visible until they're near the footer.
  // This avoids the bar covering content the moment the page loads.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const compute = () => {
      const vh = window.innerHeight || 800;
      const y = window.scrollY || window.pageYOffset || 0;
      const doc = document.documentElement;
      const distanceFromBottom = doc.scrollHeight - (y + vh);
      // Reveal once the user has scrolled past ~85% of the first viewport,
      // hide again when they're within ~140px of the bottom (footer / CTA section).
      setVisible(y > vh * 0.85 && distanceFromBottom > 140);
    };
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, []);
  const inner = (
    <Button
      size="lg"
      onClick={onClick}
      disabled={disabled}
      variant={paused ? "secondary" : "default"}
      className={cn(
        "h-12 w-full text-base font-bold",
        paused ? "opacity-90" : "shadow-2xl shadow-primary/30",
      )}
    >
      {label}
    </Button>
  );
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur transition-all duration-300 md:hidden",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0",
      )}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {href ? <a href={href}>{inner}</a> : inner}
    </div>
  );
}