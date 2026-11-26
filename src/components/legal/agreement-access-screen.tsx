import { ShieldCheck, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** A focused, safe-area aware account-setup screen, with no portal navigation. */
export function AgreementAccessScreen({ title, description, checking, retry, children }: {
  title?: string; description?: string; checking?: boolean; retry?: () => void; children?: ReactNode;
}) {
  return (
    <main className="min-h-[100dvh] bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><ShieldCheck className="h-5 w-5" /> JF Effect · Account setup</div>
        <h1 className="text-2xl font-bold tracking-tight">{title ?? (checking ? "Checking your agreements" : "Couldn't verify your agreements")}</h1>
        <p className="text-sm text-muted-foreground">{description ?? (checking ? "Just checking your account before continuing." : "Your account is protected. Try again or contact support.")}</p>
        {checking && <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Checking agreements" />}
        {!checking && retry && <Button className="w-full" onClick={retry}>Try again</Button>}
        {children}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <a href="mailto:support@jfeffect.com" className="text-sm underline text-muted-foreground">Contact support</a>
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
