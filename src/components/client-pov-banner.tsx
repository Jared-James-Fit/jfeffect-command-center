import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightLeft, Eye, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * A thin red frame around the whole screen while a coach/admin is viewing as a client, so
 * it's obvious at a glance you are NOT in your own account. Pure overlay: it never blocks taps
 * or changes layout.
 */
export function PovFrame() {
  const { isImpersonating, client } = useClientImpersonation();
  if (!isImpersonating || !client) return null;
  return (
    <div
      aria-hidden
      data-pov-frame
      className="pointer-events-none fixed inset-0 z-[70] rounded-[inherit]"
      style={{
        boxShadow:
          "inset 0 0 0 3px var(--destructive), inset 0 0 28px 2px color-mix(in oklab, var(--destructive) 22%, transparent)",
      }}
    />
  );
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ClientPovBanner() {
  const { client, isImpersonating, stop, returnTo } = useClientImpersonation();
  const navigate = useNavigate();
  // The banner sits where the app's top bars normally start (notch included),
  // so they start under it instead (--app-chrome-top / --app-safe-top in
  // styles.css): one bar under the banner, never a notch's worth of gap.
  const ref = useRef<HTMLDivElement | null>(null);
  const shown = isImpersonating && !!client;
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const set = () => root.style.setProperty("--pov-banner-h", `${el.getBoundingClientRect().height}px`);
    set();
    root.setAttribute("data-pov-banner-on", "");
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.removeAttribute("data-pov-banner-on");
      root.style.removeProperty("--pov-banner-h");
    };
  }, [shown]);
  if (!isImpersonating || !client) return null;

  const back = returnTo ?? `/admin/clients/${client.id}`;

  const exit = () => {
    const target = back;
    stop();
    navigate({ to: target });
  };

  const switchClient = () => {
    window.dispatchEvent(new CustomEvent("open-client-pov-picker"));
  };

  return (
    // data-pov-banner: it steps aside while the workout's Focus fills the screen (styles.css)
    <div
      ref={ref}
      data-pov-banner
      className="sticky top-0 z-50 w-full border-b border-destructive/40 bg-destructive/10 text-foreground backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-h-12 items-center gap-2 px-3 py-2 text-sm sm:px-4">
        <Eye className="h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">Viewing as {client.full_name ?? "client"}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-destructive">Client POV</div>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={switchClient}>
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span>Switch</span>
        </Button>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={exit}>
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Coach</span>
        </Button>
      </div>
    </div>
  );
}