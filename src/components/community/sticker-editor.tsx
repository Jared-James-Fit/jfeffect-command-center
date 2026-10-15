import { useEffect, useState } from "react";
import { BarChart3, MessageCircleQuestion, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { CommunityPost } from "@/lib/community";
import { STICKER_OPTION_MAX, STICKER_Q_MAX, cleanSticker, type StickerSpec, type StickerType } from "@/lib/lessons";
import { useSetSticker } from "@/lib/lessons.queries";

const TYPES: { type: StickerType; label: string; Icon: typeof BarChart3; hint: string }[] = [
  { type: "poll", label: "Poll", Icon: BarChart3, hint: "2 to 4 answers, one tap" },
  { type: "slider", label: "Slider", Icon: SlidersHorizontal, hint: "How much, on a slide" },
  { type: "question", label: "Question", Icon: MessageCircleQuestion, hint: "They type, only you see it" },
];
const EMOJIS = ["🔥", "💪", "😍", "🤣", "😭", "🤔", "💀", "🎯"];

/**
 * Make (or change) a story sticker: pick poll, slider or question box, write
 * it, save. Shared by your own story, a post's "…" menu and the coach's
 * lesson review, so it reads and checks the same everywhere (cleanSticker).
 */
export function StickerEditorSheet({
  open,
  initial,
  title = "Story sticker",
  saving = false,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  initial: StickerSpec | null;
  title?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (s: StickerSpec) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const [type, setType] = useState<StickerType>(initial?.type ?? "poll");
  const [q, setQ] = useState(initial?.q ?? "");
  const [options, setOptions] = useState<string[]>(initial?.type === "poll" ? initial.options.map((o) => o.label) : ["Yes", "No"]);
  const [tags, setTags] = useState<(string | undefined)[]>(initial?.type === "poll" ? initial.options.map((o) => o.tag) : []);
  const [emoji, setEmoji] = useState(initial?.type === "slider" ? initial.emoji : "🔥");
  const [error, setError] = useState<string | null>(null);

  // a fresh start each time it opens
  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? "poll");
    setQ(initial?.q ?? "");
    setOptions(initial?.type === "poll" ? initial.options.map((o) => o.label) : ["Yes", "No"]);
    setTags(initial?.type === "poll" ? initial.options.map((o) => o.tag) : []);
    setEmoji(initial?.type === "slider" ? initial.emoji : "🔥");
    setError(null);
    // only on opening: `initial` is rebuilt every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const build = (): StickerSpec =>
    type === "poll"
      ? { type, q, options: options.map((label, i) => ({ label, ...(tags[i] ? { tag: tags[i] } : {}) })) }
      : type === "slider"
        ? { type, q, emoji }
        : { type, q };

  const save = async () => {
    // a reworded sticker stays where it was put on the story
    const r = cleanSticker({ ...build(), ...(initial?.y !== undefined ? { y: initial.y } : {}) });
    if (!r.ok) return setError(r.error);
    setError(null);
    await onSave(r.sticker);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-sticker-editor>
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">{title}</SheetTitle>
            <SheetDescription className="text-[12px]">Shows on your story. Answers are one tap and only you see who answered.</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind of sticker">
            {TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="radio"
                aria-checked={type === t.type}
                onClick={() => setType(t.type)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-center transition-colors",
                  type === t.type ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                )}
                data-sticker-type={t.type}
              >
                <t.Icon className="h-5 w-5" />
                <span className="text-[13px] font-black">{t.label}</span>
                <span className="text-[10px] leading-tight">{t.hint}</span>
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">{type === "question" ? "Ask the crew" : "Question"}</span>
            <input
              value={q}
              maxLength={STICKER_Q_MAX}
              onChange={(e) => setQ(e.target.value)}
              placeholder={type === "poll" ? "anyone else hate pause squats?" : type === "slider" ? "how cooked are you after leg day?" : "whats your go-to pre-workout meal?"}
              className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[16px] outline-none focus:border-primary"
              data-sticker-q
            />
          </label>

          {type === "poll" && (
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={o}
                    maxLength={STICKER_OPTION_MAX}
                    onChange={(e) => setOptions((all) => all.map((x, k) => (k === i ? e.target.value : x)))}
                    placeholder={`Answer ${i + 1}`}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
                    data-sticker-option-input={i}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        setOptions((all) => all.filter((_, k) => k !== i));
                        setTags((all) => all.filter((_, k) => k !== i));
                      }}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-muted"
                      aria-label={`Remove answer ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {options.length < 4 && (
                <button type="button" onClick={() => setOptions((all) => [...all, ""])} className="inline-flex items-center gap-1 text-[13px] font-bold text-primary">
                  <Plus className="h-4 w-4" /> Add an answer
                </button>
              )}
            </div>
          )}

          {type === "slider" && (
            <div>
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">Emoji</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={cn("grid h-11 w-11 place-items-center rounded-xl border text-[24px]", emoji === e ? "border-primary bg-primary/10" : "border-border")}
                    aria-pressed={emoji === e}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-[13px] font-semibold text-destructive">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {onRemove && initial && (
              <button type="button" disabled={saving} onClick={() => onRemove()} className="h-11 rounded-full px-4 text-[14px] font-bold text-destructive active:bg-destructive/10">
                Remove
              </button>
            )}
            <button type="button" disabled={saving} onClick={save} className="ml-auto h-11 rounded-full bg-primary px-6 text-[14px] font-black text-primary-foreground disabled:opacity-50" data-sticker-save>
              {saving ? "Saving…" : "Save sticker"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The editor for a post you made: saves straight onto it. */
export function PostStickerEditor({ post, open, onClose }: { post: CommunityPost; open: boolean; onClose: () => void }) {
  const set = useSetSticker();
  const at = post.sticker?.y !== undefined ? { y: post.sticker.y } : {};
  const initial: StickerSpec | null = post.sticker
    ? post.sticker.type === "poll"
      ? { type: "poll" as const, q: post.sticker.q, options: post.sticker.options.map(({ label, tag }) => ({ label, ...(tag ? { tag } : {}) })), ...at }
      : post.sticker.type === "slider"
        ? { type: "slider" as const, q: post.sticker.q, emoji: post.sticker.emoji, ...at }
        : { type: "question" as const, q: post.sticker.q, ...at }
    : null;
  const run = (sticker: StickerSpec | null, ok: string) =>
    set.mutateAsync({ postId: post.id, sticker }).then(
      () => {
        toast.success(ok);
        onClose();
      },
      (e: any) => {
        toast.error(e?.message ?? "Couldn't save the sticker");
      },
    );
  return (
    <StickerEditorSheet
      open={open}
      initial={initial}
      saving={set.isPending}
      onClose={onClose}
      onSave={(s) => run(s, post.sticker ? "Sticker updated" : "Sticker added to your story")}
      onRemove={() => run(null, "Sticker removed")}
    />
  );
}
