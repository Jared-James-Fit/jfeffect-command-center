import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Copy, ExternalLink, Trash2, Pencil, Sparkles, Archive } from "lucide-react";
import { toast } from "sonner";
import { OfferForm } from "@/components/offer-form";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { OFFER_TEMPLATES, blankOffer, type OfferLike } from "@/lib/offers";

export const Route = createFileRoute("/_authenticated/admin/offers")({
  component: OffersPage,
});

function OffersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OfferLike | null>(null);
  const [assigning, setAssigning] = useState<any | null>(null);

  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").eq("archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const del = async (id: string) => {
    if (!confirm("Archive this offer? Past purchase records keep their snapshot.")) return;
    const { error } = await supabase.from("offers").update({ archived: true, status: "Archived" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Archived");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const duplicate = async (o: any) => {
    const { id, created_at, updated_at, version, ...rest } = o;
    const { error } = await supabase.from("offers").insert({ ...rest, name: `${o.name} (copy)`, status: "Draft" });
    if (error) return toast.error(error.message);
    toast.success("Duplicated");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const createFromTemplate = async (tpl: any) => {
    const merged = { ...blankOffer(), ...tpl };
    const { error } = await supabase.from("offers").insert(merged as any);
    if (error) return toast.error(error.message);
    toast.success(`Created "${tpl.name}"`);
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const save = async (v: OfferLike) => {
    if ((editing as any)?.id) {
      const { id, created_at, updated_at, version, ...patch } = v as any;
      const { error } = await supabase.from("offers").update(patch).eq("id", (editing as any).id);
      if (error) return toast.error(error.message);
      toast.success("Saved");
    } else {
      const { error } = await supabase.from("offers").insert(v as any);
      if (error) return toast.error(error.message);
      toast.success("Offer created");
    }
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  return (
    <>
      <PageHeader
        title="Offers & Products"
        subtitle="Define your services, set terms, snapshot purchases."
        actions={
          <>
            <Link to="/admin/purchases"><Button variant="outline">Purchase Records</Button></Link>
            <Button className="bg-gradient-primary font-bold uppercase tracking-wide" onClick={() => setEditing(blankOffer())}>
              <Plus className="mr-2 h-4 w-4" /> New offer
            </Button>
          </>
        }
      />
      <div className="p-6 md:p-8 space-y-8">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Start from a template</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {OFFER_TEMPLATES.map((t) => (
              <Card key={t.name} className="border-border bg-card p-4 space-y-2">
                <div className="text-sm font-bold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.offer_type}</div>
                <Button size="sm" variant="outline" className="w-full" onClick={() => createFromTemplate(t)}>
                  <Plus className="mr-1.5 h-3 w-3" /> Use template
                </Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Your offers</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {offers.length === 0 && (
              <div className="col-span-full rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No offers yet. Pick a template above or create one from scratch.
              </div>
            )}
            {offers.map((o: any) => (
              <Card key={o.id} className="border-border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.offer_type} · v{o.version ?? 1}</div>
                  </div>
                  <Badge variant={o.status === "Active" ? "default" : "outline"} className={o.status === "Active" ? "bg-gradient-primary" : ""}>{o.status}</Badge>
                </div>
                {(o.full_payable_amount ?? o.price) != null && (
                  <div className="text-2xl font-black">{o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price).toLocaleString()}</div>
                )}
                {o.payment_structure && <div className="text-xs text-muted-foreground">{o.payment_structure}</div>}
                {o.short_description && <p className="text-sm text-muted-foreground line-clamp-2">{o.short_description}</p>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setAssigning(o)}>Assign to client</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(o)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(o)}><Copy className="h-3 w-3" /></Button>
                  {o.stripe_payment_link && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copy(o.stripe_payment_link!)} title="Copy Stripe link"><Copy className="h-3 w-3" /></Button>
                      <a href={o.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></a>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => del(o.id)}><Archive className="h-3 w-3" /></Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{(editing as any)?.id ? "Edit offer" : "New offer"}</DialogTitle></DialogHeader>
          {editing && <OfferForm initial={editing} onSubmit={save} />}
        </DialogContent>
      </Dialog>

      <AssignOfferDialog offer={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}