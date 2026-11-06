import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { errorText, mediaUrl, uploadChallengeImage } from "@/lib/challenges/api";
import { logoJpeg } from "@/lib/challenges/photo";
import { ordinal } from "@/lib/challenges/format";
import type { Division } from "@/lib/challenges/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface PrizeRow {
  id: string;
  place: number;
  division_id: string | null;
  title: string;
  description: string | null;
  value_cents: number | null;
  currency: string;
  sponsor_id: string | null;
}
interface SponsorRow {
  id: string;
  name: string;
  url: string | null;
  logo_path: string | null;
  blurb: string | null;
  sort: number;
  contribution_cents: number | null;
  contribution_note: string | null;
}
interface UpdateRow {
  id: string;
  body: string;
  created_at: string;
}

const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));
const cents = (s: string) => (s.trim() ? Math.round(Number(s.replace(/[$,]/g, "")) * 100) : null);

function usePrizes(id: string) {
  return useQuery({
    queryKey: ["challenges", "admin-prizes", id],
    queryFn: async () => {
      const [p, s, u] = await Promise.all([
        db.from("challenge_prizes").select("*").eq("challenge_id", id).order("place").order("created_at"),
        db.from("challenge_sponsors").select("*").eq("challenge_id", id).order("sort").order("created_at"),
        db.from("challenge_updates").select("*").eq("challenge_id", id).order("created_at", { ascending: false }),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      if (u.error) throw u.error;
      return { prizes: p.data as PrizeRow[], sponsors: s.data as SponsorRow[], updates: u.data as UpdateRow[] };
    },
  });
}

function PrizeCard({ p, divisions, sponsors, onChanged }: { p: PrizeRow; divisions: Division[]; sponsors: SponsorRow[]; onChanged: () => void }) {
  const [d, setD] = useState({ ...p, value: dollars(p.value_cents) });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { error } = await db
      .from("challenge_prizes")
      .update({ place: d.place, division_id: d.division_id, title: d.title.trim(), description: d.description?.trim() || null, value_cents: cents(d.value), currency: d.currency, sponsor_id: d.sponsor_id })
      .eq("id", p.id);
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Prize saved");
    onChanged();
  }
  async function remove() {
    if (!confirm("Remove this prize?")) return;
    const { error } = await db.from("challenge_prizes").delete().eq("id", p.id);
    if (error) return toast.error(errorText(error));
    onChanged();
  }
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="grid grid-cols-[88px_1fr] gap-2">
        <select value={d.place} onChange={(e) => setD({ ...d, place: Number(e.target.value) })} className="h-11 rounded-lg border border-border bg-background px-2 text-base">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {ordinal(n)}
            </option>
          ))}
        </select>
        <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value.slice(0, 120) })} className="h-11 text-base" placeholder="$225 CAD + the winner's trophy" />
      </div>
      <Textarea value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value.slice(0, 500) })} rows={2} className="text-base" placeholder="Details (optional)" />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} inputMode="decimal" className="h-11 text-base" placeholder="Value $ (private)" />
        {divisions.length > 1 ? (
          <select value={d.division_id ?? ""} onChange={(e) => setD({ ...d, division_id: e.target.value || null })} className="h-11 rounded-lg border border-border bg-background px-2 text-base">
            <option value="">Overall</option>
            {divisions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : (
          <div />
        )}
        <select value={d.sponsor_id ?? ""} onChange={(e) => setD({ ...d, sponsor_id: e.target.value || null })} className="h-11 rounded-lg border border-border bg-background px-2 text-base">
          <option value="">No sponsor</option>
          {sponsors.map((s) => (
            <option key={s.id} value={s.id}>
              From {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={remove}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
        <Button variant="outline" onClick={save} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save prize
        </Button>
      </div>
    </div>
  );
}

function SponsorCard({ s, challengeId, onChanged }: { s: SponsorRow; challengeId: string; onChanged: () => void }) {
  const [d, setD] = useState({ ...s, amount: dollars(s.contribution_cents) });
  const [busy, setBusy] = useState(false);
  async function save(extra?: Partial<SponsorRow>) {
    setBusy(true);
    const { error } = await db
      .from("challenge_sponsors")
      .update({ name: d.name.trim(), url: d.url?.trim() || null, blurb: d.blurb?.trim() || null, contribution_cents: cents(d.amount), contribution_note: d.contribution_note?.trim() || null, logo_path: d.logo_path, ...extra })
      .eq("id", s.id);
    setBusy(false);
    if (error) return toast.error(/url/.test(error.message) ? "Links start with https://" : errorText(error));
    toast.success("Sponsor saved");
    onChanged();
  }
  async function logo(file?: File) {
    if (!file) return;
    try {
      const path = await uploadChallengeImage(challengeId, await logoJpeg(file));
      setD({ ...d, logo_path: path });
      await save({ logo_path: path });
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  async function remove() {
    if (!confirm(`Remove ${s.name}?`)) return;
    const { error } = await db.from("challenge_sponsors").delete().eq("id", s.id);
    if (error) return toast.error(errorText(error));
    onChanged();
  }
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <label className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-border bg-muted" aria-label="Logo">
          {d.logo_path ? <img src={mediaUrl(d.logo_path)!} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => logo(e.target.files?.[0])} />
        </label>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value.slice(0, 80) })} className="h-11 text-base" placeholder="Sponsor name" />
      </div>
      <Input value={d.url ?? ""} onChange={(e) => setD({ ...d, url: e.target.value })} className="h-11 text-base" placeholder="https://their-site.com (optional)" inputMode="url" />
      <Input value={d.blurb ?? ""} onChange={(e) => setD({ ...d, blurb: e.target.value.slice(0, 200) })} className="h-11 text-base" placeholder="One line about them (optional)" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} inputMode="decimal" className="h-11 text-base" placeholder="Contribution $ (private)" />
        <Input value={d.contribution_note ?? ""} onChange={(e) => setD({ ...d, contribution_note: e.target.value.slice(0, 500) })} className="h-11 text-base" placeholder="What they gave (private)" />
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={remove}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
        <Button variant="outline" onClick={() => save()} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save sponsor
        </Button>
      </div>
    </div>
  );
}

export function PrizesTab({ challengeId, divisions }: { challengeId: string; divisions: Division[] }) {
  const qc = useQueryClient();
  const q = usePrizes(challengeId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["challenges"] });

  async function addPrize() {
    const place = (q.data?.prizes.reduce((m, p) => Math.max(m, p.place), 0) ?? 0) + 1;
    const { error } = await db.from("challenge_prizes").insert({ challenge_id: challengeId, place, title: place === 1 ? "Winner's prize" : `${ordinal(place)} place prize` });
    if (error) return toast.error(errorText(error));
    refresh();
  }
  async function addSponsor() {
    const { error } = await db.from("challenge_sponsors").insert({ challenge_id: challengeId, name: "New sponsor", sort: q.data?.sponsors.length ?? 0 });
    if (error) return toast.error(errorText(error));
    refresh();
  }

  if (q.isLoading) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />;
  const data = q.data!;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Prizes</h3>
            <p className="text-xs text-muted-foreground">Values and sponsor amounts stay private; the public sees the prize names.</p>
          </div>
          <Button variant="outline" onClick={addPrize}>
            <Plus className="h-4 w-4" /> Prize
          </Button>
        </div>
        {data.prizes.length === 0 && <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No prizes yet.</p>}
        {data.prizes.map((p) => (
          <PrizeCard key={`${p.id}-${p.title}-${p.place}`} p={p} divisions={divisions} sponsors={data.sponsors} onChanged={refresh} />
        ))}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Sponsors</h3>
          <Button variant="outline" onClick={addSponsor}>
            <Plus className="h-4 w-4" /> Sponsor
          </Button>
        </div>
        {data.sponsors.length === 0 && <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No sponsors yet.</p>}
        {data.sponsors.map((s) => (
          <SponsorCard key={`${s.id}-${s.name}`} s={s} challengeId={challengeId} onChanged={refresh} />
        ))}
      </section>
    </div>
  );
}

