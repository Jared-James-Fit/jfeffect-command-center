import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bookmark, Camera, Dumbbell, Grid3x3, Lock, MapPin, MoreHorizontal, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { CloseFriendsButton, FollowButton, FollowCounts, FollowRequestBanner, FollowRequestsButton, FollowsYouTag } from "@/components/community/follow-button";
import { followLabel, useFollowState } from "@/lib/community-social";
import { disciplineLabel, followedByLabel } from "@/lib/community-discover";
import { useBlockPerson } from "@/lib/direct-chats";
import { ProfileEditSheet } from "@/components/community/profile-edit";
import { SuggestedAthletes } from "@/components/community/suggested-athletes";
import { useQueryClient } from "@tanstack/react-query";
import { AvatarCropper } from "@/components/avatar-cropper";
import { CoachBadge } from "@/components/community/post-card";
import { GridSkeleton, PostGrid } from "@/components/community/post-grid";
import { RepostsGrid, SavedView } from "@/components/community/saved-view";
import { trainingSinceLabel, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { useCommunityFeed, useCommunityProfile, useMyArchived, usePostMediaUrls, useSetCommunityAvatar } from "@/lib/community.queries";

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
  // a block (either way) shows no grid: the server already sends none, so no "Nothing shared yet" either
  const blocked = !!profile?.blocked;
  const shown = useMemo(() => (blocked ? [] : feed.data?.pages.flatMap((p) => p.posts) ?? []), [feed.data, blocked]);
  // Posts | Reposts | Saved | Archived (Instagram's tabs; only you see Saved and Archived)
  const [tab, setTab] = useState<ProfileTab>("posts");
  const showArchived = tab === "archived";
  const archivedQ = useMyArchived(showArchived);
  const posts = showArchived ? archivedQ.data ?? [] : shown;
  const { data: urls } = usePostMediaUrls(posts);
  const [editing, setEditing] = useState(false);
  const { isImpersonating } = useClientImpersonation();
  const setAvatar = useSetCommunityAvatar(userId);
  // Instagram: follow someone and people close to them slide in under their profile
  const { data: follows } = useFollowState(!!profile && !profile.is_me);
  const fl = followLabel(follows, profile?.author.user_id ?? userId);
  const followed = fl === "Following" || fl === "Requested";
  const wasFollowed = useRef<boolean | null>(null);
  const [similar, setSimilar] = useState(false);
  useEffect(() => {
    if (!follows || !profile || profile.is_me) return;
    if (wasFollowed.current === false && followed) setSimilar(true);
    if (!followed) setSimilar(false);
    wasFollowed.current = followed;
  }, [follows, followed, profile]);
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
        <GridSkeleton />
      </div>
    );
  }

  const tabs = profileTabs({ isMe: profile.is_me && !isImpersonating, reposts: profile.reposts ?? 0, archived: profile.archived ?? 0, current: tab, blocked });
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
          {profile.username && <div className="mt-1 truncate text-[13px] font-semibold text-muted-foreground" data-profile-username>@{profile.username}</div>}
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
          {!profile.is_me && followedByLabel(profile.followed_by) && (
            <div className="mt-1 truncate text-[12px] text-muted-foreground" data-followed-by>{followedByLabel(profile.followed_by)}</div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {profile.bio ? (
          <p className="whitespace-pre-line text-[14px] leading-snug">{profile.bio}</p>
        ) : profile.is_me && !isImpersonating ? (
          <button type="button" className="text-[13px] font-bold text-primary" onClick={() => setEditing(true)}>
            + Add a short bio
          </button>
        ) : null}
        <ProfileFacts disciplines={profile.disciplines} gym={profile.home_gym} />
      </div>

      {/* Instagram's row: full-width actions under the bio */}
      {profile.is_me ? (
        !isImpersonating && (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-muted px-3 text-[13px] font-bold active:bg-muted/70" data-edit-profile>
              Edit profile
            </button>
            {!profile.author.is_coach && <FollowRequestsButton onOpen={onOpenPerson} className="h-9 flex-1 justify-center text-[13px]" />}
            {!profile.author.is_coach && <CloseFriendsButton className="h-9 flex-1 justify-center text-[13px]" />}
          </div>
        )
      ) : profile.blocked_by_me ? (
        <div className="mt-3 flex gap-2">
          <BlockButton author={profile.author} blocked className="h-9 flex-1" />
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <FollowButton userId={profile.author.user_id} name={profile.author.name} avatarUrl={profile.author.avatar_url} isPrivate={!!profile.is_private && !viewerIsStaff} className="flex-1" />
          {/* Block lives behind ••• (never for a coach, or for coaches looking at a client) */}
          {!viewerIsStaff && !isImpersonating && !profile.author.is_coach && <ProfileMore author={profile.author} />}
        </div>
      )}

      {similar && !profile.is_me && (
        <SuggestedAthletes context={profile.author.user_id} onOpen={(a) => onOpenPerson?.(a)} onClose={() => setSimilar(false)} className="mt-3" />
      )}

      {!profile.is_me && <FollowRequestBanner userId={profile.author.user_id} name={profile.author.name} />}

      {/* (private account and automatic sharing live in Edit profile → Privacy, Instagram's spot) */}

      {profile.blocked_by_me && (
        <div data-blocked-profile className="mt-4 rounded-2xl border border-border/70 bg-card px-3.5 py-3">
          <span className="block text-[13px] font-bold">You blocked {profile.author.name}</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">They can't find you, see your posts or message you. They aren't told.</span>
        </div>
      )}

      {!profile.is_me && profile.can_see === false && !profile.blocked && (
        <div data-private-profile className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-foreground/80"><Lock className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">This account is private</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">Follow to see their posts and stories. Their automatic workout stories show for everyone.</span>
          </span>
        </div>
      )}

      {tabs.length > 1 && (
        <div className="-mx-3 mt-4 flex border-b border-border/70" role="tablist" aria-label={profile.is_me ? "Your posts" : `${profile.author.name}'s posts`} data-profile-tabs>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-label={t.label}
              onClick={() => setTab(t.key)}
              className={cn(
                "relative grid h-11 flex-1 place-items-center transition-colors",
                tab === t.key ? "text-foreground" : "text-muted-foreground",
              )}
              data-profile-tab={t.key}
            >
              <t.Icon className="h-[22px] w-[22px]" strokeWidth={tab === t.key ? 2.4 : 2} />
              {tab === t.key && <span className="absolute inset-x-6 bottom-0 h-[2px] rounded-full bg-foreground" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      {showArchived && <p className="mt-2 text-[11px] text-muted-foreground">Only you can see these. Open one and use ••• to show it on your profile again.</p>}

      {tab === "saved" ? (
        <div className="mt-4"><SavedView unit={unit} onOpenPost={onOpenPost} /></div>
      ) : tab === "reposts" ? (
        <div className="mt-4"><RepostsGrid userId={profile.author.user_id} isMe={profile.is_me} unit={unit} onOpenPost={onOpenPost} /></div>
      ) : (
      <>
      <div className="mt-4">
        {(showArchived ? archivedQ.isLoading : feed.isLoading) && !blocked ? (
          <GridSkeleton />
        ) : (
          <PostGrid
            posts={posts}
            urls={urls}
            unit={unit}
            onTap={onOpenPost}
            showAudience
            // Archived comes all at once; Posts loads as you scroll, and simply ends
            pager={showArchived || blocked ? undefined : feed}
          />
        )}
      </div>
      {posts.length === 0 && !blocked && !(showArchived ? archivedQ.isLoading : feed.isLoading) && (
        <div className="mt-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground">
          {showArchived ? "Nothing archived." : profile.is_me ? "Lock in at your next session, or share a finished workout. It shows up here." : "Nothing shared yet."}
        </div>
      )}
      </>
      )}
      {profile.is_me && (
        <ProfileEditSheet open={editing} onOpenChange={setEditing} userId={userId} bio={profile.bio} isCoach={profile.author.is_coach} />
      )}
    </div>
  );
}

type ProfileTab = "posts" | "reposts" | "saved" | "archived";

/**
 * A profile's tabs: Posts always; Reposts once they've reposted something
 * (always on yours); Saved on yours only; Archived on yours while there's
 * something in it. None across a block. One tab = no tab row at all.
 */
export function profileTabs({ isMe, reposts, archived, current, blocked }: { isMe: boolean; reposts: number; archived: number; current: ProfileTab; blocked: boolean }) {
  if (blocked) return [{ key: "posts" as const, label: "Posts", Icon: Grid3x3 }];
  return [
    { key: "posts" as const, label: "Posts", Icon: Grid3x3, show: true },
    { key: "reposts" as const, label: "Reposts", Icon: Repeat2, show: isMe || reposts > 0 },
    { key: "saved" as const, label: "Saved (only you)", Icon: Bookmark, show: isMe },
    { key: "archived" as const, label: `Archived${archived ? ` (${archived})` : ""}`, Icon: Archive, show: isMe && (archived > 0 || current === "archived") },
  ].filter((t) => t.show);
}

/** Your photo, small, for the You tab: a ring on it while you're there (Instagram's profile tab). */
export function MyTabPhoto({ active = false, size = 22 }: { active?: boolean; size?: number }) {
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(user?.id ?? null);
  return (
    <span className={cn("shrink-0 rounded-full", active ? "ring-[1.5px] ring-foreground ring-offset-1 ring-offset-background" : "ring-1 ring-border")} aria-hidden>
      <UserAvatar src={me?.author.avatar_url ?? null} name={me?.author.name ?? "You"} size={size} expandable={false} />
    </span>
  );
}

/**
 * Your own profile from the coach's Crew page (no tab row there): your photo
 * and "You" in a pill beside Post, so it reads as a button, not a picture.
 */
export function MyProfileButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { user } = useAuth();
  if (!user?.id) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-1.5 pr-3.5 text-[13px] font-bold shadow-sm transition-transform active:scale-95 max-[359px]:pr-1.5", className)}
      aria-label="Your profile"
      data-my-profile
    >
      <MyTabPhoto />
      {/* small phones: just your photo, so Post, search and the heart keep their room */}
      <span className="max-[359px]:sr-only">You</span>
    </button>
  );
}

/** What they train and where, under the bio: "Powerlifting · Strength" and their gym. Nothing when they haven't said. */
function ProfileFacts({ disciplines, gym }: { disciplines?: string[]; gym?: string | null }) {
  const trains = (disciplines ?? []).map(disciplineLabel);
  if (!trains.length && !gym) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-muted-foreground" data-profile-facts>
      {trains.length > 0 && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Dumbbell className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{trains.join(" · ")}</span>
        </span>
      )}
      {gym && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{gym}</span>
        </span>
      )}
    </div>
  );
}

