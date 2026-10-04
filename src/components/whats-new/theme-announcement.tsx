/**
 * One-time "What's new" popup introducing the light/dark mode toggle.
 *
 * - Animated demo: a mini app flips between light and dark on a loop while a
 *   toggle springs across, plus the real toggle so people can try it live.
 * - Closable via Got it, the X, tapping outside or Escape — any close marks it
 *   seen server-side (feature_announcement_views), so it never replays on
 *   another device. After closing, the real header toggle pulses briefly so
 *   people know where to find it.
 * - Waits politely: never stacks on top of another open dialog/popup.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Sparkles, Sun, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const THEME_FEATURE_KEY = "theme_toggle_2026_10";
export const THEME_TOGGLE_HIGHLIGHT_EVENT = "jf-theme-toggle-highlight";

const db = supabase as any;

export function ThemeAnnouncementGate() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  const { data: seen } = useQuery({
    queryKey: ["feature-announcement", THEME_FEATURE_KEY, userId],
    enabled: !!userId,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await db
        .from("feature_announcement_views")
        .select("feature_key")
        .eq("user_id", userId)
        .eq("feature_key", THEME_FEATURE_KEY)
        .maybeSingle();
      // If the check fails, err on the side of not nagging.
      if (error) return true;
      return !!data;
    },
  });

  // Show once the app has settled and no other popup is on screen.
  useEffect(() => {
    if (!userId || seen !== false || closed || open) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      const busy = document.querySelector('[role="dialog"], [role="alertdialog"], [data-vaul-drawer]');
      if (!busy) {
        setOpen(true);
        window.clearInterval(id);
      } else if (tries > 40) {
        window.clearInterval(id); // try again next visit
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [userId, seen, closed, open]);

  const close = () => {
    setOpen(false);
    setClosed(true);
    if (userId) {
      qc.setQueryData(["feature-announcement", THEME_FEATURE_KEY, userId], true);
      void db.from("feature_announcement_views").upsert(
        { user_id: userId, feature_key: THEME_FEATURE_KEY },
        { onConflict: "user_id,feature_key", ignoreDuplicates: true },
      );
    }
    // Point at the real button once the dialog has animated away.
    window.setTimeout(() => window.dispatchEvent(new Event(THEME_TOGGLE_HIGHLIGHT_EVENT)), 350);
  };

  return <ThemeAnnouncementDialog open={open} onClose={close} />;
}

export function ThemeAnnouncementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showBackButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-w-[22rem] gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-2xl outline-none focus:outline-none focus-visible:outline-none sm:max-w-sm"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40 active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>

        <ThemeDemo />

        <div className="space-y-4 px-6 pb-6 pt-5 text-center">
          <div className="jf-wn-rise space-y-1.5" style={{ animationDelay: "120ms" }}>
            <div className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> New
            </div>
            <DialogTitle className="text-xl font-black tracking-tight">Dark mode is here</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
              Tap the <span className="font-semibold text-foreground">sun / moon switch</span> at the top of the
              screen to flip the whole app between light and dark — easier on the eyes for late-night logging.
              Your choice is saved on this device.
            </DialogDescription>
          </div>

          <div
            className="jf-wn-rise flex items-center justify-between rounded-2xl border border-border bg-secondary/40 px-4 py-3"
            style={{ animationDelay: "220ms" }}
          >
            <span className="text-sm font-semibold">Try it now</span>
            <ThemeToggle />
          </div>

          <Button
            className="jf-wn-rise h-11 w-full rounded-2xl text-[15px] font-bold"
            style={{ animationDelay: "300ms" }}
            onClick={onClose}
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Looping animation: a mini app flipping light ⇄ dark with its switch. */
function ThemeDemo() {
  const [dark, setDark] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    timer.current = window.setInterval(() => setDark((d) => !d), 1800);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  return (
    <div
      className={cn(
        "relative flex h-48 items-end justify-center overflow-hidden transition-colors duration-700 ease-out",
        dark ? "bg-[#0d0d12]" : "bg-[#f3efe9]",
      )}
      aria-hidden
    >
      {/* Sky: sun sets, moon + stars rise */}
      <Sun
        className={cn(
          "absolute left-7 top-6 h-9 w-9 fill-amber-300 text-amber-400 transition-all duration-700 ease-out",
          dark ? "translate-y-10 rotate-90 opacity-0" : "translate-y-0 rotate-0 opacity-100",
        )}
      />
      <Moon
        className={cn(
          "absolute right-14 top-6 h-8 w-8 fill-indigo-100 text-indigo-100 transition-all duration-700 ease-out",
          dark ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0",
        )}
      />
      {[["18%", "22%"], ["30%", "12%"], ["64%", "18%"], ["78%", "34%"], ["46%", "8%"]].map(([l, t], i) => (
        <span
          key={i}
          className={cn("absolute h-1 w-1 rounded-full bg-white transition-opacity duration-700", dark ? "opacity-80" : "opacity-0")}
          style={{ left: l, top: t, transitionDelay: `${i * 80}ms` }}
        />
      ))}

      {/* Mini phone */}
      <div
        className={cn(
          "jf-wn-float relative w-52 rounded-t-[1.6rem] border-x-[5px] border-t-[5px] px-3 pb-3 pt-2.5 shadow-2xl transition-colors duration-700",
          dark ? "border-[#2a2a33] bg-[#16161c]" : "border-[#d9d4cc] bg-[#fbfaf8]",
        )}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-4 w-4 rounded-[5px] bg-primary" />
            <span className={cn("h-1.5 w-12 rounded-full transition-colors duration-700", dark ? "bg-white/70" : "bg-black/70")} />
          </div>
          {/* Demo switch */}
          <span
            className={cn(
              "relative flex h-[18px] w-[30px] items-center rounded-full p-[2px] ring-2 ring-primary/70 ring-offset-1 transition-colors duration-500",
              dark ? "bg-[#3a3a52] ring-offset-[#16161c]" : "bg-[#e5e1db] ring-offset-[#fbfaf8]",
            )}
          >
            <span
              className={cn(
                "grid h-[14px] w-[14px] place-items-center rounded-full shadow transition-all duration-500 ease-[cubic-bezier(0.34,1.45,0.55,1)]",
                dark ? "translate-x-3 bg-[#22222c]" : "translate-x-0 bg-white",
              )}
            >
              {dark
                ? <Moon className="h-2 w-2 fill-indigo-100 text-indigo-100" />
                : <Sun className="h-2 w-2 fill-amber-400 text-amber-500" />}
            </span>
          </span>
        </div>
        {[0, 1].map((i) => (
          <div
            key={i}
            className={cn("mb-2 rounded-xl p-2.5 transition-colors duration-700", dark ? "bg-[#202028]" : "bg-white shadow-sm")}
          >
            <span className={cn("mb-1.5 block h-1.5 w-16 rounded-full transition-colors duration-700", dark ? "bg-white/60" : "bg-black/60")} />
            <span className={cn("block h-1.5 w-24 rounded-full transition-colors duration-700", dark ? "bg-white/20" : "bg-black/15")} />
            {i === 0 && <span className="mt-2 block h-4 w-full rounded-md bg-primary" />}
          </div>
        ))}
        {/* Tap hint */}
        <span className="jf-wn-tap pointer-events-none absolute right-2.5 top-1 h-7 w-7 rounded-full border-2 border-primary/70" />
      </div>
    </div>
  );
}
