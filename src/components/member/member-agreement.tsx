import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLocation } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { acceptMembershipAgreement, getMyMembershipAgreement } from "@/lib/membership-agreement.functions";
import { MEMBERSHIP_AGREEMENT_ACKS, MEMBERSHIP_AGREEMENT_SUMMARY } from "@/lib/membership-agreement/acks";
import { getMySetupStatus } from "@/lib/member-setup.functions";

const QUERY_ROOT = "membership-agreement";

function useMembershipAgreement() {
  const { user } = useAuth();
  const fetch = useServerFn(getMyMembershipAgreement);
  return useQuery({
    queryKey: [QUERY_ROOT, user?.id ?? "anon"],
    enabled: !!user?.id,
    queryFn: () => fetch(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

/** Read the short version, open the full text, tick, type your name, accept. */
function MemberAgreementSheet({
  open,
  onOpenChange,
  onNotNow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotNow?: () => void;
}) {
  const qc = useQueryClient();
  const { data } = useMembershipAgreement();
  const accept = useServerFn(acceptMembershipAgreement);
  const [ticks, setTicks] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTicks([]);
      setName("");
    }
  }, [open]);

  if (!data?.applicable) return null;
  const v = data.version;
  const ready = ticks.length === MEMBERSHIP_AGREEMENT_ACKS.length && name.trim().length >= 2;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      await accept({ data: { versionId: v.id, typedName: name.trim(), acks: ticks } });
      await qc.invalidateQueries({ queryKey: [QUERY_ROOT] });
      toast.success("Membership Agreement signed", { description: "Your copy is in Account → Agreement." });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
      void qc.invalidateQueries({ queryKey: [QUERY_ROOT] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" safeTopClose className="h-[95dvh] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className="shrink-0 border-b py-4 pr-4 pl-28 text-left">
            <SheetTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-primary" /> {v.title}
            </SheetTitle>
            <SheetDescription>
              {data.acceptedEarlier
                ? "We updated the agreement. Read what's new and sign to carry on. "
                : data.acceptedAt
                  ? "One last step: confirm the health and safety terms and sign. "
                  : ""}
              Version {v.version_number}
              {v.effective_date ? ` · effective ${fmtDate(v.effective_date)}` : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            <section>
              <h3 className="text-sm font-black">The short version</h3>
              <ul className="mt-2 space-y-1.5">
                {MEMBERSHIP_AGREEMENT_SUMMARY.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-snug">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">The full agreement below is what you're agreeing to.</p>
            </section>

            <details className="group rounded-xl border bg-secondary/20">
              <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-semibold">Read the full agreement</summary>
              <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap border-t px-3 py-3 text-xs leading-relaxed text-foreground/90">
                {v.body}
              </div>
            </details>
            <a
              href="/legal/membership-agreement"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Open it on its own page <ExternalLink className="h-3 w-3" />
            </a>

            <section className="space-y-3">
              {MEMBERSHIP_AGREEMENT_ACKS.map((a) => {
                const on = ticks.includes(a.id);
                return (
                  <label key={a.id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(c) =>
                        setTicks((cur) => (c ? Array.from(new Set([...cur, a.id])) : cur.filter((x) => x !== a.id)))
                      }
                      className="mt-0.5"
                    />
                    <span className="text-sm leading-snug">{a.text}</span>
                  </label>
                );
              })}
            </section>

            <div>
              <Label htmlFor="member-agreement-name" className="text-sm font-semibold">Type your full name to sign</Label>
              <Input
                id="member-agreement-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="mt-1.5 h-11 text-base"
              />
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
            <Button onClick={() => void submit()} disabled={!ready || saving} className="h-12 w-full text-base font-bold">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign and continue
            </Button>
            {onNotNow && (
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={onNotNow}>
                Not now
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Pages a member can always use without being asked (billing, support, account).
const ALLOW = ["/portal/membership", "/portal/account", "/portal/support", "/portal/upgrade"];
const DISMISS_KEY = (uid: string) => `membership-agreement:not-now:${uid}`;

function uiIsClear() {
  return !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

/**
 * Asks a JF member to accept the live Membership Agreement: once each time the
 * app is opened until they do ("Not now" lasts for this launch), after their
 * membership setup is done, and never over another open sheet.
 */
export function MemberAgreementGate() {
  const { user } = useAuth();
  const location = useLocation();
  const { data } = useMembershipAgreement();
  const fetchSetup = useServerFn(getMySetupStatus);
  const { data: setup } = useQuery({ queryKey: ["m-setup-status"], queryFn: () => fetchSetup(), staleTime: 60_000 });
  const [open, setOpen] = useState(false);

  const uid = user?.id ?? "";
  const needed = !!uid && !!data?.applicable && data.needsSigning && setup?.complete !== false;
  const allowed = ALLOW.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (!needed || allowed || open) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY(uid))) return;
    } catch {
      /* private mode: ask anyway */
    }
    const t = window.setInterval(() => {
      if (uiIsClear()) {
        setOpen(true);
        window.clearInterval(t);
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [needed, allowed, open, uid, location.pathname]);

  if (!needed) return null;
  return (
    <MemberAgreementSheet
      open={open}
      onOpenChange={setOpen}
      onNotNow={() => {
        try {
          sessionStorage.setItem(DISMISS_KEY(uid), String(Date.now()));
        } catch {
          /* ignore */
        }
        setOpen(false);
      }}
    />
  );
}

/** Account → Agreement for a JF member: signed (with the date) or a button to review and sign. */
export function MemberAgreementCard() {
  const { data } = useMembershipAgreement();
  const [open, setOpen] = useState(false);
  if (!data?.applicable) return null;
  const v = data.version;
  const done = !!data.signedAt || (!data.needsSigning && !!data.acceptedAt);
  return (
    <Card className="space-y-3 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileSignature className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold">{v.title}</h3>
        </div>
        {done ? (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-500/50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {data.signedAt ? "Signed" : "Accepted"}
          </span>
        ) : data.needsSigning ? (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-500/60 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Action required
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {data.signedAt
          ? `You signed version ${v.version_number} on ${fmtDate(data.signedAt)}.`
          : data.acceptedAt && !data.needsSigning
            ? `You accepted version ${v.version_number} at checkout on ${fmtDate(data.acceptedAt)}.`
            : `Version ${v.version_number} covers your membership, training safety, Crew and billing. It takes about two minutes.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {data.needsSigning && <Button onClick={() => setOpen(true)}>Review and sign</Button>}
        <Button variant="outline" asChild>
          <a href="/legal/membership-agreement" target="_blank" rel="noreferrer">
            Read the agreement <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
      {data.needsSigning && <MemberAgreementSheet open={open} onOpenChange={setOpen} />}
    </Card>
  );
}
