import { useEffect, useState, useRef } from "react";
import { BarChart3, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, cleanPollOptions, type PostSlide } from "@/lib/community";
import { MentionSuggestBar } from "@/components/community/mentions";
import { MediaStrip, useMediaDraft } from "@/components/community/media-strip";
import { SpiritScene, type SpiritSceneKey } from "@/components/community/spirit-scenes";
import { AttachButtons, AttachGifPicker, AttachPreview, usePostAttach, type PostAttachInitial } from "@/components/community/post-attach";

export const NOTE_MAX = 1200;

/**
 * Write or edit a coach note's text. The featured quote (if any) isn't
 * editable here: quotes only ever come from the verified library. A new
 * post can carry a poll (`allowPoll`): the text is the question, 2-4 options.
 * With `media`, photos and videos too (up to 10, at most 3 videos): they're
 * uploaded as they're picked and handed to onSave in order.
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
  media,
  scene,
  attach,
}: {
  open: boolean;
  title: string;
  initial: string;
  quote?: { text: string; author: string | null } | null;
  saving: boolean;
  onClose: () => void;
  /** Resolves with the post's id when it has one to put a GIF / voice memo on. */
  onSave: (body: string, poll?: string[], media?: PostSlide[]) => Promise<string | void>;
  allowPoll?: boolean;
  /** Offer photos: what's on it now (when editing) and a key for this post. `hint` says where they go. */
  media?: { initial: PostSlide[] | null | undefined; key: string; hint?: string };
  /** Saturday's drawn scene, when the post has one: it's the cover until it's removed or a photo goes on. */
  scene?: { key: SpiritSceneKey; onRemove: () => Promise<void> };
  /** Offer a GIF and a voice memo: what's on it now and a key for this post. */
  attach?: { initial: PostAttachInitial | null; key: string };
}) {
  const [body, setBody] = useState(initial);
  const draft = useMediaDraft({ open: open && !!media, initial: media?.initial, key: media?.key ?? "none" });
  const att = usePostAttach({ initial: attach?.initial, key: attach?.key ?? "none", open: open && !!attach });
  const close = () => {
    if (media) draft.discard();
    att.discard();
    onClose();
  };
  // null = no poll; otherwise the options as typed
  const [poll, setPoll] = useState<string[] | null>(null);
  const [dropScene, setDropScene] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (open) {
      setBody(initial);
      setPoll(null);
      setDropScene(false);
    }
  }, [open, initial]);
  const trimmed = body.trim();
  const pollCheck = poll ? cleanPollOptions(poll) : null;
  const pollReady = !pollCheck || pollCheck.ok;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && close()}>
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
        {/* the drawn scene is the cover: take it off, or add a photo to use instead */}
        {scene && !dropScene && draft.tray.items.length === 0 && (
          <div data-scene-cover className="flex items-center gap-3 rounded-2xl border border-border p-2">
            <SpiritScene scene={scene.key} className="h-16 w-24 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold">Cover: drawn scene</div>
              <div className="text-[11px] leading-snug text-muted-foreground">Add a photo below to use it instead.</div>
            </div>
            <button type="button" onClick={() => setDropScene(true)} className="h-9 shrink-0 rounded-full bg-muted px-3 text-[12px] font-bold active:scale-95">
              Remove
            </button>
          </div>
        )}
        {media && (
          <div>
            <MediaStrip tray={draft.tray} />
            {media.hint && <p className="mt-1 text-[11px] text-muted-foreground">{media.hint}</p>}
          </div>
        )}
        {attach && <AttachPreview a={att} />}
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
          ) : null)}
        {/* one row of extras: GIF, voice memo, poll */}
        {(attach || (allowPoll && !poll)) && (
          <div className="flex flex-wrap items-center gap-2">
            {attach && <AttachButtons a={att} small />}
            {allowPoll && !poll && (
              <button type="button" onClick={() => setPoll(["", ""])} className="inline-flex h-9 w-max items-center gap-1.5 rounded-full bg-muted px-3.5 text-[13px] font-bold active:scale-95">
                <BarChart3 className="h-4 w-4" /> Add a poll
              </button>
            )}
          </div>
        )}
        {attach && <AttachGifPicker a={att} />}
        <div className="flex items-center justify-between">
          <span className="text-[11px] tabular-nums text-muted-foreground">{body.length}/{NOTE_MAX}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={close}>Cancel</Button>
            <Button
              type="button"
              disabled={saving || !trimmed || !pollReady || draft.tray.uploading > 0 || att.recorder.recording}
              onClick={() => {
                const options = pollCheck?.ok ? pollCheck.options : undefined;
                // photos only go when they changed (left out, the post keeps what it has)
                // a photo on, or the scene taken off: the drawing goes (so removing the photo later leaves no picture)
                const offScene = scene && (dropScene || (media && draft.changed && draft.tray.items.length > 0)) ? scene.onRemove : null;
                const save = (m?: PostSlide[]) =>
                  onSave(trimmed, options, m).then(async (id) => {
                    await offScene?.();
                    if (attach && id) await att.save(id);
                  });
                const run = media && draft.changed
                  ? draft.save((m) => save(m))
                  : save().then(() => { if (media) draft.discard(); });
                void run.then(
                  () => onClose(),
                  (e: any) => toast.error(e?.message ?? "Couldn't save"),
                );
              }}
            >
              {saving ? "Saving…" : draft.tray.uploading > 0 ? "Uploading…" : poll ? "Post poll" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
