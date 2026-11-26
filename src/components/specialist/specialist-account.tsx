/**
 * A specialist's own account: their profile, their two-step sign-in, and
 * sign out. Nothing else lives here.
 */
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { TwoStepCard } from "@/components/two-step/two-step-card";
import { useSpecialist } from "./specialist-context";
import { SpecialistSetup } from "./specialist-setup";

export function SpecialistAccount() {
  const { me, refresh } = useSpecialist();
  const { signOut, user } = useAuth();
  if (!me) return null;
  return (
    <div className="space-y-6">
      <Link
        to={"/specialist" as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Your account</h1>
        <p className="text-sm text-muted-foreground">
          {me.title} · {user?.email}
        </p>
      </div>
      <SpecialistSetup me={me} onDone={refresh} />
      <TwoStepCard />
      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}
