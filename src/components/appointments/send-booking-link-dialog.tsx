import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBookingLinks } from "@/lib/booking-links.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Copy, Send, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const SITE_ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://jfeffect.com";

export function SendBookingLinkDialog({
  open, onOpenChange, defaultPhone, defaultEmail,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultPhone?: string | null;
  defaultEmail?: string | null;
}) {
  const list = useServerFn(listBookingLinks);
  const { data = [], isLoading } = useQuery({
    queryKey: ["booking-links-quick"],
    queryFn: () => list(),
    enabled: open,
  });
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");

  function urlFor(slug: string) { return `${SITE_ORIGIN}/book/${slug}`; }
  function copy(slug: string) {
    navigator.clipboard.writeText(urlFor(slug));
    toast.success("Link copied");
  }
  function smsLink(slug: string) {
    const body = `Book a time with us: ${urlFor(slug)}`;
    return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(body)}`;
  }
  function mailLink(slug: string) {
    const body = `Pick a time that works for you: ${urlFor(slug)}`;
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Book a time")}&body=${encodeURIComponent(body)}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Send a booking link</DialogTitle></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Phone (for SMS)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {isLoading ? <div className="text-xs text-muted-foreground">Loading…</div>
            : data.length === 0 ? <div className="text-xs text-muted-foreground">No booking links yet. Create one in Booking Links.</div>
            : data.filter((l: any) => l.active).map((l: any) => (
              <Card key={l.id} className="p-3 border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{l.duration_minutes}m · {l.appointment_type}</div>
                    <div className="text-[11px] text-primary truncate">{urlFor(l.slug)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">{l.host_coach?.full_name ?? "Coach"}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => copy(l.slug)} className="h-7 text-xs"><Copy className="mr-1 h-3 w-3" /> Copy</Button>
                  <a href={urlFor(l.slug)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="h-7 text-xs"><ExternalLink className="mr-1 h-3 w-3" /> Open</Button></a>
                  {phone && <a href={smsLink(l.slug)}><Button size="sm" variant="outline" className="h-7 text-xs"><Send className="mr-1 h-3 w-3" /> SMS</Button></a>}
                  {email && <a href={mailLink(l.slug)}><Button size="sm" variant="outline" className="h-7 text-xs"><Send className="mr-1 h-3 w-3" /> Email</Button></a>}
                </div>
              </Card>
            ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}