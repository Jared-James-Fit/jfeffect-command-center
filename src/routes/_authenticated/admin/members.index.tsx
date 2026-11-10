import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { MembersDirectory, NewMemberButton } from "@/components/members/members-directory";
import { useAuth } from "@/lib/auth";
import { RecentlyDeletedRow } from "@/components/account/recently-deleted";

export const Route = createFileRoute("/_authenticated/admin/members/")({ component: MembersList });

/** App members: the same list as Clients › Members (search, filters, View as, test member). */
function MembersList() {
  const { viewOnly } = useAuth();
  return (
    <div className="space-y-3">
      <PageHeader
        title="Members"
        subtitle="Subscription and program-only members. Separate from coaching clients."
        actions={viewOnly ? undefined : <NewMemberButton />}
      />
      <div className="space-y-3 p-3 sm:p-4 md:p-6">
        <MembersDirectory returnTo="/admin/members" />
        <RecentlyDeletedRow />
      </div>
    </div>
  );
}
