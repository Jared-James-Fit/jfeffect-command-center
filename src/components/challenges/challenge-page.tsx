import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Copy,
  Gift,
  MapPin,
  Megaphone,
  MonitorPlay,
  QrCode,
  Share2,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AthleteAvatar,
  BoardList,
  ChallengeCover,
  ChallengeShell,
  Countdown,
  DivisionTabs,
  Podium,
  QrImage,
  RecentList,
  ScoreText,
  StatusPill,
  ago,
  useMounted,
  useNow,
  useRankedRows,
} from "@/components/challenges/ui";
import {
  challengeUrl,
  joinUrl,
  mediaUrl,
  rememberedEntry,
  track,
  useBoard,
  useChallenge,
  useEntry,
  useLiveChallenge,
} from "@/lib/challenges/api";
import {
  boardMoments,
  clockTime,
  defaultDivision,
  eventWhen,
  formatScore,
  scoringText,
  selfSignupOpen,
  tiebreakText,
  type BoardMoment,
  type BoardRow,
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
  const showBoard = !!c && c.status !== "draft" ? true : !!c && !!c.my_role;
  const board = useBoard(slug, c?.status, !!c && showBoard);
  const [division, setDivision] = useState<string | null>(null);
  const [moment, setMoment] = useState<BoardMoment | null>(null);
  const prevRows = useRef<BoardRow[] | undefined>(undefined);
  const [mine, setMine] = useState<string | null>(null);
  const mounted = useMounted();

  useLiveChallenge(c?.id);

  useEffect(() => {
    if (c) setDivision((d) => d ?? defaultDivision(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id]);

  useEffect(() => {
    setMine(rememberedEntry(slug));
    track("view", { slug });
    if (src === "qr") track("qr_visit", { slug });
    if (refCode) track("ref_visit", { slug, code: refCode });
  }, [slug, src, refCode]);

  // a new leader / someone into the top three gets a moment on screen
  useEffect(() => {
    const rows = board.data?.rows;
    if (!rows) return;
    const m = boardMoments(prevRows.current, rows);
    prevRows.current = rows;
    if (m.length) {
      setMoment(m.find((x) => x.kind === "new_leader") ?? m[0]!);
      const t = setTimeout(() => setMoment(null), 6000);
      return () => clearTimeout(t);
    }
  }, [board.data?.rows]);

  const rows = useRankedRows(board.data?.rows, division);

  if (q.isPending && !c) {
    return (
      <ChallengeShell>
        <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <Skeleton className="mt-2 h-5 w-1/2" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
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

  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const when = mounted ? eventWhen(c.starts_at, c.timezone, { withYear: true }) : null;
  const signupOpen = selfSignupOpen(c);
  const hasResults =
    ["live", "paused", "verifying", "completed", "archived"].includes(c.status) ||
    (c.status === "draft" && !!c.my_role);
  const leader = rows.find((r) => r.place === 1);
  const full = c.max_participants != null && c.registered >= c.max_participants;

  return (
    <ChallengeShell back={{ to: "/challenges", label: "Challenges" }}>
      {c.status === "draft" ? (
        <div className="mb-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          Draft: only event staff can see this page.
        </div>
      ) : null}
      {c.is_test ? (
        <div className="mb-3 rounded-xl bg-warning/15 px-3 py-2 text-sm text-warning">
          Test challenge. Not listed publicly.
        </div>
      ) : null}

      {refCode ? <FriendBanner code={refCode} /> : null}

      {/* ── hero ── */}
      <ChallengeCover
        c={c}
        className={cn("w-full", c.cover_path ? "aspect-[16/9]" : "aspect-[3/1]")}
      >
        <div className="absolute left-3 top-3">
          <StatusPill status={c.status} final={c.final} />
        </div>
      </ChallengeCover>
      <h1 className="mt-4 font-display text-4xl uppercase leading-[0.95] tracking-wide sm:text-5xl">
        {c.title}
      </h1>
      {c.tagline ? <p className="mt-2 text-base text-muted-foreground">{c.tagline}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {c.load_label ? <Fact strong>{c.load_label}</Fact> : null}
        {c.objective ? <Fact>{c.objective}</Fact> : null}
        {c.prize_summary ? (
          <Fact icon={<Gift className="h-3.5 w-3.5" />}>{c.prize_summary}</Fact>
        ) : null}
        {c.entry_fee_label ? <Fact>{c.entry_fee_label} to enter</Fact> : null}
      </div>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        {c.starts_at ? (
          <p className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {when ?? "\u00a0"}
          </p>
        ) : (
          <p className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Date to be announced
          </p>
        )}
        <p className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />{" "}
          {[c.venue_name, c.city].filter(Boolean).join(" · ") || "Venue to be announced"}
        </p>
        <p className="flex items-center gap-2">
          <Users className="h-4 w-4" /> {c.registered} {c.registered === 1 ? "athlete" : "athletes"}{" "}
          registered
          {c.max_participants
            ? ` · ${Math.max(0, c.max_participants - c.registered)} spots left`
            : ""}
        </p>
      </div>

      {/* ── what to do ── */}
      <div className="mt-5 grid gap-2">
        {mine ? (
          <Button asChild className="h-12 text-base">
            <Link to="/challenges/$slug/r/$code" params={{ slug, code: mine }}>
              Your result <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        ) : signupOpen ? (
          <Button asChild className="h-12 text-base">
            <Link
              to="/challenges/$slug/join"
              params={{ slug }}
              search={{ ref: refCode ?? undefined, src: src ?? undefined }}
            >
              Enter the challenge
            </Link>
          </Button>
        ) : full && ["upcoming", "live"].includes(c.status) ? (
          <p className="rounded-xl bg-muted px-3 py-3 text-center text-sm">
            This challenge is full.
          </p>
        ) : null}
        {c.my_role ? (
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link to="/challenges/$slug/run" params={{ slug }}>
                <ClipboardList className="mr-2 h-4 w-4" /> Run event
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link to="/challenges/$slug/display" params={{ slug }}>
                <MonitorPlay className="mr-2 h-4 w-4" /> Big screen
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {c.announcement ? (
        <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm">{c.announcement}</p>
            {c.announcement_at ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {mounted ? ago(c.announcement_at) : ""}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {c.status === "cancelled" ? (
        <div className="mt-6 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
          This challenge was cancelled.
        </div>
      ) : null}

      {/* ── countdown ── */}
      {c.status === "upcoming" && c.starts_at ? (
        <section className="mt-6">
          <Countdown to={c.starts_at} label="Starts in" />
        </section>
      ) : null}
      {c.status === "live" && c.ends_at ? (
        <section className="mt-6">
          <Countdown to={c.ends_at} label="Ends in" />
        </section>
      ) : null}

      {/* ── results ── */}
      {hasResults ? (
        <section id="leaderboard" className="mt-8 scroll-mt-20">
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="text-xl font-semibold">{c.final ? "Final results" : "Leaderboard"}</h2>
            <LiveStamp
              status={c.status}
              final={c.final}
              asOf={board.dataUpdatedAt}
              tz={c.timezone}
            />
          </div>
          {c.status === "verifying" ? (
            <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
              The event is over. Judges are checking the scores; places can still change until
              results are final.
            </p>
          ) : null}
          {moment ? (
            <div
              className="jf-moment-in mb-3 flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2 text-sm font-medium text-warning"
              role="status"
            >
              <Trophy className="h-4 w-4" />
              {moment.kind === "new_leader"
                ? `New leader: ${moment.name}`
                : `${moment.name} is into the top three`}
            </div>
          ) : null}
          <DivisionTabs
            divisions={c.divisions}
            value={division}
            onChange={setDivision}
            allowAll={!c.separate_divisions}
          />
          {board.isPending ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : rows.length ? (
            <>
              {c.final && leader ? (
                <Champion
                  name={leader.name}
                  photo={leader.photo}
                  score={formatScore(leader.score, shape)}
                  shared={leader.shared}
                />
              ) : null}
              <Podium rows={rows} shape={shape} slug={slug} final={c.final} />
              <div className="mt-3">
                <BoardList rows={rows} shape={shape} slug={slug} startAt={4} highlight={mine} />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No scores yet. The board fills in the moment a judge records the first one.
            </div>
          )}
          {board.data?.recent?.length && !c.final ? (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">Latest verified</h3>
              <RecentList recent={board.data.recent} shape={shape} divisionId={division} />
            </div>
          ) : null}
        </section>
      ) : c.status === "upcoming" ? (
        <section className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center">
          <Trophy className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            The live leaderboard opens when the event starts.
          </p>
        </section>
      ) : null}

      {/* ── how it works ── */}
      <section className="mt-10 space-y-6">
        <Block title="How it works">
          <p className="text-sm">{scoringText(c)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{tiebreakText(c)}</p>
        </Block>
        {c.rules.length ? (
          <Block title="Rules">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {c.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </Block>
        ) : null}
        {c.safety || c.warmup ? (
          <Block title="Safety" icon={<ShieldCheck className="h-4 w-4" />}>
            {c.safety ? <p className="text-sm">{c.safety}</p> : null}
            {c.warmup ? <p className="mt-2 text-sm text-muted-foreground">{c.warmup}</p> : null}
          </Block>
        ) : null}
        {c.eligibility ? (
          <Block title="Who can enter">
            <p className="text-sm">{c.eligibility}</p>
            <p className="mt-1 text-xs text-muted-foreground">Minimum age {c.min_age}.</p>
          </Block>
        ) : null}
        {c.prizes.length ? (
          <Block title="Prizes" icon={<Gift className="h-4 w-4" />}>
            <ul className="space-y-2">
              {c.prizes.map((p, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-12 shrink-0 font-semibold text-warning">
                    {ordinalShort(p.place)}
                  </span>
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
                        <AthleteAvatar name={p.winner.name} photo={p.winner.photo} size={22} />{" "}
                        {p.winner.name}
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
        {c.sponsors.length ? (
          <Block title="Supported by">
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
          </Block>
        ) : null}
        {c.description ? (
          <Block title="About">
            <p className="whitespace-pre-line text-sm">{c.description}</p>
          </Block>
        ) : null}
        {c.address ? (
          <Block title="Where" icon={<MapPin className="h-4 w-4" />}>
            <p className="text-sm">{c.venue_name}</p>
            <a
              className="text-sm text-muted-foreground underline underline-offset-2"
              href={`https://maps.google.com/?q=${encodeURIComponent([c.venue_name, c.address].filter(Boolean).join(", "))}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.address}
            </a>
          </Block>
        ) : null}
      </section>

      <SharePanel c={c} refCode={refCode} />

      {["completed", "archived"].includes(c.status) ? (
        <div className="mt-8 rounded-2xl border border-border p-5 text-center">
          <p className="font-semibold">Missed this one?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            See what's next and get your name on a board.
          </p>
          <Button asChild variant="outline" className="mt-3 h-11">
            <Link to="/challenges">See upcoming challenges</Link>
          </Button>
        </div>
      ) : null}
    </ChallengeShell>
  );
}

function ordinalShort(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function Fact({
  children,
  strong,
  icon,
}: {
  children: React.ReactNode;
  strong?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3",
        strong ? "bg-foreground font-semibold text-background" : "bg-secondary",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Block({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Champion({
  name,
  photo,
  score,
  shared,
}: {
  name: string;
  photo: string | null;
  score: string;
  shared: boolean;
}) {
  return (
    <div className="mb-4 flex items-center gap-4 rounded-2xl border border-warning/40 bg-warning/10 p-4">
      <AthleteAvatar name={name} photo={photo} size={64} medal={1} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
          <Trophy className="h-3.5 w-3.5" /> {shared ? "Co-champion" : "Champion"}
        </p>
        <p className="truncate text-xl font-semibold">{name}</p>
        <p className="text-sm text-muted-foreground">{score}</p>
      </div>
    </div>
  );
}

function LiveStamp({
  status,
  final,
  asOf,
  tz,
}: {
  status: string;
  final: boolean;
  asOf: number;
  tz: string;
}) {
  const mounted = useMounted();
  useNow(15_000);
  if (!mounted) return null;
  if (final) return <span className="text-xs text-muted-foreground">Confirmed</span>;
  if (status !== "live" && status !== "paused" && status !== "verifying") return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === "live" ? <span className="jf-live-dot h-2 w-2 rounded-full bg-primary" /> : null}
      {status === "paused" ? "Paused · " : ""}Updated{" "}
      {asOf ? clockTime(new Date(asOf).toISOString(), tz) : "now"}
    </span>
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
        <img
          src={mediaUrl(logo) ?? ""}
          alt={name}
          className="h-10 w-auto max-w-full object-contain"
        />
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
  const c = d.challenge;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-secondary p-4">
      <AthleteAvatar name={d.name} photo={d.photo} size={48} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Swords className="h-3.5 w-3.5" /> You've been challenged
        </p>
        <p className="text-base font-semibold">
          {d.score != null ? (
            <>
              {d.name} did <ScoreText value={d.score} shape={c} className="text-lg" />. Can you beat
              it?
            </>
          ) : (
            <>{d.name} is in. Are you?</>
          )}
        </p>
      </div>
    </div>
  );
}

function SharePanel({ c, refCode }: { c: ChallengePublic; refCode: string | null }) {
  const [qr, setQr] = useState(false);
  const url = challengeUrl(c.slug, refCode ? { ref: refCode } : {});
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const text = useMemo(() => {
    if (c.status === "live") return `${c.title} is live right now. Watch the leaderboard:`;
    if (c.final) return `Final results from the ${c.title}:`;
    return `${c.title}${c.prize_summary ? `, ${c.prize_summary}` : ""}. Think you've got it?`;
  }, [c]);
  return (
    <section className="mt-10 rounded-2xl border border-border p-5">
      <h2 className="text-base font-semibold">Bring someone</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The board is only as good as the people on it.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {canShare ? (
          <Button
            className="h-11"
            onClick={() =>
              navigator.share({ title: c.title, text, url }).then(
                () => track("share", { slug: c.slug }),
                () => undefined,
              )
            }
          >
            <Share2 className="mr-2 h-4 w-4" /> Share
          </Button>
        ) : null}
        <Button
          variant="outline"
          className={cn("h-11", !canShare && "col-span-1")}
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
          <Copy className="mr-2 h-4 w-4" /> Copy link
        </Button>
        <Button variant="outline" className="h-11" onClick={() => setQr((v) => !v)}>
          <QrCode className="mr-2 h-4 w-4" /> QR code
        </Button>
      </div>
      {qr ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <QrImage
            value={selfSignupOpen(c) ? joinUrl(c.slug, "qr") : challengeUrl(c.slug, { src: "qr" })}
            size={200}
            label="Scan to open this challenge"
          />
          <p className="text-xs text-muted-foreground">
            {selfSignupOpen(c) ? "Scan to sign up" : "Scan to open this page"}
          </p>
        </div>
      ) : null}
    </section>
  );
}
