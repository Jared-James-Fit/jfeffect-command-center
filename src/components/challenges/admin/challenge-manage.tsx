import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  MonitorPlay,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { AthleteAvatar, QrImage, ScoreText, StatusPill, ago } from "@/components/challenges/ui";
import { isUntitled, missingItems, type ChallengeRow } from "@/lib/challenges/wizard";
import { activityText } from "@/lib/challenges/board";
import {
  MEDIA_BUCKET,
  addStaff,
  challengeUrl,
  deleteEntry,
  duplicateChallenge,
  errorText,
  fetchInsights,
  fetchStaffList,
  fetchStaffBoard,
  finalizeResults,
  invalidateChallenge,
  joinUrl,
  keys,
  mediaUrl,
  mergePeople,
  removeStaff,
  resetPractice,
  setStatus,
  useDashboard,
  useLiveChallenge,
} from "@/lib/challenges/api";
import {
  eventWhen,
  formatScore,
  rankBadge,
  statusActions,
  type StaffEntry,
  type StatusAction,
} from "@/lib/challenges/model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Tab = "dashboard" | "athletes" | "prizes" | "team" | "insights";
const TABS: [Tab, string][] = [
  ["dashboard", "Dashboard"],
  ["athletes", "Athletes"],
  ["prizes", "Prizes"],
  ["team", "Team"],
  ["insights", "Insights"],
];

type Full = ChallengeRow & {
  id: string;
  status: string;
  is_template: boolean;
  is_test: boolean;
  announcement: string | null;
  announcement_at: string | null;
  results_final_at: string | null;
};

function useAdminChallenge(id: string) {
  return useQuery({
    queryKey: ["challenges", "admin", id],
    queryFn: async () => {
      const [{ data: c, error }, { data: divs }] = await Promise.all([
        db.from("challenges").select("*").eq("id", id).maybeSingle(),
        db
          .from("challenge_divisions")
          .select("id,name,load_label,sort")
          .eq("challenge_id", id)
          .order("sort"),
      ]);
      if (error) throw error;
      return c
        ? {
            c: {
              ...(c as Full),
              rules: ((c as Full).rules ?? []) as string[],
            } as Full,
            divisions: (divs ?? []) as { id: string; name: string; load_label: string | null }[],
          }
        : null;
    },
  });
}