/** Someone else's profile: ••• with Block. */
function ProfileMore({ author }: { author: CommunityAuthor }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid h-9 w-10 shrink-0 place-items-center rounded-lg bg-muted active:bg-muted/70" aria-label={`More for ${author.name}`} data-profile-more>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3.5">
            <UserAvatar src={author.avatar_url} name={author.name} size={28} expandable={false} />
            <SheetTitle className="truncate text-[14px] font-bold">{author.name}</SheetTitle>
            <SheetDescription className="sr-only">Options for {author.name}</SheetDescription>
          </div>
          <BlockButton author={author} blocked={false} variant="row" onDone={() => setOpen(false)} />
          <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Block or unblock, with a confirm. A block works both ways and quietly: they
 * can't find you, see your posts or stories, follow or message you (and you
 * won't see theirs). They aren't told. Coaches can't be blocked.
 */
function BlockButton({ author, blocked, variant = "button", className, onDone }: {
  author: CommunityAuthor;
  blocked: boolean;
  variant?: "button" | "row";
  className?: string;
  onDone?: () => void;
}) {
  const [ask, setAsk] = useState(false);
  const block = useBlockPerson();
  const qc = useQueryClient();
  const run = () =>
    block.mutate(
      { userId: author.user_id, blocked: !blocked },
      {
        onSuccess: () => {
          toast(blocked ? `${author.name} is unblocked` : `Blocked ${author.name}`);
          // who you can see, find and follow all change with it
          for (const key of ["community-profile", "community-feed", "community-members", "community-suggestions", "community-people-search", "community-follows", "community-follow-list"]) {
            void qc.invalidateQueries({ queryKey: [key] });
          }
          onDone?.();
        },
        onError: (e: any) => toast.error(e?.message ?? "That didn't work. Try again."),
      },
    );
  return (
    <>
      {variant === "row" ? (
        <button type="button" onClick={() => setAsk(true)} className="flex min-h-[52px] w-full items-center px-5 text-left text-[15px] font-semibold text-destructive active:bg-muted" data-block-person>
          Block
        </button>
      ) : (
        <button type="button" onClick={() => setAsk(true)} className={cn("inline-flex items-center justify-center rounded-lg bg-muted px-4 text-[13px] font-bold active:bg-muted/70", className)} data-unblock-person>
          Unblock
        </button>
      )}
      <Sheet open={ask} onOpenChange={setAsk}>
        <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]">
          <div className="flex flex-col items-center px-6 pb-3 pt-6 text-center">
            <UserAvatar src={author.avatar_url} name={author.name} size={64} expandable={false} />
            <SheetTitle className="mt-3 text-[16px] font-black">{blocked ? `Unblock ${author.name}?` : `Block ${author.name}?`}</SheetTitle>
            <SheetDescription className="mt-1 text-[13px] leading-snug">
              {blocked
                ? "They'll be able to find you, see your posts and message you again, and follows between you work again."
                : "They won't be able to find you, see your posts or stories, follow you or message you, and you won't see theirs. They won't be told."}
            </SheetDescription>
          </div>
          <div className="border-t border-border/60">
            <button
              type="button"
              disabled={block.isPending}
              onClick={() => { setAsk(false); run(); }}
              className={cn("h-12 w-full text-[14px] font-bold active:bg-muted", !blocked && "text-destructive")}
              data-block-confirm
            >
              {blocked ? "Unblock" : "Block"}
            </button>
            <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
