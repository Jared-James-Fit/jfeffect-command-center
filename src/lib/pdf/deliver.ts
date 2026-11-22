/**
 * Getting a PDF to the person (Nov 22 2026): one way for every export.
 *
 * `saveFiles` (file-share.ts) hands the file to the phone's share sheet (Save
 * to Files, Mail, Messages, Print, AirDrop) or downloads it on a computer.
 * jsPDF's own `doc.save()` does nothing in the iPhone app's web view, which is
 * why several downloads used to do nothing there. iOS opens the share sheet
 * only from a tap, so a PDF made after a wait (a read, the logo) that the phone
 * won't share from the first tap comes back as "again", and a toast with Save
 * hands it over from the toast's own tap.
 */
import { toast } from "sonner";
import { saveFiles, type SaveOutcome } from "@/lib/file-share";

let logoPromise: Promise<string | null> | null = null;

/** The app icon as a data URL for the PDF header (once a launch; null when it can't be read). */
export function loadPdfLogo(): Promise<string | null> {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      if (typeof fetch === "undefined" || typeof FileReader === "undefined") return null;
      const res = await fetch("/icon-192.png");
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string | null>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  void logoPromise.then((v) => {
    if (!v) logoPromise = null;
  });
  return logoPromise;
}

/**
 * Hands a ready PDF over (straight from a tap: the share sheet is the first
 * thing awaited) and says how it went. `label` names it in the toasts:
 * "Training program".
 */
export async function deliverPdf(file: File, label: string): Promise<SaveOutcome> {
  const outcome = await saveFiles([file]);
  if (outcome === "again") {
    toast(`${label} PDF is ready`, {
      description: "Tap Save to keep it or share it.",
      duration: 20_000,
      action: { label: "Save", onClick: () => void saveFiles([file]) },
    });
  } else if (outcome === "saved") {
    toast.success(`${label} PDF downloaded`);
  } else if (outcome === "failed") {
    toast.error("Couldn't save the PDF. Try again.");
  }
  return outcome;
}

/**
 * Makes a PDF on a tap and hands it over: a toast while it's made (when that
 * takes a moment), the share sheet or a download when it's ready.
 */
export async function makeAndDeliverPdf(
  label: string,
  build: () => Promise<File> | File,
): Promise<SaveOutcome | null> {
  const id = toast.loading(`Making the ${label.toLowerCase()} PDF…`);
  let file: File;
  try {
    file = await build();
  } catch (err) {
    console.error(`${label} PDF failed`, err);
    toast.error(
      err instanceof Error && err.message.startsWith("PDF:")
        ? err.message.slice(4).trim()
        : "Couldn't make the PDF. Try again.",
      { id },
    );
    return null;
  }
  toast.dismiss(id);
  return deliverPdf(file, label);
}
