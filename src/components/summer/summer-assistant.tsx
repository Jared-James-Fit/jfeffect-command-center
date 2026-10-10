/**
 * Cleo, everywhere in admin: a floating button (tap to open or close her
 * chat, press and hold to start talking), ⌘/Ctrl+Shift+S, and window
 * events other screens use to open her ("summer:open", "summer:toggle",
 * "summer:close"; detail { year?, dictate? }).
 *
 * Admin only; mounted once in the admin layout.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSummerProfile } from "@/lib/business-books.functions";
import { summerSpeaker } from "@/lib/summer-speaker";
import { SummerChat } from "@/components/admin/books/summer-chat";

/** `dictate`: open straight into listening (the mic in Messages, a long-press on her button). */
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

  return (
    <>
      {!hideFab && (
        <button
          type="button"
          data-summer-fab
          onClick={click}
          onPointerDown={pressStart}
          onPointerUp={pressEnd}
          onPointerLeave={pressEnd}
          onPointerCancel={pressEnd}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Cleo: tap to chat, hold to talk"
          title="Cleo (⌘⇧S)"
          className={cn(
            "summer-fab fixed right-4 z-50 flex h-12 w-12 select-none items-center justify-center rounded-full text-white md:right-6",
            "bg-gradient-to-br from-amber-300 via-orange-400 to-pink-500 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] ring-1 ring-black/10",
            "transition-transform active:scale-95 [-webkit-touch-callout:none]",
          )}
        >
          <Sparkles className="h-5 w-5" />
        </button>
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
