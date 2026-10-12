/**
 * Cleo, everywhere in admin: a floating button with two targets you can see
 * (the bubble opens her chat to type; the mic badge on its corner opens her
 * already listening; holding the bubble also starts talking), ⌘/Ctrl+Shift+S, and window
 * events other screens use to open her ("summer:open", "summer:toggle",
 * "summer:close"; detail { year?, dictate? }).
 *
 * Admin only; mounted once in the admin layout.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSummerProfile } from "@/lib/business-books.functions";
import { summerSpeaker } from "@/lib/summer-speaker";
import { SummerChat } from "@/components/admin/books/summer-chat";

/** `dictate`: open straight into listening (the mic in Messages, a long-press on her button). */
const HINT_KEY = "cleo.fab.hint.v1";
const HINT_SHOWS = 3;

export type SummerOpenDetail = { year?: number; dictate?: boolean };

export function openSummer(detail: SummerOpenDetail = {}) {
  // Called from a tap: unlock audio now so her first spoken reply can autoplay.
  if (detail.dictate) summerSpeaker().unlock();
  try {
    window.dispatchEvent(new CustomEvent<SummerOpenDetail>("summer:open", { detail }));
  } catch {
    // SSR or very old browser
  }
}

/** Routes where a chat composer owns the bottom of the screen. */
function isChatRoute(pathname: string, search: Record<string, unknown> | undefined) {
  return pathname.startsWith("/admin/messages") || (pathname.startsWith("/admin/communication") && ((search?.tab as string) ?? "messages") === "messages");
}

export function SummerAssistant() {
  const qc = useQueryClient();
  const profileFn = useServerFn(getSummerProfile);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as Record<string, unknown> | undefined });
  const href = useRouterState({ select: (r) => r.location.href });
  const hash = useRouterState({ select: (r) => r.location.hash });
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [startDictating, setStartDictating] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const { data: persona } = useQuery({
    queryKey: ["summer-profile"],
    queryFn: () => profileFn() as Promise<{ tone: string | null; instructions: string | null; isOwner: boolean; isFinance?: boolean }>,
    staleTime: 5 * 60_000,
  });

  const show = useCallback((detail: SummerOpenDetail = {}) => {
    if (detail.year) setYear(detail.year);
    if (detail.dictate) setStartDictating(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<SummerOpenDetail>).detail ?? {});
    const onToggle = (e: Event) => {
      const d = (e as CustomEvent<SummerOpenDetail>).detail ?? {};
      setOpen((o) => {
        if (!o) {
          if (d.year) setYear(d.year);
          if (d.dictate) setStartDictating(true);
        }
        return !o;
      });
    };
    const onClose = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("summer:open", onOpen);
    window.addEventListener("summer:toggle", onToggle);
    window.addEventListener("summer:close", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("summer:open", onOpen);
      window.removeEventListener("summer:toggle", onToggle);
      window.removeEventListener("summer:close", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [show]);

  // "/admin#cleo" (Cleo's approval and decision pushes) opens her chat.
  useEffect(() => {
    if (hash !== "cleo" && hash !== "#cleo") return;
    setOpen(true);
    void qc.invalidateQueries({ queryKey: ["cleo-actions"] });
    try {
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
    } catch {
      // ignore
    }
  }, [hash, qc]);

  // Year from Taxes & Books applies while she's open from there; reset after.
  useEffect(() => {
    if (!open) setYear(undefined);
  }, [open]);

  const pressStart = () => {
    held.current = false;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      summerSpeaker().unlock(); // still inside the press, so her reply can autoplay
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
      show({ dictate: true });
    }, 450);
  };
  const pressEnd = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const click = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    summerSpeaker().unlock();
    setOpen((o) => !o);
  };

  const hideFab = open || isChatRoute(pathname, search);

  /** The mic badge: straight into talking, from this tap (so audio and her reply can play). */
  const talk = () => {
    summerSpeaker().unlock();
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    show({ dictate: true });
  };

  // "Tap to chat · mic to talk" under the button on the first few visits, then never again.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (hideFab) return;
    let seen = 0;
    try {
      seen = Number(window.localStorage.getItem(HINT_KEY) ?? 0) || 0;
      if (seen >= HINT_SHOWS) return;
      window.localStorage.setItem(HINT_KEY, String(seen + 1));
    } catch {
      return;
    }
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(t);
    // Once per page load is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {!hideFab && (
        <div className="summer-fab pointer-events-none fixed right-4 z-50 md:right-6">
          {hint && (
            <span className="pointer-events-none absolute bottom-full right-0 mb-3 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg animate-in fade-in slide-in-from-bottom-1">
              Tap to chat · <Mic className="inline h-3 w-3 -translate-y-px" /> to talk
            </span>
          )}
          <button
            type="button"
            data-summer-fab
            onClick={click}
            onPointerDown={pressStart}
            onPointerUp={pressEnd}
            onPointerLeave={pressEnd}
            onPointerCancel={pressEnd}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Chat with Cleo"
            title="Chat with Cleo (⌘⇧S)"
            className={cn(
              "pointer-events-auto flex h-12 w-12 select-none items-center justify-center rounded-full text-white",
              "bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] ring-1 ring-black/10",
              "transition-transform active:scale-95 [-webkit-touch-callout:none]",
            )}
          >
            <Sparkles className="h-5 w-5" />
          </button>
          {/* The talk badge sits on the bubble's top-left corner. Its tap area
              grows up and to the left only (after:), away from the bubble's. */}
          <button
            type="button"
            data-summer-talk
            onClick={talk}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Talk to Cleo"
            title="Talk to Cleo"
            className={cn(
              "pointer-events-auto absolute -left-3.5 -top-3.5 flex h-7 w-7 select-none items-center justify-center rounded-full",
              "bg-background text-orange-500 shadow-md ring-2 ring-orange-400 transition-transform active:scale-90 [-webkit-touch-callout:none]",
              "after:absolute after:-left-2.5 after:-top-2.5 after:bottom-0 after:right-0 after:content-['']",
            )}
          >
            <Mic className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      )}
      <SummerChat
        open={open}
        onOpenChange={setOpen}
        year={year}
        persona={{ tone: persona?.tone, instructions: persona?.instructions }}
        onPersonaSaved={() => {
          qc.invalidateQueries({ queryKey: ["summer-profile"] });
          qc.invalidateQueries({ queryKey: ["books-data"] });
        }}
        route={href}
        isOwner={persona?.isOwner ?? false}
        isFinance={persona?.isFinance ?? false}
        startDictating={startDictating}
        onDictationStarted={() => setStartDictating(false)}
      />
    </>
  );
}
