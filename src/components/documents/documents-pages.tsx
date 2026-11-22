/**
 * Where the documents library lives:
 *   MyDocumentsPage       /portal/documents (Account → Documents): a member's or
 *                         client's own, plus what their coach shared with them
 *   StaffDocumentsPage    /admin/documents: a staff member's own (always private)
 *   ClientDocumentsPanel  a client's Documents tab: what the coach files for them
 *                         and what they share with their coach
 */
import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { DocumentsLibrary } from "./documents-library";

export function MyDocumentsPage() {
  const { user } = useAuth();
  const portalUserId = usePortalUserId();
  const { isImpersonating, client: viewed } = useClientImpersonation();
  const { clientId, tier, loading } = useServiceTier();
  const ownClientId = isImpersonating ? (viewed?.id ?? null) : clientId;

  return (
    <div className="pb-8">
      <PageHeader title="Documents" backTo="/portal/account" />
      <div className="mx-auto max-w-2xl px-4 py-3 md:px-8">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : !portalUserId ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Their documents show here once they've set up their login.
          </p>
        ) : (
          <DocumentsLibrary
            target={{ scope: "self", userId: portalUserId, clientId: ownClientId }}
            scope="self"
            userId={user?.id}
            viewerId={portalUserId}
            hasCoach={tier === "coaching"}
            preview={isImpersonating}
          />
        )}
      </div>
    </div>
  );
}

export function StaffDocumentsPage() {
  const { user } = useAuth();
  return (
    <div className="pb-8">
      <PageHeader title="Documents" />
      <div className="mx-auto max-w-2xl px-4 py-3 md:px-8">
        {user?.id ? (
          <DocumentsLibrary
            target={{ scope: "staff", userId: user.id }}
            scope="staff"
            userId={user.id}
          />
        ) : (
          <Skeleton className="h-16 w-full rounded-xl" />
        )}
      </div>
    </div>
  );
}

/** A client's documents on their profile (the coach's view; what the client keeps private never shows). */
export function ClientDocumentsPanel({
  clientId,
  clientName,
  clientUserId,
  className,
}: {
  clientId: string;
  clientName?: string | null;
  clientUserId?: string | null;
  className?: string;
}) {
  const { user } = useAuth();
  const first = (clientName ?? "").trim().split(/\s+/)[0] || null;
  return (
    <Card className={className ? `p-4 md:p-5 ${className}` : "p-4 md:p-5"} data-client-documents>
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold">Documents</h2>
      </div>
      <DocumentsLibrary
        target={{ scope: "client", clientId }}
        scope="client"
        userId={user?.id}
        clientFirstName={first}
        clientUserId={clientUserId ?? null}
      />
    </Card>
  );
}
