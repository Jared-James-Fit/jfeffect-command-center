/**
 * Cleo's chat in admin, with no floating button of her own: she opens from
 * her row in Messages (tap to type, the mic to talk), ⌘/Ctrl+Shift+S,
 * "/admin#cleo" (her approval and decision pushes) and window events other
 * screens use to open her ("summer:open", "summer:toggle", "summer:close";
 * detail { year?, dictate? }).
 *
 * Admin only; mounted once in the admin layout.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSummerProfile } from "@/lib/business-books.functions";
import { summerSpeaker } from "@/lib/summer-speaker";
import { SummerChat } from "@/components/admin/books/summer-chat";

/** `dictate`: open straight into listening (the mic on her row in Messages). */
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

export function SummerAssistant() {
  const qc = useQueryClient();
  const profileFn = useServerFn(getSummerProfile);
  const href = useRouterState({ select: (r) => r.location.href });
  const hash = useRouterState({ select: (r) => r.location.hash });
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [startDictating, setStartDictating] = useState(false);

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

  return (
    <>
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
