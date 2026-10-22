import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarClock, Cake, ChevronDown, ChevronRight, Eye, Flame, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SERIES_LABEL } from "@/lib/community";
import { useCommunityFeed, useCommunityPulse, useSeriesAction, useViewerUnit, type CommunityPulse } from "@/lib/community.queries";
import { CommunityScreen } from "@/components/community/community-screen";
import { MyTabPhoto } from "@/components/community/profile-view";
import { BarButton } from "@/components/community/crew-header";
import { openCommunityPerson } from "@/lib/community-notifications";
import { openCrewActivity } from "@/lib/crew-activity";
import { ActivityHeart } from "@/components/community/activity-heart";
import { CoachWeeklyPosts } from "@/components/community/coach-weekly-posts";
import { CoachLessons } from "@/components/community/coach-lessons";
import { PostScoreBoard } from "@/components/community/post-score-board";
import { BirthdayPostsCard } from "@/components/community/birthday-posts";
import { CoachPostRow } from "@/components/community/community-entry";
import { NoteEditor } from "@/components/community/note-editor";
import { PostDetailDialog } from "@/components/community/post-detail";
import { UpcomingBirthdaysWidget } from "@/components/upcoming-birthdays-widget";

/** "Today 7:00 pm" · "Tomorrow 9:00 am" · "Mon 8:00 am", in the coach's own clock. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(t) - startOf(now)) / 86_400_000);
  const clock = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : t.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${clock}`;
}

/** "never opened" · "last looked 12 days ago" */
export function lastLookedLabel(seenAt: string | null, now: Date = new Date()): string {
  if (!seenAt) return "Never opened it";
  const d = Math.max(1, Math.round((+now - +new Date(seenAt)) / 86_400_000));
  return `Last looked ${d} day${d === 1 ? "" : "s"} ago`;
}

/** Comments waiting on the coach, one row per post: "Fionna & Alyssa Amanda". */
export function groupReplies(rows: CommunityPulse["to_reply"]) {
  const by = new Map<string, { post_id: string; names: string[]; body: string; avatar_url: string | null; created_at: string }>();
  for (const r of rows) {
    const g = by.get(r.post_id);
    if (!g) by.set(r.post_id, { post_id: r.post_id, names: [r.name], body: r.body, avatar_url: r.avatar_url, created_at: r.created_at });
    else if (!g.names.includes(r.name)) g.names.push(r.name);
  }
  return [...by.values()].map((g) => ({
    ...g,
    who: g.names.length <= 2 ? g.names.join(" & ") : `${g.names[0]}, ${g.names[1]} +${g.names.length - 2}`,
  }));
}

function nextPost(p: CommunityPulse): { title: string; when: string | null } {
  if (p.paused) return { title: "Coach posts are paused", when: "Nothing goes out until you turn them back on" };
  if (!p.next) return { title: "Nothing scheduled", when: null };
  if (p.next.series === "lesson")
    return { title: `Next lesson: ${p.next.title ?? "from the library"}`, when: `${whenLabel(p.next.at)}${p.next.needs_ok ? " · needs your OK" : ""}` };
  return { title: `Next: ${SERIES_LABEL[p.next.series]?.name ?? "Coach post"}`, when: whenLabel(p.next.at) };
}

type HubTab = "feed" | "posts" | "insights";
const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "posts", label: "Posts" },
  { key: "insights", label: "Insights" },
];

/**
 * Which tab a link asks for. The League is its own page now (the bar's
 * trophy), so its old links (`#tab=league`, `#rankings`) go there; old
 * `#tab=daily` / `#tab=birthdays` / `#birthday=<id>` links open Posts.
 */
export function hubTabFromHash(h: string = typeof window === "undefined" ? "" : window.location.hash): HubTab | "league" {
  if (/tab=league/.test(h) || /rankings/.test(h)) return "league";
  if (/tab=(posts|daily|birthdays)/.test(h) || /birthday=/.test(h)) return "posts";
  if (/tab=(insights|scores)/.test(h)) return "insights";
  return "feed";
}

