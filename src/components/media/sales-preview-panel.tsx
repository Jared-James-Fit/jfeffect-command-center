import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ShareToolbar } from "@/components/sales/share-toolbar";
import { submitForReview } from "@/lib/media-manager.functions";
import { toast } from "sonner";

export function SalesPreviewPanel({
  pageKey, slug, title,
}: { pageKey: string; slug: "join" | "coaching"; title: string }) {
  const qc = useQueryClient();
  const submit = useServerFn(submitForReview);
  const { data: page } = useQuery({
    queryKey: ["sales-page", pageKey],
    queryFn: async () => {
      const { data } = await supabase.from("sales_pages").select("*").eq("page_key", pageKey).maybeSingle();
      return data;
    },
  });
  const [headline, setHeadline] = useState("");
  const [sub, setSub] = useState("");
  const [promo, setPromo] = useState("");

  useEffect(() => {
    const draft = (page?.draft_payload as any) || {};
    setHeadline(draft.hero_headline ?? page?.hero_headline ?? "");
    setSub(draft.hero_subheadline ?? page?.hero_subheadline ?? "");
    setPromo(draft.promo_message ?? page?.promo_message ?? "");
  }, [page]);

  async function saveDraft(submit_for_review: boolean) {
    const draft_payload = { hero_headline: headline, hero_subheadline: sub, promo_message: promo };
    const { error } = await supabase.from("sales_pages").update({
      draft_payload, draft_status: submit_for_review ? "needs_review" : "draft",
    } as any).eq("page_key", pageKey);
    if (error) return toast.error(error.message);
    if (submit_for_review) {
      try { await submit({ data: { kind: "sales_page", id: pageKey } }); } catch (e: any) { toast.error(e.message); return; }
    }
    qc.invalidateQueries({ queryKey: ["sales-page", pageKey] });
    toast.success(submit_for_review ? "Submitted for review" : "Draft saved");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-black">{title}</h1>
        {page?.draft_status && <Badge variant="outline">{page.draft_status}</Badge>}
      </header>

      <ShareToolbar slug={slug} promoMessage={promo || page?.promo_message} />

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Draft Suggestions</h2>
        <p className="text-xs text-muted-foreground">Edits save as drafts; admin approval publishes them to the live page.</p>
        <div className="space-y-2">
          <label className="text-xs font-medium">Hero headline</label>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">Hero subheadline</label>
          <Textarea value={sub} onChange={(e) => setSub(e.target.value)} rows={2} />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">Promo message</label>
          <Textarea value={promo} onChange={(e) => setPromo(e.target.value)} rows={3} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => saveDraft(false)}>Save Draft</Button>
          <Button onClick={() => saveDraft(true)}>Submit for Review</Button>
        </div>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        <div className="mb-2 font-bold uppercase tracking-widest">Live page</div>
        <div>Headline: {page?.hero_headline || "—"}</div>
        <div>Sub: {page?.hero_subheadline || "—"}</div>
        <div>Promo: {page?.promo_message || "—"}</div>
      </Card>
    </div>
  );
}