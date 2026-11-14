import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarClock, Cake, CheckCircle2, ChevronDown, ChevronRight, Eye, Flag, Flame, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useCommunityFeed, useCommunityPulse, useSeriesAction, useViewerUnit, type CommunityPulse } from "@/lib/community.queries";
import { CommunityScreen } from "@/components/community/community-screen";
import { CoachPostsTab } from "@/components/community/posts-schedule";
import { PostScoreBoard } from "@/components/community/post-score-board";
import { CoachPostRow } from "@/components/community/community-entry";
import { NoteEditor } from "@/components/community/note-editor";
import { PostDetailDialog } from "@/components/community/post-detail";
import { ReportsReviewSheet, useOpenReports } from "@/components/community/reports-review";
import { MANAGE_TABS, manageTabFromHash, type ManageTab } from "@/lib/crew-manage";

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

/**
 * Where a link to the coach's Crew lands: the feed, a Manage tab
 * (crew-manage.ts: `#tab=needs`, `#tab=posts` and its old `#tab=daily` /
 * `#tab=birthdays` / `#birthday=<id>`, `#tab=insights`), or the League,
 * its own page (`#tab=league`, `#rankings`).
 */
export function hubTabFromHash(h: string = typeof window === "undefined" ? "" : window.location.hash): ManageTab | "feed" | "league" {
  if (/tab=league/.test(h) || /rankings/.test(h)) return "league";
  return manageTabFromHash(h) ?? "feed";
}

/**
 * What's waiting on the coach on each Manage tab (a dot on the tab, and on
 * the bar's Manage while anything is): the crew's reports, comments to
 * answer and posts paused on Needs you; a lesson or a birthday post waiting
 * for their OK on Posts too (Needs you lists them, a tap from Posts).
 * Workouts waiting on props are listed on Needs you but never count: there's
 * nearly always a week of them (27 on Nov 14 2026), so counted, the dot would
 * never go away and would stop meaning anything.
 */
export function hubTabCounts(p: CommunityPulse | undefined, reports = 0): Record<ManageTab, number> {
  const toApprove = p ? (p.lessons_review ?? 0) + p.birthday_review : 0;
  return {
    needs: reports + (p ? groupReplies(p.to_reply).length + toApprove + (p.paused ? 1 : 0) : 0),
    posts: toApprove,
    insights: 0,
  };
}

/**
 * The coach's Crew page, behind Crew's tab: the clients' Crew (the same bar,
 * stories and full-screen feed, CommunityScreen), with the coach's tools in it
 * (Nov 14 2026): + writes a post to the crew, and Manage, in the trophy's place
 * with a dot while something waits, opens the coach's page: Needs you (what's
 * waiting, each a tap from done), Posts (everything that goes out on its own,
 * posts-schedule.tsx) and Insights (the week's numbers, each post's score).
 * The League is the trophy on Manage's bar (and its own page, /admin/league).
 * A view-only login (finance) gets the feed alone.
 */
export function AdminCommunityHub() {
  const { viewOnly } = useAuth();
  const navigate = useNavigate();
  // old League links (#tab=league, #rankings) go to the League page
  const routeHash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (hubTabFromHash(`#${routeHash}`) === "league") void navigate({ to: "/admin/league", replace: true });
  }, [routeHash, navigate]);
  const [writing, setWriting] = useState(false);
  const act = useSeriesAction();
  const { data: pulse } = useCommunityPulse(!viewOnly);
  const reports = useOpenReports(!viewOnly).data?.length ?? 0;
  const counts = hubTabCounts(pulse, reports);

  // the finance login: the feed alone, no tools
  if (viewOnly) {
    return (
      <div className="mx-auto w-full max-w-[560px] px-3 pb-12 pt-2 sm:px-4">
        <div className="-mx-3 sm:-mx-4">
          <CommunityScreen hideTabs />
        </div>
      </div>
    );
  }

  return (
    <>
      <CommunityScreen
        coach={{
          onWrite: () => setWriting(true),
          waiting: counts.needs > 0,
          startTab: counts.needs > 0 ? "needs" : "posts",
          manage: <CrewManage counts={counts} />,
        }}
      />
      <NoteEditor
        open={writing}
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
    </>
  );
}