export function UpdatesTab({ challengeId }: { challengeId: string }) {
  const qc = useQueryClient();
  const q = usePrizes(challengeId);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await db.from("challenge_updates").insert({ challenge_id: challengeId, body: body.trim() });
    setBusy(false);
    if (error) return toast.error(errorText(error));
    setBody("");
    toast.success("Posted on the challenge page");
    qc.invalidateQueries({ queryKey: ["challenges"] });
  }
  async function remove(id: string) {
    const { error } = await db.from("challenge_updates").delete().eq("id", id);
    if (error) return toast.error(errorText(error));
    qc.invalidateQueries({ queryKey: ["challenges"] });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-base font-semibold">Post an update</h3>
        <Textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 500))} rows={3} className="text-base" placeholder="Doors open at 9. Warm-up area is at the back." />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{500 - body.length} left · shows on the public page right away</span>
          <Button onClick={post} disabled={busy || !body.trim()}>
            Post
          </Button>
        </div>
      </div>
      <ul className="space-y-2">
        {(q.data?.updates ?? []).map((u) => (
          <li key={u.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3">
            <div>
              <div className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleString()}</div>
              <p className="whitespace-pre-line text-[15px]">{u.body}</p>
            </div>
            <button type="button" onClick={() => remove(u.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Delete update">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
