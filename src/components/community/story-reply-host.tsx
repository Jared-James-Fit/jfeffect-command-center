import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShareStudio, StudioShell } from "@/components/community/studio-chunks";
import type { StudioPost } from "@/components/community/share-studio";
import type { SharePicture, StickerItem } from "@/components/community/sticker-layer";
import { markStickerAnswered } from "@/lib/lessons.queries";
import { signCommunityPaths } from "@/lib/community-media";
import { storyFrameKind, storyWords, type CommunityPost } from "@/lib/community";
import { STORY_REPLY_EVENT, STORY_SHARE_EVENT, registerStoryShareHost, shareCardWords, type StoryReply, type StoryShare } from "@/lib/story-reply";

/** A picture for the shared post's card, decoded from its bytes (never a tainted canvas); null if it can't be had in time. */
async function loadPicture(url: string | null | undefined): Promise<SharePicture | null> {
  if (!url) return null;
  const load = async (): Promise<SharePicture | null> => {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") {
      try {
        const b = await createImageBitmap(blob);
        return { img: b, w: b.width, h: b.height };
      } catch {
        /* a format it can't decode this way (an SVG): the <img> below */
      }
    }
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  };
  try {
    return await Promise.race([load(), new Promise<null>((r) => window.setTimeout(() => r(null), 6000))]);
  } catch {
    return null;
  }
}

/** The shared post's card: its author, its picture (the photo itself, or a clip's poster) and its words. */
async function buildShareItem(post: CommunityPost, unit: "kg" | "lb"): Promise<StickerItem> {
  const path = post.media_type === "image" ? post.media_path : post.media_thumb_path;
  const signed = path ? await signCommunityPaths([path]).catch(() => ({}) as Record<string, string>) : {};
  const pictureUrl = (path && signed[path]) || (!post.media_type ? post.gif_url : null) || null;
  const [picture, avatar, { postShareCardItem }] = await Promise.all([
    storyFrameKind(post) === "media" ? loadPicture(pictureUrl) : Promise.resolve(null),
    loadPicture(post.author.avatar_url),
    import("@/components/community/sticker-layer"),
  ]);
  const { title, body } = shareCardWords(post, unit);
  // a photo that wouldn't load (and has no words) still says what it is
  const said = title ?? (!picture && !body ? (post.media_type === "video" ? "A clip" : post.media_type ? "A photo" : storyWords(post).text) : null);
  return postShareCardItem({ name: post.author.name, avatar, picture, video: post.media_type === "video", title: said, body });
}

/**
 * Where stories made from something else are made, mounted once on the Crew
 * screen (never in a coach's "View as client", where nothing posts):
 *  - a reply to a question response (openStoryReply): the story camera,
 *    straight into its editor with the response card on a backdrop and the
 *    keyboard up; posting marks the response answered.
 *  - Add to your story (openStoryShare, a post's ✈️): the post as a card on
 *    a backdrop; the story keeps which post it shares (View post opens it).
 * While it's mounted, Add to your story is offered (storyShareReady).
 */
export function StoryReplyHost({ unit = "lb" }: { unit?: "kg" | "lb" }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState<StoryReply | null>(null);
  const [share, setShare] = useState<{ key: string; post: CommunityPost; item: StickerItem | null } | null>(null);
  const unitRef = useRef(unit);
  unitRef.current = unit;
  useEffect(() => registerStoryShareHost(), []);
  useEffect(() => {
    const onReply = (e: Event) => {
      setShare(null);
      setReply((e as CustomEvent<StoryReply>).detail ?? null);
    };
    const onShare = (e: Event) => {
      const post = (e as CustomEvent<StoryShare>).detail?.post;
      if (!post) return;
      const key = `share:${post.id}:${Date.now()}`;
      setReply(null);
      setShare({ key, post, item: null });
      void buildShareItem(post, unitRef.current)
        .then((item) => setShare((cur) => (cur && cur.key === key ? { ...cur, item } : cur)))
        .catch(() => {});
    };
    window.addEventListener(STORY_REPLY_EVENT, onReply);
    window.addEventListener(STORY_SHARE_EVENT, onShare);
    return () => {
      window.removeEventListener(STORY_REPLY_EVENT, onReply);
      window.removeEventListener(STORY_SHARE_EVENT, onShare);
    };
  }, []);
  if (share) {
    // a story never uses onPost (the studio posts it itself)
    const post: StudioPost = { key: share.key, label: "Your story", onPost: async () => {} };
    const close = () => setShare(null);
    return (
      <StudioShell onClose={close}>
        <ShareStudio key={share.key} open onClose={close} card={null} post={post} startAs="story" allowNoPhoto={false} accept="image/*" share={{ postId: share.post.id, item: share.item }} />
      </StudioShell>
    );
  }
  if (!reply) return null;
  const key = `reply:${reply.postId}:${reply.userId}`;
  // a story never uses onPost (the studio posts it itself)
  const post: StudioPost = { key, label: "Your story", onPost: async () => {} };
  const close = () => setReply(null);
  return (
    <StudioShell onClose={close}>
      <ShareStudio
        key={key}
        open
        onClose={close}
        card={null}
        post={post}
        startAs="story"
        allowNoPhoto={false}
        accept="image/*"
        reply={{
          question: reply.question,
          answer: reply.answer,
          onPosted: async (id) => {
            await markStickerAnswered(qc, { postId: reply.postId, userId: reply.userId, replyPostId: id });
          },
        }}
      />
    </StudioShell>
  );
}
