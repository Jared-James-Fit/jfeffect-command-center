import { Badge } from "@/components/ui/badge";
import { Library, XCircle } from "lucide-react";
import type { DestinationSummary } from "@/lib/programs/sharing";

/**
 * Dedicated Membership Library status badge for program template cards.
 * Always visible so admins can immediately see whether a program is published.
 */
export function MembershipLibraryBadge({
  summary,
}: {
  summary: DestinationSummary;
}) {
  if (summary.membershipPublished) {
    const { version, hasUpdate } = summary.membershipPublished;
    return (
      <Badge variant="default" className="gap-1 text-[10px]">
        <Library className="h-3 w-3" />
        In Membership Library
        {version != null && <span className="opacity-80">v{version}</span>}
        {hasUpdate && <span className="opacity-80">· update available</span>}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
      <LibraryX className="h-3 w-3" />
      Not in Membership Library
    </Badge>
  );
}
