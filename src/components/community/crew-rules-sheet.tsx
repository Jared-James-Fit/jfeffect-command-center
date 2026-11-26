import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CREW_CONTACT_EMAIL, CREW_RULES, CREW_TERMS_SLUG, crewModerationKey, useCrewModeration } from "@/lib/crew-safety";

/**
 * The Crew community guidelines, in the words every screen shows: the public
 * page (/community-guidelines, linked from sign-up's box), Settings, Help and
 * Terms 8.1. They're agreed to once, with the Terms, when the account is made;
 * nothing asks for them in the middle of a comment or a post (Nov 26 2026,
 * 20270531100000_crew_guidelines_at_signup.sql).
 */
export function CrewGuidelines({ className, tone = "default", onLeave }: { className?: string; tone?: "default" | "page"; onLeave?: () => void }) {
  return (
    <div className={className} data-crew-guidelines>
      <ul className="space-y-3.5">
        {CREW_RULES.map((r) => (
          <li key={r.title}>
            <span className={cn("block font-semibold", tone === "page" ? "text-[17px]" : "text-[15px]")}>{r.title}</span>
            <span className={cn("block leading-snug text-muted-foreground", tone === "page" ? "text-[15px]" : "text-[14px]")}>{r.body}</span>
          </li>
        ))}
      </ul>
      <p className={cn("mt-4 leading-snug text-muted-foreground", tone === "page" ? "text-[15px]" : "text-[13px]")}>
        Part of the{" "}
        <Link to="/legal/$slug" params={{ slug: CREW_TERMS_SLUG }} className="font-semibold text-foreground underline underline-offset-2" onClick={onLeave}>
          Terms of Service
        </Link>
        , agreed to when you made your account. Questions or something urgent:{" "}
        <a href={`mailto:${CREW_CONTACT_EMAIL}`} className="font-semibold text-foreground underline underline-offset-2">
          {CREW_CONTACT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}

/** The guidelines in a sheet, from Settings (Account, Crew's privacy settings). Read-only: nothing to agree to here. */
export function CrewGuidelinesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className="mx-auto max-h-[88dvh] max-w-lg gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),16px)]"
        data-crew-guidelines-sheet
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="px-5 pb-1 pt-4">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <SheetTitle className="mt-3 text-[20px] font-bold">Community guidelines</SheetTitle>
          <SheetDescription className="mt-1 text-[14px] leading-snug text-muted-foreground">
            Crew is a place to train and cheer each other on.
          </SheetDescription>
        </div>
        <CrewGuidelines className="px-5 pb-2 pt-3" onLeave={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * A settings row that opens the guidelines: Account → Privacy & data ("settings"), and
 * Crew's Edit profile → Privacy list ("list", that list's own row style).
 */
export function CrewGuidelinesRow({ className, variant = "settings" }: { className?: string; variant?: "settings" | "list" }) {
  const [open, setOpen] = useState(false);
  // mounted on the first tap, then kept for its closing slide
  const [mounted, setMounted] = useState(false);
  const show = () => {
    setMounted(true);
    setOpen(true);
  };
  return (
    <>
      {variant === "list" ? (
        <button type="button" onClick={show} className={cn("flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3 text-left active:bg-muted", className)} data-crew-guidelines-row>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">Community guidelines</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">What's not allowed, and how to report or block</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={show}
          className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-muted/60", className)}
          data-crew-guidelines-row
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Community guidelines</span>
            <span className="block text-[13px] text-muted-foreground">What's not allowed in Crew, and how to report or block</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      )}
      {mounted && <CrewGuidelinesSheet open={open} onOpenChange={setOpen} />}
    </>
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
              <p>Something you posted in Crew went against the community guidelines{warning.note ? ":" : "."}</p>
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
