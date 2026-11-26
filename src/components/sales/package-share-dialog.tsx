import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getPublicPackages } from "@/lib/coaching-packages/packages.functions";
import { listedPackages, packageComparisonLink, priceText, selectedPublicSlugs } from "@/lib/coaching-packages/packages";

export function PackageShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const read = useServerFn(getPublicPackages);
  const q = useQuery({ queryKey: ["public-package-share"], queryFn: () => read(), enabled: open, staleTime: 15_000 });
  const [picked, setPicked] = useState<string[] | null>(null);
  const packages = listedPackages(q.data ?? []);
  const selected = selectedPublicSlugs(packages, picked ?? packages.filter(p => p.kind === "subscription").map(p => p.slug));
  const href = packageComparisonLink(selected);
  const toggle = (slug: string) => {
    if (selected.includes(slug)) setPicked(selected.filter(s => s !== slug));
    else if (selected.length < 4) setPicked([...selected, slug]);
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Packages link copied"); }
    catch { toast.error("Couldn't copy the link. Open the comparison and share its address."); }
  };
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setPicked(null); onOpenChange(v); }}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Services &amp; packages</DialogTitle>
          <DialogDescription>Pick up to four public packages to compare or share. Prices update with the public catalogue.</DialogDescription>
        </DialogHeader>
        {q.isPending ? <p className="py-4 text-sm text-muted-foreground">Loading packages…</p> : !packages.length ? (
          <div className="space-y-2"><p className="text-sm text-muted-foreground">No public options could be loaded.</p><Button variant="outline" onClick={() => void q.refetch()}>Try again</Button></div>
        ) : (
          <div className="space-y-2">
            {packages.map(p => <label key={p.slug} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border p-3">
              <Checkbox checked={selected.includes(p.slug)} disabled={selected.length >= 4 && !selected.includes(p.slug)} onCheckedChange={() => toggle(p.slug)} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{priceText(p)}</span></span>
            </label>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button asChild={selected.length > 0} disabled={!selected.length}>
            {selected.length ? <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Present</a> : <span>Present</span>}
          </Button>
          <Button variant="outline" disabled={!selected.length} onClick={() => void copy(href)}><Copy className="mr-1.5 h-4 w-4" /> Copy link</Button>
        </div>
        <Button asChild variant="ghost" className="w-full"><a href={packageComparisonLink()} target="_blank" rel="noopener noreferrer">Open all public packages</a></Button>
      </DialogContent>
    </Dialog>
  );
}

export function PackageShareButton() {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className="shrink-0" onClick={() => setOpen(true)}>Packages</Button><PackageShareDialog open={open} onOpenChange={setOpen} /></>;
}
