// Event day on one phone: sign people up, check them in, call them to the
// platform, record and correct verified scores. A score shows as saved only
// after the database confirms it; a retry after a dropped connection sends
// the same key, so it can never be counted twice.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Megaphone,
  Minus,
  MonitorPlay,
  MoreHorizontal,
  Plus,
  QrCode,
  Search,
  Settings2,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  challengeKeys,
  correctAttempt,
  errorText,
  fetchConsole,
  fetchPage,
  newClientKey,
  recordAttempt,
  setNowUp,
  setStatus,
  staffRegister,
  updateEntry,
  uploadAthletePhoto,
  useChallengeLive,
  voidAttempt,
} from "@/lib/challenges/api";
import { formatScore, kgToLb, lbToKg, num, ordinal, parseScoreInput, rankLabel } from "@/lib/challenges/format";
import { challengeUrl } from "@/lib/challenges/share";
import type { ConsoleData, ConsoleEntry } from "@/lib/challenges/types";
import { RegistrationForm, type RegistrationDraft } from "./registration-form";
import { photoBlob } from "./photo-picker";
import { AthleteAvatar, StatusPill } from "./ui";

type Tab = "judge" | "register" | "people";

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function QrBlock({ url, size = 220 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: size * 2, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setSrc, () => setSrc(null));
  }, [url, size]);
  return src ? <img src={src} alt="QR code" style={{ width: size, height: size }} className="rounded-xl bg-white p-2" /> : <div style={{ width: size, height: size }} className="rounded-xl bg-muted" />;
}

function entryState(e: ConsoleEntry, attemptsAllowed: number): { label: string; tone: string } {
  const used = e.attempts.filter((a) => !a.voided).length;
  if (e.status === "withdrawn") return { label: "Withdrawn", tone: "text-muted-foreground" };
  if (e.status === "disqualified") return { label: "DQ", tone: "text-destructive" };
  if (used >= attemptsAllowed) return { label: "Done", tone: "text-success" };
  if (used > 0) return { label: `${used}/${attemptsAllowed} attempts`, tone: "text-foreground" };
  if (e.status === "checked_in") return { label: "Here", tone: "text-primary" };
  return { label: "Not checked in", tone: "text-muted-foreground" };
}

// ── Judge sheet ───────────────────────────────────────────────────────

