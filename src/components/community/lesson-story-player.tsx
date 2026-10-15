import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Heart, Move, PenLine, Play, Sticker, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { CommunityAuthor, CommunityPost, PostSlide } from "@/lib/community";
import { coachTimeLabel, dayLabel, lessonStatusLabel, stickerSpot, stickerY, type LessonPlanRow, type LessonsOverview, type StickerSpec } from "@/lib/lessons";
import { useLessonAct, type LessonAction } from "@/lib/lessons.queries";
import { LessonStoryFrame } from "@/components/community/lesson-card";
import { StickerPreview } from "@/components/community/story-sticker";
import { StickerEditorSheet } from "@/components/community/sticker-editor";
import { NoteEditor } from "@/components/community/note-editor";
import { openCommunityPost } from "@/components/community/shared-comment";

/** A story's size in the preview (a phone's), drawn at this size and scaled to fit. */
export const STAGE_W = 390;
export const STAGE_H = 800;

/** The post as the crew will see it (built from the plan row, nothing posted). */
export function previewPost(row: LessonPlanRow, data: LessonsOverview): CommunityPost {
  const it = row.item;
  return {
    id: `preview-${row.id}`,
    created_at: row.post_at,
    visibility: "community",
    caption: row.body ?? it?.body ?? "",
    media_path: null,
    media_thumb_path: null,
    media_type: null,
    media_width: null,
    media_height: null,
    completion_id: null,
    kind: "note",
    series: "lesson",
    series_extra: it
      ? { key: it.key, track: it.track, title: it.title, level: it.level, lift: it.lift, tags: it.tags, visual: it.visual, refs: it.refs }
      : null,
    is_mine: true,
    author: data.author ?? { user_id: "", name: "Coach", avatar_url: null, is_coach: true },
    stats: null,
    reactions: {},
    my_reaction: null,
    coach_reactions: [],
    comment_count: 0,
    coach_commented: false,
    sticker: null,
  } as CommunityPost;
}

/** "Thu 12:00 pm": when it goes up, where the story's age would be. */
function whenLabel(row: LessonPlanRow): string {
  return `${dayLabel(row.day).split(",")[0]} ${coachTimeLabel(row.post_at)}`;
}

/**
 * A lesson's story at full size, exactly as the crew will see it: the
 * progress and name at the top, the lesson, the sticker where it sits and the
 * reply bar. With `onPlace` the sticker can be dragged up or down (it's saved
 * on letting go); tapping the left third goes back, anywhere else forward.
 */
