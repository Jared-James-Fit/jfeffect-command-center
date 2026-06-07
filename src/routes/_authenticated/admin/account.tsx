import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ChangePasswordCard } from "@/components/change-password-card";
import { UserCog } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/account")({
  component: AdminAccountPage,
});

function AdminAccountPage() {
  const { user, role } = useAuth();
  if (!user) return <div className="p-10 text-muted-foreground">Sign in to manage your account.</div>;

  return (
    <>
      <PageHeader title="My Account" subtitle="Manage your sign-in credentials." />
      <div className="grid gap-6 p-6 md:p-8">
        <Card className="border-border bg-card p-6 space-y-2">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" />
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Signed in as</h3>
          </div>
          <div className="text-sm font-semibold">{user.email}</div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Role: {role ?? "—"}</div>
        </Card>

        <ChangePasswordCard />
      </div>
    </>
  );
}