function ScorePad({ data, entry, onSaved }: { data: ConsoleData; entry: ConsoleEntry; onSaved: () => void }) {
  const c = data.challenge;
  const used = entry.attempts.filter((a) => !a.voided).length;
  const left = c.attempts_allowed - used;
  const needBw = (c.tiebreak === "bodyweight_lower" || c.scoring === "bodyweight_ratio") && entry.bodyweight_kg == null;
  const [text, setText] = useState("");
  const [result, setResult] = useState<"valid" | "no_lift">("valid");
  const [note, setNote] = useState("");
  const [video, setVideo] = useState("");
  const [more, setMore] = useState(false);
  const [bw, setBw] = useState("");
  const [bwUnit, setBwUnit] = useState<"lb" | "kg">("lb");
  const [key, setKey] = useState(() => newClientKey());
  const [state, setState] = useState<{ phase: "idle" | "saving" | "saved" | "error"; message?: string; rank?: number | null; ranked?: number; tied?: boolean | null; value?: number }>({ phase: "idle" });
  const online = useOnline();

  useEffect(() => {
    // a new athlete / attempt gets a new key; the same one is reused for retries
    setKey(newClientKey());
    setText("");
    setResult("valid");
    setNote("");
    setVideo("");
    setState({ phase: "idle" });
  }, [entry.entry_id, used]);

  const value = result === "no_lift" ? (parseScoreInput(text, c.metric) ?? 0) : parseScoreInput(text, c.metric);
  const bwNum = bw.trim() ? Number(bw.replace(",", ".")) : null;
  const bwKg = bwNum != null && Number.isFinite(bwNum) ? (bwUnit === "lb" ? lbToKg(bwNum) : bwNum) : null;
  const canSave = value != null && (c.scoring !== "bodyweight_ratio" || entry.bodyweight_kg != null || !!bwKg) && state.phase !== "saving";

  function bump(d: number) {
    const cur = parseScoreInput(text, c.metric) ?? 0;
    setText(String(Math.max(0, cur + d)));
  }

  async function save() {
    if (value == null) return;
    setState({ phase: "saving" });
    try {
      const res = await recordAttempt({
        entryId: entry.entry_id,
        value,
        result,
        clientKey: key,
        note: note || null,
        video: video || null,
        bodyweightKg: bwKg ? Math.round(bwKg * 10) / 10 : null,
      });
      setState({ phase: "saved", rank: res.rank, ranked: res.ranked, tied: res.tied, value });
      onSaved();
    } catch (e) {
      setState({ phase: "error", message: errorText(e) });
    }
  }

  if (state.phase === "saved") {
    const resultUrl = challengeUrl(c.slug, { handle: entry.handle });
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <div>
          <div className="font-display text-4xl uppercase">{result === "valid" ? formatScore(state.value, c) : "No lift"}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Saved and on the leaderboard
            {state.rank != null ? ` · ${state.tied ? "tied " : ""}${ordinal(state.rank)} of ${state.ranked}` : ""}
          </div>
        </div>
        {entry.show_name && (
          <div className="flex flex-col items-center gap-2">
            <QrBlock url={resultUrl} size={200} />
            <p className="text-sm font-semibold">Scan for your result card</p>
          </div>
        )}
      </div>
    );
  }

  if (left <= 0) return <p className="rounded-xl bg-muted p-3 text-center text-sm">All attempts used. Correct an attempt below if needed.</p>;
  if (!["live"].includes(c.status) && !(c.status === "verifying" && (data.role === "owner" || data.role === "manager"))) {
    return <p className="rounded-xl bg-muted p-3 text-center text-sm">{c.status === "paused" ? "Paused. Resume the challenge to record scores." : "Scores can be recorded once the challenge is live."}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="text-center text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Attempt {used + 1} of {c.attempts_allowed}
      </div>
      <div className="flex items-center justify-center gap-3">
        {c.metric === "reps" && (
          <button type="button" onClick={() => bump(-1)} className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border" aria-label="One less">
            <Minus className="h-6 w-6" />
          </button>
        )}
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode={c.metric === "reps" ? "numeric" : c.metric === "time" ? "text" : "decimal"}
          placeholder={c.metric === "time" ? "0:00.0" : "0"}
          className="h-20 w-40 text-center font-display text-5xl tabular-nums"
          aria-label="Score"
        />
        {c.metric === "reps" && (
          <button type="button" onClick={() => bump(1)} className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border" aria-label="One more">
            <Plus className="h-6 w-6" />
          </button>
        )}
      </div>
      <div className="text-center text-sm text-muted-foreground">
        {c.metric === "time" ? "Minutes:seconds, or seconds" : c.unit === "reps" ? "Valid reps" : c.unit}
      </div>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Attempt result">
        {(["valid", "no_lift"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={result === r}
            onClick={() => setResult(r)}
            className={cn(
              "flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold",
              result === r ? (r === "valid" ? "border-success bg-success/10 text-success" : "border-destructive bg-destructive/10 text-destructive") : "border-border",
            )}
          >
            {r === "valid" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {r === "valid" ? "Valid" : "No lift"}
          </button>
        ))}
      </div>

      {needBw && (
        <div className="flex items-center gap-2">
          <Input value={bw} onChange={(e) => setBw(e.target.value)} inputMode="decimal" placeholder={c.scoring === "bodyweight_ratio" ? "Bodyweight (needed)" : "Bodyweight (for ties)"} className="h-12 flex-1 text-base" />
          <div className="flex rounded-lg border border-border p-1">
            {(["lb", "kg"] as const).map((u) => (
              <button key={u} type="button" onClick={() => setBwUnit(u)} className={cn("h-10 rounded-md px-3 text-sm font-semibold", bwUnit === u ? "bg-secondary" : "text-muted-foreground")}>
                {u}
              </button>
            ))}
          </div>
        </div>
      )}

      {more ? (
        <div className="space-y-2">
          <Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder="Judge's note (private)" className="h-11 text-base" />
          <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="Video link (https://…)" className="h-11 text-base" inputMode="url" />
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="w-full text-center text-sm font-semibold text-muted-foreground">
          Add a note or video link
        </button>
      )}

      {state.phase === "error" && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Not saved. {state.message}
        </div>
      )}
      {!online && state.phase !== "saving" && (
        <div className="flex items-center gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning">
          <WifiOff className="h-4 w-4" /> No connection. Saving will work again when you're back online.
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
      >
        {state.phase === "saving" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {state.phase === "saving" ? "Saving…" : state.phase === "error" ? "Try again" : `Save ${result === "valid" ? (value != null ? formatScore(value, c) : "score") : "no lift"}`}
      </button>
    </div>
  );
}

function AttemptRow({ data, a, onDone }: { data: ConsoleData; a: ConsoleEntry["attempts"][number]; onDone: () => void }) {
  const c = data.challenge;
  const [mode, setMode] = useState<null | "correct" | "void">(null);
  const [text, setText] = useState(String(a.v));
  const [result, setResult] = useState(a.r);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = c.final || !["live", "paused", "verifying"].includes(c.status);

  async function go() {
    setBusy(true);
    try {
      if (mode === "void") await voidAttempt(a.id, reason);
      else {
        const v = parseScoreInput(text, c.metric);
        if (v == null) throw new Error("Check the score.");
        await correctAttempt(a.id, v, result, reason);
      }
      toast.success(mode === "void" ? "Attempt voided" : "Score corrected");
      setMode(null);
      setReason("");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn("rounded-xl border border-border p-3", a.voided && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            Attempt {a.n}: {a.r === "valid" ? formatScore(a.v, c) : "No lift"}
            {a.voided && " · voided"}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(a.at))}
            {a.note ? ` · ${a.note}` : ""}
            {a.void_reason ? ` · ${a.void_reason}` : ""}
          </div>
        </div>
        {!a.voided && !locked && !mode && (
          <div className="flex gap-1">
            <button type="button" onClick={() => setMode("correct")} className="h-9 rounded-lg border border-border px-2.5 text-xs font-semibold">
              Correct
            </button>
            <button type="button" onClick={() => setMode("void")} className="h-9 rounded-lg border border-border px-2.5 text-xs font-semibold">
              Void
            </button>
          </div>
        )}
      </div>
      {mode && (
        <div className="mt-3 space-y-2">
          {mode === "correct" && (
            <div className="flex gap-2">
              <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" className="h-11 w-28 text-base" />
              <div className="flex flex-1 rounded-lg border border-border p-1">
                {(["valid", "no_lift"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setResult(r)} className={cn("h-9 flex-1 rounded-md text-sm font-semibold", result === r ? "bg-secondary" : "text-muted-foreground")}>
                    {r === "valid" ? "Valid" : "No lift"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "void" ? "Why void it? (required, kept in history)" : "Why the change? (required, kept in history)"} className="h-11 text-base" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode(null)} className="h-10 flex-1 rounded-lg border border-border text-sm font-semibold">
              Cancel
            </button>
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={go} className="h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {busy ? "Saving…" : mode === "void" ? "Void attempt" : "Save correction"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function EntrySheet({ data, entry, onOpenChange, refresh }: { data: ConsoleData; entry: ConsoleEntry | null; onOpenChange: (o: boolean) => void; refresh: () => void }) {
  const c = data.challenge;
  const canJudge = data.role === "owner" || data.role === "manager" || data.role === "judge";
  const [busy, setBusy] = useState(false);
  if (!entry) return null;
  const nowUp = c.now_up_entry === entry.entry_id;
  const division = data.divisions.find((d) => d.id === entry.division_id)?.name;

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function askReason(q: string): string | null {
    const r = window.prompt(q);
    return r && r.trim().length >= 3 ? r.trim() : null;
  }

  return (
    <Sheet open={!!entry} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[94dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <SheetHeader className="text-left">
          <SheetTitle className="sr-only">{entry.name}</SheetTitle>
        </SheetHeader>
        <div className="flex items-center gap-3">
          <AthleteAvatar name={entry.name} photo={entry.photo} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{entry.name}</div>
            <div className="text-sm text-muted-foreground">
              Bib #{entry.bib}
              {division ? ` · ${division}` : ""}
              {entry.bodyweight_kg ? ` · ${num(kgToLb(entry.bodyweight_kg))} lb` : ""}
              {!entry.show_name ? " · name hidden" : ""}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-secondary" aria-label="More">
              <MoreHorizontal className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {entry.status === "registered" && <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { status: "checked_in" }), "Checked in")}>Check in</DropdownMenuItem>}
              {entry.status === "checked_in" && entry.attempts.length === 0 && (
                <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { status: "registered" }))}>Undo check-in</DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  const v = window.prompt("Bodyweight in lb (leave blank to clear)", entry.bodyweight_kg ? num(kgToLb(entry.bodyweight_kg)) : "");
                  if (v == null) return;
                  const n = Number(v.replace(",", "."));
                  void act(() => updateEntry(entry.entry_id, { bodyweight_kg: v.trim() ? Math.round(lbToKg(n) * 10) / 10 : "" }), "Bodyweight saved");
                }}
              >
                Set bodyweight
              </DropdownMenuItem>
              {data.divisions.length > 1 &&
                data.divisions
                  .filter((d) => d.id !== entry.division_id)
                  .map((d) => (
                    <DropdownMenuItem key={d.id} onClick={() => act(() => updateEntry(entry.entry_id, { division_id: d.id }), `Moved to ${d.name}`)}>
                      Move to {d.name}
                    </DropdownMenuItem>
                  ))}
              <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { show_name: !entry.show_name }))}>
                {entry.show_name ? "Hide name publicly" : "Show name publicly"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {entry.status !== "withdrawn" && entry.attempts.length === 0 && (
                <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { status: "withdrawn", reason: "Withdrew" }), "Withdrawn")}>Withdraw</DropdownMenuItem>
              )}
              {entry.status === "withdrawn" && <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { status: "registered" }), "Back in")}>Reinstate</DropdownMenuItem>}
              {canJudge && entry.status !== "disqualified" && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    const reason = askReason("Why are they disqualified? (kept in history)");
                    if (reason) void act(() => updateEntry(entry.entry_id, { status: "disqualified", reason }), "Disqualified");
                  }}
                >
                  Disqualify
                </DropdownMenuItem>
              )}
              {canJudge && entry.status === "disqualified" && (
                <DropdownMenuItem onClick={() => act(() => updateEntry(entry.entry_id, { status: "checked_in", reason: "Reinstated" }), "Reinstated")}>Reinstate</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {entry.status === "disqualified" && <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">Disqualified: {entry.status_reason}</p>}
        {entry.status === "withdrawn" && <p className="mt-3 rounded-xl bg-muted p-3 text-sm">Withdrawn.</p>}

        {canJudge && c.status === "live" && entry.status !== "withdrawn" && entry.status !== "disqualified" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => setNowUp(c.id, nowUp ? null : entry.entry_id), nowUp ? undefined : "On the big screen")}
            className={cn("mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold", nowUp ? "border-primary bg-primary/10 text-primary" : "border-border")}
          >
            <Megaphone className="h-4 w-4" /> {nowUp ? "On the platform now · tap to clear" : "Call to the platform"}
          </button>
        )}

        {entry.contact && (
          <div className="mt-4 rounded-xl border border-border p-3 text-sm">
            <div className="font-semibold">{entry.contact.full_name ?? "No full name"}</div>
            {entry.contact.email && (
              <a className="block text-primary" href={`mailto:${entry.contact.email}`}>
                {entry.contact.email}
              </a>
            )}
            {entry.contact.phone && (
              <a className="block text-primary" href={`tel:${entry.contact.phone}`}>
                {entry.contact.phone}
              </a>
            )}
            {entry.contact.erased && <span className="text-muted-foreground">Contact details deleted at their request.</span>}
          </div>
        )}

        {canJudge && entry.status !== "withdrawn" && entry.status !== "disqualified" && (
          <div className="mt-5">
            <ScorePad data={data} entry={entry} onSaved={refresh} />
          </div>
        )}

        {entry.attempts.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="text-sm font-semibold">Attempts</div>
            <ul className="space-y-2">
              {entry.attempts.map((a) => (
                <AttemptRow key={a.id} data={data} a={a} onDone={refresh} />
              ))}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── The console ───────────────────────────────────────────────────────

export function EventConsole({ slug }: { slug: string }) {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const online = useOnline();
  const pageQ = useQuery({ queryKey: ["challenges", "console-page", slug], queryFn: () => fetchPage(slug), enabled: !!user });
  const challengeId = pageQ.data?.challenge.id;
  const q = useQuery({
    queryKey: challengeKeys.console(challengeId ?? "none"),
    queryFn: () => fetchConsole(challengeId!),
    enabled: !!challengeId,
    refetchInterval: 15_000,
  });
  useChallengeLive(challengeId);
  const data = q.data;
  const [tab, setTab] = useState<Tab>("judge");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{ bib: number; entry_id?: string; name: string; already?: boolean } | null>(null);
  const [regKey, setRegKey] = useState(0);
  const [filter, setFilter] = useState<"all" | "here" | "waiting" | "done">("all");

  useEffect(() => {
    if (data && (data.role === "registrar") && tab === "judge") setTab("register");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.role]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["challenges"] });
  };

  const c = data?.challenge;
  const entries = data?.entries ?? [];
  const open = entries.find((e) => e.entry_id === openId) ?? null;

  const list = useMemo(() => {
    if (!c) return [];
    const t = term.trim().toLowerCase().replace(/^#/, "");
    let l = entries.filter((e) => !t || e.name.toLowerCase().includes(t) || String(e.bib) === t || (e.contact?.full_name ?? "").toLowerCase().includes(t));
    const used = (e: ConsoleEntry) => e.attempts.filter((a) => !a.voided).length;
    if (tab === "judge") {
      // who's next first: here and not done, then not here, then done
      const order = (e: ConsoleEntry) =>
        e.status === "withdrawn" || e.status === "disqualified" ? 4 : used(e) >= c.attempts_allowed ? 3 : e.status === "checked_in" ? (used(e) > 0 ? 1 : 0) : 2;
      l = [...l].sort((a, b) => (c.now_up_entry === a.entry_id ? -1 : c.now_up_entry === b.entry_id ? 1 : order(a) - order(b) || a.bib - b.bib));
    } else {
      if (filter === "here") l = l.filter((e) => e.status === "checked_in");
      if (filter === "waiting") l = l.filter((e) => e.status === "registered");
      if (filter === "done") l = l.filter((e) => used(e) >= c.attempts_allowed);
    }
    return l;
  }, [entries, term, tab, filter, c]);

  async function lifecycle(status: string) {
    if (!c) return;
    let reason: string | undefined;
    if (status === "cancelled") {
      const r = window.prompt("Why is it cancelled? This shows on the public page.");
      if (!r) return;
      reason = r;
    }
    if (status === "verifying" && !window.confirm("End the challenge? New scores stop; a manager can still add a missed result while you review.")) return;
    try {
      await setStatus(c.id, status, reason);
      toast.success(status === "live" ? "You're live" : status === "paused" ? "Paused" : status === "verifying" ? "Submissions closed" : "Updated");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function register(d: RegistrationDraft) {
    if (!c) return;
    setRegBusy(true);
    setRegError(null);
    try {
      const res = await staffRegister(c.id, d.input);
      if (d.photo && res.athlete_id) {
        try {
          await uploadAthletePhoto(res.athlete_id, await photoBlob(d.photo), res.photo_nonce);
        } catch {
          toast.error("Registered, but the photo didn't upload. Add it from their entry.");
        }
      }
      setRegistered({ bib: res.bib, entry_id: res.entry_id, name: d.input.display_name, already: res.already });
      refresh();
    } catch (e) {
      setRegError(errorText(e));
    } finally {
      setRegBusy(false);
    }
  }

  if (loading) return <div className="flex h-dvh items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!user) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Event staff sign in</h1>
        <p className="text-sm text-muted-foreground">The event console is for this challenge's judges and staff.</p>
        <Link to="/auth" search={{ next: `/challenges/${slug}/console` } as never} className="inline-flex h-12 items-center rounded-lg bg-primary px-6 text-[15px] font-semibold text-primary-foreground">
          Sign in
        </Link>
      </div>
    );
  }
  if (pageQ.isLoading || q.isLoading) return <div className="flex h-dvh items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data || !c || q.error) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold">Not on this event's staff</h1>
        <p className="text-sm text-muted-foreground">Ask the organizer to add you as a judge or registration staff for this challenge.</p>
        <Link to="/challenges/$slug" params={{ slug }} className="text-sm font-semibold text-primary">
          Back to the challenge
        </Link>
      </div>
    );
  }

  const manage = data.role === "owner" || data.role === "manager";
  const done = entries.filter((e) => e.attempts.some((a) => !a.voided)).length;
  const here = entries.filter((e) => e.status === "checked_in").length;
  const tabs: { id: Tab; label: string }[] = [
    ...(data.role !== "registrar" ? [{ id: "judge" as Tab, label: "Judge" }] : []),
    { id: "register", label: "Register" },
    { id: "people", label: "People" },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2">
          <Link to="/challenges/$slug" params={{ slug }} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Back to the challenge">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{c.title}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusPill status={c.status} className="px-2 py-0.5 text-[10px]" />
              <span>
                {entries.length} in · {here} here · {done} done
              </span>
              {!online && <WifiOff className="h-3.5 w-3.5 text-warning" aria-label="Offline" />}
            </div>
          </div>
          <button type="button" onClick={() => setQrOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Sign-up QR code">
            <QrCode className="h-5 w-5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Event controls">
              <MoreHorizontal className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {manage && (c.status === "upcoming" || c.status === "draft") && <DropdownMenuItem onClick={() => lifecycle("live")}>Go live</DropdownMenuItem>}
              {manage && c.status === "live" && <DropdownMenuItem onClick={() => lifecycle("paused")}>Pause</DropdownMenuItem>}
              {manage && (c.status === "paused" || c.status === "verifying") && <DropdownMenuItem onClick={() => lifecycle("live")}>Resume</DropdownMenuItem>}
              {manage && (c.status === "live" || c.status === "paused") && <DropdownMenuItem onClick={() => lifecycle("verifying")}>End submissions</DropdownMenuItem>}
              <DropdownMenuItem asChild>
                <Link to="/challenges/$slug/live" params={{ slug }} target="_blank">
                  <MonitorPlay className="mr-2 h-4 w-4" /> Big screen
                </Link>
              </DropdownMenuItem>
              {manage && (
                <DropdownMenuItem asChild>
                  <Link to="/admin/challenges/$challengeId" params={{ challengeId: c.id }}>
                    <Settings2 className="mr-2 h-4 w-4" /> Settings & results
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mx-auto flex max-w-2xl gap-1 px-3 pb-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setRegistered(null);
              }}
              className={cn("h-10 flex-1 rounded-lg text-sm font-semibold", tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-3 pb-24 pt-3">
        {c.status === "upcoming" && manage && (
          <button type="button" onClick={() => lifecycle("live")} className="mb-3 flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground">
            Go live
          </button>
        )}
        {c.status === "verifying" && (
          <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            Submissions are closed.{" "}
            {manage ? (
              <Link to="/admin/challenges/$challengeId" params={{ challengeId: c.id }} search={{ tab: "results" } as never} className="font-semibold underline">
                Review and confirm the results
              </Link>
            ) : (
              "The organizer is confirming results."
            )}
          </div>
        )}

        {tab === "register" ? (
          registered ? (
            <div className="space-y-4 py-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
              <div className="text-lg font-semibold">{registered.already ? `${registered.name} was already registered` : `${registered.name} is in`}</div>
              <div className="mx-auto w-40 rounded-2xl border border-border p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Bib</div>
                <div className="font-display text-6xl leading-none">#{registered.bib}</div>
              </div>
              <div className="flex flex-col gap-2">
                {data.role !== "registrar" && registered.entry_id && (
                  <button
                    type="button"
                    onClick={() => {
                      setTab("judge");
                      setOpenId(registered.entry_id!);
                      setRegistered(null);
                    }}
                    className="h-12 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
                  >
                    Judge them now
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRegistered(null);
                    setRegKey((k) => k + 1);
                  }}
                  className="h-12 rounded-lg border border-border text-[15px] font-semibold"
                >
                  Register someone else
                </button>
              </div>
            </div>
          ) : (
            <RegistrationForm key={regKey} mode="staff" challenge={c} divisions={data.divisions} submitting={regBusy} error={regError} onSubmit={register} />
          )
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or bib" className="h-12 pl-9 text-base" inputMode="search" />
            </div>
            {tab === "people" && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {(
                  [
                    ["all", "All"],
                    ["here", "Checked in"],
                    ["waiting", "Not here yet"],
                    ["done", "Done"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setFilter(id)} className={cn("h-9 shrink-0 rounded-full border px-3 text-sm font-semibold", filter === id ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {entries.length ? "Nobody matches." : "Nobody's registered yet. Use Register, or show the sign-up QR."}
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {list.map((e) => {
                  const st = entryState(e, c.attempts_allowed);
                  const isUp = c.now_up_entry === e.entry_id;
                  return (
                    <li key={e.entry_id}>
                      <button type="button" onClick={() => setOpenId(e.entry_id)} className={cn("flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50", isUp && "bg-primary/[0.06]")}>
                        <span className="w-12 shrink-0 text-center font-display text-xl tabular-nums text-muted-foreground">#{e.bib}</span>
                        <AthleteAvatar name={e.name} photo={e.photo} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold">
                            {e.name}
                            {isUp && <span className="ml-2 text-xs font-bold uppercase text-primary">On the platform</span>}
                          </div>
                          <div className={cn("text-xs", st.tone)}>
                            {st.label}
                            {tab === "people" && e.contact?.full_name ? ` · ${e.contact.full_name}` : ""}
                          </div>
                        </div>
                        {e.score != null && (
                          <div className="text-right">
                            <div className="font-display text-xl tabular-nums">{formatScore(e.score, c)}</div>
                            <div className="text-xs text-muted-foreground">{rankLabel(e.rank, e.tied)}</div>
                          </div>
                        )}
                        {e.status === "disqualified" && <Ban className="h-4 w-4 text-destructive" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>

      <EntrySheet data={data} entry={open} onOpenChange={(o) => !o && setOpenId(null)} refresh={refresh} />

      <Sheet open={qrOpen} onOpenChange={setQrOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Scan to sign up</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col items-center gap-3 text-center">
            <QrBlock url={`${challengeUrl(slug)}/join?src=qr`} size={260} />
            <p className="font-display text-2xl uppercase">{c.title}</p>
            <p className="text-sm text-muted-foreground">Point a phone camera here. It takes a minute and it's free.</p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
