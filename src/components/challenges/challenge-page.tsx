/**
 * A challenge's public page, leaderboard first: a compact header with the one
 * thing to do next, then the board (search, find my ranking, live), then the
 * details folded away. Readable without an account; drafts only for staff.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Copy,
  Dumbbell,
  LayoutDashboard,
  MapPin,
  Megaphone,
  MonitorPlay,
  Share2,
  Swords,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  AthleteAvatar,
  ChallengeShell,
  ScoreText,
  StatusPill,
  ago,
  countdownParts,
  useMounted,
  useNow,
} from "@/components/challenges/ui";
import { Leaderboard } from "@/components/challenges/leaderboard";
import {
  challengeUrl,
  mediaUrl,
  rememberedEntry,
  track,
  useChallenge,
  useEntry,
  useLiveChallenge,
} from "@/lib/challenges/api";
import { athletes, hasBoard, primaryAction } from "@/lib/challenges/board";
import {
  eventWhen,
  ordinal,
  scoringText,
  tiebreakText,
  type ChallengePublic,
} from "@/lib/challenges/model";

export function ChallengePage({
  slug,
  initial,
  refCode,
  src,
}: {
  slug: string;
  initial: ChallengePublic | null;
  refCode: string | null;
  src: "qr" | "display" | null;
}) {
  const q = useChallenge(slug, initial);
  const c = q.data ?? null;
  const [remembered, setRemembered] = useState<string | null>(null);
  const [findMine, setFindMine] = useState(0);
  useLiveChallenge(c?.id);

  useEffect(() => {
    setRemembered(rememberedEntry(slug));
    track("view", { slug });
    if (src === "qr") track("qr_visit", { slug });
    if (refCode) track("ref_visit", { slug, code: refCode });
  }, [slug, src, refCode]);

  if (q.isPending && !c) {
    return (
      <ChallengeShell>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-9 w-3/4" />
        <Skeleton className="mt-3 h-12 w-full rounded-xl" />
        <Skeleton className="mt-6 h-12 w-full rounded-xl" />
        <Skeleton className="mt-3 h-72 w-full rounded-2xl" />
      </ChallengeShell>
    );
  }
  if (!c) {
    return (
      <ChallengeShell>
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">This challenge isn't up yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It may not be published, or the link is off by a letter.
          </p>
          <Button asChild className="mt-6 h-11">
            <Link to="/challenges">See all challenges</Link>
          </Button>
        </div>
      </ChallengeShell>
    );
  }

  // the signed-in athlete's own entry wins; else the one registered on this phone
  const mine = c.my_code ?? remembered;
  const action = primaryAction(c, mine);
  const board = hasBoard(c);

  return (
    <ChallengeShell back={{ to: "/challenges", label: "Challenges" }}>
      {c.status === "draft" ? (
        <Notice>Draft: only event staff can see this page.</Notice>
      ) : null}
      {c.is_test ? <Notice tone="warning">Test challenge. Not listed publicly.</Notice> : null}
      {refCode ? <FriendBanner code={refCode} /> : null}

      <Header c={c} />

      {/* the one thing to do next */}
      <div className="mt-4 flex gap-2">
        <PrimaryButton
          action={action}
          slug={slug}
          refCode={refCode}
          src={src}
          onFindMine={() => setFindMine((n) => n + 1)}
        />
        <ShareButton c={c} refCode={refCode} />
      </div>
      {action.kind === "register" ? <RegistrationLine c={c} /> : null}

      {c.my_role ? <StaffLinks c={c} /> : null}

      {c.announcement ? <Announcement text={c.announcement} at={c.announcement_at} /> : null}

      {c.status === "cancelled" ? (
        <div className="mt-6 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
          This challenge was cancelled.
        </div>
      ) : null}
      {c.status === "verifying" ? (
        <div className="mt-6 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          The event is over. Judges are checking scores; places can change until results are
          confirmed.
        </div>
      ) : null}

      <div className="mt-6">
        {board ? (
          <Leaderboard c={c} slug={slug} mine={mine} findMineNonce={findMine} />
        ) : c.status !== "cancelled" ? (
          <BeforeTheEvent c={c} />
        ) : null}
      </div>

      <Details c={c} slug={slug} />

      <AppPromo />
    </ChallengeShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({ c }: { c: ChallengePublic }) {
  const mounted = useMounted();
  const when = mounted ? eventWhen(c.starts_at, c.timezone) : null;
  const cover = mediaUrl(c.cover_path);
  const facts = [c.load_label, c.objective, c.prize_summary ? `Prize: ${c.prize_summary}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <header>
      {cover ? (
        <div className="mb-4 aspect-[4/1] w-full overflow-hidden rounded-2xl bg-muted">
          <img src={cover} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StatusPill status={c.status} final={c.final} />
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" />
          {c.starts_at ? (when ?? " ") : "Date to be announced"}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" />
          {c.venue_name ?? "Venue to be announced"}
        </span>
      </div>
      <h1 className="mt-2 font-display text-3xl uppercase leading-[0.95] tracking-wide sm:text-4xl">
        {c.title}
      </h1>
      {facts ? <p className="mt-2 text-sm text-muted-foreground">{facts}</p> : null}
    </header>
  );
}

function PrimaryButton({
  action,
  slug,
  refCode,
  src,
  onFindMine,
}: {
  action: ReturnType<typeof primaryAction>;
  slug: string;
  refCode: string | null;
  src: "qr" | "display" | null;
  onFindMine: () => void;
}) {
  const cls = "h-12 flex-1 text-base";
  switch (action.kind) {
    case "register":
      return (
        <Button asChild className={cls}>
          <Link
            to="/challenges/$slug/join"
            params={{ slug }}
            search={{ ref: refCode ?? undefined, src: src ?? undefined }}
          >
            Register
          </Link>
        </Button>
      );
    case "find_me":
      return (
        <Button className={cls} onClick={onFindMine}>
          Find my ranking
        </Button>
      );
    case "my_entry":
      return (
        <Button asChild variant="outline" className={cls}>
          <Link to="/challenges/$slug/r/$code" params={{ slug, code: action.code }}>
            You're registered <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      );
    case "rankings":
    case "final":
      return (
        <Button
          variant={action.kind === "final" ? "default" : "outline"}
          className={cls}
          onClick={() =>
            document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth" })
          }
        >
          {action.label}
        </Button>
      );
    default:
      return <div className="flex-1" />;
  }
}

function RegistrationLine({ c }: { c: ChallengePublic }) {
  const left = c.max_participants != null ? Math.max(0, c.max_participants - c.registered) : null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Users className="h-3.5 w-3.5" /> {athletes(c.registered)} registered
      {left != null ? ` · ${left} ${left === 1 ? "spot" : "spots"} left` : ""}
      {c.entry_fee_label ? ` · ${c.entry_fee_label}` : ""}
    </p>
  );
}

function ShareButton({ c, refCode }: { c: ChallengePublic; refCode: string | null }) {
  const url = challengeUrl(c.slug, refCode ? { ref: refCode } : {});
  const text = c.status === "live"
    ? `${c.title} is live right now. Watch the leaderboard:`
    : c.final
      ? `Final results from the ${c.title}:`
      : `${c.title}${c.prize_summary ? `, ${c.prize_summary}` : ""}. Think you've got it?`;
  return (
    <Button
      variant="outline"
      className="h-12 w-12 shrink-0 p-0"
      aria-label="Share this challenge"
      onClick={() => {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          navigator.share({ title: c.title, text, url }).then(
            () => track("share", { slug: c.slug }),
            () => undefined,
          );
          return;
        }
        navigator.clipboard.writeText(url).then(
          () => {
            toast.success("Link copied");
            track("copy_link", { slug: c.slug });
          },
          () => toast.error("Couldn't copy the link"),
        );
      }}
    >
      <Share2 className="h-5 w-5" />
    </Button>
  );
}

