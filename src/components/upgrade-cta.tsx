import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles } from "lucide-react";

type Props = {
  title?: string;
  subtitle?: string;
  inline?: boolean;
  perks?: string[];
};

export function UpgradeCTA({
  title = "Unlock the full app",
  subtitle = "Upgrade your membership to access this content.",
  inline = false,
  perks,
}: Props) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4 text-amber-500" />
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground hidden sm:inline">— {subtitle}</span>
        </div>
        <Link to="/m/upgrade"><Button size="sm">Upgrade</Button></Link>
      </div>
    );
  }
  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
          {perks && perks.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {perks.map((p) => <li key={p} className="flex items-center gap-2">✓ <span>{p}</span></li>)}
            </ul>
          )}
          <Link to="/m/upgrade" className="mt-4 inline-block">
            <Button>See plans & upgrade</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}