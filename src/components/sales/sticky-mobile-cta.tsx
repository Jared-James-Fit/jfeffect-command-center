import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stickyCtaChoice, stickyCtaState, type CtaChoice } from "@/lib/sticky-cta";

/**
 * The phone's bottom button on public pages. It shows once the visitor is
 * past the first half screen. With `hideWhenInline` it steps aside while one
 * of the page's own buttons (`data-inline-cta`) is on screen, and with
 * `zones` it becomes the section's own button while that section
 * (`data-cta-zone`) fills the middle of the screen (sticky-cta.ts).
 */
export function StickyMobileCta({
  label,
  onClick,
  href,
  disabled,
  paused,
  zones,
  hideWhenInline = false,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  paused?: boolean;
  zones?: Record<string, CtaChoice>;
  hideWhenInline?: boolean;
}) {
  const [state, setState] = useState<{ visible: boolean; zone: string | null }>({
    visible: false,
    zone: null,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const compute = () => {
      frame = 0;
      const vh = window.innerHeight || 800;
      const inlineVisible =
        hideWhenInline &&
        Array.from(document.querySelectorAll<HTMLElement>("[data-inline-cta]")).some((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.bottom > 0 && r.top < vh;
        });
      const zoneEls = zones
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-cta-zone]"))
        : [];
      const next = stickyCtaState({
        scrollY: window.scrollY || window.pageYOffset || 0,
        viewportHeight: vh,
        inlineVisible,
        zones: zoneEls.map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.dataset.ctaZone ?? "", top: r.top, bottom: r.bottom };
        }),
      });
      setState((prev) => (prev.visible === next.visible && prev.zone === next.zone ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [hideWhenInline, zones]);

  const choice = href ? stickyCtaChoice({ label, href }, zones, state.zone) : { label, href: "" };
  const visible = state.visible;
  const buttonClass = cn("h-12 w-full text-base font-bold", paused && "opacity-90");
  const internal = choice.href.startsWith("/");
  return (
    <div
      aria-hidden={!visible}
      data-sticky-cta={state.zone ?? "page"}
      className={cn(
        "phone-column fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-3 transition-all duration-300 md:hidden",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0",
      )}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {href ? (
        <Button
          asChild
          size="lg"
          variant={paused ? "secondary" : "default"}
          className={buttonClass}
        >
          {internal ? (
            <Link to={choice.href as any} tabIndex={visible ? undefined : -1}>
              {choice.label}
            </Link>
          ) : (
            <a href={choice.href} tabIndex={visible ? undefined : -1}>
              {choice.label}
            </a>
          )}
        </Button>
      ) : (
        <Button
          size="lg"
          onClick={onClick}
          disabled={disabled}
          variant={paused ? "secondary" : "default"}
          className={buttonClass}
          tabIndex={visible ? undefined : -1}
        >
          {label}
        </Button>
      )}
    </div>
  );
}