/** What's waiting on the coach in each tab: a red dot on the tab (the count is in its label for screen readers). */
export function hubTabCounts(p: CommunityPulse | undefined): Record<HubTab, number> {
  if (!p) return { feed: 0, posts: 0, insights: 0 };
  return {
    feed: groupReplies(p.to_reply).length + p.waiting_props,
    posts: (p.lessons_review ?? 0) + p.birthday_review,
    insights: 0,
  };
}

/**
 * The coach's Crew page, behind the raised centre button. One row on top
 * (+ to write a post, Feed · Posts · Insights, the Activity heart, your
 * photo), like the clients' Crew bar:
 * - Feed: only what's waiting on you (comments to answer, workouts waiting
 *   on props, posts to approve), then the feed.
 * - Posts: everything that goes out on its own (lessons, the daily series,
 *   birthdays), a birthday draft to review first.
 * - Insights: the week in numbers and how each post did.
 * The League is its own page (`/admin/league`, the trophy on the bar).
 */
export function AdminCommunityHub() {
  const { viewOnly, user } = useAuth();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<HubTab>(() => {
    const t = hubTabFromHash();
    return t === "league" ? "feed" : t;
  });
  // The tab lives in the hash: Back from a page opened here returns to the
  // same tab, and Crew's own button (no hash) brings you back to the Feed.
  const routeHash = useRouterState({ select: (s) => s.location.hash });
  // null: also apply the hash once on arrival (the router's, not window's).
  const seenHash = useRef<string | null>(null);
  useEffect(() => {
    if (routeHash === seenHash.current) return;
    seenHash.current = routeHash;
    const t = hubTabFromHash(`#${routeHash}`);
    if (t === "league") void navigate({ to: "/admin/league", replace: true });
    else setPicked(t);
  }, [routeHash, navigate]);
  const setTab = (t: HubTab) => {
    setPicked(t);
    void navigate({ to: ".", hash: t === "feed" ? "" : `tab=${t}`, replace: true, resetScroll: false });
  };
  const [writing, setWriting] = useState(false);
  const act = useSeriesAction();
  const { data: pulse } = useCommunityPulse(!viewOnly);
  // a view-only login (finance) gets the feed alone: no queues, no tools
  const tab: HubTab = viewOnly ? "feed" : picked;
  const counts = hubTabCounts(pulse);
  // profiles and Activity live in the feed: open them there
  const onFeed = (open: () => void) => {
    if (tab === "feed") return open();
    setTab("feed");
    window.setTimeout(open, 0);
  };

  return (
    <div className="mx-auto w-full max-w-[560px] px-3 pb-12 sm:px-4">
      {!viewOnly && (
        <div className="sticky top-0 z-20 -mx-3 flex items-center gap-1 bg-background/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-4 sm:px-3 md:top-[41px]" data-crew-hub-bar>
          <BarButton label="Write a post" onClick={() => setWriting(true)} data-crew-write>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Plus className="h-5 w-5 stroke-[2.75]" />
            </span>
          </BarButton>
          <div className="grid min-w-0 flex-1 grid-cols-3 rounded-full bg-muted p-1" role="tablist" aria-label="Crew sections">
            {HUB_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                aria-label={counts[t.key] ? `${t.label}, ${counts[t.key]} waiting on you` : undefined}
                onClick={() => setTab(t.key)}
                className={cn(
                  "h-9 min-w-0 rounded-full px-1 text-[13px] font-bold transition-colors",
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {t.label}
                {/* something waiting here: a red dot (the Feed's rows and Posts' cards say what) */}
                {counts[t.key] > 0 && <span className="ml-0.5 inline-block h-1.5 w-1.5 -translate-y-1.5 rounded-full bg-primary" data-tab-waiting aria-hidden />}
              </button>
            ))}
          </div>
          {/* Activity: likes, comments and follows on your posts, with the bubble when there's something new */}
          <ActivityHeart onOpen={() => onFeed(openCrewActivity)} />
          {/* you: your own profile (posts, followers, edit), with your photo */}
          <BarButton
            label="Your profile"
            onClick={() => {
              const id = user?.id;
              if (id) onFeed(() => openCommunityPerson(id));
            }}
            data-my-profile
          >
            <MyTabPhoto size={27} />
          </BarButton>
        </div>
      )}

      <div className="space-y-3 pt-2">
        {tab === "feed" ? (
          <>
            {!viewOnly && <NeedsYou onGo={setTab} />}
            <div className="-mx-3 sm:-mx-4">
              <CommunityScreen hideTabs />
            </div>
          </>
        ) : tab === "posts" ? (
          <PostsTab birthdayFirst={(pulse?.birthday_review ?? 0) > 0} />
        ) : (
          <>
            <WeekCard />
            <PostScoreBoard />
          </>
        )}
      </div>

      <NoteEditor
        open={writing && !viewOnly}
        title="Write a post"
        initial=""
        saving={act.isPending}
        onClose={() => setWriting(false)}
        allowPoll
        media={{ initial: null, key: "new-post" }}
        attach={{ initial: null, key: "new-post" }}
        onSave={async (body, poll, media) => {
          const r = await act.mutateAsync({ kind: "note", body, poll, media });
          toast.success(poll ? "Poll posted to the community" : "Posted to the community");
          return r?.id;
        }}
      />
    </div>
  );
}

