import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, RefreshCw, Type } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isAutoPost, type CommunityPost } from "@/lib/community";
import { CREW_UNIT } from "@/lib/dual-weight";
import { instagramPlan, MULTI_CARDS, type IgCard } from "@/lib/instagram-export";
import { paintInstagramCard } from "@/lib/instagram-cards";
import { forgetPostArt } from "@/lib/post-art";
import { lastPaintReport } from "@/lib/post-design-paint";
import { reportProblems } from "@/lib/post-design";
import { stripEmphasis } from "@/lib/post-decks";
import { PostArtImage } from "@/components/community/post-art";
import { refreshPostHeadlines } from "@/lib/post-design.functions";

const db = supabase as any;

type Headline = { id: string; post_id: string | null; status: string; old_title: string | null; new_title: string | null; problems: string[] | null };

/** The automated posts out lately, newest first (the feed's own read, so they're exactly what people see). */
function useRecentAutoPosts() {
  return useQuery({
    queryKey: ["post-design", "recent"],
    staleTime: 60_000,
    queryFn: async (): Promise<CommunityPost[]> => {
      const { data, error } = await db.rpc("community_feed", { _limit: 60 });
      if (error) throw error;
      return ((data?.posts ?? []) as CommunityPost[]).filter((p) => isAutoPost(p) && instagramPlan(p).card);
    },
  });
}

function useHeadlines() {
  return useQuery({
    queryKey: ["post-design", "headlines"],
    staleTime: 30_000,
    queryFn: async (): Promise<Headline[]> => {
      const { data, error } = await db.from("community_post_headlines").select("id, post_id, status, old_title, new_title, problems").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Headline[];
    },
  });
}

/** Paint every slide of a post off screen and say what the design checks find (the harness's check, on real posts). */
async function checkPost(post: CommunityPost): Promise<string[]> {
  const plan = instagramPlan(post);
  const card = plan.card as IgCard;
  const n = MULTI_CARDS.has(card) ? plan.cards ?? 1 : 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    await paintInstagramCard(c, { card, format: "feed", post, unit: CREW_UNIT, slide: i });
    c.width = 0;
    const r = lastPaintReport();
    if (r) out.push(...reportProblems(r).map((p) => (n > 1 ? `slide ${i + 1}: ${p}` : p)));
  }
  return out;
}

/**
 * Crew → Posts → Manage → Post design (Nov 25 2026): the automated posts as
 * the profile grid shows them (three across, each its painted cover), the
 * design checks on each (contrast, the size the headline reads at in the
 * grid, nothing clipped), a post's every slide on a tap with Repaint, and
 * the cover-headline pass (tightened headlines with Undo). Repaint all
 * repaints this phone's copies; every phone repaints on its own when the
 * design version changes.
 */
