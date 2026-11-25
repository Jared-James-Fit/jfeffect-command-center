/**
 * Manage → Insights → Crew promos (admin only): JF Effect's own promos in the
 * Crew feed, each with how many saw it, tapped it and dismissed it. A promo
 * links inside the app only and can skip people who already have the service.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listPromoCampaigns, savePromoCampaign, type PromoCampaign } from "@/lib/crew-ads/crew-ads.functions";
import { SPONSORED_LABEL } from "@/lib/crew-ads/placement";

type Draft = {
  id?: string;
  name: string;
  headline: string;
  body: string;
  cta_label: string;
  cta_path: string;
  suppress_for: Array<"coaching" | "premium">;
  status: PromoCampaign["status"];
};
const BLANK: Draft = { name: "", headline: "", body: "", cta_label: "Learn more", cta_path: "/coaching", suppress_for: ["coaching"], status: "draft" };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export function CrewPromosAdmin() {
  const list = useServerFn(listPromoCampaigns);
  const save = useServerFn(savePromoCampaign);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["crew-promo-campaigns"], queryFn: () => list() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const m = useMutation({
    mutationFn: (d: Draft) => save({ data: { ...d } }),
    onSuccess: () => {
      toast.success("Promo saved");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["crew-promo-campaigns"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save the promo"),
  });
  const edit = (c: PromoCampaign) =>
    setDraft({ id: c.id, name: c.name, headline: c.headline, body: c.body ?? "", cta_label: c.cta_label, cta_path: c.cta_path, suppress_for: c.suppress_for as Draft["suppress_for"], status: c.status });

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-crew-promos-admin>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">Crew promos</h3>
          <p className="text-[12px] text-muted-foreground">Your own promos in the feed, shown as "{SPONSORED_LABEL}". First after 8–10 posts, then every 12+, 2 a visit, 3 a day.</p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft(BLANK)} className="h-9 shrink-0 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background">
            New promo
          </button>
        )}
      </div>

      {draft && (
        <form
          className="mt-4 grid gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate(draft);
          }}
        >
          <Input placeholder="Name (only you see it)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input placeholder="Headline" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
          <Textarea placeholder="A line or two (optional)" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={2} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Button" value={draft.cta_label} onChange={(e) => setDraft({ ...draft, cta_label: e.target.value })} />
            <Input placeholder="/coaching" value={draft.cta_path} onChange={(e) => setDraft({ ...draft, cta_path: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className="self-center text-muted-foreground">Skip people with:</span>
            {(["coaching", "premium"] as const).map((k) => {
              const on = draft.suppress_for.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft({ ...draft, suppress_for: on ? draft.suppress_for.filter((x) => x !== k) : [...draft.suppress_for, k] })}
                  className={cn("h-8 rounded-full px-3 font-medium", on ? "bg-foreground text-background" : "bg-muted")}
                >
                  {k === "coaching" ? "Coaching" : "Premium"}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className="self-center text-muted-foreground">Status:</span>
            {(["draft", "active", "paused", "ended"] as const).map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={draft.status === st}
                onClick={() => setDraft({ ...draft, status: st })}
                className={cn("h-8 rounded-full px-3 font-medium capitalize", draft.status === st ? "bg-foreground text-background" : "bg-muted")}
              >
                {st === "active" ? "Live" : st}
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            <button type="submit" disabled={m.isPending} className="h-10 flex-1 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground disabled:opacity-60">
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-full px-4 text-[14px] font-medium text-muted-foreground">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 divide-y divide-border">
        {q.isLoading && <p className="py-3 text-[13px] text-muted-foreground">Loading…</p>}
        {q.data?.length === 0 && <p className="py-3 text-[13px] text-muted-foreground">No promos yet.</p>}
        {q.data?.map((c) => (
          <button key={c.id} type="button" onClick={() => edit(c)} className="flex w-full items-start justify-between gap-3 py-3 text-left" data-promo-row={c.status}>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{c.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{c.headline} · {c.cta_path}</span>
            </span>
            <span className="shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
              <span className={cn("block font-semibold", c.status === "active" ? "text-foreground" : "")}>{c.status === "active" ? "Live" : c.status}</span>
              {c.stats.impressions} seen · {c.stats.clicks} taps ({pct(c.stats.clicks, c.stats.impressions)}) · {c.stats.dismissals} dismissed
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