export function AdminChallengeManage({ id }: { id: string }) {
  const q = useAdminChallenge(id);
  const [tab, setTab] = useState<Tab>("dashboard");
  useLiveChallenge(id);
  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!q.data) return <p className="p-6 text-sm text-muted-foreground">Challenge not found.</p>;
  const { c, divisions } = q.data;
  const when = eventWhen(c.starts_at, c.timezone, { withYear: true });
  const tabs = TABS.filter(([t]) => !c.is_template || t === "dashboard");
  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/admin/challenges"
          className="-ml-1 flex h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Challenges
        </Link>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/challenges/$id/edit" params={{ id: c.id }} search={{ step: 1 }}>
            <Pencil className="mr-1.5 h-4 w-4" /> Edit
          </Link>
        </Button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-2xl font-semibold">
          {isUntitled(c.title) ? "New challenge" : c.title}
        </h1>
        {c.is_template ? (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">Template</span>
        ) : (
          <StatusPill status={c.status as never} final={!!c.results_final_at} />
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {when ?? "No date yet"}
        {c.venue_name ? ` · ${c.venue_name}` : ""}
      </p>

      {tabs.length > 1 ? (
        <div className="sticky top-0 z-20 -mx-4 mt-4 overflow-x-auto border-b border-border bg-background px-4">
          <div className="flex gap-1" role="tablist">
            {tabs.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-11 shrink-0 border-b-2 px-3 text-sm font-medium",
                  tab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="pt-5">
        {tab === "dashboard" ? <Dashboard c={c} /> : null}
        {tab === "athletes" ? <Entries c={c} divisions={divisions} /> : null}
        {tab === "prizes" ? <Prizes c={c} divisions={divisions} /> : null}
        {tab === "team" ? <Team c={c} /> : null}
        {tab === "insights" ? <Insights c={c} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard: where the event is, what's next, what just happened      */
/* ------------------------------------------------------------------ */

const LIFECYCLE = [
  { key: "draft", label: "Draft" },
  { key: "upcoming", label: "Published" },
  { key: "live", label: "Live" },
  { key: "done", label: "Completed" },
] as const;

function lifecycleIndex(status: string): number {
  if (status === "draft") return 0;
  if (status === "upcoming") return 1;
  if (status === "live" || status === "paused" || status === "verifying") return 2;
  return 3;
}

function Dashboard({ c }: { c: Full }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dash = useDashboard(c.is_template ? undefined : c.id);
  const d = dash.data;
  const [confirm, setConfirm] = useState<StatusAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [ties, setTies] = useState<{ place: number; title: string; names: string[] }[] | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState(c.announcement ?? "");
  const missing = missingItems({ ...c, rules: (c.rules ?? []) as string[] });
  const actions = c.is_template ? [] : statusActions(c.status as never);
  const primary = actions.find((a) => a.tone === "primary");
  const secondary = actions.filter((a) => a !== primary);
  const page = challengeUrl(c.slug);
  const join = joinUrl(c.slug, "qr");
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative_to_bodyweight };
  const live = c.status === "live" || c.status === "paused";

  const run = async (a: StatusAction) => {
    setBusy(true);
    try {
      if (a.to === "finalize") {
        const r = await finalizeResults(c.id);
        toast.success(
          `Results confirmed. ${r.assigned} prize${r.assigned === 1 ? "" : "s"} assigned.`,
        );
        if (r.ties.length) setTies(r.ties);
      } else {
        await setStatus(c.id, a.to);
        toast.success(`${a.label}: done`);
      }
      invalidateChallenge(qc);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const ask = (a: StatusAction) => (a.confirm ? setConfirm(a) : void run(a));

  if (c.is_template) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl bg-muted p-4 text-sm">
          A template. New challenges can start from it (New challenge → Or start from).
        </p>
        <MoreActions c={c} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* where it is */}
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Event stage">
        {LIFECYCLE.map((s, i) => {
          const at = lifecycleIndex(c.status);
          return (
            <li key={s.key} aria-current={i === at ? "step" : undefined}>
              <span
                className={cn(
                  "block h-1 rounded-full",
                  i < at ? "bg-foreground/35" : i === at ? "bg-foreground" : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "mt-1.5 block truncate text-xs",
                  i === at ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* what's next */}
      {c.status === "draft" && missing.length ? (
        <div className="rounded-2xl border border-border p-4">
          <p className="text-sm font-semibold">Finish setting it up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Still needed: {missing.map((m) => m.text.toLowerCase()).join(", ")}. Nothing is public
            until you publish.
          </p>
          <Button asChild className="mt-3 h-12 w-full text-base">
            <Link
              to="/admin/challenges/$id/edit"
              params={{ id: c.id }}
              search={{ step: missing[0]!.step }}
            >
              Continue setup
            </Link>
          </Button>
        </div>
      ) : null}

      {ties?.length ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">Tied for a prize</p>
          {ties.map((t) => (
            <p key={t.place} className="mt-1">
              {t.title}: {t.names.join(", ")} share the place under your published rules. Pick how
              to award it in Prizes.
            </p>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {live ? (
          <Button asChild className="h-12 w-full text-base">
            <Link to="/challenges/$slug/run" params={{ slug: c.slug }}>
              <ClipboardList className="mr-2 h-4 w-4" /> Open judging
            </Link>
          </Button>
        ) : null}
        {primary && !(c.status === "draft" && missing.length) ? (
          <Button
            variant={live ? "outline" : "default"}
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={() =>
              primary.to === "upcoming"
                ? navigate({ to: "/admin/challenges/$id/edit", params: { id: c.id }, search: { step: 4 } })
                : ask(primary)
            }
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {primary.to === "upcoming" ? "Review & publish" : primary.label}
          </Button>
        ) : null}
        {secondary.length ? (
          <div className="flex flex-wrap gap-2">
            {secondary.map((a) => (
              <Button
                key={a.to}
                variant={a.tone === "destructive" ? "ghost" : "outline"}
                className={cn("h-10", a.tone === "destructive" && "text-destructive")}
                disabled={busy}
                onClick={() => ask(a)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {/* the numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Registered" value={d?.registered} />
        <Stat label="Checked in" value={d?.checked_in} />
        <Stat label="Scored" value={d?.scored} />
        <Stat label="Waiting to lift" value={d?.waiting} hint="Checked in, no score" />
      </div>
      {d?.leaders.length ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border p-4">
          <AthleteAvatar name={d.leaders[0]!.name} photo={d.leaders[0]!.photo} size={44} medal={1} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {c.results_final_at ? "Winner" : d.leaders.length > 1 ? "Tied for first" : "Leading"}
            </p>
            <p className="truncate font-semibold">{d.leaders.map((l) => l.name).join(", ")}</p>
          </div>
          <ScoreText value={d.leaders[0]!.score} shape={shape} className="text-2xl" />
        </div>
      ) : null}

      {/* where people go */}
      <div className="grid grid-cols-2 gap-2">
        <QuickLink to="/challenges/$slug" slug={c.slug} icon={ExternalLink} label="Public page" />
        <QuickLink to="/challenges/$slug/display" slug={c.slug} icon={MonitorPlay} label="Big screen" />
        {!live ? (
          <QuickLink to="/challenges/$slug/run" slug={c.slug} icon={ClipboardList} label="Judging & desk" />
        ) : null}
        <Button
          variant="outline"
          className="h-12 justify-start"
          onClick={() =>
            navigator.clipboard.writeText(page).then(
              () => toast.success("Link copied"),
              () => toast.error("Couldn't copy"),
            )
          }
        >
          <Copy className="mr-2 h-4 w-4" /> Copy link
        </Button>
      </div>

      {/* what just happened */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Recent activity</h2>
        {dash.isPending ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : d?.recent.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {d.recent.map((a, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {activityText(a, shape)}
                  {a.by ? <span className="block text-xs text-muted-foreground">by {a.by}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(a.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Nothing yet. Sign-ups, scores and changes show up here as they happen.
          </p>
        )}
      </section>

      {c.status !== "draft" ? (
        <section className="rounded-2xl border border-border p-4">
          <h2 className="text-base font-semibold">Update on the page</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One short line at the top, e.g. "Doors open 12:30. Warm-ups start at 1."
          </p>
          <Textarea
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            rows={2}
            maxLength={280}
            className="mt-2"
          />
          <Button
            className="mt-2 h-10"
            variant="outline"
            onClick={async () => {
              const { error } = await db
                .from("challenges")
                .update({
                  announcement: announcement.trim() || null,
                  announcement_at: announcement.trim() ? new Date().toISOString() : null,
                })
                .eq("id", c.id);
              if (error) toast.error(errorText(error));
              else {
                toast.success(announcement.trim() ? "Update posted" : "Update removed");
                invalidateChallenge(qc);
              }
            }}
          >
            Post update
          </Button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border p-4">
        <h2 className="text-base font-semibold">Sign-up QR code</h2>
        <p className="mt-1 text-sm text-muted-foreground">Print it for the venue.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <QrImage value={join} size={140} label="Scan to sign up" />
          <DownloadQr url={join} name={`${c.slug}-signup-qr.png`} />
        </div>
      </section>

      <MoreActions c={c} />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(confirm)}>
              {confirm?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | undefined; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums leading-none">{value ?? "–"}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function QuickLink({
  to,
  slug,
  icon: Icon,
  label,
}: {
  to: "/challenges/$slug" | "/challenges/$slug/display" | "/challenges/$slug/run";
  slug: string;
  icon: typeof ExternalLink;
  label: string;
}) {
  return (
    <Button asChild variant="outline" className="h-12 justify-start">
      <Link to={to} params={{ slug }}>
        <Icon className="mr-2 h-4 w-4" /> {label}
      </Link>
    </Button>
  );
}

function MoreActions({ c }: { c: Full }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">More</h2>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-10"
          onClick={async () => {
            try {
              const nid = await duplicateChallenge(c.id, false);
              invalidateChallenge(qc);
              toast.success("Copied as a new draft");
              navigate({ to: "/admin/challenges/$id/edit", params: { id: nid }, search: { step: 1 } });
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          Duplicate
        </Button>
        {!c.is_template && c.status === "draft" ? (
          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              try {
                await duplicateChallenge(c.id, true, `${c.title} (template)`);
                invalidateChallenge(qc);
                toast.success("Saved as a template");
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            Save as template
          </Button>
        ) : null}
        {c.status === "draft" && !c.is_template ? (
          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              try {
                const r = await resetPractice(c.id);
                invalidateChallenge(qc);
                toast.success(`Practice run cleared (${r.cleared} entries)`);
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            Clear practice run
          </Button>
        ) : null}
        {c.status === "draft" || c.is_template ? (
          <Button
            variant="ghost"
            className="h-10 text-destructive"
            onClick={async () => {
              if (!window.confirm("Delete this draft? This can't be undone.")) return;
              const { error } = await db.from("challenges").delete().eq("id", c.id);
              if (error) toast.error(errorText(error));
              else {
                invalidateChallenge(qc);
                navigate({ to: "/admin/challenges" });
              }
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete draft
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DownloadQr({ url, name }: { url: string; name: string }) {
  return (
    <Button
      variant="outline"
      className="h-10"
      onClick={async () => {
        const QRCode = (await import("qrcode")).default;
        const data = await QRCode.toDataURL(url, {
          margin: 2,
          width: 1200,
          errorCorrectionLevel: "M",
        });
        const a = document.createElement("a");
        a.href = data;
        a.download = name;
        a.click();
      }}
    >
      <Download className="mr-1.5 h-4 w-4" /> Download for print
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Entries (contact details: admins only, by RLS)                     */
/* ------------------------------------------------------------------ */

type Contact = {
  person_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  instagram: string | null;
  marketing_opt_in: boolean;
};

function useContacts(personIds: string[]) {
  return useQuery({
    queryKey: ["challenges", "contacts", personIds.slice().sort().join(",")],
    enabled: personIds.length > 0,
    queryFn: async () => {
      const out = new Map<string, Contact>();
      for (let i = 0; i < personIds.length; i += 150) {
        const { data, error } = await db
          .from("challenge_people_private")
          .select("person_id,full_name,email,phone,instagram,marketing_opt_in")
          .in("person_id", personIds.slice(i, i + 150));
        if (error) throw error;
        for (const r of (data ?? []) as Contact[]) out.set(r.person_id, r);
      }
      return out;
    },
  });
}

function Entries({ c, divisions }: { c: Full; divisions: { id: string; name: string }[] }) {
  const board = useQuery({ queryKey: keys.staff(c.id), queryFn: () => fetchStaffBoard(c.id) });
  const entries = board.data?.entries ?? [];
  const contacts = useContacts(entries.map((e) => e.person_id!).filter(Boolean));
  const [q, setQ] = useState("");
  const [merge, setMerge] = useState<StaffEntry | null>(null);
  const qc = useQueryClient();
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return entries;
    return entries.filter((e) => {
      const ct = e.person_id ? contacts.data?.get(e.person_id) : undefined;
      return [e.name, String(e.bib), ct?.full_name, ct?.email].some((x) =>
        x?.toLowerCase().includes(n),
      );
    });
  }, [entries, contacts.data, q]);

  const exportResults = () => {
    const rows = [["Rank", "Bib", "Name", "Division", "Score", "Status"]];
    for (const e of [...entries].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))) {
      rows.push([
        e.rank ? rankBadge(e.rank, e.tied) : "",
        String(e.bib),
        e.name,
        divisions.find((d) => d.id === e.division_id)?.name ?? "",
        e.score != null
          ? formatScore(e.score, {
              measure: c.measure,
              unit: c.unit,
              relative: c.relative_to_bodyweight,
            })
          : "",
        e.status,
      ]);
    }
    const csv = rows
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${c.slug}-results.csv`;
    a.click();
  };

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, number or email"
          className="h-11 flex-1"
        />
        <Button
          variant="outline"
          className="h-11"
          onClick={exportResults}
          title="Results only. Contact details never leave the app."
        >
          <Download className="mr-1.5 h-4 w-4" /> Results CSV
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Contact details are visible to admins only, never to judges, registration staff or the
        public.
      </p>
      {board.isLoading ? <Skeleton className="h-64 w-full rounded-2xl" /> : null}
      <ul className="space-y-2">
        {shown.map((e) => {
          const ct = e.person_id ? contacts.data?.get(e.person_id) : undefined;
          return (
            <li key={e.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-center gap-3">
                <span className="w-8 text-center font-display text-xl text-muted-foreground">
                  {e.bib}
                </span>
                <AthleteAvatar name={e.name} photo={e.show_photo ? e.photo : null} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.name}
                    {ct && ct.full_name !== e.name ? (
                      <span className="font-normal text-muted-foreground"> · {ct.full_name}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      divisions.find((d) => d.id === e.division_id)?.name,
                      e.status.replace("_", " "),
                      e.source === "self" ? "signed up themselves" : "registered by staff",
                      e.claimed ? "claimed profile" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {e.score != null ? (
                  <div className="text-right">
                    <ScoreText
                      value={e.score}
                      shape={{
                        measure: c.measure,
                        unit: c.unit,
                        relative: c.relative_to_bodyweight,
                      }}
                      className="text-lg"
                    />
                    <p className="text-xs text-muted-foreground">{rankBadge(e.rank, e.tied)}</p>
                  </div>
                ) : null}
              </div>
              {ct ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-11 text-xs text-muted-foreground">
                  <a href={`mailto:${ct.email}`} className="hover:text-foreground">
                    {ct.email}
                  </a>
                  {ct.phone ? (
                    <a href={`tel:${ct.phone}`} className="hover:text-foreground">
                      {ct.phone}
                    </a>
                  ) : null}
                  {ct.instagram ? (
                    <a
                      href={`https://instagram.com/${ct.instagram}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground"
                    >
                      @{ct.instagram}
                    </a>
                  ) : null}
                  <span>{ct.marketing_opt_in ? "OK to market to" : "No marketing"}</span>
                  <span>{e.show_photo ? "Photo OK" : "No photo"}</span>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1 pl-11">
                <Link
                  to="/athletes/$handle"
                  params={{ handle: e.handle }}
                  className="inline-flex h-8 items-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
                >
                  Profile
                </Link>
                <button
                  type="button"
                  className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setMerge(e)}
                >
                  Merge duplicate
                </button>
                {!e.attempts.length ? (
                  <button
                    type="button"
                    className="h-8 rounded-lg px-2 text-xs text-destructive hover:bg-muted"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${e.name}'s registration?`)) return;
                      try {
                        await deleteEntry(e.id);
                        invalidateChallenge(qc);
                        toast.success("Registration deleted");
                      } catch (err) {
                        toast.error(errorText(err));
                      }
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {!shown.length && !board.isLoading ? (
          <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No entries yet.
          </li>
        ) : null}
      </ul>
      <MergeDialog entry={merge} onClose={() => setMerge(null)} />
    </div>
  );
}

/** Two profiles for one person (two emails, a typo): fold one into the other. */
function MergeDialog({ entry, onClose }: { entry: StaffEntry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const search = useQuery({
    queryKey: ["challenges", "people-search", q],
    enabled: !!entry && q.trim().length >= 2,
    queryFn: async () => {
      const term = q.trim().replace(/[%,()]/g, "");
      const { data } = await db
        .from("challenge_people_private")
        .select("person_id,full_name,email, challenge_people!inner(handle,display_name)")
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(8);
      return (
        (data ?? []) as {
          person_id: string;
          full_name: string;
          email: string;
          challenge_people: { handle: string; display_name: string };
        }[]
      ).filter((p) => p.person_id !== entry?.person_id);
    },
  });
  return (
    <Dialog open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge into another profile</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {entry?.name}'s entries move to the profile you pick, which keeps its name, link and
          photo. Entries in the same challenge stay apart.
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="h-11"
        />
        <ul className="space-y-1">
          {(search.data ?? []).map((p) => (
            <li key={p.person_id}>
              <button
                type="button"
                disabled={busy}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={async () => {
                  if (!entry?.person_id) return;
                  setBusy(true);
                  try {
                    const r = await mergePeople(p.person_id, entry.person_id);
                    invalidateChallenge(qc);
                    toast.success(
                      r.left_behind
                        ? `Merged ${r.moved}; ${r.left_behind} stayed (same challenge)`
                        : "Merged",
                    );
                    onClose();
                  } catch (err) {
                    toast.error(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span>
                  <span className="block font-medium">{p.full_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.email} · /{p.challenge_people.handle}
                  </span>
                </span>
                Merge
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Prizes + sponsors                                                  */
/* ------------------------------------------------------------------ */

type Prize = {
  id: string;
  division_id: string | null;
  place: number;
  title: string;
  value_cents: number | null;
  sponsor_id: string | null;
  winner_entry_id: string | null;
  winner_source: string | null;
  status: "open" | "notified" | "claimed" | "unclaimed";
  notified_at: string | null;
  notified_via: string | null;
  claim_by: string | null;
  claimed_at: string | null;
  collection_notes: string | null;
  fulfillment_notes: string | null;
};
type SponsorRow = {
  id: string;
  name: string;
  url: string | null;
  logo_path: string | null;
  blurb: string | null;
  contribution_cents: number | null;
  sort: number;
};

function Prizes({ c, divisions }: { c: Full; divisions: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const prizes = useQuery({
    queryKey: ["challenges", "prizes", c.id],
    queryFn: async () =>
      ((await db.from("challenge_prizes").select("*").eq("challenge_id", c.id).order("place"))
        .data ?? []) as Prize[],
  });
  const sponsors = useQuery({
    queryKey: ["challenges", "sponsors", c.id],
    queryFn: async () =>
      ((await db.from("challenge_sponsors").select("*").eq("challenge_id", c.id).order("sort"))
        .data ?? []) as SponsorRow[],
  });
  const board = useQuery({ queryKey: keys.staff(c.id), queryFn: () => fetchStaffBoard(c.id) });
  const entries = board.data?.entries ?? [];
  const contacts = useContacts(entries.map((e) => e.person_id!).filter(Boolean));
  const refresh = () => {
    void prizes.refetch();
    void sponsors.refetch();
    invalidateChallenge(qc);
  };
  const final = !!c.results_final_at;

  const update = async (id: string, patch: Partial<Prize>) => {
    const { error } = await db.from("challenge_prizes").update(patch).eq("id", id);
    if (error) toast.error(errorText(error));
    else refresh();
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Prizes</h2>
          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              const next = (prizes.data?.reduce((m, p) => Math.max(m, p.place), 0) ?? 0) + 1;
              const { error } = await db.from("challenge_prizes").insert({
                challenge_id: c.id,
                place: next,
                title: `${next === 1 ? "1st" : next === 2 ? "2nd" : next === 3 ? "3rd" : `${next}th`} place`,
              });
              if (error) toast.error(errorText(error));
              else refresh();
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add prize
          </Button>
        </div>
        {!final ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Winners fill in by themselves when you confirm final results. A tie under your rules is
            left for you to settle here.
          </p>
        ) : null}
        <ul className="space-y-3">
          {(prizes.data ?? []).map((p) => {
            const winner = entries.find((e) => e.id === p.winner_entry_id);
            const ct = winner?.person_id ? contacts.data?.get(winner.person_id) : undefined;
            return (
              <li key={p.id} className="rounded-2xl border border-border p-4">
                <div className="grid grid-cols-[4rem_1fr] gap-2">
                  <Input
                    inputMode="numeric"
                    defaultValue={p.place}
                    onBlur={(e) => {
                      const v = Number(e.target.value) || p.place;
                      if (v !== p.place) void update(p.id, { place: v });
                    }}
                    className="h-10"
                    aria-label="Place"
                  />
                  <Input
                    defaultValue={p.title}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== p.title &&
                      void update(p.id, { title: e.target.value.trim() })
                    }
                    className="h-10"
                    aria-label="Prize"
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input
                    inputMode="decimal"
                    defaultValue={p.value_cents != null ? (p.value_cents / 100).toFixed(2) : ""}
                    placeholder="Value ($, private)"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                        ? Math.round(Number(e.target.value.replace(/[$,]/g, "")) * 100)
                        : null;
                      if (v !== p.value_cents && (v == null || Number.isFinite(v)))
                        void update(p.id, { value_cents: v });
                    }}
                    className="h-10"
                  />
                  <select
                    value={p.sponsor_id ?? ""}
                    onChange={(e) => void update(p.id, { sponsor_id: e.target.value || null })}
                    className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
                  >
                    <option value="">No sponsor</option>
                    {(sponsors.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {divisions.length ? (
                    <select
                      value={p.division_id ?? ""}
                      onChange={(e) => void update(p.id, { division_id: e.target.value || null })}
                      className="col-span-2 h-10 rounded-lg border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Everyone</option>
                      {divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>

                {final ? (
                  <div className="mt-4 rounded-xl bg-muted p-3">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-warning" />
                      <select
                        value={p.winner_entry_id ?? ""}
                        onChange={(e) =>
                          void update(p.id, {
                            winner_entry_id: e.target.value || null,
                            winner_source: e.target.value ? "admin" : null,
                          })
                        }
                        className="h-10 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                        aria-label="Winner"
                      >
                        <option value="">No winner set</option>
                        {entries
                          .filter((e) => e.score != null && e.status !== "disqualified")
                          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {rankBadge(e.rank, e.tied)} · {e.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    {winner && ct ? (
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="font-medium">{ct.full_name}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="outline" size="sm" className="h-9">
                            <a
                              href={`mailto:${ct.email}?subject=${encodeURIComponent(`You won at the ${c.title}`)}`}
                            >
                              <Mail className="mr-1.5 h-3.5 w-3.5" /> Email
                            </a>
                          </Button>
                          {ct.phone ? (
                            <Button asChild variant="outline" size="sm" className="h-9">
                              <a href={`sms:${ct.phone}`}>
                                <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Text
                              </a>
                            </Button>
                          ) : null}
                          {ct.phone ? (
                            <Button asChild variant="outline" size="sm" className="h-9">
                              <a href={`tel:${ct.phone}`}>
                                <Phone className="mr-1.5 h-3.5 w-3.5" /> Call
                              </a>
                            </Button>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(["open", "notified", "claimed", "unclaimed"] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() =>
                                void update(p.id, {
                                  status: s,
                                  notified_at:
                                    s === "notified" && !p.notified_at
                                      ? new Date().toISOString()
                                      : p.notified_at,
                                  claimed_at:
                                    s === "claimed"
                                      ? new Date().toISOString()
                                      : s === "open"
                                        ? null
                                        : p.claimed_at,
                                })
                              }
                              className={cn(
                                "h-9 rounded-full px-3 text-xs font-medium capitalize",
                                p.status === s
                                  ? "bg-foreground text-background"
                                  : "bg-background text-muted-foreground",
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            defaultValue={p.notified_via ?? ""}
                            placeholder="Told them how (text, email…)"
                            onBlur={(e) =>
                              e.target.value !== (p.notified_via ?? "") &&
                              void update(p.id, { notified_via: e.target.value.trim() || null })
                            }
                            className="h-9 text-xs"
                          />
                          <Input
                            type="date"
                            defaultValue={p.claim_by ?? ""}
                            onBlur={(e) =>
                              e.target.value !== (p.claim_by ?? "") &&
                              void update(p.id, { claim_by: e.target.value || null })
                            }
                            className="h-9 text-xs"
                            aria-label="Claim by"
                          />
                        </div>
                        <Textarea
                          defaultValue={p.collection_notes ?? ""}
                          placeholder="How they collect it"
                          rows={2}
                          onBlur={(e) =>
                            e.target.value !== (p.collection_notes ?? "") &&
                            void update(p.id, { collection_notes: e.target.value.trim() || null })
                          }
                          className="text-xs"
                        />
                        <Textarea
                          defaultValue={p.fulfillment_notes ?? ""}
                          placeholder="Fulfilment notes (private)"
                          rows={2}
                          onBlur={(e) =>
                            e.target.value !== (p.fulfillment_notes ?? "") &&
                            void update(p.id, { fulfillment_notes: e.target.value.trim() || null })
                          }
                          className="text-xs"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="mt-3 text-xs text-destructive"
                  onClick={async () => {
                    if (!window.confirm("Remove this prize?")) return;
                    const { error } = await db.from("challenge_prizes").delete().eq("id", p.id);
                    if (error) toast.error(errorText(error));
                    else refresh();
                  }}
                >
                  Remove prize
                </button>
              </li>
            );
          })}
          {!prizes.data?.length ? (
            <li className="text-sm text-muted-foreground">No prizes yet.</li>
          ) : null}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Sponsors</h2>
          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              const name = window.prompt("Sponsor name");
              if (!name?.trim()) return;
              const { error } = await db.from("challenge_sponsors").insert({
                challenge_id: c.id,
                name: name.trim(),
                sort: sponsors.data?.length ?? 0,
              });
              if (error) toast.error(errorText(error));
              else refresh();
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add sponsor
          </Button>
        </div>
        <ul className="space-y-3">
          {(sponsors.data ?? []).map((s) => (
            <SponsorEditor key={s.id} s={s} onChange={refresh} />
          ))}
          {!sponsors.data?.length ? (
            <li className="text-sm text-muted-foreground">
              No sponsors. Only list real, confirmed ones: they show on the page and cards.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function SponsorEditor({ s, onChange }: { s: SponsorRow; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const update = async (patch: Partial<SponsorRow>) => {
    const { error } = await db.from("challenge_sponsors").update(patch).eq("id", s.id);
    if (error) toast.error(errorText(error));
    else onChange();
  };
  return (
    <li className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-3">
        <label className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : s.logo_path ? (
            <img
              src={mediaUrl(s.logo_path) ?? ""}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : (
            <Plus className="h-4 w-4 text-muted-foreground" />
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              try {
                const ext =
                  f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
                const p = `sponsors/${crypto.randomUUID()}.${ext}`;
                const { error } = await supabase.storage
                  .from(MEDIA_BUCKET)
                  .upload(p, f, { contentType: f.type });
                if (error) throw error;
                await update({ logo_path: p });
              } catch (err) {
                toast.error(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <Input
          defaultValue={s.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== s.name &&
            void update({ name: e.target.value.trim() })
          }
          className="h-10 flex-1"
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Input
          defaultValue={s.url ?? ""}
          placeholder="https://…"
          onBlur={(e) =>
            e.target.value !== (s.url ?? "") && void update({ url: e.target.value.trim() || null })
          }
          className="h-10"
        />
        <Input
          inputMode="decimal"
          defaultValue={s.contribution_cents != null ? (s.contribution_cents / 100).toFixed(2) : ""}
          placeholder="Put in ($, private)"
          onBlur={(e) => {
            const v = e.target.value.trim()
              ? Math.round(Number(e.target.value.replace(/[$,]/g, "")) * 100)
              : null;
            if (v !== s.contribution_cents && (v == null || Number.isFinite(v)))
              void update({ contribution_cents: v });
          }}
          className="h-10"
        />
      </div>
      <Input
        defaultValue={s.blurb ?? ""}
        placeholder="One line (optional)"
        onBlur={(e) =>
          e.target.value !== (s.blurb ?? "") &&
          void update({ blurb: e.target.value.trim() || null })
        }
        className="mt-2 h-10"
        maxLength={200}
      />
      <button
        type="button"
        className="mt-2 text-xs text-destructive"
        onClick={async () => {
          if (!window.confirm(`Remove ${s.name}?`)) return;
          const { error } = await db.from("challenge_sponsors").delete().eq("id", s.id);
          if (error) toast.error(errorText(error));
          else onChange();
        }}
      >
        Remove sponsor
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Team                                                               */
/* ------------------------------------------------------------------ */

const ROLE_HELP: Record<string, string> = {
  manager: "Runs the day: starts, pauses and ends the event, judges and registers.",
  judge: "Records and corrects scores, registers people. No contact details.",
  registration: "Registers and checks people in. No scores, no contact details.",
};

function Team({ c }: { c: Full }) {
  const list = useQuery({
    queryKey: ["challenges", "staff-list", c.id],
    queryFn: () => fetchStaffList(c.id),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("judge");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Admins can do everything. Add anyone else who helps on the day; they sign in with their own
        JF Effect login and open Run event.
      </p>
      <div className="rounded-2xl border border-border p-4">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their login email"
          type="email"
          className="h-11"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {(["manager", "judge", "registration"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium capitalize",
                role === r ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
        <Button
          className="mt-3 h-11 w-full"
          disabled={busy || !email.includes("@")}
          onClick={async () => {
            setBusy(true);
            try {
              await addStaff(c.id, email, role);
              setEmail("");
              void list.refetch();
              toast.success("Added");
            } catch (e) {
              toast.error(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add to the team
        </Button>
      </div>
      <ul className="space-y-2">
        {(list.data ?? []).map((s) => (
          <li
            key={s.user_id}
            className="flex items-center gap-3 rounded-2xl border border-border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.email} · <span className="capitalize">{s.role}</span>
              </p>
            </div>
            <Button
              variant="ghost"
              className="h-9 text-muted-foreground"
              onClick={async () => {
                try {
                  await removeStaff(c.id, s.user_id);
                  void list.refetch();
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Insights                                                           */
/* ------------------------------------------------------------------ */

function Insights({ c }: { c: Full }) {
  const q = useQuery({
    queryKey: keys.insights(c.id),
    queryFn: () => fetchInsights(c.id),
    staleTime: 30_000,
  });
  const d = q.data;
  if (q.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!d) return <p className="text-sm text-muted-foreground">Couldn't load insights.</p>;
  const m = (k: keyof typeof d.metrics) => d.metrics[k]?.visitors ?? 0;
  const ev = (k: keyof typeof d.metrics) => d.metrics[k]?.events ?? 0;
  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const maxViews = Math.max(1, ...d.by_day.map((x) => Math.max(x.views, x.registrations)));
  return (
    <div className="space-y-6">
      <Grid title="Athletes">
        <Tile label="Registered" value={d.registered} />
        <Tile label="Competed" value={d.competed} />
        <Tile label="Returning" value={d.returning} hint="Entered an earlier challenge" />
        <Tile label="Claimed profiles" value={d.claimed} />
        <Tile label="Signed up via QR" value={d.by_source.qr} />
        <Tile label="Brought by a friend" value={d.by_source.friend} />
        <Tile label="Self sign-ups" value={d.by_source.self} />
        <Tile label="Registered by staff" value={d.by_source.staff} />
      </Grid>
      <Grid title="Reach (measured on this site)">
        <Tile label="Page visitors" value={m("view")} />
        <Tile label="QR scans" value={m("qr_visit")} />
        <Tile label="Friend-link visits" value={m("ref_visit")} />
        <Tile label="Result page visitors" value={m("result_view")} />
        <Tile label="Profile views" value={d.profile_views} />
        <Tile label="Big-screen opens" value={m("display_view")} />
      </Grid>
      <Grid title="Sharing">
        <Tile
          label="Share sheet opened"
          value={ev("share")}
          hint="Opened, not proof it was posted"
        />
        <Tile label="Cards saved" value={ev("download")} />
        <Tile label="Links copied" value={ev("copy_link")} />
        <Tile label="Captions copied" value={ev("copy_caption")} />
      </Grid>
      <Grid title="Business">
        <Tile label="Marketing opt-ins" value={d.marketing_opt_in} />
        <Tile label="Photo OK" value={d.photo_consent} />
        <Tile
          label="Coaching applications"
          value={d.coaching_inquiries}
          hint="From entrants, after they entered"
        />
        <Tile label="Prizes" value={money(d.prize_value_cents)} />
        <Tile label="Sponsor money" value={money(d.sponsor_cents)} />
      </Grid>
      {d.by_day.length ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Daily visitors and sign-ups</h3>
          <div className="space-y-1">
            {d.by_day.slice(-21).map((x) => (
              <div key={x.day} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-muted-foreground">
                  {new Date(`${x.day}T12:00:00`).toLocaleDateString("en-CA", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <div className="flex flex-1 flex-col gap-0.5">
                  <div
                    className="h-2 rounded-full bg-foreground/70"
                    style={{ width: `${(x.views / maxViews) * 100}%`, minWidth: x.views ? 4 : 0 }}
                  />
                  <div
                    className="h-2 rounded-full bg-success"
                    style={{
                      width: `${(x.registrations / maxViews) * 100}%`,
                      minWidth: x.registrations ? 4 : 0,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                  {x.views} · {x.registrations}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Dark: unique visitors. Green: sign-ups. Visitors are counted once per browser per half
            hour; staff don't count.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Grid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="font-display text-3xl tabular-nums">{value}</div>
      <div className="text-xs font-medium">{label}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
