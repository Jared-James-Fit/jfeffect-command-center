import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { redeemStaffInvite } from "@/lib/media-manager.functions";

export const Route = createFileRoute("/staff-setup")({
  validateSearch: (s: Record<string, unknown>) => ({ token: String(s.token ?? "") }),
  component: StaffSetupPage,
});

function StaffSetupPage() {
  const { token } = Route.useSearch();
  const redeem = useServerFn(redeemStaffInvite);
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) return toast.error("Password must be 8+ characters");
    setBusy(true);
    try {
      await redeem({ data: { token, password } });
      toast.success("Account ready — please sign in");
      navigate({ to: "/auth", replace: true });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-black">Set up your account</h1>
        <p className="text-sm text-muted-foreground">Create a password to activate your Media Manager account.</p>
        {!token && <p className="text-sm text-destructive">Missing or invalid setup link.</p>}
        {token && (
          <>
            <Input type="password" placeholder="New password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button onClick={submit} disabled={busy} className="w-full">{busy ? "Setting up…" : "Activate account"}</Button>
          </>
        )}
      </Card>
    </div>
  );
}