function StaffLinks({ c }: { c: ChallengePublic }) {
  const links = [
    { to: "/challenges/$slug/run", label: "Judge", icon: ClipboardList },
    { to: "/challenges/$slug/display", label: "Big screen", icon: MonitorPlay },
  ] as const;
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-sm">
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          params={{ slug: c.slug }}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-secondary px-3 font-medium"
        >
          <l.icon className="h-4 w-4" /> {l.label}
        </Link>
      ))}
      {c.my_role === "admin" ? (
        <Link
          to="/admin/challenges/$id"
          params={{ id: c.id }}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-secondary px-3 font-medium"
        >
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </Link>
      ) : null}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warning" }) {
  return (
    <div
      className={cn(
        "mb-3 rounded-xl px-3 py-2 text-sm",
        tone === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function Announcement({ text, at }: { text: string; at: string | null }) {
  const mounted = useMounted();
  return (
    <div className="mt-4 flex gap-3 rounded-2xl border border-border p-3">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm">{text}</p>
        {at && mounted ? <p className="mt-0.5 text-xs text-muted-foreground">{ago(at)}</p> : null}
      </div>
    </div>
  );
}

/** Before the board opens: a countdown and who's in, nothing else. */
function BeforeTheEvent({ c }: { c: ChallengePublic }) {
  const mounted = useMounted();
  const now = useNow(1000);
  const parts = c.starts_at ? countdownParts(new Date(c.starts_at).getTime(), now) : null;
  return (
    <section
      id="leaderboard"
      className="rounded-2xl border border-border bg-card p-5 text-center"
      aria-label="Leaderboard"
    >
      <p className="text-sm font-medium">The leaderboard goes live when the event starts</p>
      {mounted && parts && !parts.done ? (
        <p className="mt-2 font-display text-4xl tabular-nums">
          {parts.d > 0
            ? `${parts.d}d ${parts.h}h ${String(parts.m).padStart(2, "0")}m`
            : `${parts.h}:${String(parts.m).padStart(2, "0")}:${String(parts.s).padStart(2, "0")}`}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-muted-foreground">{athletes(c.registered)} registered</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Details: short, folded away under the board                        */
/* ------------------------------------------------------------------ */

function Details({ c, slug }: { c: ChallengePublic; slug: string }) {
  const mounted = useMounted();
  const sections = useMemo(() => {
    const out: { id: string; title: string; body: React.ReactNode }[] = [];
    out.push({
      id: "how",
      title: "How it works",
      body: (
        <>
          <p>{scoringText(c)}</p>
          <p className="mt-2 text-muted-foreground">{tiebreakText(c)}</p>
        </>
      ),
    });
    if (c.rules.length)
      out.push({
        id: "rules",
        title: `Rules (${c.rules.length})`,
        body: (
          <ol className="list-decimal space-y-1.5 pl-5">
            {c.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        ),
      });
    if (c.prizes.length || c.prize_summary)
      out.push({
        id: "prizes",
        title: "Prizes",
        body: (
          <>
            {c.prize_summary && !c.prizes.length ? <p>{c.prize_summary}</p> : null}
            <ul className="space-y-2">
              {c.prizes.map((p, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-10 shrink-0 font-semibold">{ordinal(p.place)}</span>
                  <span className="flex-1">
                    {p.title}
                    {p.division_id ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {c.divisions.find((d) => d.id === p.division_id)?.name}
                      </span>
                    ) : null}
                    {p.sponsor ? (
                      <span className="block text-xs text-muted-foreground">from {p.sponsor}</span>
                    ) : null}
                    {p.winner ? (
                      <Link
                        to="/challenges/$slug/r/$code"
                        params={{ slug, code: p.winner.code }}
                        className="mt-1 flex items-center gap-2 font-medium"
                      >
                        <AthleteAvatar name={p.winner.name} photo={p.winner.photo} size={22} />
                        {p.winner.name}
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ),
      });
    out.push({
      id: "when",
      title: "When and where",
      body: (
        <div className="space-y-1">
          <p>
            {c.starts_at
              ? mounted
                ? eventWhen(c.starts_at, c.timezone, { withYear: true })
                : " "
              : "Date to be announced"}
            {c.ends_at && mounted ? ` until ${eventWhen(c.ends_at, c.timezone)?.split(" · ")[1] ?? ""}` : ""}
          </p>
          <p>{[c.venue_name, c.city].filter(Boolean).join(" · ") || "Venue to be announced"}</p>
          {c.address ? (
            <a
              className="text-muted-foreground underline underline-offset-2"
              href={`https://maps.google.com/?q=${encodeURIComponent([c.venue_name, c.address].filter(Boolean).join(", "))}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.address}
            </a>
          ) : null}
          <p className="text-muted-foreground">
            {athletes(c.registered)} registered
            {c.max_participants ? ` of ${c.max_participants}` : ""}
            {c.entry_fee_label ? ` · Entry: ${c.entry_fee_label}` : ""}
          </p>
        </div>
      ),
    });
    if (c.eligibility || c.min_age)
      out.push({
        id: "who",
        title: "Who can enter",
        body: (
          <>
            {c.eligibility ? <p>{c.eligibility}</p> : null}
            <p className="mt-1 text-muted-foreground">Minimum age {c.min_age}.</p>
          </>
        ),
      });
    if (c.safety || c.warmup)
      out.push({
        id: "safety",
        title: "Safety",
        body: (
          <>
            {c.safety ? <p>{c.safety}</p> : null}
            {c.warmup ? <p className="mt-2 text-muted-foreground">{c.warmup}</p> : null}
          </>
        ),
      });
    if (c.description)
      out.push({
        id: "about",
        title: "About",
        body: <p className="whitespace-pre-line">{c.description}</p>,
      });
    if (c.sponsors.length)
      out.push({
        id: "sponsors",
        title: "Supported by",
        body: (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {c.sponsors.map((s) => (
              <SponsorTile
                key={s.id ?? s.name}
                name={s.name}
                logo={s.logo_path}
                url={s.url ?? null}
                blurb={s.blurb ?? null}
              />
            ))}
          </div>
        ),
      });
    return out;
  }, [c, slug, mounted]);

  return (
    <section className="mt-10" aria-label="Event details">
      <h2 className="mb-1 text-base font-semibold">Details</h2>
      <Accordion type="multiple" className="rounded-2xl border border-border px-4">
        {sections.map((s) => (
          <AccordionItem key={s.id} value={s.id} className="last:border-b-0">
            <AccordionTrigger className="min-h-[52px] py-3 text-[15px] hover:no-underline">
              {s.title}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed">{s.body}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <CopyLink c={c} />
    </section>
  );
}

function CopyLink({ c }: { c: ChallengePublic }) {
  const url = challengeUrl(c.slug);
  return (
    <button
      type="button"
      className="mt-3 flex h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      onClick={() =>
        navigator.clipboard.writeText(url).then(
          () => {
            toast.success("Link copied");
            track("copy_link", { slug: c.slug });
          },
          () => toast.error("Couldn't copy the link"),
        )
      }
    >
      <Copy className="h-4 w-4" /> Copy link to this challenge
    </button>
  );
}

function SponsorTile({
  name,
  logo,
  url,
  blurb,
}: {
  name: string;
  logo: string | null;
  url: string | null;
  blurb: string | null;
}) {
  const inner = (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-border p-3 text-center">
      {logo ? (
        <img src={mediaUrl(logo) ?? ""} alt={name} className="h-10 w-auto max-w-full object-contain" />
      ) : (
        <span className="text-sm font-semibold">{name}</span>
      )}
      {blurb ? <span className="mt-1 text-xs text-muted-foreground">{blurb}</span> : null}
    </div>
  );
  return url ? (
    <a href={url} target="_blank" rel="noreferrer sponsored">
      {inner}
    </a>
  ) : (
    inner
  );
}

/** "Jared did 18 reps. Can you beat it?" when someone arrives from a friend's link. */
function FriendBanner({ code }: { code: string }) {
  const e = useEntry(code);
  const d = e.data;
  if (!d) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-secondary p-3">
      <AthleteAvatar name={d.name} photo={d.photo} size={44} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Swords className="h-3.5 w-3.5" /> You've been challenged
        </p>
        <p className="text-[15px] font-semibold">
          {d.score != null ? (
            <>
              {d.name} did <ScoreText value={d.score} shape={d.challenge} className="text-lg" />.
              Can you beat it?
            </>
          ) : (
            <>{d.name} is in. Are you?</>
          )}
        </p>
      </div>
    </div>
  );
}

/** The quiet way into the app for people who came for the event. */
export function AppPromo({ className }: { className?: string }) {
  const { user } = useAuth();
  if (user) return null;
  return (
    <section
      className={cn("mt-10 flex items-center gap-4 rounded-2xl border border-border p-4", className)}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
        <Dumbbell className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Train for the next one with JF Effect</p>
        <p className="text-sm text-muted-foreground">
          Free workouts, a workout builder and the crew. Free to join.
        </p>
      </div>
      <Button asChild variant="outline" className="h-10 shrink-0">
        <Link to="/join">Try it free</Link>
      </Button>
    </section>
  );
}
