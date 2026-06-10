import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, MessageCircle } from "lucide-react";

export function UpgradeToCoachingPrompt({
  feature = "This feature",
  upgradeTo = "/m/upgrade",
  supportTo = "/m/account",
}: {
  feature?: string;
  upgradeTo?: string;
  supportTo?: string;
}) {
  return (
    <Card className="border-border bg-card p-8 text-center max-w-lg mx-auto my-10">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-bold mb-1">{feature} is available with coaching</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Your JF Membership covers self-guided programs, recipes, resources and the community.
        1:1 coaching, custom programming and lift feedback unlock with a coaching plan.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to={upgradeTo as any}>
          <Button className="bg-gradient-primary font-bold uppercase">
            <Sparkles className="mr-2 h-4 w-4" /> Upgrade to Coaching
          </Button>
        </Link>
        <Link to={supportTo as any}>
          <Button variant="outline"><MessageCircle className="mr-2 h-4 w-4" /> Message Support</Button>
        </Link>
      </div>
    </Card>
  );
}