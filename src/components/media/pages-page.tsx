import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaHeader } from "@/components/media/media-header";
import {
  Copy, ExternalLink, MessageSquare, Mail, Link2, Plus, Trash2,
} from "lucide-react";

const PAGE_TYPES = [
  "coaching_sales_page", "membership_page", "lead_magnet",
  "application_page", "checkout", "booking_page", "other",
] as const;
type PageType = typeof PAGE_TYPES[number];
const PAGE_TYPE_LABEL: Record<PageType, string> = {
  coaching_sales_page: "Coaching Sales Page",
  membership_page: "Membership Page",
  lead_magnet: "Lead Magnet",
  application_page: "Application Page",
  checkout: "Checkout",
  booking_page: "Booking Page",
  other: "Other",
};
const STATUS = ["draft", "live", "paused", "archived"] as const;

type MediaPage = {
  id: string;
  name: string;
  url: string;
  page_type: PageType;
  campaign_id: string | null;
  offer: string | null;
  owner_id: string | null;
  status: string;
  notes: string | null;
  last_reviewed_at: string | null;
  created_at: string;
};

export function PagesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pages" | "links" | "utm">("pages");
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: pages, isLoading } = useQuery({
    queryKey: ["media_pages"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("media_pages") as any)
        .select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as MediaPage[];
    },
  });

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Pages & Promo Links"
        description="Sales pages, booking links, lead magnets, and trackable URLs."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />Add page
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mb-4">
        <TabsList>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="links">Quick promo links</TabsTrigger>
          <TabsTrigger value="utm">UTM builder</TabsTrigger>
        </TabsList>

        <TabsContent value="pages" className="mt-4">
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
            </div>
          ) : !pages?.length ? (
            <Card className="p-10 text-center text-muted-foreground">
              <Link2 className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p className="mb-3">No pages tracked yet.</p>
              <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add page</Button>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pages.map((p) => <PageCard key={p.id} page={p} onOpen={() => setOpenId(p.id)} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <QuickPromoLinks />
        </TabsContent>

        <TabsContent value="utm" className="mt-4">
          <UtmBuilder pages={pages || []} />
        </TabsContent>
      </Tabs>

      <NewPageDialog open={createOpen} onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["media_pages"] })} />

      <PageDrawer id={openId} onClose={() => setOpenId(null)}
        onMutated={() => qc.invalidateQueries({ queryKey: ["media_pages"] })} />
    </div>
  );
}

function PageCard({ page, onOpen }: { page: MediaPage; onOpen: () => void }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <button onClick={onOpen} className="line-clamp-2 text-left font-semibold hover:underline">{page.name}</button>
        <Badge variant="outline">{PAGE_TYPE_LABEL[page.page_type] || page.page_type}</Badge>
      </div>
      <a href={page.url} target="_blank" rel="noreferrer" className="line-clamp-1 break-all text-xs text-primary underline">
        {page.url}
      </a>
      {page.offer && <div className="mt-2 text-xs text-muted-foreground">Offer: {page.offer}</div>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <LinkActions url={page.url} name={page.name} />
      </div>
    </Card>
  );
}

export function LinkActions({ url, name }: { url: string; name?: string }) {
  const safeUrl = url || "";
  const promoMsg = `${name ? name + " — " : ""}${safeUrl}`;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(safeUrl); toast.success("Link copied"); }}>
        <Copy className="mr-1.5 h-3.5 w-3.5" />Copy Link
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={safeUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open</a>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={`sms:&body=${encodeURIComponent(promoMsg)}`}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />SMS</a>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={`mailto:?subject=${encodeURIComponent(name || "Link")}&body=${encodeURIComponent(promoMsg)}`}>
          <Mail className="mr-1.5 h-3.5 w-3.5" />Email
        </a>
      </Button>
      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(safeUrl); toast.success("IG bio link copied"); }}>
        Copy IG Bio
      </Button>
      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(promoMsg); toast.success("Promo message copied"); }}>
        Copy Promo Message
      </Button>
    </>
  );
}