/** What goes out next (lessons and the daily series together), or that posts are paused. */
function UpNext() {
  const { data: p } = useCommunityPulse();
  if (!p) return null;
  const next = nextPost(p);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card" data-crew-up-next>
      <Row icon={<CalendarClock className="h-4 w-4" />} title={next.title} sub={next.when ?? undefined} hot={p.paused} />
    </div>
  );
}

/** Everything that goes out on its own: what's next, lessons, the daily series, birthdays (a draft to review first). */
function PostsTab({ birthdayFirst }: { birthdayFirst: boolean }) {
  const birthdays = (
    <div className="space-y-3">
      <BirthdayPostsCard />
      <UpcomingBirthdaysWidget windowDays={30} hideWhenEmpty />
    </div>
  );
  return (
    <div className="space-y-3">
      <UpNext />
      {birthdayFirst && birthdays}
      <CoachLessons />
      <CoachWeeklyPosts />
      {!birthdayFirst && birthdays}
    </div>
  );
}

/**
 * The top of the Feed: only what's waiting on the coach (comments to answer,
 * shared workouts waiting on props, posts to approve, posts paused), each one
 * tap from done. Nothing waiting, nothing shown: the feed starts right away.
 */
function NeedsYou({ onGo }: { onGo: (t: HubTab) => void }) {
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: p, refetch } = useCommunityPulse();
  const feed = useCommunityFeed(null);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(false);

  // Shared workouts this week still waiting on a coach reaction (from the feed already loaded).
  const waiting = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return (feed.data?.pages[0]?.posts ?? []).filter((x) => !x.is_mine && x.kind !== "note" && !x.my_reaction && new Date(x.created_at).getTime() > weekAgo);
  }, [feed.data]);

  if (!p) return null;
  const replies = groupReplies(p.to_reply);
  const lessons = p.lessons_review ?? 0;
  const any = replies.length > 0 || p.waiting_props > 0 || lessons > 0 || p.birthday_review > 0 || p.paused;
  if (!any) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/25 bg-card" data-crew-needs-you>
      <div className="flex items-center gap-1.5 px-4 pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        <Flame className="h-3.5 w-3.5" /> Needs you
      </div>
      <div className="divide-y divide-border/60">
        {replies.map((r) => (
          <Row
            key={r.post_id}
            icon={<UserAvatar src={r.avatar_url} name={r.who} size={28} expandable={false} />}
            title={r.who}
            sub={`“${r.body}”`}
            hot
            tag="Reply"
            onClick={() => setOpenPost(r.post_id)}
          />
        ))}

        {p.waiting_props > 0 && (
          <>
            <Row
              icon={<Flame className="h-4 w-4" />}
              title={`${p.waiting_props} shared ${p.waiting_props === 1 ? "workout" : "workouts"} waiting on your props`}
              sub="One tap tells them you saw it"
              hot
              open={showProps}
              onClick={() => setShowProps((v) => !v)}
            />
            {showProps && (
              <div className="divide-y divide-border/60 px-4">
                {waiting.map((x) => (
                  <CoachPostRow key={x.id} post={x} unit={unit} />
                ))}
              </div>
            )}
          </>
        )}

        {lessons > 0 && (
          <Row
            icon={<CalendarClock className="h-4 w-4" />}
            title={`${lessons} ${lessons === 1 ? "lesson needs" : "lessons need"} your OK`}
            sub="Nothing goes out until you approve it"
            hot
            onClick={() => onGo("posts")}
          />
        )}

        {p.birthday_review > 0 && (
          <Row
            icon={<Cake className="h-4 w-4" />}
            title={p.birthday_review === 1 ? "1 birthday post to review" : `${p.birthday_review} birthday posts to review`}
            sub="Nothing goes out until you approve it"
            hot
            onClick={() => onGo("posts")}
          />
        )}

        {p.paused && (
          <Row icon={<CalendarClock className="h-4 w-4" />} title="Coach posts are paused" sub="Turn them back on in Posts" hot onClick={() => onGo("posts")} />
        )}
      </div>

      <PostDetailDialog
        postId={openPost}
        unit={unit}
        viewerIsStaff
        onClose={() => {
          setOpenPost(null);
          void refetch();
        }}
      />
    </section>
  );
}