export function LessonStoryStage({
  post,
  sticker,
  author,
  when,
  count = 1,
  at = 0,
  onPlace,
  onPrev,
  onNext,
}: {
  post: CommunityPost;
  sticker: StickerSpec | null;
  author: CommunityAuthor;
  when: string;
  count?: number;
  at?: number;
  onPlace?: (y: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (bar.current) setBarH(bar.current.offsetHeight);
  }, []);
  const drag = useRef<{ startY: number; from: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const y = live ?? sticker?.y;
  const first = author.name.split(" ")[0];

  // the sticker as a viewer gets it, so the lesson lays itself out around it
  const shown: CommunityPost = useMemo(
    () => ({
      ...post,
      sticker: sticker
        ? ({
            ...sticker,
            y,
            total: 0,
            is_mine: true,
            ...(sticker.type === "poll" ? { options: sticker.options.map((o) => ({ ...o, votes: 0 })) } : {}),
          } as CommunityPost["sticker"])
        : null,
    }),
    [post, sticker, y],
  );

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPlace || !stage.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const s = stage.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { startY: e.clientY, from: (r.top + r.height / 2 - s.top) / s.height, moved: false };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !stage.current) return;
    if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    if (!d.moved) return;
    const next = stickerY(d.from + (e.clientY - d.startY) / stage.current.getBoundingClientRect().height);
    if (next !== undefined) setLive(next);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && live !== null) onPlace?.(live);
    setLive(null);
  };
  const tap = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-sticker-drag]")) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) onPrev?.();
    else onNext?.();
  };

  return (
    <div ref={stage} onClick={tap} className="relative flex select-none flex-col overflow-hidden bg-black text-white" style={{ width: STAGE_W, height: STAGE_H }} data-lesson-stage>
      <LessonStoryFrame post={shown} />
      {sticker && (
        <div
          className={cn("absolute inset-x-0 z-40 touch-none", onPlace && "cursor-grab active:cursor-grabbing")}
          style={stickerSpot(y, barH)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            drag.current = null;
            setLive(null);
          }}
          data-sticker-drag
        >
          <StickerPreview sticker={sticker} className={cn(live !== null && "scale-[1.03] ring-4 ring-white/40 transition-transform")} />
        </div>
      )}

      {/* top: progress and who */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-3">
        <div className="flex gap-1">
          {Array.from({ length: Math.max(1, count) }, (_, i) => (
            <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: i < at ? "100%" : i === at ? "35%" : "0%" }} />
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex h-10 items-center gap-2">
          <UserAvatar src={author.avatar_url} name={author.name} size={32} expandable={false} />
          <span className="truncate text-[14px] font-bold">{first}</span>
          <span className="shrink-0 text-[12px] text-white/70">{when}</span>
        </div>
      </div>

      {/* bottom: the reply bar, as the crew sees it */}
      <div ref={bar} className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pb-3 pt-10" aria-hidden>
        <div className="mb-3 px-1">
          <span className="inline-flex h-8 items-center gap-0.5 rounded-full bg-white/15 pl-3 pr-2 text-[13px] font-bold">
            View post <ChevronRight className="h-4 w-4" />
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex h-12 min-w-0 flex-1 items-center rounded-full border border-white/50 pl-4 pr-1">
            <span className="min-w-0 flex-1 truncate text-[16px] text-white/80">Message {first}…</span>
            <span className="grid h-10 w-10 place-items-center text-[24px] leading-none">😍</span>
            <span className="grid h-10 w-10 place-items-center text-[24px] leading-none">😂</span>
          </div>
          <span className="grid h-12 w-12 place-items-center">
            <Heart className="h-[30px] w-[30px]" strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** The story, small, in the lesson's sheet: tap it to play it full screen (and arrange it there). */
export function StoryThumb({ row, data, onOpen }: { row: LessonPlanRow; data: LessonsOverview; onOpen?: () => void }) {
  const post = useMemo(() => previewPost(row, data), [row, data]);
  const scale = 0.62;
  const stage = (
    <div className="pointer-events-none" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      <LessonStoryStage post={post} sticker={row.sticker} author={post.author} when={whenLabel(row)} />
    </div>
  );
  const box = "relative mx-auto block overflow-hidden rounded-[22px] bg-black text-left";
  const size = { width: STAGE_W * scale, height: STAGE_H * scale };
  if (!onOpen) {
    return (
      <div className={box} style={size} data-lesson-preview="story">
        {stage}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={cn(box, "active:scale-[0.99]")} style={size} aria-label="Play the story full screen and arrange it" data-lesson-preview="story">
      {stage}
      <span className="absolute inset-x-0 bottom-3 mx-auto flex w-max items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12px] font-black text-black shadow-lg">
        <Play className="h-3.5 w-3.5 fill-black" /> Play & arrange
      </span>
    </button>
  );
}

/** Words, photo and sticker editors for one planned lesson (the sheet's and the player's). */
export function LessonEditors({ row, words, sticker, onClose }: { row: LessonPlanRow; words: boolean; sticker: boolean; onClose: () => void }) {
  const act = useLessonAct();
  const it = row.item;
  const run = (a: LessonAction, ok: string) =>
    act.mutate(a, {
      onSuccess: () => {
        toast.success(ok);
        onClose();
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
    });
  return (
    <>
      {it && (
        <NoteEditor
          open={words}
          title={`${dayLabel(row.day)}: ${it.title}`}
          initial={row.body ?? it.body}
          saving={act.isPending}
          onClose={onClose}
          media={{ initial: row.media as PostSlide[], key: `lesson-${row.id}`, hint: "Photos go on top of this lesson. The diagram stays under the words." }}
          onSave={async (body, _poll, media) => {
            await act.mutateAsync({ kind: "save", id: row.id, body, ...(media ? { media } : {}) });
            toast.success("Saved. It goes out like this.");
          }}
        />
      )}
      <StickerEditorSheet
        open={sticker}
        initial={row.sticker}
        title="Lesson sticker"
        saving={act.isPending}
        onClose={onClose}
        onSave={(s: StickerSpec) => run({ kind: "save", id: row.id, sticker: s, stickerSet: true }, "Sticker saved")}
        onRemove={() => run({ kind: "save", id: row.id, sticker: null, stickerSet: true }, "No sticker on this one")}
      />
    </>
  );
}

/**
 * The coming lessons as stories, full screen, the way the crew will get them:
 * tap the right side for the next one, the left to go back (or the arrows).
 * Each one can be arranged right there before it goes out: drag the sticker
 * up or down (saved when you let go; up top, the lesson's words go under it),
 * change the words or photo, change the sticker, approve it. One that's
 * already up opens as the post.
 */
export function LessonStoryPlayer({ rows, startId, data, onClose }: { rows: LessonPlanRow[]; startId: string; data: LessonsOverview; onClose: () => void }) {
  const act = useLessonAct();
  const [id, setId] = useState(startId);
  const found = rows.findIndex((r) => r.id === id);
  const i = found < 0 ? 0 : found;
  const row = rows[i] ?? null;
  const [words, setWords] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  // where the sticker was just put, until the plan reloads with it
  const [placed, setPlaced] = useState<Record<string, number | null>>({});

  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.75);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H, 1.15));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (d: 1 | -1) => {
    const n = rows[i + d];
    if (n) setId(n.id);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (words || stickerOpen) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const post = useMemo(() => (row ? previewPost(row, data) : null), [row, data]);
  if (!row || !post) return null;

  const posted = row.status === "posted";
  const live = row.status === "planned" || row.status === "approved";
  const sticker: StickerSpec | null = row.sticker
    ? row.id in placed
      ? { ...row.sticker, y: placed[row.id] ?? undefined }
      : row.sticker
    : null;
  const run = (a: LessonAction, ok: string, after?: () => void) =>
    act.mutate(a, {
      onSuccess: () => {
        toast.success(ok);
        after?.();
      },
      onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
    });
  const place = (y: number | undefined) => {
    if (!row.sticker) return;
    const rowId = row.id;
    setPlaced((p) => ({ ...p, [rowId]: y ?? null }));
    act.mutate(
      { kind: "save", id: rowId, sticker: { ...row.sticker, y }, stickerSet: true },
      {
        onSuccess: () => toast.success(y === undefined ? "Sticker back in its usual spot" : "Sticker moved"),
        onError: (e: any) => {
          // it didn't save: back where it was
          setPlaced(({ [rowId]: _gone, ...rest }) => rest);
          toast.error(e?.message ?? "Couldn't move the sticker");
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 text-white shadow-none sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,980px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-lesson-player
      >
        <DialogTitle className="sr-only">Lesson stories</DialogTitle>
        <DialogDescription className="sr-only">Tap the right side for the next lesson, the left to go back. Drag the sticker to move it.</DialogDescription>

        <div className="flex items-center gap-2 px-4 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-black">{row.item?.title}</div>
            <div className="truncate text-[12px] text-white/60">
              {dayLabel(row.day)} · {coachTimeLabel(row.post_at)} · {lessonStatusLabel(row, data.mode)}
            </div>
          </div>
          <span className="shrink-0 text-[12px] font-bold text-white/50">
            {i + 1} of {rows.length}
          </span>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 active:bg-white/20" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={box} className="relative min-h-0 flex-1 px-3">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="overflow-hidden rounded-[24px] shadow-2xl ring-1 ring-white/10" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
              <div style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <LessonStoryStage
                  key={row.id}
                  post={post}
                  sticker={sticker}
                  author={post.author}
                  when={whenLabel(row)}
                  count={rows.length}
                  at={i}
                  onPlace={posted ? undefined : place}
                  onPrev={() => go(-1)}
                  onNext={() => go(1)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 px-4 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.85rem)" }}>
          {!posted && sticker && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[12px] font-semibold text-white/60" data-lesson-arrange-hint>
              <Move className="h-3.5 w-3.5" /> Drag the sticker up or down to move it
              {sticker.y !== undefined && (
                <button type="button" onClick={() => place(undefined)} className="ml-1 font-black text-white underline-offset-2 active:underline">
                  Reset
                </button>
              )}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => go(-1)} disabled={i === 0} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-30" aria-label="Previous lesson">
              <ChevronLeft className="h-5 w-5" />
            </button>
            {posted ? (
              <button type="button" onClick={() => row.post_id && openCommunityPost(row.post_id)} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-[14px] font-black text-black">
                Open the post <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button type="button" onClick={() => setWords(true)} className="flex h-12 flex-1 flex-col items-center justify-center rounded-2xl bg-white/10 text-[11px] font-bold active:bg-white/20" data-lesson-player-tool="words">
                  <PenLine className="h-4 w-4" /> Words & photo
                </button>
                <button type="button" onClick={() => setStickerOpen(true)} className="flex h-12 flex-1 flex-col items-center justify-center rounded-2xl bg-white/10 text-[11px] font-bold active:bg-white/20" data-lesson-player-tool="sticker">
                  <Sticker className="h-4 w-4" /> {row.sticker ? "Sticker" : "Add sticker"}
                </button>
                {live && data.mode === "review" &&
                  (row.status === "approved" ? (
                    <button type="button" disabled={act.isPending} onClick={() => run({ kind: "unapprove", id: row.id }, "Back to needing your OK")} className="flex h-12 flex-1 flex-col items-center justify-center rounded-2xl bg-emerald-500/20 text-[11px] font-black text-emerald-300" data-lesson-player-unapprove>
                      <Check className="h-4 w-4" />
                      <span className="inline-flex items-center gap-0.5">Approved · <Undo2 className="h-3 w-3" /></span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() => run({ kind: "approve", id: row.id }, `Approved for ${whenLabel(row)}`, () => go(1))}
                      className="flex h-12 flex-1 flex-col items-center justify-center rounded-2xl bg-primary text-[11px] font-black text-primary-foreground"
                      data-lesson-player-approve
                    >
                      <Check className="h-4 w-4" /> Approve
                    </button>
                  ))}
              </>
            )}
            <button type="button" onClick={() => go(1)} disabled={i >= rows.length - 1} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-30" aria-label="Next lesson">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <LessonEditors
          row={row}
          words={words}
          sticker={stickerOpen}
          onClose={() => {
            setWords(false);
            setStickerOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
