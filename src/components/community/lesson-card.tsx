import { cn } from "@/lib/utils";
import type { CommunityPost } from "@/lib/community";
import { extraLesson, hookLine, storyFrameLayout } from "@/lib/lessons";
import { LessonVisualArt, visualLabel } from "@/components/community/lesson-visuals";

/**
 * A coach lesson's diagram, shown like a picture the coach posted: just the
 * drawing on a quiet card, nothing over or under it. A lesson reads like any
 * other post of his, so there's no series label ("Methods & cues"), no
 * sources list and no disclaimer in the feed or the story: the words cite
 * the research the way he would ("a 2021 meta-analysis found…"), and the
 * sources stay on file for him in the lesson planner. Null without a diagram.
 */
export function LessonDiagram({ post, className }: { post: CommunityPost; className?: string }) {
  const lesson = extraLesson(post);
  if (!lesson?.visual) return null;
  return (
    <div
      className={cn("rounded-2xl border border-border/70 bg-muted/40 px-3.5 py-3", className)}
      data-lesson-diagram={lesson.track}
    >
      <LessonVisualArt visual={lesson.visual} />
    </div>
  );
}

/**
 * A lesson as a story: its title, the diagram, and the first line of the post.
 * The rest is one swipe up ("Post"), and the sticker sits under it.
 */
export function LessonStoryFrame({ post }: { post: CommunityPost }) {
  const lesson = extraLesson(post);
  if (!lesson) return null;
  const hook = hookLine(post.caption);
  // always clear of the name row up top and the reply bar below (storyFrameLayout);
  // with a sticker under it, the lesson sits up top; moved up top, the lesson
  // goes under it. The hook only fits without a diagram.
  const sticker = !!post.sticker;
  const layout = storyFrameLayout(post.sticker);
  const showHook = !!hook && !(sticker && lesson.visual);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-zinc-950 bg-[radial-gradient(120%_70%_at_100%_0%,rgba(239,51,64,0.38),transparent_60%)] px-6",
        layout.place === "bottom" ? "justify-end" : layout.place === "top" ? "justify-start" : "justify-center",
      )}
      style={layout.style}
      data-story-frame="lesson"
      data-story-place={layout.place}
    >
      {/* no "Methods & cues" style label: it's his story, not a series' */}
      <span className="block text-[28px] font-black leading-[1.08]">{lesson.title}</span>
      {lesson.visual && (
        <div className="mt-4 rounded-2xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10" aria-label={visualLabel(lesson.visual)}>
          <LessonVisualArt visual={lesson.visual} tone="dark" />
        </div>
      )}
      {showHook && <p className="mt-4 line-clamp-3 text-[17px] font-semibold leading-snug text-white/85">{hook}</p>}
    </div>
  );
}
