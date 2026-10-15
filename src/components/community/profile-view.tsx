import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Camera, Lock, Pencil, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { CloseFriendsButton, FollowButton, FollowCounts, FollowRequestBanner, FollowRequestsButton, FollowsYouTag } from "@/components/community/follow-button";
import { useFollowState, useSetPrivate } from "@/lib/community-social";
import { AvatarCropper } from "@/components/avatar-cropper";
import { CoachBadge } from "@/components/community/post-card";
import { PostTileFace, postThumbPath } from "@/components/community/post-tile";
import { BIO_MAX, trainingSinceLabel, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { useCommunityFeed, useCommunityProfile, useMyArchived, useMyCommunitySettings, usePostMediaUrls, useSetAutoShare, useSetBio, useSetCommunityAvatar } from "@/lib/community.queries";

/**
 * A person's corner of the community: photo, name, a short bio, follower /
 * following counts (Instagram-style) and a grid of what they chose to share.
 * A private account you don't follow shows only its automatic workout
 * stories, with Request to follow. No reaction totals.
 */
export function ProfileView({ userId, unit, onOpenPost, onOpenPerson }: { userId: string; unit: "kg" | "lb"; onOpenPost: (post: CommunityPost) => void; onOpenPerson?: (a: CommunityAuthor) => void }) {
  const { data: profile, isLoading } = useCommunityProfile(userId);
  // coaches follow a private account straight away (no request), so it acts public for them
  const { role } = useAuth();
  const viewerIsStaff = role === "admin" || role === "coach";
  const feed = useCommunityFeed(userId);
  const shown = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  // Your own profile: Posts | Archived (Instagram-style, only you see Archived)
  const [showArchived, setShowArchived] = useState(false);
  const archivedQ = useMyArchived(showArchived);
  const posts = showArchived ? archivedQ.data ?? [] : shown;
  const { data: urls } = usePostMediaUrls(posts);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const saveBio = useSetBio(userId);
  const setAvatar = useSetCommunityAvatar(userId);
  const photoRef = useRef<HTMLInputElement | null>(null);
  // A picked photo goes through "Move and scale" before it's saved.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  useEffect(() => () => { if (cropSrc) URL.revokeObjectURL(cropSrc); }, [cropSrc]);

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
  const meta = [`${profile.posts} ${profile.posts === 1 ? "post" : "posts"}`, since].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="flex items-center gap-4">
        {/* Your own photo: tap to add / change. Community-only, never your account photo. */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            disabled={!profile.is_me || setAvatar.isPending}
            onClick={() => photoRef.current?.click()}
            className="relative rounded-full bg-[linear-gradient(135deg,#ffb054,#ef3340)] p-[3px] disabled:cursor-default"
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
                if (!f) return;
                if (f.type && !f.type.startsWith("image/")) return void toast.error("Pick a photo");
                setCropSrc(URL.createObjectURL(f));
              }}
            />
          )}
          {profile.is_me && (
            <AvatarCropper
              src={cropSrc}
              open={!!cropSrc}
              onCancel={() => setCropSrc(null)}
              onDone={(blob) => {
                setCropSrc(null);
                const file = new File([blob], "community-photo.jpg", { type: "image/jpeg" });
                setAvatar.mutate(file, { onSuccess: () => toast.success("Photo updated"), onError: (err: any) => toast.error(err?.message ?? "Couldn't upload that photo") });
              }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="font-display truncate text-[28px] uppercase leading-none">{profile.author.name}</h2>
            {profile.author.is_coach && <CoachBadge />}
          </div>
          {profile.author.is_coach && <div className="mt-1 text-[12px] font-bold text-foreground/80">{profile.author.title || "Coach · JF Effect"}</div>}
          <div className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
            {profile.is_private && <Lock className="h-3 w-3" aria-label="Private account" />}
            {meta}
          </div>
          <FollowCounts
            userId={profile.author.user_id}
            name={profile.author.name}
            isMe={profile.is_me}
            canSee={profile.can_see ?? true}
            followers={profile.followers ?? 0}
            following={profile.following ?? 0}
            onOpen={onOpenPerson}
          />
          {!profile.is_me && <FollowsYouTag userId={profile.author.user_id} className="mt-1.5 inline-block" />}
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

      {/* Instagram's row: full-width actions under the bio */}
      {profile.is_me ? (
        !profile.author.is_coach && (
          <div className="mt-3 flex gap-2">
            <FollowRequestsButton onOpen={onOpenPerson} className="h-9 flex-1 justify-center text-[13px]" />
            <CloseFriendsButton className="h-9 flex-1 justify-center text-[13px]" />
          </div>
        )
      ) : (
        <div className="mt-3 flex gap-2">
          <FollowButton userId={profile.author.user_id} name={profile.author.name} avatarUrl={profile.author.avatar_url} isPrivate={!!profile.is_private && !viewerIsStaff} className="flex-1" />
        </div>
      )}

      {!profile.is_me && <FollowRequestBanner userId={profile.author.user_id} name={profile.author.name} />}

      {profile.is_me && <PulseSwitch />}
      {profile.is_me && !profile.author.is_coach && <PrivateSwitch />}

      {!profile.is_me && profile.can_see === false && (
        <div data-private-profile className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-foreground/80"><Lock className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">This account is private</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">Follow to see their posts and stories. Their automatic workout stories show for everyone.</span>
          </span>
        </div>
      )}

      {profile.is_me && ((profile.archived ?? 0) > 0 || showArchived) && (
        <div className="mt-4 flex items-center gap-1.5" role="tablist" aria-label="Your posts">
          {([[false, "Posts"], [true, `Archived${profile.archived ? ` · ${profile.archived}` : ""}`]] as const).map(([arch, label]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={showArchived === arch}
              onClick={() => setShowArchived(arch)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold",
                showArchived === arch ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
              )}
            >
              {arch && <Archive className="h-3.5 w-3.5" />} {label}
            </button>
          ))}
        </div>
      )}
      {showArchived && <p className="mt-2 text-[11px] text-muted-foreground">Only you can see these. Open one and use ••• to show it on your profile again.</p>}

      <div className="mt-4 grid grid-cols-3 gap-1 overflow-hidden rounded-2xl">
        {posts.map((p) => {
          const thumb = urls?.[postThumbPath(p) ?? ""] ?? null;
          return (
            <button key={p.id} type="button" onClick={() => onOpenPost(p)} className="relative aspect-square overflow-hidden bg-muted" aria-label={`Open ${p.stats?.workout_title ?? p.session_title ?? "workout"}`}>
              <PostTileFace post={p} thumb={thumb} unit={unit} />
              {p.visibility === "close_friends" ? (
                <Star className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 fill-emerald-400 text-emerald-400 drop-shadow" aria-label="Close friends" />
              ) : p.visibility !== "community" && p.visibility !== "followers" ? (
                <Lock className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-white drop-shadow" />
              ) : null}
            </button>
          );
        })}
      </div>
      {posts.length === 0 && !(showArchived ? archivedQ.isLoading : feed.isLoading) && (
        <div className="mt-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground">
          {showArchived ? "Nothing archived." : profile.is_me ? "Lock in at your next session, or share a finished workout. It shows up here." : "Nothing shared yet."}
        </div>
      )}
      {!showArchived && feed.hasNextPage && (
        <Button type="button" variant="ghost" className="mt-2 w-full" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
          {feed.isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}

/** Your own profile: automatic sharing on or off (a finished workout posts itself to your story). */
function PulseSwitch() {
  const { isImpersonating } = useClientImpersonation();
  const { data } = useMyCommunitySettings(!isImpersonating);
  const set = useSetAutoShare();
  if (isImpersonating || !data) return null;
  return (
    <label data-pulse-switch className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-bold">Share my workouts</span>
        <span className="block text-[11.5px] leading-snug text-muted-foreground">Post my finished workouts to my story automatically (24 hours), with the session's best win</span>
      </span>
      <Switch checked={data.auto_share_workouts} disabled={set.isPending} onCheckedChange={(on) => set.mutate(on, { onError: () => toast.error("Couldn't save that") })} />
    </label>
  );
}

/** Your own profile: private account on or off (members only; a coach's account stays public). */
function PrivateSwitch() {
  const { isImpersonating } = useClientImpersonation();
  const { data: state } = useFollowState(!isImpersonating);
  const set = useSetPrivate();
  // Instagram asks before either switch: going public shows everything at once and lets everyone waiting in
  const [ask, setAsk] = useState<boolean | null>(null);
  if (isImpersonating || !state) return null;
  const waiting = state.requests.length;
  const save = (on: boolean) =>
    set.mutate(on, {
      onSuccess: () => toast.success(on ? "Your account is private" : "Your account is public", { description: on ? "People who already follow you still do." : waiting ? "Everyone waiting to follow you is in now." : undefined }),
      onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
    });
  return (
    <>
      <label data-private-switch className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3">
        <span className="min-w-0">
          <span className="block text-[13px] font-bold">Private account</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">
            {state.is_private
              ? "Only followers you approve see your posts and stories. Your automatic workout stories still show for everyone."
              : "Anyone in the crew can follow you and see your posts. Turn on to approve followers first."}
          </span>
        </span>
        <Switch checked={state.is_private} disabled={set.isPending} onCheckedChange={(on) => setAsk(on)} />
      </label>
      <Sheet open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[420px]">
          <div data-private-confirm className="px-6 pb-3 pt-6 text-center">
            <SheetTitle className="text-[16px] font-black">{ask ? "Switch to private account?" : "Switch to public account?"}</SheetTitle>
            <SheetDescription className="mt-2 text-[13px] leading-snug">
              {ask
                ? "Only followers you approve will see your posts and stories. People who already follow you still will. Your automatic workout stories still show for everyone."
                : `Anyone in the crew will be able to see your posts and stories.${waiting ? ` ${waiting === 1 ? "The 1 person" : `The ${waiting} people`} waiting to follow you will be approved.` : ""}`}
            </SheetDescription>
          </div>
          <div className="border-t border-border/60">
            <button
              type="button"
              className="h-12 w-full text-[14px] font-bold text-primary active:bg-muted"
              onClick={() => {
                const on = !!ask;
                setAsk(null);
                save(on);
              }}
            >
              {ask ? "Switch to private" : "Switch to public"}
            </button>
            <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
