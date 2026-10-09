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
};

/**
 * A community post inside a chat: its photo (when it has one), what it is,
 * and a tap that opens it. Replies read like Instagram's: "Replied to your
 * post" for the person who posted it, "You replied to Amanda's post" for the
 * one who sent it.
 */
export function CommunityPostChatCard({ att, mine, staff }: { att: PostCardAttachment; mine: boolean; staff: boolean }) {
  const path = att.thumb_path ?? null;
  const { data: thumb } = useQuery({
    queryKey: ["community-thumb", path],
    enabled: !!path,
    staleTime: 40 * 60_000,
    queryFn: async () => (await signCommunityPaths([path]))[path!] ?? null,
  });
  if (!att.post_id) return null;
  const birthday = /birthday/i.test(att.title ?? "");
  const label = att.reply
    ? mine ? `You replied to ${att.name ? `${att.name}'s` : "their"} post` : "Replied to your post"
    : null;
  return (
    <div className={cn("flex max-w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
      {label && <span className="px-1 text-[11px] font-semibold opacity-75">{label}</span>}
      <Link
        to={staff ? "/admin/community" : "/portal/community"}
        hash={`post=${att.post_id}`}
        className="flex w-[260px] max-w-full items-center gap-3 rounded-2xl border border-border bg-background p-2.5 text-left text-foreground shadow-sm transition hover:bg-muted/60 active:scale-[0.98]"
      >
        {thumb ? (
          <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
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
