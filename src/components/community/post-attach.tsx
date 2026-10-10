import { useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { removeCommunityFiles, uploadVoiceMemo } from "@/lib/community-media";
import { communityKeys, invalidateCommunity, useFullMediaUrl } from "@/lib/community.queries";
import { useQueryClient } from "@tanstack/react-query";
import type { CommunityPost } from "@/lib/community";
import { GifPicker } from "@/components/gif-picker";
import { RecordingBar, VoiceMemoPlayer, useVoiceMemoRecorder } from "@/components/community/voice-memo";

const db = supabase as any;

/** What a post has on it already (the shape of a my-post row). */
export type PostAttachInitial = { gif_url?: string | null; audio_path?: string | null; audio_duration?: number | null };

export const attachOfPost = (p: Pick<CommunityPost, "gif_url" | "audio"> | null | undefined): PostAttachInitial | null =>
  p ? { gif_url: p.gif_url ?? null, audio_path: p.audio?.path ?? null, audio_duration: p.audio?.duration ?? null } : null;

type Voice = { duration: number; blob?: Blob; local?: string; path?: string };

/**
 * A post's GIF and voice memo while it's being written: pick one GIF from
 * the library, record up to two minutes. Nothing is uploaded until the post
 * is saved; `save(postId)` then puts them on it (or takes them off).
 */
export function usePostAttach({ initial, key, open = true }: { initial: PostAttachInitial | null | undefined; key: string; open?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [gif, setGif] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<Voice | null>(null);
  const [changed, setChanged] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const localRef = useRef<string | null>(null);

  const setVoice = (v: Voice | null) => {
    if (localRef.current && localRef.current !== v?.local) URL.revokeObjectURL(localRef.current);
    localRef.current = v?.local ?? null;
    setVoiceState(v);
  };
  const recorder = useVoiceMemoRecorder((v) => {
    setVoice({ duration: v.duration, blob: v.blob, local: v.url });
    setChanged(true);
  });

  // a new post / a different post / reopened: back to what it has
  useEffect(() => {
    if (!open) return;
    setGif(initial?.gif_url ?? null);
    setVoice(initial?.audio_path ? { path: initial.audio_path, duration: Number(initial.audio_duration) || 0 } : null);
    setChanged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);
  useEffect(() => () => void (localRef.current && URL.revokeObjectURL(localRef.current)), []);

  const signed = useFullMediaUrl(voice?.path, !!voice?.path).data ?? null;

  return {
    gif,
    voice,
    voiceSrc: voice?.local ?? signed,
    changed,
    recorder,
    gifOpen,
    setGifOpen,
    pickGif: (url: string) => {
      setGif(url);
      setChanged(true);
      setGifOpen(false);
    },
    removeGif: () => {
      setGif(null);
      setChanged(true);
    },
    removeVoice: () => {
      setVoice(null);
      setChanged(true);
    },
    /** Stop a recording that's still going (closing the composer). */
    discard: () => {
      if (recorder.recording) recorder.cancel();
    },
    /** Put them on the post (only when something changed). */
    save: async (postId: string) => {
      if (!changed) return;
      if (!user?.id) throw new Error("Sign in again to post");
      const path = voice?.blob ? await uploadVoiceMemo(voice.blob, user.id) : voice?.path ?? null;
      const { error } = await db.rpc("community_set_post_extras", {
        _post_id: postId,
        _gif_url: gif,
        _audio_path: path,
        _audio_duration: voice ? Math.round(voice.duration * 10) / 10 : null,
      });
      if (error) {
        if (voice?.blob) await removeCommunityFiles([path]);
        throw error;
      }
      // the memo it had is gone (removed or re-recorded)
      if (initial?.audio_path && initial.audio_path !== path) await removeCommunityFiles([initial.audio_path]);
      if (voice?.blob && path) setVoice({ path, duration: voice.duration });
      setChanged(false);
      invalidateCommunity(qc);
      qc.invalidateQueries({ queryKey: communityKeys.post(postId) });
    },
  };
}

export type PostAttach = ReturnType<typeof usePostAttach>;

/** GIF and Voice, as two small buttons (the ones already on the post drop out). */
export function AttachButtons({ a, dark, small, className }: { a: PostAttach; dark?: boolean; small?: boolean; className?: string }) {
  const chip = cn(
    "inline-flex shrink-0 items-center justify-center gap-1 px-3 text-[13px] font-black active:scale-95 disabled:opacity-40",
    small ? "h-9 rounded-full" : "h-11 rounded-2xl",
    dark ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-muted text-foreground",
  );
  if (a.recorder.recording) return null;
  return (
    <div className={cn("flex shrink-0 gap-2", className)}>
      {!a.gif && (
        <button type="button" onClick={() => a.setGifOpen(true)} className={chip} aria-label="Add a GIF">
          GIF
        </button>
      )}
      {!a.voice && (
        <button type="button" onClick={() => void a.recorder.start()} className={cn(chip, small ? "w-9 px-0" : "w-11 px-0")} aria-label="Record a voice memo">
          <Mic className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}

/** What's attached (GIF, voice memo, a recording in progress), each with a way off. */
export function AttachPreview({ a, dark, className }: { a: PostAttach; dark?: boolean; className?: string }) {
  if (!a.gif && !a.voice && !a.recorder.recording) return null;
  const x = cn("absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full shadow ring-2", dark ? "bg-white text-black ring-black" : "bg-foreground text-background ring-background");
  return (
    <div data-post-attach className={cn("flex flex-wrap items-center gap-3", className)}>
      {a.recorder.recording && (
        <RecordingBar
          elapsed={a.recorder.elapsed}
          levels={a.recorder.levels}
          onCancel={a.recorder.cancel}
          onDone={() => void a.recorder.finish()}
          className={cn("w-full", dark && "bg-white/10 text-white")}
        />
      )}
      {a.gif && (
        <div className="relative">
          <img src={a.gif} alt="GIF" className="h-16 w-16 rounded-xl object-cover" />
          <button type="button" onClick={a.removeGif} className={x} aria-label="Remove GIF">
            <X className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        </div>
      )}
      {a.voice && (
        <div className="relative">
          <VoiceMemoPlayer src={a.voiceSrc} duration={a.voice.duration} className={cn(dark && "bg-white/10 text-white")} />
          <button type="button" onClick={a.removeVoice} className={x} aria-label="Remove voice memo">
            <X className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}

/** The library, opened from the GIF button. */
export function AttachGifPicker({ a }: { a: PostAttach }) {
  return <GifPicker hideTrigger asDialog showSounds={false} controlledOpen={a.gifOpen} onControlledOpenChange={a.setGifOpen} onPick={(g) => a.pickGif(g.media_url)} />;
}

/** Buttons, previews and the picker together, for a sheet or dialog. */
export function PostAttachRow({ a, className }: { a: PostAttach; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <AttachPreview a={a} />
      <AttachButtons a={a} small />
      <AttachGifPicker a={a} />
    </div>
  );
}

/**
 * On a post: its GIF (playing, as it is) and voice memo (tap to play).
 * Nothing when it has neither.
 */
export function PostExtras({ post, className }: { post: Pick<CommunityPost, "id" | "gif_url" | "audio">; className?: string }) {
  const src = useFullMediaUrl(post.audio?.path, !!post.audio).data ?? null;
  if (!post.gif_url && !post.audio) return null;
  return (
    <div data-post-extras className={cn("flex flex-col items-start gap-2", className)} onClick={(e) => e.stopPropagation()}>
      {post.gif_url && <img src={post.gif_url} alt="GIF" loading="lazy" className="max-h-[220px] max-w-[240px] rounded-2xl object-cover" />}
      {post.audio && <VoiceMemoPlayer src={src} duration={post.audio.duration} seed={hashSeed(post.id)} />}
    </div>
  );
}

const hashSeed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 997 + 1;
