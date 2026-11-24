import { useEffect, useState } from "react";
import { PenLine, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { useAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { MeetNumbers, StoryFilter, TemplateText } from "@/lib/story-filters";

/*
 * A story template's own tools (Nov 23 2026): star it into Favorites (the
 * first chip of the row), and change its words (its title, a second line, a
 * meet's numbers). Both are this person's conveniences on this phone, kept per
 * login: a favourite or a meet's numbers are never anything anyone else sees
 * until they post the story with them on it.
 */

const FAVS_KEY = "jf-template-favs-v1";
const TEXT_KEY = "jf-template-text-v1";
/** The most favourites kept (the chip's row stays a row). */
export const MAX_FAVORITES = 16;

function read<T>(key: string, owner: string | null, fallback: T): T {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return raw && raw.owner === owner ? (raw.value as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, owner: string | null, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ owner, value }));
  } catch {
    /* private mode: this visit only */
  }
}

/** Starred template keys ("fx:gameday"), newest first. */
export function useTemplateFavorites(): { favorites: string[]; toggle: (key: string) => boolean } {
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => setFavorites(read<string[]>(FAVS_KEY, owner, []).filter((k) => typeof k === "string").slice(0, MAX_FAVORITES)), [owner]);
  const toggle = (key: string) => {
    const on = !favorites.includes(key);
    const next = on ? [key, ...favorites].slice(0, MAX_FAVORITES) : favorites.filter((k) => k !== key);
    setFavorites(next);
    write(FAVS_KEY, owner, next);
    return on;
  };
  return { favorites, toggle };
}

/** What this person typed onto templates, by template id (a meet's numbers are remembered for the next meet post). */
export function useTemplateText(): { text: Record<string, TemplateText>; set: (id: string, t: TemplateText | null) => void } {
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [text, setText] = useState<Record<string, TemplateText>>({});
  useEffect(() => setText(read<Record<string, TemplateText>>(TEXT_KEY, owner, {})), [owner]);
  const set = (id: string, t: TemplateText | null) => {
    setText((cur) => {
      const next = { ...cur };
      if (t) next[id] = t;
      else delete next[id];
      write(TEXT_KEY, owner, next);
      return next;
    });
  };
  return { text, set };
}

/**
 * Over the shutter while a template is on: its name, Edit (its words) when
 * it has words to change, and a star for Favorites.
 */
export function TemplateChip({
  filter,
  label,
  emoji,
  favorite,
  onFavorite,
  onEdit,
}: {
  filter: StoryFilter;
  label: string;
  emoji: string;
  favorite: boolean;
  onFavorite: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full bg-black/45 py-1 pl-3.5 pr-1 backdrop-blur-md" data-template-chip={filter.id}>
      <span className="text-[16px] leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 truncate px-1 text-[13px] font-bold">{label}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 text-[12px] font-bold active:scale-95" aria-label={`Edit the words on ${label}`} data-template-edit>
          <PenLine className="h-3.5 w-3.5" /> Edit
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          feedback("tap");
          onFavorite();
        }}
        aria-pressed={favorite}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full active:scale-90"
        aria-label={favorite ? `${label} is a favourite. Tap to remove it` : `Add ${label} to Favorites`}
        data-template-fav={favorite ? "on" : "off"}
      >
        <Star className={cn("h-4 w-4", favorite ? "fill-[#ffd23f] text-[#ffd23f]" : "text-white/80")} />
      </button>
    </div>
  );
}

const field = "h-11 w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 text-[16px] text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none";

