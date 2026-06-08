import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, ArrowRight, Clock, Calendar } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/m/plans")({ component: PlanLibrary });

function PlanLibrary() {
  const fetchMe = useServerFn(getCurrentMember);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const [q, setQ] = useState("");
  const [style, setStyle] = useState<string>("");
  const [diff, setDiff] = useState<string>("");

  const { data: plans = [] } = useQuery({
    queryKey: ["m-plans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plans").select("*")
        .eq("status", "Published")
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const filtered = (plans as any[]).filter((p) => {
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (style && p.training_style !== style) return false;
    if (diff && p.difficulty !== diff) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Program Library" subtitle="Browse plans included in your membership." />
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search plans" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="">All styles</option>
          {["powerlifting","bodybuilding","strength","hypertrophy","fat_loss","lifestyle","mobility","hybrid","custom"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={diff} onChange={(e) => setDiff(e.target.value)}>
          <option value="">Any difficulty</option>
          {["Beginner","Intermediate","Advanced","All Levels"].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const unlocked = accessKeys.has(p.required_access_level);
          return (
            <Card key={p.id} className="overflow-hidden p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {p.training_style} · {p.difficulty}
                  </div>
                </div>
                {p.featured && <Badge>Featured</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{p.weeks}w · {p.days_per_week}/wk</span>
                {p.est_minutes_per_workout && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{p.est_minutes_per_workout} min</span>}
              </div>
              {p.description && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>}
              <div className="mt-4">
                {unlocked ? (
                  <Link to="/m/plans/$planId" params={{ planId: p.id }}>
                    <Button variant="outline" size="sm" className="w-full">View Plan <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                  </Link>
                ) : (
                  <Button variant="ghost" size="sm" className="w-full" disabled>
                    <Lock className="mr-1 h-3.5 w-3.5" /> Locked
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="text-sm text-muted-foreground">No plans match those filters.</div>}
      </div>
    </div>
  );
}