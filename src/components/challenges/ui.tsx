/**
 * Pieces every challenge screen shares: the public page shell, status pill,
 * athlete avatar, countdown, podium, live board and QR code.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import QRCode from "qrcode";
import { ChevronLeft, Search, Trophy } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { mediaUrl } from "@/lib/challenges/api";
import {
  STATUS_META,
  boardRows,
  formatScore,
  rankBadge,
  scoreUnit,
  scoreValue,
  type BoardRow,
  type ChallengeCard,
  type ChallengeStatus,
  type Division,
  type RecentAttempt,
  type ScoreShape,
} from "@/lib/challenges/model";

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

/** The public challenge pages' own top bar: brand back to the hub, and a way into the app. */
export function ChallengeShell({
  children,
  back,
  wide = false,
}: {
  children: ReactNode;
  back?: { to: string; label: string } | null;
  wide?: boolean;
}) {
  const { user } = useAuth();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header
        className="sticky top-0 z-30 border-b border-border bg-background"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div
          className={cn(
            "mx-auto flex h-14 items-center gap-2 px-4",
            wide ? "max-w-5xl" : "max-w-3xl",
          )}
        >
          {back ? (
            <Link
              to={back.to}
              className="-ml-2 flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> {back.label}
            </Link>
          ) : (
            <Link to="/challenges" className="flex h-10 items-center gap-2">
              <img src="/logo.png" alt="" className="h-7 w-7 rounded-md" />
              <span className="font-display text-lg uppercase tracking-wide">Challenges</span>
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1">
            {back ? (
              <Link to="/challenges" className="flex h-10 items-center gap-2 rounded-lg px-2">
                <img src="/logo.png" alt="JF Effect" className="h-7 w-7 rounded-md" />
              </Link>
            ) : (
              <Link
                to={user ? "/app" : "/auth"}
                className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {user ? "Open app" : "Sign in"}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main
        className={cn("mx-auto px-4 pb-24 pt-4", wide ? "max-w-5xl" : "max-w-3xl")}
        style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <Link to="/" className="font-medium text-foreground">
          JF Effect
        </Link>{" "}
        · Real competitions, verified results.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export function StatusPill({
  status,
  final,
  className,
}: {
  status: ChallengeStatus;
  final?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const label = status === "completed" && !final ? "Completed" : meta.label;
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        meta.tone === "live" && "bg-primary text-primary-foreground",
        meta.tone === "neutral" && "bg-secondary text-foreground",
        meta.tone === "muted" && "bg-muted text-muted-foreground",
        meta.tone === "warning" && "bg-warning/15 text-warning",
        meta.tone === "success" && "bg-success/15 text-success",
        meta.tone === "destructive" && "bg-destructive/15 text-destructive",
        className,
      )}
    >
      {meta.tone === "live" ? (
        <span className="jf-live-dot h-2 w-2 rounded-full bg-primary-foreground" />
      ) : null}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Avatar                                                             */
/* ------------------------------------------------------------------ */

const MEDAL_RING: Record<number, string> = {
  1: "ring-warning",
  2: "ring-[#c9ccd1]",
  3: "ring-[#d08a4b]",
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** An athlete's photo (only when they consented), else a clean monogram. */
export function AthleteAvatar({
  name,
  photo,
  size = 40,
  medal,
  className,
}: {
  name: string;
  photo: string | null | undefined;
  size?: number;
  medal?: number | null;
  className?: string;
}) {
  const url = mediaUrl(photo);
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-display text-muted-foreground",
        medal && MEDAL_RING[medal]
          ? `ring-2 ring-offset-2 ring-offset-background ${MEDAL_RING[medal]}`
          : "",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="leading-none">{initialsOf(name)}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Countdown                                                          */
/* ------------------------------------------------------------------ */

/**
 * True once the page runs in the browser. Anything time-based (countdowns,
 * "5m ago", an event's local time) renders only then: the server and a phone
 * can disagree on the clock or on a zone's rules (Manitoba from Nov 2026).
 */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function countdownParts(target: number, now: number) {
  const ms = Math.max(0, target - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return { done: ms === 0, d, h, m, s };
}

export function Countdown({
  to,
  label,
  size = "md",
}: {
  to: string;
  label: string;
  size?: "md" | "xl";
}) {
  const now = useNow(1000);
  const mounted = useMounted();
  if (!mounted) return null;
  const parts = countdownParts(new Date(to).getTime(), now);
  if (parts.done) return null;
  const cells: [number, string][] =
    parts.d > 0
      ? [
          [parts.d, "days"],
          [parts.h, "hrs"],
          [parts.m, "min"],
        ]
      : [
          [parts.h, "hrs"],
          [parts.m, "min"],
          [parts.s, "sec"],
        ];
  return (
    <div>
      <p
        className={cn("font-medium text-muted-foreground", size === "xl" ? "text-2xl" : "text-xs")}
      >
        {label}
      </p>
      <div className="mt-1 flex gap-2">
        {cells.map(([v, l]) => (
          <div
            key={l}
            className={cn(
              "rounded-xl bg-muted text-center",
              size === "xl" ? "min-w-[9rem] px-6 py-4" : "min-w-[3.5rem] px-2 py-1.5",
            )}
          >
            <div
              className={cn(
                "font-display tabular-nums leading-none",
                size === "xl" ? "text-8xl" : "text-2xl",
              )}
            >
              {String(v).padStart(2, "0")}
            </div>
            <div
              className={cn(
                "mt-1 text-muted-foreground",
                size === "xl" ? "text-xl" : "text-[11px]",
              )}
            >
              {l}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Score                                                              */
/* ------------------------------------------------------------------ */

export function ScoreText({
  value,
  shape,
  className,
  unitClassName,
}: {
  value: number | null;
  shape: ScoreShape;
  className?: string;
  unitClassName?: string;
}) {
  if (value == null) return <span className={cn("text-muted-foreground", className)}>–</span>;
  const timeLong = shape.measure === "time" && Number(value) >= 60;
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="font-display tabular-nums">{scoreValue(value, shape)}</span>
      {!timeLong ? (
        <span className={cn("ml-1 text-[0.55em] font-medium text-muted-foreground", unitClassName)}>
          {scoreUnit(value, shape)}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Podium + board                                                     */
/* ------------------------------------------------------------------ */

type RankedRow = BoardRow & { place: number; shared: boolean };

export function Podium({
  rows,
  shape,
  slug,
  final,
}: {
  rows: RankedRow[];
  shape: ScoreShape;
  slug: string;
  final: boolean;
}) {
  const top = rows.filter((r) => r.place <= 3).slice(0, 3);
  if (!top.length) return null;
  // second, first, third: the leader in the middle and tallest
  const order = [
    top.find((r) => r.place === 2) ?? top[1],
    top[0],
    top.find((r) => r.place === 3) ?? top[2],
  ].filter(Boolean) as RankedRow[];
  const unique = Array.from(new Map(order.map((r) => [r.code, r])).values());
  return (
    <div
      className="grid grid-cols-3 items-end gap-2"
      aria-label={final ? "Final podium" : "Current top three"}
    >
      {unique.map((r) => {
        const first = r.place === 1;
        return (
          <Link
            key={r.code}
            to="/challenges/$slug/r/$code"
            params={{ slug, code: r.code }}
            className={cn(
              "flex flex-col items-center rounded-2xl border border-border bg-card px-2 pb-3 text-center",
              first ? "pt-4" : "pt-3",
            )}
          >
            <AthleteAvatar name={r.name} photo={r.photo} size={first ? 72 : 56} medal={r.place} />
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-semibold",
                r.place === 1 ? "text-warning" : "text-muted-foreground",
              )}
            >
              {r.place === 1 ? <Trophy className="h-3.5 w-3.5" /> : null}
              {rankBadge(r.place, r.shared)}
            </span>
            <span className="mt-0.5 line-clamp-1 w-full text-sm font-semibold">{r.name}</span>
            <ScoreText
              value={r.score}
              shape={shape}
              className={cn("mt-0.5", first ? "text-3xl" : "text-2xl")}
            />
          </Link>
        );
      })}
    </div>
  );
}

/** Remembers each row's last place so a row that moved up flashes once. */
function useMovedUp(rows: RankedRow[]): Set<string> {
  const prev = useRef<Map<string, number> | null>(null);
  const moved = useMemo(() => {
    const out = new Set<string>();
    if (prev.current) {
      for (const r of rows) {
        const was = prev.current.get(r.code);
        if (was == null || r.place < was) out.add(r.code);
      }
    }
    return out;
  }, [rows]);
  useEffect(() => {
    prev.current = new Map(rows.map((r) => [r.code, r.place]));
  }, [rows]);
  return moved;
}

export function BoardList({
  rows,
  shape,
  slug,
  highlight,
  startAt = 1,
  search = true,
}: {
  rows: RankedRow[];
  shape: ScoreShape;
  slug: string;
  highlight?: string | null;
  startAt?: number;
  search?: boolean;
}) {
  const [q, setQ] = useState("");
  const moved = useMovedUp(rows);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => r.place >= startAt || needle);
    return needle ? list.filter((r) => r.name.toLowerCase().includes(needle)) : list;
  }, [rows, q, startAt]);
  return (
    <div>
      {search && rows.length > 8 ? (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a name"
            className="h-11 pl-9"
            aria-label="Find a name on the board"
          />
        </div>
      ) : null}
      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {shown.map((r) => (
          <li
            key={r.code}
            className={cn(
              moved.has(r.code) && "jf-board-flash",
              highlight === r.code && "bg-muted",
            )}
          >
            <Link
              to="/challenges/$slug/r/$code"
              params={{ slug, code: r.code }}
              className="flex min-h-[3.5rem] items-center gap-3 px-3 py-2"
            >
              <span
                className={cn(
                  "w-10 shrink-0 text-sm font-semibold tabular-nums",
                  r.place <= 3 ? "text-warning" : "text-muted-foreground",
                )}
              >
                {rankBadge(r.place, r.shared)}
              </span>
              <AthleteAvatar name={r.name} photo={r.photo} size={36} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.name}</span>
              <ScoreText value={r.score} shape={shape} className="text-xl" />
            </Link>
          </li>
        ))}
        {!shown.length ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {q ? "Nobody by that name yet." : "No scores yet."}
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export function DivisionTabs({
  divisions,
  value,
  onChange,
  allowAll,
}: {
  divisions: Division[];
  value: string | null;
  onChange: (v: string | null) => void;
  allowAll: boolean;
}) {
  if (!divisions.length) return null;
  const opts: { id: string | null; label: string }[] = [
    ...(allowAll ? [{ id: null, label: "Everyone" }] : []),
    ...divisions.map((d) => ({
      id: d.id,
      label: d.load_label ? `${d.name} · ${d.load_label}` : d.name,
    })),
  ];
  return (
    <div
      className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1"
      role="tablist"
      aria-label="Division"
    >
      {opts.map((o) => (
        <button
          key={o.id ?? "all"}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-10 shrink-0 rounded-full px-4 text-sm font-medium",
            value === o.id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RecentList({
  recent,
  shape,
  divisionId,
  limit = 5,
}: {
  recent: RecentAttempt[];
  shape: ScoreShape;
  divisionId?: string | null;
  limit?: number;
}) {
  const now = useNow(30_000);
  const mounted = useMounted();
  const list = recent
    .filter((r) => !r.tiebreak && (!divisionId || r.division_id === divisionId))
    .slice(0, limit);
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5">
      {list.map((r) => (
        <li key={r.id} className="flex items-center gap-2 text-sm">
          <AthleteAvatar name={r.name} photo={r.photo} size={24} />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{r.name}</span>{" "}
            <span className="text-muted-foreground">
              {r.valid ? formatScore(r.value, shape) : "no valid score"}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {mounted ? ago(r.at, now) : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** The ranked rows of the board on screen (everyone, or one division). */
export function useRankedRows(
  rows: BoardRow[] | undefined,
  divisionId: string | null,
): RankedRow[] {
  return useMemo(() => boardRows(rows ?? [], divisionId), [rows, divisionId]);
}

/* ------------------------------------------------------------------ */
/*  QR                                                                 */
/* ------------------------------------------------------------------ */

export function QrImage({
  value,
  size = 200,
  className,
  label,
}: {
  value: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then((u) => !off && setSrc(u))
      .catch(() => !off && setSrc(null));
    return () => {
      off = true;
    };
  }, [value, size]);
  return (
    <div
      className={cn("inline-block rounded-xl bg-white p-2", className)}
      style={{ width: size + 16 }}
    >
      {src ? (
        <img src={src} alt={label ?? "QR code"} width={size} height={size} />
      ) : (
        <div style={{ width: size, height: size }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cover                                                              */
/* ------------------------------------------------------------------ */

/** The event's artwork, or a clean typographic stand-in. */
export function ChallengeCover({
  c,
  className,
  children,
}: {
  c: Pick<ChallengeCard, "cover_path" | "title" | "load_label">;
  className?: string;
  children?: ReactNode;
}) {
  const url = mediaUrl(c.cover_path);
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-[#151517]", className)}>
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end p-4">
          <div className="h-1.5 w-12 bg-primary" />
          <div className="mt-2 font-display text-3xl uppercase leading-[0.95] text-white">
            {c.load_label ?? c.title}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
