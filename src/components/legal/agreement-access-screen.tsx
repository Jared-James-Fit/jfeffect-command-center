import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardSplash } from "@/components/dashboard-splash";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** A focused, safe-area aware account-setup screen, with no portal navigation. */
export function AgreementAccessScreen({ title, description, checking, retry, children }: {
  title?: string; description?: string; checking?: boolean; retry?: () => void; children?: ReactNode;
}) {
  if (checking) return <DashboardSplash onRetry={retry} />;
  return (
    <main className="min-h-[100dvh] bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><ShieldCheck className="h-5 w-5" /> JF Effect · Account setup</div>
        <h1 className="text-2xl font-bold tracking-tight">{title ?? "Couldn't verify your agreements"}</h1>
        <p className="text-sm text-muted-foreground">{description ?? "Your account is protected. Try again or contact support."}</p>
        {retry && <Button className="w-full" onClick={retry}>Try again</Button>}
        {children}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <a href="mailto:support@jfeffect.com" className="text-sm underline text-muted-foreground">Contact support</a>
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