export function PostDesignCard() {
  const posts = useRecentAutoPosts();
  const headlines = useHeadlines();
  const qc = useQueryClient();
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState<CommunityPost | null>(null);
  const [checks, setChecks] = useState<Record<string, string[]>>({});
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const byPost = useMemo(() => new Map((headlines.data ?? []).filter((h) => h.post_id).map((h) => [h.post_id!, h])), [headlines.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of headlines.data ?? []) c[h.status] = (c[h.status] ?? 0) + 1;
    return c;
  }, [headlines.data]);

  const checkAll = async () => {
    if (!posts.data?.length || checking) return;
    setChecking(true);
    try {
      const next: Record<string, string[]> = {};
      for (const p of posts.data) next[p.id] = await checkPost(p).catch((e) => [`couldn't paint: ${String(e?.message ?? e)}`]);
      setChecks(next);
      const bad = Object.values(next).filter((v) => v.length).length;
      toast.success(bad ? `${bad} of ${posts.data.length} posts need a look` : `All ${posts.data.length} posts pass`);
    } finally {
      setChecking(false);
    }
  };
  const repaint = async (ids: string[] | null) => {
    await forgetPostArt(ids);
    setRev((r) => r + 1);
  };
  const runHeadlines = async () => {
    setRefreshing(true);
    try {
      const out = await refreshPostHeadlines();
      toast.success(out.running ? "Headline pass running. It works through a few posts every few minutes." : "Every deck's headline has been looked at.");
      void qc.invalidateQueries({ queryKey: ["post-design", "headlines"] });
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-post-design>
      <header className="space-y-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[16px] font-semibold">
            <Type className="h-4 w-4" aria-hidden /> Post design
          </div>
          <p className="text-[13px] text-muted-foreground">Every automated post as the profile grid shows it. Black, off-white, graphite and red; checked for contrast, grid size and clipping.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={checkAll} loading={checking} disabled={!posts.data?.length}>
            Check readability
          </Button>
          <Button size="sm" variant="outline" onClick={() => void repaint(null)}>
            <RefreshCw className="h-4 w-4" /> Repaint all
          </Button>
          <Button size="sm" variant="outline" onClick={runHeadlines} loading={refreshing}>
            Tighten headlines
          </Button>
        </div>
        {headlines.data && (
          <p className="text-[12px] text-muted-foreground" data-headline-counts>
            Headlines: {counts.done ?? 0} tightened · {counts.kept ?? 0} already read well · {counts.failed ?? 0} left as they were{counts.undone ? ` · ${counts.undone} put back` : ""}
          </p>
        )}
      </header>
      {posts.isLoading ? (
        <div className="grid grid-cols-3 gap-0.5 p-0.5">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-none" />
          ))}
        </div>
      ) : posts.error ? (
        <p className="px-4 py-6 text-[14px] text-muted-foreground">Couldn't load the posts. Pull down to try again.</p>
      ) : !posts.data?.length ? (
        <p className="px-4 py-6 text-[14px] text-muted-foreground">No automated posts yet.</p>
      ) : (
        <div className="mx-auto grid max-w-[420px] grid-cols-3 gap-0.5 bg-black p-0.5" data-post-design-grid>
          {posts.data.map((p) => {
            const problems = checks[p.id];
            return (
              <button key={`${p.id}:${rev}`} type="button" onClick={() => setOpen(p)} className="relative aspect-[3/4] overflow-hidden" aria-label={`Open ${stripEmphasis(p.caption ?? p.series ?? "post").slice(0, 60)}`}>
                <PostArtImage post={p} card={instagramPlan(p).card!} unit={CREW_UNIT} fill zoom={false} />
                {problems && (
                  <span className={cn("absolute right-1 top-1 rounded-full p-0.5", problems.length ? "bg-warning text-black" : "bg-success text-white")}>
                    {problems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" swipeToClose className="max-h-[92svh] overflow-y-auto">
          {open && <PostDesignDetail post={open} rev={rev} problems={checks[open.id]} headline={byPost.get(open.id) ?? null} onRepaint={() => void repaint([open.id])} onUndone={() => void qc.invalidateQueries({ queryKey: ["post-design", "headlines"] })} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PostDesignDetail({ post, rev, problems, headline, onRepaint, onUndone }: { post: CommunityPost; rev: number; problems?: string[]; headline: Headline | null; onRepaint: () => void; onUndone: () => void }) {
  const plan = instagramPlan(post);
  const card = plan.card as IgCard;
  const n = MULTI_CARDS.has(card) ? plan.cards ?? 1 : 1;
  const [undoing, setUndoing] = useState(false);
  const undo = async () => {
    if (!headline) return;
    setUndoing(true);
    try {
      const { data, error } = await db.rpc("community_post_headline_undo", { _id: headline.id });
      if (error) throw error;
      toast.success(data === "applied" ? "Headline put back" : "It changed since, so it was left as it is");
      onUndone();
      onRepaint();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setUndoing(false);
    }
  };
  return (
    <div className="space-y-4 pb-6">
      <SheetTitle className="text-[16px]">{n > 1 ? `${n} slides` : "The card"}</SheetTitle>
      <div className="-mx-6 flex snap-x snap-mandatory gap-2 overflow-x-auto px-6" data-post-design-slides>
        {Array.from({ length: n }, (_, i) => (
          <div key={`${i}:${rev}`} className="w-[78%] max-w-[320px] shrink-0 snap-start overflow-hidden rounded-xl">
            <PostArtImage post={post} card={card} slide={i} unit={CREW_UNIT} eager zoom={false} />
          </div>
        ))}
      </div>
      {problems && (
        <div className={cn("rounded-xl px-3 py-2 text-[13px]", problems.length ? "bg-warning/10" : "bg-success/10")}>
          {problems.length ? problems.map((p) => <div key={p}>{p}</div>) : "Passes contrast, grid size and clipping checks."}
        </div>
      )}
      {headline && (headline.status === "done" || headline.status === "undone") && (
        <div className="space-y-1 rounded-xl border border-border px-3 py-2 text-[13px]" data-headline-change>
          <div className="text-muted-foreground">Headline {headline.status === "done" ? "tightened for the grid" : "put back"}</div>
          <div className="line-through decoration-muted-foreground/60">{stripEmphasis(headline.old_title ?? "")}</div>
          <div className="font-semibold">{stripEmphasis(headline.new_title ?? "")}</div>
          {headline.status === "done" && (
            <Button size="sm" variant="ghost" onClick={undo} loading={undoing} className="-ml-2">
              Undo
            </Button>
          )}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={onRepaint}>
        <RefreshCw className="h-4 w-4" /> Repaint this post
      </Button>
    </div>
  );
}
