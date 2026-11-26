import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { AccessLogView } from "@/components/pov/pov-access-log";
import { useAuth } from "@/lib/auth";

/**
 * Account access (admin only): every View as, who opened which account, their role, when and for
 * how long, how it ended, the changes made with their before and after values, writes stopped
 * while view-only, and every refused attempt. The database answers the admin only
 * (admin_access_log); anyone else sees nothing here.
 */
export const Route = createFileRoute("/_authenticated/admin/access-log")({ component: AccessLogPage });

function AccessLogPage() {
  const { role, loading } = useAuth() as { role: string | null; loading?: boolean };
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10" data-access-log-page>
      <PageHeader
        title="Account access"
        subtitle="Every View as and every refused attempt, kept automatically and never editable."
        backTo="/admin/team"
      />
      {loading ? null : role !== "admin" ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Only the admin can see the account access record.</p>
      ) : (
        <AccessLogView />
      )}
    </div>
  );
}