function QuickPromoLinks() {
  // Preserve legacy coaching/membership/join promo entries.
  const presets = [
    { name: "Coaching Sales Page", url: "https://jfeffect.com/coaching" },
    { name: "Membership", url: "https://jfeffect.com/membership" },
    { name: "Join", url: "https://jfeffect.com/join" },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Built-in short links that mirror your existing sales pages.</p>
      {presets.map((p) => (
        <Card key={p.url} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">{p.name}</div>
              <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{p.url}</a>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <LinkActions url={p.url} name={p.name} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function UtmBuilder({ pages }: { pages: MediaPage[] }) {
  const [base, setBase] = useState("");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");

  const built = useMemo(() => {
    if (!base.trim()) return "";
    let url: URL;
    try { url = new URL(base.trim()); } catch { return "Invalid URL"; }
    const add = (k: string, v: string) => v.trim() && url.searchParams.set(k, v.trim());
    add("utm_source", source); add("utm_medium", medium);
    add("utm_campaign", campaign); add("utm_content", content); add("utm_term", term);
    return url.toString();
  }, [base, source, medium, campaign, content, term]);

  return (
    <Card className="p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Destination URL</Label>
          <div className="flex gap-2">
            <Input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://jfeffect.com/coaching" />
            {pages.length > 0 && (
              <Select onValueChange={(v) => setBase(v)}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Or pick page" /></SelectTrigger>
                <SelectContent>
                  {pages.map((p) => <SelectItem key={p.id} value={p.url}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <Labeled label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="instagram" /></Labeled>
        <Labeled label="Medium"><Input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="social" /></Labeled>
        <Labeled label="Campaign"><Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="summer-launch" /></Labeled>
        <Labeled label="Content"><Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="reel-1" /></Labeled>
        <Labeled label="Term"><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="optional" /></Labeled>
      </div>
      <div className="mt-4">
        <Label>Tracked URL</Label>
        <div className="flex gap-2">
          <Input readOnly value={built} className="font-mono text-xs" />
          <Button disabled={!built || built === "Invalid URL"} onClick={() => { navigator.clipboard.writeText(built); toast.success("Tracked URL copied"); }}>
            <Copy className="mr-1.5 h-4 w-4" />Copy
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

function NewPageDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (b: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pageType, setPageType] = useState<PageType>("coaching_sales_page");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim() || !url.trim()) return toast.error("Name and URL required");
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase.from("media_pages") as any).insert({
      name: name.trim(), url: url.trim(), page_type: pageType, status: "live",
      created_by: u.user?.id, owner_id: u.user?.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Page added"); onOpenChange(false);
    setName(""); setUrl(""); onCreated();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add page</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Labeled label="Page name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Labeled>
          <Labeled label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Labeled>
          <Labeled label="Page type">
            <Select value={pageType} onValueChange={(v) => setPageType(v as PageType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_TYPES.map((t) => <SelectItem key={t} value={t}>{PAGE_TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageDrawer({
  id, onClose, onMutated,
}: { id: string | null; onClose: () => void; onMutated: () => void }) {
  const { data: p } = useQuery({
    queryKey: ["media_page", id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await (supabase.from("media_pages") as any).select("*").eq("id", id).maybeSingle();
      return data as MediaPage | null;
    },
    enabled: !!id,
  });
  const [local, setLocal] = useState<MediaPage | null>(null);
  if (p && (!local || local.id !== p.id)) setLocal(p);

  async function save() {
    if (!local || !id) return;
    const { error } = await (supabase.from("media_pages") as any).update({
      name: local.name, url: local.url, page_type: local.page_type, offer: local.offer,
      status: local.status, notes: local.notes,
      last_reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved"); onMutated();
  }
  async function remove() {
    if (!id) return;
    if (!confirm("Delete this page?")) return;
    const { error } = await (supabase.from("media_pages") as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); onMutated(); onClose();
  }
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {!local ? <Skeleton className="h-40" /> : (
          <>
            <SheetHeader><SheetTitle>{local.name}</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-3">
              <Labeled label="Name"><Input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} /></Labeled>
              <Labeled label="URL"><Input value={local.url} onChange={(e) => setLocal({ ...local, url: e.target.value })} /></Labeled>
              <Labeled label="Page type">
                <Select value={local.page_type} onValueChange={(v) => setLocal({ ...local, page_type: v as PageType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_TYPES.map((t) => <SelectItem key={t} value={t}>{PAGE_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </Labeled>
              <Labeled label="Status">
                <Select value={local.status} onValueChange={(v) => setLocal({ ...local, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Labeled>
              <Labeled label="Offer"><Input value={local.offer ?? ""} onChange={(e) => setLocal({ ...local, offer: e.target.value })} /></Labeled>
              <Labeled label="Notes"><Textarea rows={4} value={local.notes ?? ""} onChange={(e) => setLocal({ ...local, notes: e.target.value })} /></Labeled>
              <div className="flex flex-wrap gap-1.5"><LinkActions url={local.url} name={local.name} /></div>
              <div className="flex justify-between pt-2">
                <Button variant="destructive" size="sm" onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>
                <Button onClick={save}>Save</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}