import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = ["account"] as const;
type Tab = typeof TABS[number];

export const Route = createFileRoute("/_authenticated/media/settings")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
  component: SettingsWorkspace,
});

function SettingsWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: Tab = tab ?? "account";
  const { user, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and personal preferences.</p>
      </header>
      <Tabs value={active} onValueChange={(v) => navigate({ to: "/media/settings", search: { tab: v as Tab }, replace: true })}>
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="account" className="mt-4 space-y-3">
          <Card className="p-4 space-y-2">
            <div className="text-sm"><span className="font-medium">Email:</span> {user?.email}</div>
            <div className="text-sm"><span className="font-medium">Role:</span> Media Manager</div>
          </Card>
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}