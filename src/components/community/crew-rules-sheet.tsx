import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { feedback } from "@/lib/feedback";
import {
  CREW_CONTACT_EMAIL,
  CREW_RULES,
  CREW_TERMS_SLUG,
  acceptCrewRules,
  answerCrewRules,
  crewModerationKey,
  useCrewModeration,
  useCrewRulesAsk,
} from "@/lib/crew-safety";

/**
 * The one-time Community rules, asked the first time someone posts or
 * comments in Crew (the server refuses with `crew_rules` until they agree;
 * `withCrewRules` opens this and sends the post again on Agree). Mounted once
 * in the app shell. Agree is stored on the server (community_accept_rules).
 */
export function CrewRulesHost() {
  const open = useCrewRulesAsk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const agree = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await acceptCrewRules();
      feedback("tap");
      void qc.invalidateQueries({ queryKey: crewModerationKey });
      answerCrewRules(true);
    } catch {
      toast.error("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && answerCrewRules(false)}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="mx-auto max-h-[88dvh] max-w-lg gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),12px)]"
        data-crew-rules
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="px-5 pb-2 pt-4">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <SheetTitle className="mt-3 text-[20px] font-bold">Crew community rules</SheetTitle>
          <SheetDescription className="mt-1 text-[14px] leading-snug text-muted-foreground">
            Crew is a place to train and cheer each other on. Before your first post or comment, agree to keep it that way.
          </SheetDescription>
        </div>
        <ul className="space-y-3 px-5 py-3">
          {CREW_RULES.map((r) => (
            <li key={r.title}>
              <span className="block text-[15px] font-semibold">{r.title}</span>
              <span className="block text-[14px] leading-snug text-muted-foreground">{r.body}</span>
            </li>
          ))}
        </ul>
        <p className="px-5 text-[13px] leading-snug text-muted-foreground">
          Part of the{" "}
          <Link to="/legal/$slug" params={{ slug: CREW_TERMS_SLUG }} className="font-semibold text-foreground underline" onClick={() => answerCrewRules(false)}>
            Terms of Service
          </Link>
          . Questions or something urgent:{" "}
          <a href={`mailto:${CREW_CONTACT_EMAIL}`} className="font-semibold text-foreground underline">
            {CREW_CONTACT_EMAIL}
          </a>
          .
        </p>
        <div className="grid gap-2 px-5 pb-2 pt-4">
          <Button className="h-12 w-full text-[15px]" onClick={() => void agree()} disabled={busy} data-crew-rules-agree>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "I agree"}
          </Button>
          <Button variant="ghost" className="h-11 w-full" onClick={() => answerCrewRules(false)} disabled={busy}>
            Not now
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A warning from the team (Crew → Manage → Warn), shown once the next time
 * this person opens Crew, with the rules; Got it marks it seen
 * (community_ack_warning). A posting pause is said alongside it.
 */
export function CrewWarningNotice() {
  const qc = useQueryClient();
  const { data } = useCrewModeration();
  const [seen, setSeen] = useState(false);
  const warning = data?.warning;
  if (!warning || seen) return null;
  const paused = data?.posting_paused_until;
  const ack = () => {
    setSeen(true);
    void (supabase as any)
      .rpc("community_ack_warning")
      .then(() => qc.invalidateQueries({ queryKey: crewModerationKey }));
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && ack()}>
      <AlertDialogContent data-crew-warning>
        <AlertDialogHeader>
          <AlertDialogTitle>A note from the JF Effect team</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>Something you posted in Crew went against the community rules{warning.note ? ":" : "."}</p>
              {warning.note && <p className="font-medium text-foreground">“{warning.note}”</p>}
              {paused && (
                <p>
                  Posting, comments and message requests are paused on your account until{" "}
                  {new Date(paused).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
                </p>
              )}
              <p>
                Crew has zero tolerance for hate, harassment, threats or sexual content. Questions:{" "}
                <a href={`mailto:${CREW_CONTACT_EMAIL}`} className="underline">{CREW_CONTACT_EMAIL}</a>
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={ack}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
