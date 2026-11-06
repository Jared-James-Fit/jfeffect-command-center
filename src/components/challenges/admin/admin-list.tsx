import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Eye, Loader2, Plus, Share2, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { challengeRpc, duplicateChallenge, errorText } from "@/lib/challenges/api";
import { CHALLENGE_PRESETS, presetFields, type ChallengePreset } from "@/lib/challenges/presets";
import { shortDate, slugify } from "@/lib/challenges/format";
import type { ChallengeStatus } from "@/lib/challenges/types";
import { StatusPill } from "../ui";

interface OverviewRow {
  id: string;
  slug: string;
  title: string;
  status: ChallengeStatus;
  is_template: boolean;
  starts_at: string | null;
  city: string | null;
  activity: string;
  role: string | null;
  final: boolean;
  registered: number;
  competed: number;
  views: number;
  shares: number;
  referrals: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useOverview() {
  return useQuery({ queryKey: ["challenges", "overview"], queryFn: () => challengeRpc<OverviewRow[]>("challenge_overview") });
}

function NewChallengeDialog({ open, onOpenChange, sources }: { open: boolean; onOpenChange: (o: boolean) => void; sources: OverviewRow[] }) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<ChallengePreset | null>(null);
  const [from, setFrom] = useState<OverviewRow | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [asTemplate, setAsTemplate] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreset(null);
    setFrom(null);
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    setAsTemplate(false);
  }

  async function create() {
    const s = slug || slugify(title);
    if (title.trim().length < 3) return toast.error("Give it a name.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length < 3) return toast.error("The web address can use letters, numbers and dashes.");
    setBusy(true);
    try {
      let id: string;
      if (from) {
        id = await duplicateChallenge(from.id, title.trim(), s, asTemplate);
      } else {
        const p = preset ?? CHALLENGE_PRESETS[CHALLENGE_PRESETS.length - 1];
        const { data, error } = await db
          .from("challenges")
          .insert({ title: title.trim(), slug: s, is_template: asTemplate, city: "Winnipeg", ...presetFields(p) })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
        await db.from("challenge_divisions").insert({ challenge_id: id, name: "Open", sort: 0 });
      }
      onOpenChange(false);
      reset();
      navigate({ to: "/admin/challenges/$challengeId", params: { challengeId: id } });
    } catch (e) {
      const msg = errorText(e);
      toast.error(/duplicate key|unique/i.test(msg) ? "That web address is taken. Pick another." : msg);
    } finally {
      setBusy(false);
    }
  }

  const step = preset || from ? 2 : 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "What will people do?" : "Name it"}</DialogTitle>
        </DialogHeader>
        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {CHALLENGE_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPreset(p)} className="rounded-xl border border-border p-3 text-left hover:bg-secondary">
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </button>
              ))}
            </div>
            {sources.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Or start from one you've run</div>
                <div className="space-y-1.5">
                  {sources.slice(0, 8).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setFrom(s);
                        setTitle(s.is_template ? s.title.replace(/ template$/i, "") : `${s.title} 2`);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-left hover:bg-secondary"
                    >
                      <span className="truncate text-sm font-semibold">{s.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.is_template ? "Template" : shortDate(s.starts_at) || s.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {from ? `A copy of ${from.title}: rules, divisions, prizes and sponsors. No people or scores.` : `${preset!.label}: scoring, rules and tie-break are filled in. You can change any of it before the event starts.`}
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold" htmlFor="nc-title">Name</label>
              <Input
                id="nc-title"
                className="h-11 text-base"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="e.g. Winnipeg Deadlift Showdown"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold" htmlFor="nc-slug">Web address</label>
              <div className="flex items-center rounded-lg border border-border pl-3">
                <span className="shrink-0 text-sm text-muted-foreground">jfeffect.com/challenges/</span>
                <Input
                  id="nc-slug"
                  className="h-11 border-0 pl-0.5 text-base shadow-none focus-visible:ring-0"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} className="h-4 w-4" />
              Save as a reusable template (never public)
            </label>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={reset}>
                Back
              </Button>
              <Button className="h-11 flex-1" onClick={create} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create draft
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AdminChallengesPage() {
  const q = useOverview();
  const [open, setOpen] = useState(false);
  const rows = q.data ?? [];
  const templates = rows.filter((r) => r.is_template);
  const events = rows.filter((r) => !r.is_template);
  const sources = useMemo(() => [...templates, ...events.filter((e) => e.status !== "draft")], [templates, events]);
  const { role } = useAuth();
  const canCreate = role === "admin";

  return (
    <div>
      <PageHeader
        title="Challenges"
        subtitle="Real-world events with a live leaderboard and share cards."
        actions={
          canCreate && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New challenge
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 md:px-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/challenges" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 font-semibold">
            <Eye className="h-4 w-4" /> Public hub
          </Link>
        </div>
        {q.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-2 text-[15px] font-semibold">No challenges yet</div>
            <p className="mt-1 text-sm text-muted-foreground">Create one, publish it, and share the link.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((r) => (
              <li key={r.id}>
                <Link to="/admin/challenges/$challengeId" params={{ challengeId: r.id }} className="block rounded-2xl border border-border bg-card p-4 hover:bg-secondary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold">{r.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.starts_at ? shortDate(r.starts_at) : "No date yet"}
                        {r.city ? ` · ${r.city}` : ""} · /challenges/{r.slug}
                      </div>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {r.registered} registered · {r.competed} competed
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> {r.views} page views
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Share2 className="h-3.5 w-3.5" /> {r.shares} shares · {r.referrals} friend sign-ups
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {templates.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Templates</h2>
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={t.id} className={cn("flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3")}>
                  <Link to="/admin/challenges/$challengeId" params={{ challengeId: t.id }} className="min-w-0 truncate text-sm font-semibold">
                    {t.title}
                  </Link>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Copy className="h-3.5 w-3.5" /> New challenge → start from it
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <NewChallengeDialog open={open} onOpenChange={setOpen} sources={sources} />
    </div>
  );
}
