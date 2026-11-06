import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { challengeRpc, errorText } from "@/lib/challenges/api";
import { shortDate } from "@/lib/challenges/format";
import { AthleteAvatar } from "../ui";

interface Person {
  entry_id: string;
  athlete_id: string;
  bib: number;
  name: string;
  handle: string;
  photo: string | null;
  instagram: string | null;
  status: string;
  source: "staff" | "self";
  arrived_via: string | null;
  referred_by: string | null;
  show_name: boolean;
  photo_consent: boolean;
  acknowledged_at: string | null;
  created_at: string;
  claimed: boolean;
  discoverable: boolean;
  other_events: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  marketing: boolean;
  marketing_at: string | null;
  erased: boolean;
}

function csv(rows: Person[]): string {
  const cols: (keyof Person)[] = ["bib", "name", "full_name", "email", "phone", "instagram", "status", "source", "arrived_via", "referred_by", "marketing", "marketing_at", "photo_consent", "show_name", "created_at"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function PersonSheet({ p, slug, onClose }: { p: Person | null; slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const owner = role === "admin";
  const [d, setD] = useState<Partial<Person>>({});
  const [busy, setBusy] = useState(false);
  const [mergeQ, setMergeQ] = useState("");
  const search = useQuery({
    queryKey: ["challenges", "athlete-search", mergeQ],
    enabled: owner && mergeQ.trim().length >= 2,
    queryFn: () => challengeRpc<{ athlete_id: string; handle: string; name: string; email: string | null; entries: number; claimed: boolean }[]>("challenge_athlete_search", { p_q: mergeQ }),
  });
  if (!p) return null;
  const v = { ...p, ...d };

  async function save() {
    setBusy(true);
    try {
      await challengeRpc("challenge_update_athlete", {
        p_athlete: p!.athlete_id,
        p: { display_name: v.name, full_name: v.full_name ?? "", email: v.email ?? "", phone: v.phone ?? "", instagram: v.instagram ?? "" },
      });
      toast.success("Saved");
      setD({});
      qc.invalidateQueries({ queryKey: ["challenges"] });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function erase() {
    if (!confirm(`Delete ${p!.name}'s email, phone and full name? Their results stay.`)) return;
    try {
      await challengeRpc("challenge_erase_contact", { p_athlete: p!.athlete_id });
      toast.success("Contact details deleted");
      qc.invalidateQueries({ queryKey: ["challenges"] });
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  async function merge(intoId: string, intoName: string) {
    if (!confirm(`Merge ${p!.name} into ${intoName}? Every entry moves to ${intoName}'s profile. This can't be undone.`)) return;
    try {
      await challengeRpc("challenge_merge_athletes", { p_from: p!.athlete_id, p_into: intoId });
      toast.success("Merged");
      qc.invalidateQueries({ queryKey: ["challenges"] });
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{p.name}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="text-sm text-muted-foreground">
            Bib #{p.bib} · {p.source === "self" ? "signed up themselves" : "registered by staff"}
            {p.arrived_via ? ` via ${p.arrived_via}` : ""}
            {p.referred_by ? ` · invited by ${p.referred_by}` : ""} · {shortDate(p.created_at)}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[
              p.acknowledged_at ? "Agreed to the rules" : "No agreement on file",
              p.photo_consent ? "Photo consent" : "No photo consent",
              p.marketing ? "Opted in to emails" : "No marketing emails",
              p.show_name ? "Name public" : "Name hidden",
              p.claimed ? "Has a JF account" : "No account",
              p.other_events ? `${p.other_events} other challenge${p.other_events === 1 ? "" : "s"}` : "First challenge",
            ].map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-1">
                {t}
              </span>
            ))}
          </div>
          {(
            [
              ["name", "Name on leaderboards"],
              ["full_name", "Full name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["instagram", "Instagram"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block space-y-1">
              <span className="text-sm font-semibold">{label}</span>
              <Input value={(v[k] as string) ?? ""} onChange={(e) => setD({ ...d, [k]: e.target.value })} className="h-11 text-base" />
            </label>
          ))}
          <Button onClick={save} disabled={busy || !Object.keys(d).length} className="h-11 w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
          <Link to="/challenges/$slug/$handle" params={{ slug, handle: p.handle }} className="block text-center text-sm font-semibold text-primary">
            Open their result page
          </Link>
          {owner && (
            <div className="space-y-2 rounded-2xl border border-border p-3">
              <div className="text-sm font-semibold">Same person as another profile?</div>
              <Input value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} placeholder="Search name, email or handle" className="h-11 text-base" />
              {(search.data ?? [])
                .filter((x) => x.athlete_id !== p.athlete_id)
                .map((x) => (
                  <button key={x.athlete_id} type="button" onClick={() => merge(x.athlete_id, x.name)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-border p-2 text-left text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{x.name}</span> <span className="text-muted-foreground">{x.email ?? `@${x.handle}`}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{x.entries} entries · merge →</span>
                  </button>
                ))}
            </div>
          )}
          {owner && !p.erased && (
            <button type="button" onClick={erase} className="w-full text-center text-sm font-semibold text-destructive">
              Delete their contact details
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PeopleTab({ challengeId, slug }: { challengeId: string; slug: string }) {
  const q = useQuery({ queryKey: ["challenges", "participants", challengeId], queryFn: () => challengeRpc<Person[]>("challenge_participants", { p_challenge: challengeId }) });
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<Person | null>(null);
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    const all = q.data ?? [];
    return t ? all.filter((p) => `${p.name} ${p.full_name ?? ""} ${p.email ?? ""} ${p.bib}`.toLowerCase().includes(t)) : all;
  }, [q.data, term]);

  if (q.isLoading) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="text-sm text-muted-foreground">{errorText(q.error)}</p>;
  const all = q.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search people" className="h-11 pl-9 text-base" />
        </div>
        <Button variant="outline" className="h-11" onClick={() => download(`${slug}-participants.csv`, csv(all))} disabled={!all.length}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {all.length} people · {all.filter((p) => p.marketing).length} opted in to emails. Only email people about other things if they opted in.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {rows.map((p) => (
          <li key={p.entry_id}>
            <button type="button" onClick={() => setOpen(p)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/50">
              <span className="w-10 text-center font-display text-lg text-muted-foreground">#{p.bib}</span>
              <AthleteAvatar name={p.name} photo={p.photo} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {p.name}
                  {p.full_name && p.full_name !== p.name ? <span className="font-normal text-muted-foreground"> · {p.full_name}</span> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.erased ? "Contact details deleted" : [p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
              </div>
              <span className="text-xs text-muted-foreground">{p.status.replace("_", " ")}</span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="p-6 text-center text-sm text-muted-foreground">{all.length ? "Nobody matches." : "Nobody's signed up yet."}</li>}
      </ul>
      <PersonSheet key={open?.entry_id ?? "none"} p={open} slug={slug} onClose={() => setOpen(null)} />
    </div>
  );
}
