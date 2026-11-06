import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { challengeKeys, challengeRpc, errorText, fetchConsole, finalizeResults, reopenResults, setStatus } from "@/lib/challenges/api";
import { awardWinners } from "@/lib/challenges/awards";
import { formatScore, ordinal, rankLabel } from "@/lib/challenges/format";
import { challengeUrl } from "@/lib/challenges/share";
import type { AwardRow, ChallengeRow } from "@/lib/challenges/types";
import { AthleteAvatar } from "../ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const AWARD_STATUS: { value: AwardRow["status"]; label: string }[] = [
  { value: "to_notify", label: "To notify" },
  { value: "notified", label: "Notified" },
  { value: "claimed", label: "Collected" },
  { value: "unclaimed", label: "Not collected" },
  { value: "forfeited", label: "Forfeited" },
];

function AwardCard({ a, row, onChanged }: { a: AwardRow; row: ChallengeRow; onChanged: () => void }) {
  const [deadline, setDeadline] = useState(a.claim_deadline ?? "");
  const [instructions, setInstructions] = useState(a.collection_instructions ?? "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [busy, setBusy] = useState(false);
  const first = (a.full_name ?? a.name).split(" ")[0];
  const resultLink = challengeUrl(row.slug, { handle: a.handle });
  const message = `Hi ${first}, congrats! You placed ${ordinal(a.place)}${a.share < 1 ? " (tied)" : ""} at the ${row.title} with ${formatScore(a.score, row)}. Your prize: ${a.prize}${a.share < 1 ? ` (split ${Math.round(1 / a.share)} ways)` : ""}.${instructions ? `\n\n${instructions}` : ""}${deadline ? `\n\nPlease collect it by ${deadline}.` : ""}\n\nYour result: ${resultLink}\n\nJF Effect`;

  async function update(patch: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      await challengeRpc("challenge_update_award", { p_award: a.id, p: patch });
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <AthleteAvatar name={a.name} photo={null} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {ordinal(a.place)} · {a.prize}
            {a.share < 1 ? ` · ${Math.round(a.share * 100)}% share` : ""}
          </div>
          <div className="truncate text-base font-semibold">
            {a.name} {a.full_name && a.full_name !== a.name ? <span className="font-normal text-muted-foreground">({a.full_name})</span> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            Bib #{a.bib} · {formatScore(a.score, row)}
            {a.value_cents ? ` · prize value $${((a.value_cents * a.share) / 100).toFixed(2)} ${a.currency}` : ""}
          </div>
        </div>
        <select
          value={a.status}
          disabled={busy}
          onChange={(e) => update({ status: e.target.value }, "Updated")}
          className="h-10 shrink-0 rounded-lg border border-border bg-background px-2 text-sm font-semibold"
          aria-label="Prize status"
        >
          {AWARD_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {a.email && (
          <a
            href={`mailto:${a.email}?subject=${encodeURIComponent(`Your prize: ${row.title}`)}&body=${encodeURIComponent(message)}`}
            onClick={() => a.status === "to_notify" && update({ status: "notified", notified_via: "email" })}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold"
          >
            <Mail className="h-4 w-4" /> Email
          </a>
        )}
        {a.phone && (
          <>
            <a
              href={`sms:${a.phone}?&body=${encodeURIComponent(message)}`}
              onClick={() => a.status === "to_notify" && update({ status: "notified", notified_via: "text" })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold"
            >
              <MessageSquare className="h-4 w-4" /> Text
            </a>
            <a href={`tel:${a.phone}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold">
              <Phone className="h-4 w-4" /> Call
            </a>
          </>
        )}
        {!a.email && !a.phone && <span className="text-sm text-warning">No contact details on file.</span>}
        {a.notified_at && <span className="self-center text-xs text-muted-foreground">Notified {new Date(a.notified_at).toLocaleDateString()}{a.notified_via ? ` by ${a.notified_via}` : ""}</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="h-11 text-base" aria-label="Collect by" />
        <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} className="h-11 text-base" placeholder="How to collect it (goes in the message)" />
      </div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-base" placeholder="Private notes (e-transfer sent, trophy engraved…)" />
      <div className="flex justify-end">
        <Button variant="outline" disabled={busy} onClick={() => update({ claim_deadline: deadline, collection_instructions: instructions, notes }, "Saved")}>
          Save details
        </Button>
      </div>
    </li>
  );
}

export function ResultsTab({ row }: { row: ChallengeRow }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const consoleQ = useQuery({ queryKey: challengeKeys.console(row.id), queryFn: () => fetchConsole(row.id) });
  const prizesQ = useQuery({
    queryKey: ["challenges", "admin-prizes-lite", row.id],
    queryFn: async () => {
      const { data, error } = await db.from("challenge_prizes").select("id, place, division_id, title").eq("challenge_id", row.id).order("place");
      if (error) throw error;
      return data as { id: string; place: number; division_id: string | null; title: string }[];
    },
  });
  const awardsQ = useQuery({
    queryKey: ["challenges", "awards", row.id],
    queryFn: () => challengeRpc<AwardRow[]>("challenge_awards_list", { p_challenge: row.id }),
    enabled: !!row.results_finalized_at || row.status === "completed" || row.status === "archived",
  });
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["challenges"] });

  const data = consoleQ.data;
  const standings = useMemo(
    () =>
      (data?.entries ?? [])
        .filter((e) => e.rank != null)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.bib - b.bib),
    [data],
  );
  const preview = useMemo(() => {
    const ranked = standings.map((e) => ({ id: e.entry_id, rank: e.rank!, division_rank: e.division_rank!, division_id: e.division_id }));
    return (prizesQ.data ?? []).map((p) => ({ prize: p, winners: awardWinners(ranked, p) }));
  }, [standings, prizesQ.data]);
  const ties = standings.filter((e) => e.tied && (e.rank ?? 99) <= Math.max(3, ...(prizesQ.data ?? []).map((p) => p.place)));
  const missingBw = row.tiebreak === "bodyweight_lower" ? ties.filter((e) => e.bodyweight_kg == null) : [];
  const unjudged = (data?.entries ?? []).filter((e) => e.status === "checked_in" && !e.attempts.some((a) => !a.voided));
  const nameOf = (id: string) => data?.entries.find((e) => e.entry_id === id)?.name ?? "?";

  async function finalize() {
    if (!data) return;
    if (!confirm("Confirm these as the final results? The winners show on the page and the standings lock.")) return;
    setBusy(true);
    try {
      await finalizeResults(row.id, data.version);
      toast.success("Results are final");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function end() {
    if (!confirm("End submissions? Judges stop recording; you can still add a missed result while you review.")) return;
    try {
      await setStatus(row.id, "verifying");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  async function reopen() {
    const reason = window.prompt("Why reopen the results? (kept in history)");
    if (!reason) return;
    try {
      await reopenResults(row.id, reason);
      toast.success("Reopened for review");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  if (consoleQ.isLoading) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />;

  const isFinal = row.status === "completed" || row.status === "archived";

  return (
    <div className="space-y-6">
      {(row.status === "live" || row.status === "paused") && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="text-sm">The challenge is running. End submissions to review and confirm the results.</div>
          <Button onClick={end}>End submissions</Button>
        </div>
      )}

      {row.status === "verifying" && (
        <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/[0.06] p-4">
          <div className="text-base font-semibold">Review, then confirm the results</div>
          <ul className="space-y-1 text-sm">
            {unjudged.length > 0 && (
              <li className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> {unjudged.length} checked-in {unjudged.length === 1 ? "athlete has" : "athletes have"} no score: {unjudged.slice(0, 5).map((e) => e.name).join(", ")}
              </li>
            )}
            {ties.length > 0 && (
              <li className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> Shared places in the prizes: {ties.map((e) => `${e.name} (T${e.rank})`).join(", ")}. They split the prize as the rules say.
              </li>
            )}
            {missingBw.length > 0 && (
              <li className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> Add bodyweights for {missingBw.map((e) => e.name).join(", ")} in the console to apply the tie-break.
              </li>
            )}
            {!unjudged.length && !ties.length && (
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> Every checked-in athlete has a score and no prize place is shared.
              </li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={finalize} disabled={busy || !standings.length}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm final results
            </Button>
            <Button variant="outline" asChild>
              <Link to="/challenges/$slug/console" params={{ slug: row.slug }}>
                Open the console
              </Link>
            </Button>
          </div>
        </div>
      )}

      {preview.length > 0 && !isFinal && standings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold">Prizes as it stands</h3>
          <ul className="space-y-1.5">
            {preview.map(({ prize, winners }) => (
              <li key={prize.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm">
                <span className="font-semibold">
                  {ordinal(prize.place)} · {prize.title}
                </span>
                <span className="text-right text-muted-foreground">
                  {winners.length ? winners.map((w) => `${nameOf(w.id)}${w.share < 1 ? ` (${Math.round(w.share * 100)}%)` : ""}`).join(", ") : "Nobody yet"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isFinal && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Winners & prizes</h3>
            {role === "admin" && (
              <Button variant="ghost" onClick={reopen}>
                Reopen results
              </Button>
            )}
          </div>
          {awardsQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (awardsQ.data ?? []).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No prizes were set for this challenge.</p>
          ) : (
            <ul className="space-y-3">
              {awardsQ.data!.map((a) => (
                <AwardCard key={a.id} a={a} row={row} onChanged={refresh} />
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Contact details are private to you and this event's manager. Messages open in your own email or texts.</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-base font-semibold">{isFinal ? "Final standings" : "Provisional standings"}</h3>
        {standings.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No verified scores yet.</p>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {standings.map((e) => (
              <li key={e.entry_id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn("w-9 text-center font-display text-lg", e.tied && "text-warning")}>{rankLabel(e.rank, e.tied)}</span>
                <AthleteAvatar name={e.name} photo={e.photo} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    #{e.bib}
                    {data?.divisions.length && data.divisions.length > 1 ? ` · ${data.divisions.find((d) => d.id === e.division_id)?.name ?? ""} ${ordinal(e.division_rank ?? 0)}` : ""}
                    {e.bodyweight_kg ? ` · ${e.bodyweight_kg} kg` : ""}
                  </div>
                </div>
                <span className="font-display text-xl tabular-nums">{formatScore(e.score, row)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
