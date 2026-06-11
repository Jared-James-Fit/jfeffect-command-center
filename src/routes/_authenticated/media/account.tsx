import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/media/account")({
  component: AccountPage,
});

function AccountPage() {
  const { user, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-black">Account</h1>
      <Card className="p-4 space-y-2">
        <div className="text-sm"><span className="font-medium">Email:</span> {user?.email}</div>
        <div className="text-sm"><span className="font-medium">Role:</span> Media Manager</div>
      </Card>
      <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}