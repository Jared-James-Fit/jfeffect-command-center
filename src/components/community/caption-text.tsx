import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MentionText } from "@/components/community/mentions";
import { captionParagraphs } from "@/lib/caption-preview";
import type { CommunityAuthor, CommunityMention } from "@/lib/community";

/**
 * A caption shown whole (Nov 21 2026): its paragraphs as written, each its own
 * block with a measured gap between them (never a wall, never a full empty
 * line), a single line break inside one kept. `lead` sits at the start of the
 * first paragraph (Instagram's bold name), `trail` at the end of the last
 * ("… more"). The size and leading are the caller's.
 */
export function CaptionText({
  text,
  mentions,
  onOpenPerson,
  lead,
  trail,
  className,
}: {
  text: string;
  mentions?: CommunityMention[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
  lead?: ReactNode;
  trail?: ReactNode;
  className?: string;
}) {
  const paragraphs = captionParagraphs(text);
  if (!paragraphs.length && !lead && !trail) return null;
  return (
    <div className={cn("[&>p+p]:mt-[0.7em]", className)} data-caption-text>
      {(paragraphs.length ? paragraphs : [""]).map((p, i, all) => (
        <p key={i} className="whitespace-pre-line break-words">
          {i === 0 && lead}
          <MentionText text={p} mentions={mentions} onOpen={onOpenPerson} />
          {i === all.length - 1 && trail}
        </p>
      ))}
    </div>
  );
}
