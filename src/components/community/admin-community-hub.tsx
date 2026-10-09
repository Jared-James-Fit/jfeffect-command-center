import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Cake, ChevronDown, ChevronRight, Eye, Flame, MessageCircle, PenLine, Star } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SERIES_LABEL } from "@/lib/community";
import { useCommunityFeed, useCommunityPulse, useSeriesAction, useViewerUnit, type CommunityPulse } from "@/lib/community.queries";
import { CommunityScreen } from "@/components/community/community-screen";
import { CoachWeeklyPosts } from "@/components/community/coach-weekly-posts";
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
  if (p.paused) return { title: "Daily posts are paused", when: "Turn them back on in Daily posts" };
  if (!p.next) return { title: "Nothing scheduled", when: null };
  return { title: `Next: ${SERIES_LABEL[p.next.series]?.name ?? "Daily post"}`, when: whenLabel(p.next.at) };
}

function birthdayPost(p: CommunityPulse): { title: string; when: string | null } | null {
  if (p.birthday_review > 0) return { title: p.birthday_review === 1 ? "1 birthday post to review" : `${p.birthday_review} birthday posts to review`, when: "Nothing goes out until you approve it" };
  if (p.birthday_next)
    return { title: `${p.birthday_next.name}'s birthday post`, when: `${whenLabel(p.birthday_next.post_at)} · ${p.birthday_next.status === "scheduled" ? "approved" : "needs review"}` };
  return null;
}

/**
 * Dashboard: the community at a glance, always worth reading. How many
 * clients looked this week and how they engaged, then only what needs you
 * (comments to answer, workouts waiting on props, a birthday draft) and
 * what goes out next. The whole card opens the Community page.
 */
