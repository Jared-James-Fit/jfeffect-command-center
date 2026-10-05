import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Maximize2 } from "lucide-react";
import type { NfQuestion } from "@/lib/native-forms";

/**
 * Optional reference image shown above a question's input (e.g. the body-fat
 * chart). Stored in `nf_questions.validation.reference_image` as a path/URL so
 * no schema change is needed and duplicated forms carry it along.
 */
export function getQuestionReferenceImage(q: Pick<NfQuestion, "validation">): string | null {
  const v = q.validation?.reference_image;
  return typeof v === "string" && v.trim() ? v : null;
}

export function QuestionReferenceImage({ src, label }: { src: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative mt-3 block w-full overflow-hidden rounded-lg border border-border bg-black"
        aria-label={`Enlarge reference image: ${label}`}
      >
        <img src={src} alt={label} loading="lazy" className="block h-auto w-full" />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-2 py-1 text-[11px] font-medium backdrop-blur">
          <Maximize2 className="h-3 w-3" /> Tap to enlarge
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-hidden p-3">
          <DialogHeader>
            <DialogTitle className="text-sm">Reference</DialogTitle>
          </DialogHeader>
          {/* Wider than the viewport on phones so the labels stay readable; scroll to pan. */}
          <div className="max-h-[75vh] overflow-auto rounded-md bg-black">
            <img src={src} alt={label} className="block h-auto w-[900px] max-w-none sm:w-full" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
