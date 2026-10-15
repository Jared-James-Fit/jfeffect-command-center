import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { signCommunityPaths } from "@/lib/community-media";
import { cn } from "@/lib/utils";

/** The bits of a message attachment (kind "community_post") the card reads. */
export type PostCardAttachment = {
  post_id?: string;
  title?: string | null;
  request_note?: string | null;
  /** The post's author (replies). */
  name?: string | null;
  thumb_path?: string | null;
  /** Sent from the post's "Message" button. */
  reply?: boolean;
  /** Sent from the story viewer (a message or a quick emoji). */
  story?: boolean;
};

/** A message that answers a story or post: its card leads, Instagram style. */
export function postReplyCard(attachments: unknown): PostCardAttachment | null {
  if (!Array.isArray(attachments)) return null;
  const a = attachments.find((x: any) => x?.kind === "community_post" && x?.post_id && x?.reply);
  return (a as PostCardAttachment) ?? null;
}

/** One to three emoji and nothing else: shown big, without a bubble (like Instagram's 🤩). */
export function isJumboEmoji(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 24) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u.test(t)) return false;
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? [...new (Intl as any).Segmenter(undefined, { granularity: "grapheme" }).segment(t.replace(/\s+/g, ""))].length
    : t.replace(/\s+/g, "").length;
  return seg >= 1 && seg <= 3 && /\p{Extended_Pictographic}/u.test(t);
}

function useCommunityThumb(path: string | null) {
  return useQuery({
    queryKey: ["community-thumb", path],
    enabled: !!path,
    staleTime: 40 * 60_000,
    queryFn: async () => (await signCommunityPaths([path]))[path!] ?? null,
  });
}

/**
 * A community post inside a chat. A reply (to a story, or from a post's
 * Message button) reads like Instagram's: "Replied to your story" over a big
 * cover of it (the photo, or the words on the story's own dark-red look), and
 * a tap opens it. A post shared any other way stays a compact card.
 */
export function CommunityPostChatCard({ att, mine, staff }: { att: PostCardAttachment; mine: boolean; staff: boolean }) {
  const path = att.thumb_path ?? null;
  const { data: signed } = useCommunityThumb(path);
  // A photo that won't load (expired story, deleted file) falls back to the words.
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = signed && signed !== broken ? signed : null;
  if (!att.post_id) return null;
  const birthday = /birthday/i.test(att.title ?? "");
  const what = att.story ? "story" : "post";
  const label = att.reply
    ? mine ? `You replied to ${att.name ? `${att.name}'s` : "their"} ${what}` : `Replied to your ${what}`
    : null;
  const to = staff ? "/admin/community" : "/portal/community";

  if (att.reply) {
    const words = att.request_note?.trim() || null;
    return (
      <div className={cn("flex max-w-full flex-col gap-1.5", mine ? "items-end" : "items-start")} data-post-reply-card>
        <span className="px-1 text-[12px] font-medium text-muted-foreground">{label}</span>
        <div className={cn("flex items-stretch gap-2", mine && "flex-row-reverse")}>
          <span className="w-[3px] shrink-0 rounded-full bg-border" aria-hidden />
          <Link
            to={to}
            hash={`post=${att.post_id}`}
            aria-label={`Open ${att.title || `the ${what}`}`}
            className={cn(
              "relative block shrink-0 overflow-hidden rounded-2xl bg-zinc-950 shadow-sm ring-1 ring-black/5 transition active:scale-[0.98]",
              att.story ? "aspect-[9/16] w-[136px]" : "aspect-[4/5] w-[168px]",
            )}
          >
            {thumb ? (
              <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" draggable={false} onError={() => setBroken(thumb)} />
            ) : (
              // No photo: the words, the way the story itself shows them.
              <span className="absolute inset-0 flex flex-col bg-[radial-gradient(120%_90%_at_80%_0%,rgba(239,51,64,0.45),transparent_60%)] p-2.5 text-white">
                {att.name && <span className="truncate text-[10px] font-semibold text-white/70">{att.name}</span>}
                <span className="flex flex-1 items-center justify-center text-center">
                  {birthday ? (
                    <span className="text-[44px] leading-none">🎂</span>
                  ) : (
                    <span className="line-clamp-[7] whitespace-pre-wrap break-words text-[13px] font-bold leading-snug">
                      {words || att.title || "Community post"}
                    </span>
                  )}
                </span>
              </span>
            )}
            {thumb && att.name && (
              <span className="absolute inset-x-0 top-0 truncate bg-gradient-to-b from-black/55 to-transparent px-2.5 pb-4 pt-2 text-[10px] font-semibold text-white/90">
                {att.name}
              </span>
            )}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex max-w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
      <Link
        to={to}
        hash={`post=${att.post_id}`}
        className="flex w-[260px] max-w-full items-center gap-3 rounded-2xl border border-border bg-background p-2.5 text-left text-foreground shadow-sm transition hover:bg-muted/60 active:scale-[0.98]"
      >
        {thumb ? (
          <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" onError={() => setBroken(thumb)} />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-[22px]">{birthday ? "🎂" : "💬"}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{att.title || "Community post"}</span>
          {att.request_note && <span className="block truncate text-[12px] text-muted-foreground">{att.request_note}</span>}
          <span className="mt-0.5 block text-[12px] font-bold text-primary">View post</span>
        </span>
      </Link>
    </div>
  );
}

/**
 * The words of a story/post reply, under its cover: their own bubble, or one
 * to three emoji shown big with no bubble at all.
 */
export function PostReplyText({ body, mine, children }: { body: string; mine: boolean; children: ReactNode }) {
  if (isJumboEmoji(body)) {
    return <div className={cn("mt-1 px-1 text-[44px] leading-none", mine ? "text-right" : "text-left")} data-jumbo-emoji>{body.trim()}</div>;
  }
  return (
    <div className={cn("mt-1.5 flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn(
        "w-fit max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm",
        mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
      )}>
        {children}
      </div>
    </div>
  );
}
