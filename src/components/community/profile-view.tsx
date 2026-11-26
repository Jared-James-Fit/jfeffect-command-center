import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, OfflineState } from "@/components/loading";
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
import { BlockConfirmSheet } from "@/components/community/block-person-sheet";
import { ReportSheet } from "@/components/community/report-sheet";
import { ProfileEditSheet } from "@/components/community/profile-edit";
import { SuggestedAthletes } from "@/components/community/suggested-athletes";
import { useCrewPhotoPicker } from "@/components/community/crew-photo-picker";
import { CoachBadge } from "@/components/community/post-card";
import { GridSkeleton, PostGrid } from "@/components/community/post-grid";
import { RepostsGrid, SavedView } from "@/components/community/saved-view";
import { isWorkoutCard, trainingSinceLabel, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { useCommunityFeed, useCommunityProfile, useMyArchived, usePostMediaUrls } from "@/lib/community.queries";
import { StoryAvatar, StoryHostContext, useStoryRing } from "@/components/community/story-ring";
import { storyGroupFor, storyRings } from "@/lib/story-ring";
import { useSeenStories } from "@/lib/story-seen";

/**
 * A person's corner of the community: photo, name, a short bio, follower /
 * following counts (Instagram-style) and a grid of what they chose to share.
 * A private account you don't follow shows only its automatic workout
 * stories, with Request to follow. No reaction totals.
 */
export function ProfileView({ userId, unit, onOpenPost, onOpenPerson }: { userId: string; unit: "kg" | "lb"; onOpenPost: (post: CommunityPost) => void; onOpenPerson?: (a: CommunityAuthor) => void }) {
  const profileQ = useCommunityProfile(userId);
  const { data: profile, isLoading } = profileQ;
  // coaches follow a private account straight away (no request), so it acts public for them
  const { role } = useAuth();
  const viewerIsStaff = role === "admin" || role === "coach";
  const feed = useCommunityFeed(userId);
  // a block (either way) shows no grid: the server already sends none, so no "Nothing shared yet" either
  const blocked = !!profile?.blocked;
  // (a story someone posted lives in the story rail only, never on the grid: Instagram's way)
  // a profile is what they posted: never a story or a workout's bare card (isWorkoutCard)
  const shown = useMemo(() => (blocked ? [] : (feed.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !p.story && !isWorkoutCard(p))), [feed.data, blocked]);
  // Their story ring: the Crew's read of who has a story up, else their own posts' (a story the Crew
  // hasn't loaded yet still rings here). No story, no ring: a plain photo.
  const host = useContext(StoryHostContext);
  const hostStory = useStoryRing(profile?.author.user_id);
  const seenStories = useSeenStories();
  const theirPosts = useMemo(() => (blocked ? [] : feed.data?.pages.flatMap((p) => p.posts) ?? []), [feed.data, blocked]);
  const ownRead = useMemo(
    () => (profile ? storyRings(theirPosts, { seen: seenStories }).get(profile.author.user_id) ?? "none" : "none"),
    [theirPosts, seenStories, profile],
  );
  const story = hostStory.state !== "none"
    ? hostStory
    : {
        state: host?.play ? ownRead : ("none" as const),
        open: () => {
          const g = profile ? storyGroupFor(theirPosts, profile.author.user_id) : null;
          if (!g || !host?.play) return false;
          host.play(g, theirPosts);
          return true;
        },
      };
  // Posts | Reposts | Saved | Archived (Instagram's tabs; only you see Saved and Archived)
  const [tab, setTab] = useState<ProfileTab>("posts");
  const showArchived = tab === "archived";
  const archivedQ = useMyArchived(showArchived);
  const posts = showArchived ? archivedQ.data ?? [] : shown;
  const { data: urls } = usePostMediaUrls(posts);
  const [editing, setEditing] = useState(false);
  const { isImpersonating } = useClientImpersonation();
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
  // Your Crew picture: any picture, taken or picked, framed in "Move and scale" (crew-photo-picker.tsx)
  const photo = useCrewPhotoPicker(userId, { hasPhoto: !!profile?.author.avatar_url });

  if (!profile && (profileQ.isError || profileQ.fetchStatus === "paused")) {
    // a profile that couldn't load says so, with Try again (never a skeleton forever)
    return profileQ.fetchStatus === "paused"
      ? <OfflineState what="this profile" />
      : <ErrorState error={profileQ.error} what="this profile" onRetry={() => profileQ.refetch()} retrying={profileQ.isFetching} />;
  }
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
        {/* The photo: no ring unless there's a story up (then a tap plays it: the brand ring while there's
            something you haven't watched, grey once you have); with no story a tap opens the photo big
            (photo-viewer.tsx). Your own changes from the camera badge, or a tap on the circle while there's
            none. Community-only, never your account photo. The room around it is kept whatever the ring
            says, so nothing moves when a story goes up or runs out. */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="relative p-1.5" data-profile-photo>
            <span className={cn("block rounded-full", photo.pending && "animate-pulse")}>
              {story.state === "none" && profile.is_me && !profile.author.avatar_url ? (
                <button
                  type="button"
                  disabled={photo.pending}
                  onClick={photo.open}
                  className="block rounded-full"
                  aria-label="Add a Crew picture"
                >
                  <UserAvatar src={null} name={profile.author.name} size={78} expandable={false} />
                </button>
              ) : (
                <StoryAvatar userId={profile.author.user_id} src={profile.author.avatar_url} name={profile.author.name} size={78} expandable story={story} />
              )}
            </span>
            {profile.is_me && (
              <button
                type="button"
                disabled={photo.pending}
                onClick={photo.open}
                data-profile-photo-change
                aria-label={profile.author.avatar_url ? "Change your Crew picture" : "Add a Crew picture"}
                className="absolute bottom-0.5 right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-foreground text-background after:absolute after:-inset-2 after:content-[''] active:scale-95"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {profile.is_me && !profile.author.avatar_url && <span className="text-[11px] font-bold text-primary">Add photo</span>}
          {profile.is_me && photo.element}
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

/** Someone else's profile: ••• with Report and Block. */
function ProfileMore({ author }: { author: CommunityAuthor }) {
  const [open, setOpen] = useState(false);
  // mounted on first tap
  const [reporting, setReporting] = useState<boolean | null>(null);
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
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.setTimeout(() => setReporting(true), 120);
            }}
            className="flex min-h-[52px] w-full items-center px-5 text-left text-[15px] font-semibold text-destructive active:bg-muted"
            data-report-profile
          >
            Report
          </button>
          <BlockButton author={author} blocked={false} variant="row" onDone={() => setOpen(false)} />
          <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
        </SheetContent>
      </Sheet>
      {reporting !== null && <ReportSheet kind="profile" targetId={author.user_id} author={author} open={reporting} onOpenChange={setReporting} />}
    </>
  );
}

/** Block or unblock, with a confirm (BlockConfirmSheet). Coaches can't be blocked. */
function BlockButton({ author, blocked, variant = "button", className, onDone }: {
  author: CommunityAuthor;
  blocked: boolean;
  variant?: "button" | "row";
  className?: string;
  onDone?: () => void;
}) {
  const [ask, setAsk] = useState(false);
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
      <BlockConfirmSheet author={author} blocked={blocked} open={ask} onOpenChange={setAsk} onDone={onDone} />
    </>
  );
}