/** The template's words: its title, a second line, and a meet's own numbers (all optional; empty puts the template's back). */
export function TemplateTextSheet({
  open,
  onClose,
  filter,
  value,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  filter: StoryFilter | null;
  value: TemplateText | undefined;
  onSave: (t: TemplateText | null) => void;
}) {
  const def = filter?.edit;
  const [title, setTitle] = useState("");
  const [sub, setSub] = useState("");
  const [meet, setMeet] = useState<MeetNumbers>({ unit: "kg" });
  useEffect(() => {
    if (!open || !def) return;
    setTitle((value?.title ?? def.title).replace(/\|/g, "\n"));
    setSub(value?.sub ?? def.sub ?? "");
    setMeet({ unit: "kg", ...(value?.meet ?? {}) });
  }, [open, def, value]);
  if (!filter || !def) return null;
  const save = () => {
    const t: TemplateText = {};
    const tt = title.trim();
    if (tt && tt !== def.title.replace(/\|/g, "\n")) t.title = tt.slice(0, 60);
    if (sub.trim() !== (def.sub ?? "")) t.sub = sub.trim().slice(0, 48);
    if (def.meet) {
      const m: MeetNumbers = { unit: meet.unit ?? "kg" };
      for (const k of ["cls", "s", "b", "d"] as const) if (meet[k]?.trim()) m[k] = meet[k]!.trim().slice(0, 10);
      if (m.cls || m.s || m.b || m.d) t.meet = m;
    }
    onSave(Object.keys(t).length ? t : null);
    onClose();
  };
  const num = (k: "s" | "b" | "d", label: string) => (
    <label className="min-w-0 flex-1">
      <span className="mb-1 block text-[12px] font-semibold text-white/60">{label}</span>
      <input inputMode="decimal" value={meet[k] ?? ""} onChange={(e) => setMeet((m) => ({ ...m, [k]: e.target.value.replace(/[^\d.,]/g, "") }))} className={field} placeholder="—" data-template-meet={k} />
    </label>
  );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton swipeToClose className="dark max-h-[88dvh] overflow-y-auto rounded-t-[22px] border-0 bg-[#121214] p-0 text-white sm:mx-auto sm:max-w-[520px]" data-template-text-sheet>
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/30" aria-hidden />
        <div className="space-y-4 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
          <div>
            <SheetTitle className="text-[17px] font-bold text-white">{typeof filter.label === "string" ? filter.label : "Template"}</SheetTitle>
            <SheetDescription className="text-[13px] text-white/60">Change the words on it. Leave a box empty to keep the template's own.</SheetDescription>
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-white/60">Title</span>
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} maxLength={60} className={cn(field, "h-auto resize-none py-2.5 leading-snug")} data-template-title />
          </label>
          {def.sub !== undefined && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-white/60">Second line</span>
              <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={48} className={field} data-template-sub />
            </label>
          )}
          {def.meet && (
            <div className="space-y-3 rounded-2xl bg-white/[0.04] p-3" data-template-meet>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold">Your meet (optional)</span>
                <div className="flex rounded-full bg-white/10 p-0.5 text-[12px] font-bold" role="group" aria-label="Unit">
                  {(["kg", "lb"] as const).map((u) => (
                    <button key={u} type="button" onClick={() => setMeet((m) => ({ ...m, unit: u }))} aria-pressed={meet.unit === u} className={cn("h-8 rounded-full px-3", meet.unit === u ? "bg-white text-black" : "text-white/70")}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/60">Weight class</span>
                <input value={meet.cls ?? ""} onChange={(e) => setMeet((m) => ({ ...m, cls: e.target.value }))} maxLength={10} className={field} placeholder="e.g. 93 kg" data-template-meet="cls" />
              </label>
              <div className="flex gap-2">
                {num("s", "Squat")}
                {num("b", "Bench")}
                {num("d", "Deadlift")}
              </div>
              <p className="text-[12px] text-white/50">The total adds up by itself when all three are in.</p>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onSave(null);
                onClose();
              }}
              className="h-12 rounded-2xl bg-white/10 px-4 text-[15px] font-semibold active:scale-[0.98]"
              data-template-reset
            >
              Reset
            </button>
            <button type="button" onClick={save} className="h-12 flex-1 rounded-2xl bg-white text-[15px] font-bold text-black active:scale-[0.98]" data-template-save>
              Done
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
