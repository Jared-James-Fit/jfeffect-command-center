import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarPlus, ChevronRight, Gift, MapPin, MonitorPlay, Settings2, Share2, ShieldCheck, Ticket, Timer, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { arrival, mediaUrl, track, useBoard, useChallengeLive, usePage } from "@/lib/challenges/api";
import { eventWhen, formatScore, hasBoard, isOver, loadText, objectiveText, ordinal, tiebreakText } from "@/lib/challenges/format";
import { cardForEvent, challengeUrl, eventCaption } from "@/lib/challenges/share";
import type { BoardData, ChallengePageData } from "@/lib/challenges/types";
import { Leaderboard, RecentResults } from "./leaderboard";
import { ShareStudio } from "./share-studio";
import { AppCta, AthleteAvatar, Countdown, PublicBar, PublicFooter, Section, StatusPill } from "./ui";

function icsFor(page: ChallengePageData): string {
  const c = page.challenge;
  const start = new Date(c.starts_at!);
  const end = c.ends_at ? new Date(c.ends_at) : new Date(start.getTime() + 3 * 3600_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JF Effect//Challenges//EN",
    "BEGIN:VEVENT",
    `UID:challenge-${c.id}@jfeffect.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(c.title)}`,
    `LOCATION:${esc([c.location_name, c.location_address].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${esc(`${objectiveText(c)}\n${challengeUrl(c.slug)}`)}`,
    `URL:${challengeUrl(c.slug)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function addToCalendar(page: ChallengePageData) {
  track(page.challenge.slug, "calendar_add");
  const blob = new Blob([icsFor(page)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${page.challenge.slug}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function Fact({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="text-[15px] font-medium">{children}</div>
      </div>
    </div>
  );
}

function Details({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15px] font-semibold">
        {title}
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t border-border px-4 py-3 text-[15px] leading-relaxed">{children}</div>
    </details>
  );
}

export function ChallengePage({
  slug,
  initialPage,
  initialBoard,
  search,
}: {
  slug: string;
  initialPage: ChallengePageData | null;
  initialBoard: BoardData | null;
  search: { ref?: string; src?: string };
}) {
  const pageQ = usePage(slug, initialPage);
  const page = pageQ.data ?? initialPage;
  const c = page?.challenge;
  const showBoard = !!c && hasBoard(c.status);
  const boardQ = useBoard(slug, showBoard, initialBoard);
  const board = boardQ.data ?? initialBoard;
  useChallengeLive(c?.id);
  const [shareOpen, setShareOpen] = useState(false);
  const [from, setFrom] = useState<{ ref: string | null; source: string | null }>({ ref: null, source: null });

  useEffect(() => {
    const a = arrival(search);
    setFrom(a);
    track(slug, "page_view", { ref: a.ref, source: a.source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const firstPrize = page?.prizes.find((p) => p.place === 1 && !p.division_id) ?? page?.prizes[0] ?? null;
  const buildEvent = useCallback((h: string) => cardForEvent(c!, firstPrize?.title ?? null, h), [c, firstPrize]);
  const eventHeadlines = useMemo(() => {
    if (!c) return [];
    if (c.status === "live") return ["LIVE NOW", "SCAN TO ENTER", "COME WATCH"];
    if (isOver(c.status)) return ["FINAL RESULTS", "SEE WHO WON"];
    return ["SCAN TO ENTER", "WHO'S IN?", "SEE YOU THERE"];
  }, [c]);

  if (!page || !c) {
    return (
      <div className="min-h-screen bg-background">
        <PublicBar />
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="text-xl font-semibold">Challenge not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">It may not be public yet, or the link has a typo.</p>
          <Link to="/challenges" className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            See all challenges
          </Link>
        </div>
      </div>
    );
  }

  const when = eventWhen(c.starts_at, c.ends_at, c.timezone);
  const load = loadText(c.load_value, c.load_unit);
  const joinOpen = page.registration === "open" && c.self_registration;
  const role = page.viewer.role;
  const mine = page.viewer.entry;
  const spotsLeft = c.max_participants ? Math.max(0, c.max_participants - page.counts.registered) : null;
  const leader = board?.rows.find((r) => r.rank === 1) ?? null;
  const cancelledNote = c.status === "cancelled" ? page.updates.find((u) => u.body.startsWith("Cancelled"))?.body : null;
  const mapHref = c.location_address || c.location_name ? `https://maps.google.com/?q=${encodeURIComponent([c.location_name, c.location_address, c.city].filter(Boolean).join(", "))}` : null;

  return (
    <div className="min-h-screen bg-background">
      <PublicBar
        right={
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-secondary"
            aria-label="Share this challenge"
          >
            <Share2 className="h-5 w-5" />
          </button>
        }
      />

      {page.preview && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning">
          Preview: only event staff can see this page until it's published.
        </div>
      )}

      <main className="mx-auto max-w-3xl space-y-8 px-4 pb-6 pt-4">
        {/* ── Hero ── */}
        <section className="space-y-4">
          {c.cover_path ? (
            <div className="relative overflow-hidden rounded-2xl bg-muted" style={{ aspectRatio: "16 / 9" }}>
              <img src={mediaUrl(c.cover_path)!} alt="" className="h-full w-full object-cover" />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            {c.city && <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{c.city}</span>}
          </div>
          <div>
            <h1 className="font-display text-[44px] uppercase leading-[0.95] tracking-[0.005em] sm:text-6xl">{c.title}</h1>
            {c.tagline && <p className="mt-3 text-lg text-muted-foreground">{c.tagline}</p>}
          </div>

          {c.status === "upcoming" && c.starts_at && <Countdown to={c.starts_at} label="Starts in" />}
          {c.status === "live" && c.ends_at && <Countdown to={c.ends_at} label="Ends in" />}

          {cancelledNote && <div className="rounded-xl border border-border bg-muted p-3 text-sm">{cancelledNote}</div>}

          {/* the one main action */}
          {mine ? (
            <Link
              to="/challenges/$slug/$handle"
              params={{ slug, handle: mine.handle }}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
            >
              <Ticket className="h-4 w-4" /> You're in · Bib #{mine.bib}
            </Link>
          ) : joinOpen ? (
            <Link
              to="/challenges/$slug/join"
              params={{ slug }}
              search={{ ref: from.ref ?? undefined, src: from.source ?? undefined } as never}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
            >
              Enter the challenge{/^free$/i.test(c.entry_fee) ? " · Free" : ""}
            </Link>
          ) : page.registration === "full" ? (
            <div className="rounded-xl border border-border p-3 text-center text-sm font-semibold">This challenge is full.</div>
          ) : !isOver(c.status) && page.registration === "open" && !c.self_registration ? (
            <div className="rounded-xl border border-border p-3 text-center text-sm">Sign up with the event staff at the venue.</div>
          ) : null}

          {(role === "owner" || role === "manager" || role === "judge" || role === "registrar") && (
            <div className="flex flex-wrap gap-2">
              <Link to="/challenges/$slug/console" params={{ slug }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold">
                <Timer className="h-4 w-4" /> Event console
              </Link>
              <Link to="/challenges/$slug/live" params={{ slug }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold">
                <MonitorPlay className="h-4 w-4" /> Big screen
              </Link>
              {(role === "owner" || role === "manager") && (
                <Link to="/admin/challenges/$challengeId" params={{ challengeId: c.id }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold">
                  <Settings2 className="h-4 w-4" /> Edit
                </Link>
              )}
            </div>
          )}

          <div className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
            <Fact icon={Trophy} label="To win">
              {objectiveText(c)}
            </Fact>
            <Fact icon={CalendarPlus} label="When">
              {when ?? "Date to be announced"}
              {c.status === "upcoming" && c.starts_at && (
                <button type="button" onClick={() => addToCalendar(page)} className="ml-2 text-sm font-semibold text-primary underline-offset-2 hover:underline">
                  Add to calendar
                </button>
              )}
            </Fact>
            <Fact icon={MapPin} label="Where">
              {c.location_name ? (
                mapHref ? (
                  <a href={mapHref} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                    {c.location_name}
                    {c.location_address ? `, ${c.location_address}` : ""}
                  </a>
                ) : (
                  c.location_name
                )
              ) : (
                <>Venue to be announced{c.city ? ` · ${c.city}` : ""}</>
              )}
            </Fact>
            {firstPrize ? (
              <Fact icon={Gift} label="Prize">
                {firstPrize.title}
                {firstPrize.sponsor ? <span className="text-muted-foreground"> · from {firstPrize.sponsor}</span> : null}
              </Fact>
            ) : null}
            <Fact icon={Users} label="Athletes">
              {page.counts.registered} registered
              {page.counts.competed ? ` · ${page.counts.competed} competed` : ""}
              {spotsLeft != null && !isOver(c.status) ? ` · ${spotsLeft} spots left` : ""}
            </Fact>
            <Fact icon={Ticket} label="Entry">
              {c.entry_fee}
              {c.min_age ? ` · ${c.min_age}+` : ""}
            </Fact>
          </div>
        </section>

        {/* ── Winners ── */}
        {c.final && page.winners.length > 0 && (
          <Section title="Winners">
            <div className="space-y-2">
              {page.winners.map((w, i) => {
                const inner = (
                  <div className={cn("flex items-center gap-3 rounded-2xl border p-3", w.place === 1 ? "border-warning/50 bg-warning/[0.07]" : "border-border bg-card")}>
                    <AthleteAvatar name={w.name} photo={w.photo} size={w.place === 1 ? 56 : 44} ring={w.place === 1} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {ordinal(w.place)} place{w.division_id ? ` · ${page.divisions.find((d) => d.id === w.division_id)?.name ?? ""}` : ""}
                        {w.share < 1 ? " · tied" : ""}
                      </div>
                      <div className="truncate text-base font-semibold">{w.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {w.prize}
                        {w.share < 1 ? ` (split ${Math.round(1 / w.share)} ways)` : ""}
                      </div>
                    </div>
                    <span className="font-display text-2xl tabular-nums">{formatScore(w.score, c)}</span>
                  </div>
                );
                return w.handle ? (
                  <Link key={`${w.place}-${w.handle}-${i}`} to="/challenges/$slug/$handle" params={{ slug, handle: w.handle }} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={`${w.place}-${i}`}>{inner}</div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Leaderboard ── */}
        {showBoard && board && (
          <Section
            id="leaderboard"
            title={board.final ? "Final standings" : "Live leaderboard"}
            action={
              !board.final && (
                <span className="text-xs text-muted-foreground">
                  Updated {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: c.timezone }).format(new Date(board.updated_at))}
                </span>
              )
            }
          >
            {board.now_up && (
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3">
                <AthleteAvatar name={board.now_up.name} photo={board.now_up.photo} size={44} />
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">On the platform</div>
                  <div className="truncate text-base font-semibold">{board.now_up.name}</div>
                </div>
              </div>
            )}
            {!board.final && c.status === "verifying" && (
              <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                Submissions are closed. These standings are provisional until the results are confirmed.
              </div>
            )}
            <Leaderboard board={board} spec={c} divisions={page.divisions} slug={slug} live={!board.final} mine={mine?.handle} />
            {!board.final && leader && board.rows.length > 1 && (
              <p className="mt-3 text-center text-xs text-muted-foreground">Only verified scores count. Ties follow the rule below.</p>
            )}
          </Section>
        )}

        {showBoard && board && !board.final && board.recent.length > 0 && (
          <Section title="Just verified">
            <RecentResults board={board} spec={c} slug={slug} />
          </Section>
        )}

        {!showBoard && c.status !== "cancelled" && (
          <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            The live leaderboard opens when the challenge starts.
            {page.counts.registered > 0 ? ` ${page.counts.registered} ${page.counts.registered === 1 ? "athlete has" : "athletes have"} signed up so far.` : ""}
          </div>
        )}

        {/* ── How it works ── */}
        <Section title="How it works">
          <div className="space-y-2">
            {c.description && <p className="pb-2 text-[15px] leading-relaxed text-muted-foreground">{c.description}</p>}
            {c.how_it_works && (
              <Details title="On the day" open={c.status === "upcoming"}>
                <p className="whitespace-pre-line">{c.how_it_works}</p>
              </Details>
            )}
            {c.rules.length > 0 && (
              <Details title="Rules">
                <ol className="list-decimal space-y-1.5 pl-5">
                  {c.rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
                {c.judging_standard && <p className="mt-3 text-muted-foreground">{c.judging_standard}</p>}
                {load && <p className="mt-3 text-sm text-muted-foreground">Weight: {load}.</p>}
                {c.equipment && <p className="mt-1 text-sm text-muted-foreground">Equipment: {c.equipment}</p>}
              </Details>
            )}
            <Details title="Ties">
              <p>{tiebreakText(c.tiebreak, c.tiebreak_note)}</p>
            </Details>
            {c.eligibility && (
              <Details title="Who can enter">
                <p className="whitespace-pre-line">{c.eligibility}</p>
              </Details>
            )}
            {c.safety && (
              <Details title="Safety">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <p className="whitespace-pre-line">{c.safety}</p>
                </div>
              </Details>
            )}
          </div>
        </Section>

        {/* ── Prizes ── */}
        {page.prizes.length > 1 && (
          <Section title="Prizes">
            <ul className="space-y-2">
              {page.prizes.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-display text-lg">{ordinal(p.place)}</span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.division_id ? page.divisions.find((d) => d.id === p.division_id)?.name : "Overall"}
                      {p.sponsor ? ` · from ${p.sponsor}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Sponsors ── */}
        {page.sponsors.length > 0 && (
          <Section title="Thanks to">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {page.sponsors.map((s) => {
                const inner = (
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-center">
                    {s.logo_path ? (
                      <img src={mediaUrl(s.logo_path)!} alt={s.name} className="h-14 w-auto max-w-full object-contain" loading="lazy" />
                    ) : (
                      <span className="font-display text-xl">{s.name}</span>
                    )}
                    {s.logo_path && <span className="text-xs font-semibold">{s.name}</span>}
                    {s.blurb && <span className="text-xs text-muted-foreground">{s.blurb}</span>}
                  </div>
                );
                return s.url ? (
                  <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
                    {inner}
                  </a>
                ) : (
                  <div key={s.id}>{inner}</div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Updates ── */}
        {page.updates.length > 0 && (
          <Section title="Updates">
            <ul className="space-y-2">
              {page.updates.map((u) => (
                <li key={u.id} className="rounded-2xl border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: c.timezone }).format(new Date(u.at))}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[15px]">{u.body}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left"
        >
          <div>
            <div className="text-[15px] font-semibold">Bring a friend</div>
            <div className="text-sm text-muted-foreground">Share the challenge with a card and a QR code.</div>
          </div>
          <Share2 className="h-5 w-5 shrink-0" />
        </button>

        <AppCta slug={slug} />
      </main>
      <PublicFooter />

      <Sheet open={shareOpen} onOpenChange={setShareOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Share the challenge</SheetTitle>
          </SheetHeader>
          {shareOpen && (
            <div className="mt-4">
              <ShareStudio
                build={buildEvent}
                headlines={eventHeadlines}
                caption={eventCaption(c, challengeUrl(slug, { src: "share" }), firstPrize?.title ?? null)}
                link={challengeUrl(slug, { src: "share" })}
                slug={slug}
                fileWho="event"
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
