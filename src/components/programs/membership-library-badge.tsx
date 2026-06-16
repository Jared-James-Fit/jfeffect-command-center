import { Badge } from "@/components/ui/badge";
import { Radio } from "lucide-react";
import type { DestinationSummary } from "@/lib/programs/sharing";

/**
 * Membership Library status badge for program template cards.
 * Shows only when the program is published to the membership library
 * (pl_template_shares destination = "membership" AND status = "shared").
 */
export function MembershipLibraryBadge({
  summary,
}: {
  summary: DestinationSummary;
}) {
  if (!summary.membershipPublished) {
    return null;
  }

  return (
    <Badge variant="default" className="gap-1">
      <Radio className="h-3 w-3" />
      Membership Live
    </Badge>
  );
}
