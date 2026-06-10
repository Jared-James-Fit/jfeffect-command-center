import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSalesPageAdmin, updateSalesPage } from "@/lib/sales-pages.functions";
import { ShareToolbar } from "@/components/sales/share-toolbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ExternalLink, Plus, Trash2, ArrowUp, ArrowDown, Image as ImageIcon, Eye, EyeOff } from "lucide-react";

type PageKey = "join" | "coaching";

export function SalesPageEditor({ pageKey }: { pageKey: PageKey }) {
  const fetchAdmin = useServerFn(getSalesPageAdmin);
  const save = useServerFn(updateSalesPage);
  const qc = useQueryClient();
  const { data: page, isLoading } = useQuery({
    queryKey: ["admin-sales-page", pageKey],
    queryFn: () => fetchAdmin({ data: { page_key: pageKey } }),
  });

  const [draft, setDraft] = useState<any>(null);
  useEffect(() => { if (page) setDraft(structuredClone(page)); }, [page]);

  if (isLoading || !draft) return <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>;

  const update = (patch: any) => setDraft((d: any) => ({ ...d, ...patch }));
  const updateSection = (k: string, v: any) => setDraft((d: any) => ({ ...d, sections: { ...d.sections, [k]: v } }));

  const handleSave = async () => {
    try {
      await save({ data: { page_key: pageKey, patch: {
        published: draft.published,
        hero_headline: draft.hero_headline,
        hero_subheadline: draft.hero_subheadline,
        hero_image_url: draft.hero_image_url,
        primary_cta_label: draft.primary_cta_label,
        primary_cta_kind: draft.primary_cta_kind,
        primary_cta_url: draft.primary_cta_url,
        secondary_cta_label: draft.secondary_cta_label,
        secondary_cta_href: draft.secondary_cta_href,
        sections: draft.sections,
        visuals: draft.visuals,
        testimonials: draft.testimonials,
        promo_message: draft.promo_message,
      } } });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin-sales-page", pageKey] });
      qc.invalidateQueries({ queryKey: ["public-sales-page", pageKey] });
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };

  const togglePublish = async () => {
    const next = !draft.published;
    update({ published: next });
    try {
      await save({ data: { page_key: pageKey, patch: { published: next } } });
      toast.success(next ? "Page is now Live" : "Page Unpublished");
      qc.invalidateQueries({ queryKey: ["public-sales-page", pageKey] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
      update({ published: !next });
    }
  };

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className={`rounded-md px-2 py-0.5 text-xs font-bold ${draft.published ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"}`}>
            {draft.published ? "Live" : "Unpublished"}
          </div>
          <a href={`/${pageKey}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3 w-3" />Preview / Open live</Button>
          </a>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={togglePublish}>{draft.published ? "Unpublish" : "Publish"}</Button>
          <Button onClick={handleSave}>Save changes</Button>
        </div>
      </div>

      <ShareToolbar slug={pageKey} promoMessage={draft.promo_message} />

      {/* Hero */}
      <Card className="p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Hero</div>
        <div><Label>Headline</Label><Input value={draft.hero_headline} onChange={(e) => update({ hero_headline: e.target.value })} /></div>
        <div><Label>Subheadline</Label><Textarea rows={2} value={draft.hero_subheadline} onChange={(e) => update({ hero_subheadline: e.target.value })} /></div>
        <div>
          <Label>Hero image URL <span className="text-muted-foreground">(paste any image URL)</span></Label>
          <div className="flex gap-2">
            <Input value={draft.hero_image_url ?? ""} onChange={(e) => update({ hero_image_url: e.target.value || null })} placeholder="https://…" />
            {draft.hero_image_url && <img src={draft.hero_image_url} alt="" className="h-10 w-10 rounded object-cover border border-border" />}
          </div>
        </div>
      </Card>

      {/* CTAs */}
      <Card className="p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Primary CTA</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label>Button label</Label><Input value={draft.primary_cta_label} onChange={(e) => update({ primary_cta_label: e.target.value })} /></div>
          <div>
            <Label>Destination</Label>
            <Select value={draft.primary_cta_kind} onValueChange={(v) => update({ primary_cta_kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checkout">Stripe checkout (Membership)</SelectItem>
                <SelectItem value="application">Open application form</SelectItem>
                <SelectItem value="lead_form">Open in-app lead form</SelectItem>
                <SelectItem value="booking">Open booking link</SelectItem>
                <SelectItem value="external">Open external URL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>URL (booking / external / checkout)</Label><Input value={draft.primary_cta_url ?? ""} onChange={(e) => update({ primary_cta_url: e.target.value || null })} placeholder="https://…" /></div>
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground pt-4">Secondary CTA</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Label</Label><Input value={draft.secondary_cta_label ?? ""} onChange={(e) => update({ secondary_cta_label: e.target.value || null })} /></div>
          <div><Label>Link</Label><Input value={draft.secondary_cta_href ?? ""} onChange={(e) => update({ secondary_cta_href: e.target.value || null })} /></div>
        </div>
      </Card>

      {/* List editor: included / not_included */}
      <ListEditor title="What's included" value={draft.sections?.included ?? []} onChange={(v) => updateSection("included", v)} />
      <ListEditor title="Not included" value={draft.sections?.not_included ?? []} onChange={(v) => updateSection("not_included", v)} />

      {pageKey === "coaching" && (
        <ListEditor title="Who this is for" value={draft.sections?.who_for ?? []} onChange={(v) => updateSection("who_for", v)} />
      )}

      {/* FAQ editor */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">FAQ</div>
          <Button size="sm" variant="outline" onClick={() => updateSection("faq", [...(draft.sections?.faq ?? []), { q: "", a: "" }])}>
            <Plus className="mr-1 h-3 w-3" />Add
          </Button>
        </div>
        <div className="space-y-3">
          {(draft.sections?.faq ?? []).map((f: any, i: number) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-3">
              <Input value={f.q} placeholder="Question" onChange={(e) => {
                const list = [...draft.sections.faq]; list[i] = { ...list[i], q: e.target.value }; updateSection("faq", list);
              }} />
              <Textarea rows={2} value={f.a} placeholder="Answer" onChange={(e) => {
                const list = [...draft.sections.faq]; list[i] = { ...list[i], a: e.target.value }; updateSection("faq", list);
              }} />
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => updateSection("faq", draft.sections.faq.filter((_: any, idx: number) => idx !== i))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Visuals manager */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Visuals</div>
            <div className="text-[11px] text-muted-foreground">Paste any image URL. Slots: <code>app_preview</code> for app screenshots, <code>proof</code> for transformation/results images.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => update({ visuals: [...(draft.visuals ?? []), { url: "", alt: "", slot: "app_preview", visible: true }] })}>
            <Plus className="mr-1 h-3 w-3" />Add visual
          </Button>
        </div>
        <div className="space-y-2">
          {(draft.visuals ?? []).map((v: any, i: number) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[80px_1fr_140px_120px_auto]">
              <div className="grid h-12 w-12 place-items-center overflow-hidden rounded bg-muted">
                {v.url ? <img src={v.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
              </div>
              <Input value={v.url} placeholder="Image URL" onChange={(e) => { const list = [...draft.visuals]; list[i] = { ...list[i], url: e.target.value }; update({ visuals: list }); }} />
              <Input value={v.alt ?? ""} placeholder="Alt text / label" onChange={(e) => { const list = [...draft.visuals]; list[i] = { ...list[i], alt: e.target.value }; update({ visuals: list }); }} />
              <Select value={v.slot ?? "app_preview"} onValueChange={(val) => { const list = [...draft.visuals]; list[i] = { ...list[i], slot: val }; update({ visuals: list }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="app_preview">App preview</SelectItem>
                  <SelectItem value="proof">Proof / transformation</SelectItem>
                  <SelectItem value="hero">Hero</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" title={v.visible !== false ? "Visible" : "Hidden"} onClick={() => { const list = [...draft.visuals]; list[i] = { ...list[i], visible: !(v.visible !== false) }; update({ visuals: list }); }}>
                  {v.visible !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                </Button>
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { const list = [...draft.visuals]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; update({ visuals: list }); }}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" disabled={i === draft.visuals.length - 1} onClick={() => { const list = [...draft.visuals]; [list[i + 1], list[i]] = [list[i], list[i + 1]]; update({ visuals: list }); }}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => update({ visuals: draft.visuals.filter((_: any, idx: number) => idx !== i) })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          {(!draft.visuals || draft.visuals.length === 0) && (
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">No visuals yet. Add app screenshots and proof images above.</div>
          )}
        </div>
      </Card>

      {/* Testimonials */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Testimonials</div>
          <Button size="sm" variant="outline" onClick={() => update({ testimonials: [...(draft.testimonials ?? []), { name: "", quote: "", image_url: "", visible: true }] })}>
            <Plus className="mr-1 h-3 w-3" />Add testimonial
          </Button>
        </div>
        <div className="space-y-2">
          {(draft.testimonials ?? []).map((t: any, i: number) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_2fr_1fr_auto]">
              <Input value={t.name} placeholder="Name" onChange={(e) => { const list = [...draft.testimonials]; list[i] = { ...list[i], name: e.target.value }; update({ testimonials: list }); }} />
              <Textarea rows={2} value={t.quote} placeholder="Quote" onChange={(e) => { const list = [...draft.testimonials]; list[i] = { ...list[i], quote: e.target.value }; update({ testimonials: list }); }} />
              <Input value={t.image_url ?? ""} placeholder="Image URL (optional)" onChange={(e) => { const list = [...draft.testimonials]; list[i] = { ...list[i], image_url: e.target.value }; update({ testimonials: list }); }} />
              <div className="flex items-center justify-end gap-1">
                <Switch checked={t.visible !== false} onCheckedChange={(c) => { const list = [...draft.testimonials]; list[i] = { ...list[i], visible: c }; update({ testimonials: list }); }} />
                <Button size="sm" variant="ghost" onClick={() => update({ testimonials: draft.testimonials.filter((_: any, idx: number) => idx !== i) })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Promo message */}
      <Card className="p-5 space-y-2">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Promo message (copied from Share toolbar)</div>
        <Textarea rows={4} value={draft.promo_message ?? ""} onChange={(e) => update({ promo_message: e.target.value || null })} />
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className="rounded-lg border border-border bg-card/90 p-2 backdrop-blur shadow-lg">
          <Button onClick={handleSave} className="font-bold">Save changes</Button>
        </div>
      </div>
    </div>
  );
}

function ListEditor({ title, value, onChange }: { title: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Card className="p-5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
        <Button size="sm" variant="outline" onClick={() => onChange([...(value ?? []), ""])}>
          <Plus className="mr-1 h-3 w-3" />Add
        </Button>
      </div>
      <div className="space-y-2">
        {(value ?? []).map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input value={s} onChange={(e) => { const list = [...value]; list[i] = e.target.value; onChange(list); }} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}