import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildFilloutUrl } from "@/lib/fillout";
import { getOrCreateCurrentSubmission, type NfForm } from "@/lib/native-forms";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

export type ExternalFormClient = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

/**
 * True when a form should open in a real browser tab instead of an in-app
 * sheet — i.e. it is provider-hosted (Fillout et al.) with a usable URL.
 */
export function isExternalForm(form: Pick<NfForm, "kind" | "external_url"> | null | undefined): boolean {
  return !!form && form.kind === "external" && !!form.external_url;
}

/**
 * Resolves the exact, client-tagged external URL for a form. Keeps the same
 * submission/assignment metadata the embedded view used, so tracking and
 * submission association are unchanged.
 */
export async function resolveExternalFormUrl(
  form: NfForm,
  client: ExternalFormClient,
): Promise<string> {
  const base = form.external_url as string | null;
  if (!base) return "";
  if (form.requires_client_identity === false) return base;

  let assignmentId: string | null = null;
  let periodStart: string | null = null;
  try {
    const [{ data: assignment }, submission] = await Promise.all([
      supabase
        .from("nf_assignments")
        .select("id")
        .eq("form_id", form.id)
        .eq("client_id", client.id)
        .maybeSingle(),
      getOrCreateCurrentSubmission(form, client.id).catch(() => null),
    ]);
    assignmentId = (assignment as any)?.id ?? null;
    periodStart = (submission as any)?.period_start ?? null;
  } catch {
    /* identity params are best-effort; never block opening the form */
  }

  return buildFilloutUrl(base, client, {
    assignmentId,
    formId: form.id,
    periodStart,
  });
}

/**
 * Opens external forms in a real browser tab from a user gesture. The blank
 * tab is opened synchronously (so iOS/PWA does not block it) and its location
 * is set once the client-tagged URL resolves. If the tab is blocked we surface
 * a one-tap "Open form" fallback link.
 */
export function useExternalFormOpener() {
  const [fallback, setFallback] = useState<{ url: string; title: string } | null>(null);
  const busy = useRef(false);

  const openExternalForm = useCallback(
    (form: NfForm, client: ExternalFormClient, title?: string) => {
      if (busy.current) return;
      busy.current = true;
      // Must happen synchronously inside the tap handler.
      const win = window.open("about:blank", "_blank");
      if (win) {
        try {
          win.opener = null;
        } catch {
          /* noop */
        }
      }
      resolveExternalFormUrl(form, client)
        .then((url) => {
          const target = url || (form.external_url ?? "");
          if (!target) {
            win?.close();
            return;
          }
          if (win && !win.closed) win.location.replace(target);
          else setFallback({ url: target, title: title || form.title || "Form" });
        })
        .catch(() => {
          win?.close();
          const target = form.external_url ?? "";
          if (target) setFallback({ url: target, title: title || form.title || "Form" });
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [],
  );

  const fallbackDialog = (
    <Dialog open={!!fallback} onOpenChange={(v) => { if (!v) setFallback(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-black uppercase tracking-widest">
            {fallback?.title ?? "Form"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your browser blocked the new tab. Tap below to open the form.
        </p>
        <Button asChild className="w-full bg-gradient-primary font-bold">
          <a href={fallback?.url} target="_blank" rel="noopener noreferrer" onClick={() => setFallback(null)}>
            <ExternalLink className="mr-1.5 h-4 w-4" /> Open form
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  );

  return { openExternalForm, fallbackDialog };
}
