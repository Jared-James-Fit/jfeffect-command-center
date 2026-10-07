import { useMemo, useRef, useState } from "react";
import { Camera, Lock, Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge, LockInHero, WorkoutHero } from "@/components/community/post-card";
import { BIO_MAX, trainingSinceLabel, type CommunityPost } from "@/lib/community";
import { useCommunityFeed, useCommunityProfile, usePostMediaUrls, useSetBio, useSetCommunityAvatar } from "@/lib/community.queries";

/**
 * A person's corner of the community: photo, name, a short bio and a grid of
 * the workouts they chose to share. Deliberately no follower counts or
 * reaction totals.
 */
export function ProfileView({ userId, unit, onOpenPost }: { userId: string; unit: "kg" | "lb"; onOpenPost: (post: CommunityPost) => void }) {
  const { data: profile, isLoading } = useCommunityProfile(userId);
  const feed = useCommunityFeed(userId);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  const { data: urls } = usePostMediaUrls(posts);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const saveBio = useSetBio(userId);
  const setAvatar = useSetCommunityAvatar(userId);
  const photoRef = useRef<HTMLInputElement | null>(null);

  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-none" />
          ))}
        </div>
      </div>
    );
  }

  const since = trainingSinceLabel(profile.training_since);
  const meta = [`${profile.posts} ${profile.posts === 1 ? "workout" : "workouts"} shared`, since].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="flex items-center gap-4">
        {/* Your own photo: tap to add / change. Community-only, never your account photo. */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            disabled={!profile.is_me || setAvatar.isPending}
            onClick={() => photoRef.current?.click()}
            className="relative rounded-full bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)] p-[3px] disabled:cursor-default"
            aria-label={profile.is_me ? (profile.author.avatar_url ? "Change your community photo" : "Add a community photo") : undefined}
          >
            <span className={cn("block rounded-full bg-background p-[2px]", setAvatar.isPending && "animate-pulse")}>
              <UserAvatar src={profile.author.avatar_url} name={profile.author.name} size={78} expandable={false} />
            </span>
            {profile.is_me && (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-foreground text-background">
                <Camera className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
          {profile.is_me && !profile.author.avatar_url && <span className="text-[11px] font-bold text-primary">Add photo</span>}
          {profile.is_me && profile.author.avatar_url && (
            <button type="button" disabled={setAvatar.isPending} className="text-[11px] font-semibold text-muted-foreground" onClick={() => setAvatar.mutate(null, { onError: (e: any) => toast.error(e?.message ?? "Couldn't remove it") })}>
              Remove
            </button>
          )}
          {profile.is_me && (
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setAvatar.mutate(f, { onSuccess: () => toast.success("Photo updated"), onError: (err: any) => toast.error(err?.message ?? "Couldn't upload that photo") });
              }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="font-display truncate text-[28px] uppercase leading-none">{profile.author.name}</h2>
            {profile.author.is_coach && <CoachBadge />}
          </div>
          <div className="mt-1 text-[12px] font-semibold text-muted-foreground">{meta}</div>
        </div>
      </div>

      <div className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <Textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))} rows={2} autoFocus placeholder="Lifter, goal, weight class… whatever you want people to know." className="resize-none rounded-2xl text-[16px]" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] tabular-nums text-muted-foreground">{bio.length}/{BIO_MAX}</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saveBio.isPending}
                  onClick={() => saveBio.mutate(bio, { onSuccess: () => setEditing(false), onError: (e: any) => toast.error(e?.message ?? "Couldn't save") })}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : profile.bio ? (
          <p className="whitespace-pre-line text-[14px] leading-snug">
            {profile.bio}
            {profile.is_me && (
              <button type="button" className="ml-2 inline-flex items-center gap-1 text-[12px] font-bold text-muted-foreground" onClick={() => { setBio(profile.bio ?? ""); setEditing(true); }}>
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
          </p>
        ) : profile.is_me ? (
          <button type="button" className="text-[13px] font-bold text-primary" onClick={() => { setBio(""); setEditing(true); }}>
            + Add a short bio
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1 overflow-hidden rounded-2xl">
        {posts.map((p) => {
          const thumb = urls?.[p.media_thumb_path ?? (p.media_type === "image" ? p.media_path ?? "" : "")] ?? null;
          return (
            <button key={p.id} type="button" onClick={() => onOpenPost(p)} className="relative aspect-square overflow-hidden bg-muted" aria-label={`Open ${p.stats?.workout_title ?? p.session_title ?? "workout"}`}>
              {p.media_type && thumb ? (
                <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : p.stats ? (
                <WorkoutHero stats={p.stats} unit={unit} size="tile" />
              ) : p.locked_in_at ? (
                <LockInHero post={p} size="tile" />
              ) : (
                <div className="h-full w-full bg-muted" />
              )}
              {p.media_type === "video" && <Play className="absolute right-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />}
              {p.visibility === "private" && <Lock className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>
      {posts.length === 0 && !feed.isLoading && (
        <div className="mt-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground">
          {profile.is_me ? "Your shared workouts show up here. Finish a session and tap Share workout." : "Nothing shared yet."}
        </div>
      )}
      {feed.hasNextPage && (
        <Button type="button" variant="ghost" className="mt-2 w-full" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
          {feed.isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
