import { useEffect } from "react";
import { createPortal } from "react-dom";
import { unitSwitchWords, type UnitSwitchAsk } from "@/lib/workouts/unit-relabel";

/**
 * Switching a card's unit with weights on it: "They were lb" keeps the
 * numbers (a card that opened in the wrong unit), "Convert to lb" shows the
 * same weights in the other unit. Both said in the person's own numbers
 * (unit-relabel.ts). On <body> like the weight box's sheet, so it's never
 * under Focus's ‹ / Next bar, and data-state="open" holds Focus's swipes.
 */
export function UnitSwitchSheet({
  ask,
  onKeep,
  onConvert,
  onClose,
}: {
  ask: UnitSwitchAsk;
  onKeep: () => void;
  onConvert: () => void;
  onClose: () => void;
}) {
  const words = unitSwitchWords(ask);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={words.title} data-state="open" data-unit-switch-ask={ask.to}>
      <button type="button" aria-label="Cancel" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-background px-4 pt-2.5 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[22rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <h2 className="text-[17px] font-semibold leading-tight">{words.title}</h2>
        <p className="mt-1 text-[14px] leading-snug text-muted-foreground">{words.question}</p>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={onKeep}
            data-unit-keep
            className="flex min-h-[3.25rem] w-full flex-col items-start justify-center rounded-lg border border-foreground px-3.5 py-2 text-left active:scale-[0.99]"
          >
            <span className="text-[15px] font-semibold">{words.keep.label}</span>
            <span className="text-[13px] tabular-nums text-muted-foreground">{words.keep.detail}</span>
          </button>
          <button
            type="button"
            onClick={onConvert}
            data-unit-convert
            className="flex min-h-[3.25rem] w-full flex-col items-start justify-center rounded-lg border border-border px-3.5 py-2 text-left active:scale-[0.99]"
          >
            <span className="text-[15px] font-semibold">{words.convert.label}</span>
            <span className="text-[13px] tabular-nums text-muted-foreground">{words.convert.detail}</span>
          </button>
          <button type="button" onClick={onClose} className="h-11 w-full rounded-lg text-[15px] font-medium text-muted-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