/** Manage: Needs you · Posts · Insights, the tab in the hash (so Back, pushes and old links agree). */
function CrewManage({ counts }: { counts: Record<ManageTab, number> }) {
  const navigate = useNavigate();
  const routeHash = useRouterState({ select: (s) => s.location.hash });
  const tab = manageTabFromHash(`#${routeHash}`) ?? "needs";
  const setTab = (t: ManageTab) => void navigate({ to: ".", hash: `tab=${t}`, replace: true, resetScroll: false });
  return (
    <div className="space-y-3" data-crew-manage={tab}>
      <div className="grid grid-cols-3 rounded-full bg-muted p-1" role="tablist" aria-label="Manage Crew">
        {MANAGE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-label={counts[t.key] ? `${t.label}, something's waiting on you` : undefined}
            onClick={() => setTab(t.key)}
            className={cn(
              "h-9 min-w-0 rounded-full px-1 text-[14px] font-semibold transition-colors",
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
            data-manage-tab={t.key}
          >
            {t.label}
            {/* something waiting here: a dot (the rows say what) */}
            {counts[t.key] > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 -translate-y-1.5 rounded-full bg-primary" data-tab-waiting aria-hidden />}
          </button>
        ))}
      </div>
      {tab === "needs" ? (
        <NeedsYou onGo={setTab} />
      ) : tab === "posts" ? (
        <CoachPostsTab />
      ) : (
        <>
          <WeekCard />
          <PostScoreBoard />
        </>
      )}
    </div>
  );
}

/**
 * Manage → Needs you: only what's waiting on the coach (the crew's reports,
 * comments to answer, shared workouts waiting on props, lessons or birthday
 * posts waiting for an OK, posts paused), each a tap from done. Nothing
 * waiting: one line that says so.
 */
function NeedsYou({ onGo }: { onGo: (t: ManageTab) => void }) {
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: p, refetch, isLoading } = useCommunityPulse();
  const feed = useCommunityFeed(null);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const reportCount = useOpenReports().data?.length ?? 0;

  // Shared workouts this week still waiting on a coach reaction (from the feed already loaded).
  const waiting = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return (feed.data?.pages[0]?.posts ?? []).filter((x) => !x.is_mine && x.kind !== "note" && !x.my_reaction && new Date(x.created_at).getTime() > weekAgo);
  }, [feed.data]);

  if (isLoading) return <Skeleton className="h-32 w-full rounded-2xl" />;
  if (!p) return null;
  const replies = groupReplies(p.to_reply);
  const lessons = p.lessons_review ?? 0;
  const any = reportCount > 0 || replies.length > 0 || p.waiting_props > 0 || lessons > 0 || p.birthday_review > 0 || p.paused;
  if (!any) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4" data-crew-needs-you="none">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">All caught up</div>
          <div className="text-[13px] text-muted-foreground">Nothing's waiting on you in Crew.</div>
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-crew-needs-you>
      <div className="divide-y divide-border">
        {reportCount > 0 && (
          <Row
            icon={<Flag className="h-4 w-4" />}
            title={`${reportCount} ${reportCount === 1 ? "report" : "reports"} from the crew`}
            sub="Remove it or dismiss it"
            hot
            onClick={() => setShowReports(true)}
          />
        )}
        {replies.map((r) => (
          <Row
            key={r.post_id}
            icon={<UserAvatar src={r.avatar_url} name={r.who} size={32} expandable={false} />}
            title={r.who}
            sub={`“${r.body}”`}
            tag="Reply"
            onClick={() => setOpenPost(r.post_id)}
          />
        ))}

        {p.waiting_props > 0 && (
          <>
            <Row
              icon={<Flame className="h-4 w-4" />}
              title={`${p.waiting_props} ${p.waiting_props === 1 ? "workout" : "workouts"} waiting on your props`}
              sub="One tap tells them you saw it"
              open={showProps}
              onClick={() => setShowProps((v) => !v)}
            />
            {showProps && (
              <div className="divide-y divide-border px-4">
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
      <ReportsReviewSheet
        open={showReports}
        onOpenChange={setShowReports}
        onOpenPost={(id) => {
          setShowReports(false);
          setOpenPost(id);
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
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-crew-week>
      <div className="px-4 pb-3 pt-3">
        <div className="text-[16px] font-semibold">Last 7 days</div>
        <div className="text-[12px] text-muted-foreground">Clients only</div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="truncate text-[22px] font-semibold leading-none tabular-nums">{s.value}</div>
              <div className="mt-1 text-[12px] leading-tight text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {p.not_opened.length > 0 && (
        <div className="border-t border-border">
          <Row
            icon={<Eye className="h-4 w-4" />}
            title={`${p.not_opened.length} haven't looked this week`}
            sub="See who · a quick message usually does it"
            open={showQuiet}
            onClick={() => setShowQuiet((v) => !v)}
          />
          {showQuiet && (
            <ul className="divide-y divide-border px-4">
              {p.not_opened.map((c) => (
                <li key={c.user_id} className="flex items-center gap-3 py-2">
                  <UserAvatar src={c.avatar_url} name={c.name} size={30} expandable={false} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{c.name}</div>
                    <div className="truncate text-[12px] text-muted-foreground">{lastLookedLabel(c.seen_at)}</div>
                  </div>
                  <Link
                    to="/admin/messages"
                    search={{ client: c.client_id } as any}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[13px] font-semibold"
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

/** One row: a plain icon tile, what it is, and a way in (`hot`: needs an OK, so its tile is amber). */
function Row({ icon, title, sub, hot, open, tag, onClick }: { icon: ReactNode; title: string; sub?: string; hot?: boolean; open?: boolean; tag?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full", hot ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{title}</div>
        {sub && <div className="truncate text-[13px] text-muted-foreground">{sub}</div>}
      </div>
    </>
  );
  // a line that only says something (what's next) isn't a button
  if (!onClick) return <div className="flex w-full items-center gap-3 px-4 py-2.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted/60" aria-expanded={open}>
      {body}
      {tag ? (
        <span className="shrink-0 rounded-full border border-border px-3 py-1 text-[13px] font-semibold">{tag}</span>
      ) : open === undefined ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      )}
    </button>
  );
}
