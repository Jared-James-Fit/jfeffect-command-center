import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const NOTE_MAX = 1200;

/**
 * Write or edit a coach note's text. The featured quote (if any) isn't
 * editable here: quotes only ever come from the verified library.
 */
export function NoteEditor({
  open,
  title,
  initial,
  quote,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: string;
  quote?: { text: string; author: string | null } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState(initial);
  useEffect(() => {
    if (open) setBody(initial);
  }, [open, initial]);
  const trimmed = body.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-[520px] rounded-3xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="text-base font-black">{title}</DialogTitle>
        <DialogDescription className="sr-only">Write the post text.</DialogDescription>
        {quote && (
          <figure className="border-l-[3px] border-primary pl-3">
            <blockquote className="text-[14px] font-semibold leading-snug">“{quote.text}”</blockquote>
            {quote.author && <figcaption className="mt-1 text-[11px] text-muted-foreground">{quote.author}</figcaption>}
          </figure>
        )}
        <Textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, NOTE_MAX))} rows={7} className="resize-none rounded-2xl text-[16px] leading-snug" aria-label="Post text" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] tabular-nums text-muted-foreground">{body.length}/{NOTE_MAX}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              disabled={saving || !trimmed}
              onClick={() =>
                void onSave(trimmed).then(
                  () => onClose(),
                  (e: any) => toast.error(e?.message ?? "Couldn't save"),
                )
              }
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
