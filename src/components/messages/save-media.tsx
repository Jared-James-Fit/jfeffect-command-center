import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { ArrowDownToLine } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  prepareSave, readyFiles, saveFiles, saveLabel, warmSave,
  type SaveItem, type SaveOutcome,
} from "@/lib/save-media";

function nounOf(items: SaveItem[]): string {
  if (items.length > 1) return items.every((i) => i.kind === "video") ? "videos" : items.every((i) => i.kind === "image") ? "photos" : "photos & videos";
  return items[0]?.kind === "video" ? "video" : "photo";
}

/**
 * Save chat photos / videos, iMessage style: the share sheet's Save Image /
 * Save Video on a phone, a download on a computer. Call it straight from a
 * tap: when the files are already in hand (warmed on touch-down) the sheet
 * opens in that tap; a long video still downloading shows its progress and
 * then a "Save" button (iOS only opens the sheet from a tap).
 */
export function useSaveMedia() {
  const busy = useRef(false);
  return useCallback(async (items: SaveItem[]) => {
    if (!items.length) return;
    const noun = nounOf(items);
    const offerAgain = (files: File[], id?: string | number) => {
      toast(`${noun[0].toUpperCase()}${noun.slice(1)} ready`, {
        id,
        description: "Tap Save, then Save to Photos",
        duration: 20_000,
        action: { label: "Save", onClick: () => { void saveFiles(files).then((o) => report(o, files)); } },
      });
    };
    const report = (outcome: SaveOutcome, files: File[], id?: string | number) => {
      if (outcome === "again") return offerAgain(files, id);
      if (outcome === "saved") return void toast.success(items.length > 1 ? `${items.length} files downloaded` : "Downloaded", { id });
      if (outcome === "failed") return void toast.error(`Couldn't save that ${noun}. Try again.`, { id });
      if (id != null) toast.dismiss(id);
    };

    // In hand already: open the sheet inside this tap.
    const now = readyFiles(items);
    if (now) {
      report(await saveFiles(now), now);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    const id = toast.loading(`Getting your ${noun}…`);
    let shown = -1;
    try {
      const files = await prepareSave(items, (p) => {
        const pct = Math.round(p * 100);
        if (pct === shown || pct >= 100) return;
        shown = pct;
        toast.loading(`Getting your ${noun}… ${pct}%`, { id });
      });
      // Usually still counts as the tap (a quick photo); if not, one more tap.
      report(await saveFiles(files), files, id);
    } catch {
      toast.error(`Couldn't get that ${noun}. Check your connection and try again.`, { id });
    } finally {
      busy.current = false;
    }
  }, []);
}

/**
 * The round save button beside a photo / video someone sent you (iOS 17
 * Messages): centred on one, by the time at the bottom of a tall stack of
 * several (the middle of three clips can be off screen).
 */
export function SaveMediaButton({ items, className }: { items: SaveItem[]; className?: string }) {
  const save = useSaveMedia();
  if (!items.length) return null;
  const label = saveLabel(items);
  return (
    <button
      type="button"
      data-save-media
      data-no-doubletap
      aria-label={label}
      title={label}
      // touch-down starts getting the file, so the tap can open the sheet at once
      onPointerDown={(e) => { e.stopPropagation(); warmSave(items); }}
      onClick={(e) => { e.stopPropagation(); void save(items); }}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground shadow-sm ring-1 ring-border/60 transition hover:text-foreground active:scale-90",
        items.length > 1 ? "mb-7 self-end" : "self-center",
        className,
      )}
    >
      <ArrowDownToLine className="h-4 w-4" />
    </button>
  );
}
