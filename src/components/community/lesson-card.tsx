import { useState } from "react";
import { BookOpen, ChevronDown, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommunityPost } from "@/lib/community";
import { extraLesson, hookLine, lessonKicker, safeRefUrl, type LessonExtra } from "@/lib/lessons";
import { LessonVisualArt, visualLabel, visualNote } from "@/components/community/lesson-visuals";

/**
 * What a coach lesson shows under its words: the diagram (when it has one) on
 * the same quiet card as the other info posts (Tuesday's data, Thursday's
 * features), what kind of lesson it is ("Technique fix · Squat · Beginner"),
 * its sources one tap away, and the line that keeps it a lesson and not an
 * instruction: your program stays as written.
 */
export function LessonCard({ post, className }: { post: CommunityPost; className?: string }) {
  const lesson = extraLesson(post);
  const [open, setOpen] = useState(false);
  if (!lesson) return null;
  const refs = lesson.refs ?? [];
  const first = post.author.name.split(" ")[0];
  return (
    <div className={className} data-lesson-card={lesson.track}>
      {lesson.visual ? (
        <div className="rounded-2xl border border-border/70 bg-muted/40 px-3.5 pb-3 pt-3" data-lesson-diagram>
          <Kicker lesson={lesson} />
          <LessonVisualArt visual={lesson.visual} className="mt-3" />
          <div className="mt-2.5 text-[11px] leading-snug text-muted-foreground">{visualNote(lesson.visual)}</div>
        </div>
      ) : (
        <Kicker lesson={lesson} />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {refs.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-muted-foreground active:text-foreground"
            aria-expanded={open}
            data-lesson-sources
          >
            <BookOpen className="h-3.5 w-3.5" />
            {refs.length === 1 ? "1 source" : `${refs.length} sources`}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
        <span className="text-[12px] text-muted-foreground" data-lesson-note>
          Good to know, not a change to your program. Big technique changes, ask {first} first.
        </span>
      </div>
      {open && (
        <ol className="mt-1.5 space-y-1 border-l-2 border-border pl-3" onClick={(e) => e.stopPropagation()}>
          {refs.map((r, i) => {
            const url = safeRefUrl(r.url);
            return (
              <li key={i} className="text-[12px] leading-snug text-muted-foreground">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline decoration-border underline-offset-2">
                    {r.label}
                  </a>
                ) : (
                  <span className="font-semibold text-foreground">{r.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Kicker({ lesson }: { lesson: LessonExtra }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground" data-lesson-kicker>
      <GraduationCap className="h-3 w-3 shrink-0 text-primary" aria-hidden />
      <span className="truncate">{lessonKicker(lesson)}</span>
    </div>
  );
}

/**
 * A lesson as a story: what it's about, the diagram, and the first line of
 * the post. The rest is one swipe up ("Post"), and the sticker sits under it.
 */
export function LessonStoryFrame({ post }: { post: CommunityPost }) {
  const lesson = extraLesson(post);
  if (!lesson) return null;
  const hook = hookLine(post.caption);
  // with a sticker under it, the lesson sits up top; the hook only fits without a diagram
  const sticker = !!post.sticker;
  const showHook = !!hook && !(sticker && lesson.visual);
  return (
    <div
      className={cn(
        "flex flex-1 flex-col bg-zinc-950 bg-[radial-gradient(120%_70%_at_100%_0%,rgba(239,51,64,0.38),transparent_60%)] px-6",
        sticker ? "justify-start pt-24" : "justify-center pb-28 pt-24",
      )}
      data-story-frame="lesson"
    >
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-red-400">{lessonKicker(lesson)}</span>
      <span className="mt-2 block text-[28px] font-black leading-[1.08]">{lesson.title}</span>
      {lesson.visual && (
        <div className="mt-4 rounded-2xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10" aria-label={visualLabel(lesson.visual)}>
          <LessonVisualArt visual={lesson.visual} tone="dark" />
        </div>
      )}
      {showHook && <p className="mt-4 line-clamp-3 text-[17px] font-semibold leading-snug text-white/85">{hook}</p>}
    </div>
  );
}
