import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { challengeRpc, errorText } from "@/lib/challenges/api";

interface Stats {
  events: Record<string, { total: number; unique: number }>;
  visitors: number;
  qr_visits: number;
  referral_visits: number;
  registrations: { total: number; staff: number; self: number; referred: number; via_qr: number; checked_in: number; withdrawn: number; disqualified: number; photo_consent: number };
  competed: number;
  returning: number;
  claimed: number;
  new_accounts: number;
  marketing: number;
  prize_cents: number;
  sponsor_cents: number;
  coaching_applications: number;
  top_sharers: { name: string; handle: string; visits: number }[];
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}`;

export function InsightsTab({ challengeId }: { challengeId: string }) {
  const q = useQuery({ queryKey: ["challenges", "stats", challengeId], queryFn: () => challengeRpc<Stats>("challenge_stats", { p_challenge: challengeId }), refetchInterval: 60_000 });
  if (q.isLoading) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />;
  if (!q.data) return <p className="text-sm text-muted-foreground">{errorText(q.error)}</p>;
  const s = q.data;
  const ev = (k: string) => s.events[k]?.total ?? 0;
  const uq = (k: string) => s.events[k]?.unique ?? 0;
  const r = s.registrations;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-base font-semibold">People</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Registered" value={r.total} sub={`${r.self} themselves · ${r.staff} by staff`} />
          <Tile label="Checked in" value={r.checked_in} />
          <Tile label="Competed" value={s.competed} />
          <Tile label="Returning athletes" value={s.returning} sub="entered an earlier challenge" />
          <Tile label="Brought by a friend" value={r.referred} sub="signed up from someone's link" />
          <Tile label="Signed up by QR" value={r.via_qr} />
          <Tile label="Claimed profiles" value={s.claimed} sub={`${s.new_accounts} new JF Effect accounts`} />
          <Tile label="Email opt-ins" value={s.marketing} sub="separate from the event" />
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Attention</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Challenge page views" value={ev("page_view")} sub={`${uq("page_view")} unique visitors`} />
          <Tile label="Result page views" value={ev("result_view")} sub={`${uq("result_view")} unique`} />
          <Tile label="Visits from friends' links" value={s.referral_visits} />
          <Tile label="QR scans" value={s.qr_visits} sub="page opens from a QR code" />
          <Tile label="Profile views" value={ev("profile_view")} />
          <Tile label="Big screen opens" value={ev("display_open")} />
          <Tile label="Sign-up page views" value={ev("join_view")} />
          <Tile label="Calendar adds" value={ev("calendar_add")} />
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Sharing</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Cards saved" value={ev("card_download")} />
          <Tile label="Share sheet opened" value={ev("share_sheet")} sub="not proof it was posted" />
          <Tile label="Links copied" value={ev("copy_link") + ev("invite_link")} sub={`${ev("invite_link")} friend invites`} />
          <Tile label="Captions copied" value={ev("copy_caption")} />
        </div>
        {s.top_sharers.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="text-sm font-semibold">Who brought the most visits</div>
            <ul className="mt-2 space-y-1 text-sm">
              {s.top_sharers.map((t) => (
                <li key={t.handle} className="flex justify-between">
                  <span>{t.name}</span>
                  <span className="tabular-nums text-muted-foreground">{t.visits}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Business</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="JF Effect sign-up taps" value={ev("join_click")} />
          <Tile label="Coaching taps" value={ev("coaching_click")} sub={`${s.coaching_applications} applications from challenges`} />
          <Tile label="Prize cost" value={money(s.prize_cents)} />
          <Tile label="Sponsor contributions" value={money(s.sponsor_cents)} />
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Every number is measured: a page load, a tap or a database record, counted once per visitor per half hour. Visitors are a random id in their browser, never a name.
        Your own and your staff's visits don't count.
      </p>
    </div>
  );
}

interface StaffRow {
  user_id: string;
  role: "manager" | "judge" | "registrar";
  email: string | null;
  name: string | null;
}
interface AuditRow {
  at: string;
  entity: string;
  action: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string | null;
  bib: number | null;
}

const ROLE_LABEL = { manager: "Manager", judge: "Judge", registrar: "Registration" } as const;

function auditLine(a: AuditRow): string {
  const b = a.before ?? {};
  const n = a.after ?? {};
  switch (`${a.entity}:${a.action}`) {
    case "attempt:record":
      return `Score recorded: attempt ${n.attempt_no}, ${n.result === "valid" ? n.value : "no lift"}`;
    case "attempt:correct":
      return `Score corrected: ${b.result === "valid" ? b.value : "no lift"} → ${n.result === "valid" ? n.value : "no lift"}`;
    case "attempt:void":
      return "Attempt voided";
    case "entry:register":
      return `Registered (${n.source === "self" ? "themselves" : "by staff"})`;
    case "entry:update":
      return `Entry changed: ${Object.keys(n)
        .filter((k) => JSON.stringify(n[k]) !== JSON.stringify(b[k]))
        .map((k) => `${k.replace("_kg", "").replace("_", " ")} ${b[k] ?? "–"} → ${n[k] ?? "–"}`)
        .join(", ")}`;
    case "challenge:status":
      return `Status: ${b.status} → ${n.status}`;
    default:
      return `${a.entity} ${a.action}`;
  }
}

export function TeamTab({ challengeId }: { challengeId: string }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const owner = role === "admin";
  const staffQ = useQuery({ queryKey: ["challenges", "staff", challengeId], queryFn: () => challengeRpc<StaffRow[]>("challenge_staff_list", { p_challenge: challengeId }) });
  const auditQ = useQuery({ queryKey: ["challenges", "audit", challengeId], queryFn: () => challengeRpc<AuditRow[]>("challenge_audit_list", { p_challenge: challengeId }) });
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<StaffRow["role"]>("judge");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await challengeRpc("challenge_add_staff", { p_challenge: challengeId, p_email: email.trim(), p_role: newRole });
      setEmail("");
      toast.success("Added. They open the event console from the challenge page.");
      qc.invalidateQueries({ queryKey: ["challenges", "staff", challengeId] });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(uid: string) {
    try {
      await challengeRpc("challenge_remove_staff", { p_challenge: challengeId, p_user: uid });
      qc.invalidateQueries({ queryKey: ["challenges", "staff", challengeId] });
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Event staff</h3>
          <p className="text-xs text-muted-foreground">
            Judges record and correct scores. Registration signs people up and checks them in. Neither sees contact details; managers do. Staff need a JF Effect login (free at jfeffect.com/join).
          </p>
        </div>
        <ul className="space-y-2">
          {(staffQ.data ?? []).map((s) => (
            <li key={s.user_id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{s.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[s.role]} · {s.email}
                </div>
              </div>
              {owner && (
                <button type="button" onClick={() => remove(s.user_id)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {staffQ.data?.length === 0 && <li className="text-sm text-muted-foreground">Just you so far.</li>}
        </ul>
        {owner && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their login email" className="h-11 flex-1 text-base" type="email" />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRow["role"])} className="h-11 rounded-lg border border-border bg-background px-2 text-base">
              <option value="judge">Judge</option>
              <option value="registrar">Registration</option>
              <option value="manager">Manager</option>
            </select>
            <Button className="h-11" onClick={add} disabled={busy || !email.includes("@")}>
              Add
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-semibold">History</h3>
        <p className="text-xs text-muted-foreground">Every registration, score, correction and status change, with who did it and why.</p>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {(auditQ.data ?? []).map((a, i) => (
            <li key={i} className="px-3 py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span>
                  {a.bib ? <span className="font-semibold">#{a.bib} </span> : null}
                  {auditLine(a)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {a.actor ?? "System"}
                {a.reason ? ` · “${a.reason}”` : ""}
              </div>
            </li>
          ))}
          {auditQ.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
