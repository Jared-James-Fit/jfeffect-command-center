import { useEffect, useState, useRef } from "react";
import { BarChart3, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, cleanPollOptions } from "@/lib/community";
import { MentionSuggestBar } from "@/components/community/mentions";

export const NOTE_MAX = 1200;

/**
 * Write or edit a coach note's text. The featured quote (if any) isn't
 * editable here: quotes only ever come from the verified library. A new
 * post can carry a poll (`allowPoll`): the text is the question, 2-4 options.
 */
export function NoteEditor({
  open,
  title,
  initial,
  quote,
  saving,
  onClose,
  onSave,
  allowPoll = false,
}: {
  open: boolean;
  title: string;
  initial: string;
  quote?: { text: string; author: string | null } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (body: string, poll?: string[]) => Promise<void>;
  allowPoll?: boolean;
}) {
  const [body, setBody] = useState(initial);
  // null = no poll; otherwise the options as typed
  const [poll, setPoll] = useState<string[] | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (open) {
      setBody(initial);
      setPoll(null);
    }
  }, [open, initial]);
  const trimmed = body.trim();
  const pollCheck = poll ? cleanPollOptions(poll) : null;
  const pollReady = !pollCheck || pollCheck.ok;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-[520px] rounded-3xl" showBackButton={false} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="text-base font-black">{title}</DialogTitle>
        <DialogDescription className="sr-only">Write the post text.</DialogDescription>
        {quote && (
          <figure className="border-l-[3px] border-primary pl-3">
            <blockquote className="text-[14px] font-semibold leading-snug">“{quote.text}”</blockquote>
            {quote.author && <figcaption className="mt-1 text-[11px] text-muted-foreground">{quote.author}</figcaption>}
          </figure>
        )}
        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, NOTE_MAX))}
          rows={poll ? 3 : 7}
          placeholder={poll ? "Ask the crew something…" : undefined}
          className="resize-none rounded-2xl text-[16px] leading-snug"
          aria-label={poll ? "Poll question" : "Post text"}
        />
        <MentionSuggestBar value={body} onChange={(v) => setBody(v.slice(0, NOTE_MAX))} inputRef={bodyRef} className="-my-2" />
        {allowPoll &&
          (poll ? (
            <div data-poll-editor className="space-y-2 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Poll</span>
                <button type="button" onClick={() => setPoll(null)} className="text-[12px] font-bold text-muted-foreground active:opacity-60">
                  Remove poll
                </button>
              </div>
              {poll.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={o}
                    onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value.slice(0, POLL_OPTION_MAX) : x)))}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                    className="h-11 rounded-xl text-[16px]"
                  />
                  {poll.length > 2 && (
                    <button type="button" onClick={() => setPoll(poll.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {poll.length < POLL_MAX_OPTIONS && (
                <button type="button" onClick={() => setPoll([...poll, ""])} className="text-[13px] font-bold text-primary active:opacity-60">
                  + Add option
                </button>
              )}
              {pollCheck && !pollCheck.ok && poll.some((x) => x.trim()) && <p className="text-[12px] text-muted-foreground">{pollCheck.reason}</p>}
            </div>
          ) : (
            <button type="button" onClick={() => setPoll(["", ""])} className="inline-flex h-9 w-max items-center gap-1.5 rounded-full bg-muted px-3.5 text-[13px] font-bold active:scale-95">
              <BarChart3 className="h-4 w-4" /> Add a poll
            </button>
          ))}
        <div className="flex items-center justify-between">
          <span className="text-[11px] tabular-nums text-muted-foreground">{body.length}/{NOTE_MAX}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              disabled={saving || !trimmed || !pollReady}
              onClick={() =>
                void onSave(trimmed, pollCheck?.ok ? pollCheck.options : undefined).then(
                  () => onClose(),
                  (e: any) => toast.error(e?.message ?? "Couldn't save"),
                )
              }
            >
              {saving ? "Saving…" : poll ? "Post poll" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