/** Insights' first card: the last 7 days in four numbers, and who hasn't looked. */
function WeekCard() {
  const { data: p, isLoading } = useCommunityPulse();
  const [showQuiet, setShowQuiet] = useState(false);
  if (isLoading) return <Skeleton className="h-32 w-full rounded-2xl" />;
  if (!p) return null;
  const stats = [
    { value: `${p.opened}/${p.roster}`, label: "opened it" },
    { value: String(p.reactions), label: p.reactions === 1 ? "reaction" : "reactions" },
    { value: String(p.comments), label: p.comments === 1 ? "comment" : "comments" },
    { value: String(p.client_posts), label: "shared" },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card" data-crew-week>
      <div className="px-4 pb-3 pt-3">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Last 7 days · clients only</div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="font-display truncate text-[24px] leading-none">{s.value}</div>
              <div className="mt-1 text-[11px] font-semibold leading-tight text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {p.not_opened.length > 0 && (
        <div className="border-t border-border/60">
          <Row
            icon={<Eye className="h-4 w-4" />}
            title={`${p.not_opened.length} haven't looked this week`}
            sub="See who · a quick message usually does it"
            open={showQuiet}
            onClick={() => setShowQuiet((v) => !v)}
          />
          {showQuiet && (
            <ul className="divide-y divide-border/60 px-4">
              {p.not_opened.map((c) => (
                <li key={c.user_id} className="flex items-center gap-3 py-2">
                  <UserAvatar src={c.avatar_url} name={c.name} size={30} expandable={false} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{c.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{lastLookedLabel(c.seen_at)}</div>
                  </div>
                  <Link
                    to="/admin/messages"
                    search={{ client: c.client_id } as any}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-bold"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Message
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ icon, title, sub, hot, open, tag, onClick }: { icon: ReactNode; title: string; sub?: string; hot?: boolean; open?: boolean; tag?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", hot ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13px] font-bold", hot && "text-primary")}>{title}</div>
        {sub && <div className="truncate text-[12px] text-muted-foreground">{sub}</div>}
      </div>
    </>
  );
  // a line that only says something (what's next) isn't a button
  if (!onClick) return <div className="flex w-full items-center gap-3 px-4 py-2.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted/60" aria-expanded={open}>
      {body}
      {tag ? (
        <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-black text-primary-foreground">{tag}</span>
      ) : open === undefined ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      )}
    </button>
  );
}