export function CommunityPulseCard() {
  const { data: p, isLoading } = useCommunityPulse();
  if (isLoading) return <Skeleton className="h-[104px] w-full rounded-xl" />;
  if (!p) return null;
  const replies = groupReplies(p.to_reply).length;
  const bday = birthdayPost(p);
  const next = nextPost(p);
  const lines: { icon: ReactNode; text: string; hot?: boolean }[] = [];
  if (replies > 0) lines.push({ icon: <MessageCircle className="h-3.5 w-3.5" />, text: replies === 1 ? "1 post has comments to answer" : `${replies} posts have comments to answer`, hot: true });
  if (p.waiting_props > 0) lines.push({ icon: <Flame className="h-3.5 w-3.5" />, text: `${p.waiting_props} shared ${p.waiting_props === 1 ? "workout" : "workouts"} waiting on your props`, hot: true });
  if (bday) lines.push({ icon: <Cake className="h-3.5 w-3.5" />, text: p.birthday_review > 0 ? bday.title : `${bday.title} · ${whenLabel(p.birthday_next!.post_at)}`, hot: p.birthday_review > 0 });
  lines.push({ icon: <CalendarClock className="h-3.5 w-3.5" />, text: next.when && !p.paused ? `${next.title} · ${next.when}` : next.title, hot: p.paused });

  return (
    <Link to="/admin/community" className="block rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 active:scale-[0.995]" data-no-return>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Flame className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-black leading-tight">
            Community <span className="text-[11px] font-semibold text-muted-foreground">· last 7 days</span>
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {p.opened}/{p.roster} opened · {p.reactions} {p.reactions === 1 ? "reaction" : "reactions"} · {p.comments} {p.comments === 1 ? "comment" : "comments"}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <ul className="mt-2.5 space-y-1.5 border-t border-border/70 pt-2.5">
        {lines.map((l, i) => (
          <li key={i} className={cn("flex items-center gap-2 text-[12px]", l.hot ? "font-bold text-primary" : "text-muted-foreground")}>
            <span className="shrink-0">{l.icon}</span>
            <span className="truncate">{l.text}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

type HubTab = "feed" | "daily" | "birthdays";
const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "daily", label: "Daily posts" },
  { key: "birthdays", label: "Birthdays" },
];

function tabFromHash(): HubTab {
  if (typeof window === "undefined") return "feed";
  const h = window.location.hash;
  if (/birthday=/.test(h) || /tab=birthdays/.test(h)) return "birthdays";
  if (/tab=daily/.test(h)) return "daily";
  return "feed";
}

/**
 * The coach's Community page: the week at a glance with what needs you on
 * top, then three tabs. Feed (react and reply), Daily posts (the schedule,
 * on/off, post now, edit what's next) and Birthdays (drafts to review, who's
 * next, their Home birthday cards). "+ Post" writes to the crew from anywhere
 * on the page.
 */
export function AdminCommunityHub() {
  const [tab, setTab] = useState<HubTab>(tabFromHash);
  const [writing, setWriting] = useState(false);
  const act = useSeriesAction();

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3 px-3 pb-12 pt-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-black tracking-tight">Community</h1>
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-black text-primary-foreground shadow-sm active:scale-95"
        >
          <PenLine className="h-4 w-4" /> Post
        </button>
      </div>

      <PulsePanel onGo={setTab} />

      <div>
        <div className="grid grid-cols-3 rounded-full bg-muted p-1" role="tablist" aria-label="Community sections">
          {HUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn("h-9 rounded-full text-[13px] font-bold transition-colors", tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "feed" ? (
        <div className="-mx-3 sm:-mx-4">
          <CommunityScreen hideTabs />
        </div>
      ) : tab === "daily" ? (
        <CoachWeeklyPosts />
      ) : (
        <div className="space-y-3">
          <BirthdayPostsCard />
          <UpcomingBirthdaysWidget windowDays={30} />
        </div>
      )}

      <NoteEditor
        open={writing}
        title="Write a post"
        initial=""
        saving={act.isPending}
        onClose={() => setWriting(false)}
        onSave={async (body) => {
          await act.mutateAsync({ kind: "note", body });
          toast.success("Posted to the community");
        }}
      />
    </div>
  );
}

/** The top of the Community page: four numbers, then what needs you. */
function PulsePanel({ onGo }: { onGo: (t: HubTab) => void }) {
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: p, isLoading, refetch } = useCommunityPulse();
  const feed = useCommunityFeed(null);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);

  // Shared workouts this week still waiting on a coach reaction (from the feed already loaded).
  const waiting = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return (feed.data?.pages[0]?.posts ?? []).filter((x) => !x.is_mine && x.kind !== "note" && !x.my_reaction && new Date(x.created_at).getTime() > weekAgo);
  }, [feed.data]);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (!p) return null;
  const replies = groupReplies(p.to_reply);
  const bday = birthdayPost(p);
  const next = nextPost(p);
  const stats = [
    { value: `${p.opened}/${p.roster}`, label: "opened it" },
    { value: String(p.reactions), label: p.reactions === 1 ? "reaction" : "reactions" },
    { value: String(p.comments), label: p.comments === 1 ? "comment" : "comments" },
    { value: String(p.client_posts), label: "shared" },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="px-4 pb-3 pt-3">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Last 7 days · clients only</div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="font-display truncate text-[26px] leading-none">{s.value}</div>
              <div className="mt-1 text-[11px] font-semibold leading-tight text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border/60 border-t border-border/60">
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

        {bday && <Row icon={<Cake className="h-4 w-4" />} title={bday.title} sub={bday.when ?? undefined} hot={p.birthday_review > 0} onClick={() => onGo("birthdays")} />}

        <Row icon={<CalendarClock className="h-4 w-4" />} title={next.title} sub={next.when ?? undefined} hot={p.paused} onClick={() => onGo("daily")} />

        {p.top_post && (
          <Row
            icon={<Star className="h-4 w-4" />}
            title="Top post this week"
            sub={`${p.top_post.line || p.top_post.name} · ${p.top_post.reactions} ❤️ · ${p.top_post.comments} 💬`}
            onClick={() => setOpenPost(p.top_post!.post_id)}
          />
        )}

        {p.not_opened.length > 0 && (
          <>
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
          </>
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

function Row({ icon, title, sub, hot, open, tag, onClick }: { icon: ReactNode; title: string; sub?: string; hot?: boolean; open?: boolean; tag?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted/60" aria-expanded={open}>
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", hot ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13px] font-bold", hot && "text-primary")}>{title}</div>
        {sub && <div className="truncate text-[12px] text-muted-foreground">{sub}</div>}
      </div>
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
