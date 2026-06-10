import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, Mail, MessageCircle, ExternalLink, Instagram, FileText } from "lucide-react";
import { toast } from "sonner";

const PUBLIC_DOMAIN = "https://jfeffect.com";

export function publicSalesUrl(slug: "join" | "coaching") {
  return `${PUBLIC_DOMAIN}/${slug}`;
}

export function ShareToolbar({
  slug, promoMessage,
}: {
  slug: "join" | "coaching";
  promoMessage?: string | null;
}) {
  const url = publicSalesUrl(slug);
  const display = `jfeffect.com/${slug}`;
  const subject = slug === "coaching" ? "Apply for JF Effect Coaching" : "Join JF Membership";
  const body = promoMessage || (slug === "coaching"
    ? `Apply for JF Effect Coaching here: ${url}`
    : `Join JF Membership here: ${url}`);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Public link</div>
        <code className="rounded bg-muted px-2 py-1 text-xs">{display}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(url, "Public link")}>
          <Copy className="mr-1 h-3 w-3" />Copy link
        </Button>
        <a href={`/${slug}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3 w-3" />Open live page</Button>
        </a>
        <a href={`sms:?&body=${encodeURIComponent(body)}`}>
          <Button size="sm" variant="outline"><MessageCircle className="mr-1 h-3 w-3" />SMS</Button>
        </a>
        <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
          <Button size="sm" variant="outline"><Mail className="mr-1 h-3 w-3" />Email</Button>
        </a>
        <Button size="sm" variant="outline" onClick={() => copy(url, "IG bio link")}>
          <Instagram className="mr-1 h-3 w-3" />Copy IG bio link
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(body, "Promo message")}>
          <FileText className="mr-1 h-3 w-3" />Copy promo message
        </Button>
      </div>
    </Card>
  );
}